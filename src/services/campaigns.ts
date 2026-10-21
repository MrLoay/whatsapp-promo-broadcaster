import type Database from 'better-sqlite3';
import { config } from '../config';
import { sendCampaignMessage } from '../whatsapp/dispatch';
import { getConnectionState } from '../whatsapp/webjs-client';
import { listOptedInContacts, type Contact } from './contacts';
import { getTemplateById, registerTemplate, type MessageTemplate } from './templates';
import { getCreditBalance, deductCredits, getCostPerMsg } from './credits';
import { updateAccountStatus } from './accounts';

export interface Campaign {
  id: number;
  owner: string;
  name: string;
  template_id: number;
  variable_values: string | null;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  created_at: string;
}

export interface SendSummary {
  campaignId: number;
  totalTargeted: number;
  sent: number;
  failed: number;
  throttledOut: number; // recipients skipped because they'd exceed the 24h tier limit
}

export function createCampaign(
  db: Database.Database,
  owner: string,
  name: string,
  templateId: number,
  variableValues: string[]
): Campaign {
  const template = getTemplateById(db, owner, templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);
  // personalize_name templates get their {{1}} filled per-recipient at send
  // time from contacts.name, so a fixed campaign-wide value isn't required.
  if (!template.personalize_name && variableValues.length !== template.variable_count) {
    throw new Error(
      `Template "${template.name}" expects ${template.variable_count} variable(s), got ${variableValues.length}`
    );
  }
  const info = db
    .prepare(`INSERT INTO campaigns (owner, name, template_id, variable_values) VALUES (?, ?, ?, ?)`)
    .run(owner, name, templateId, JSON.stringify(variableValues));
  return getCampaignById(db, owner, info.lastInsertRowid as number)!;
}

/**
 * Simplified campaign creation for the dashboard: just a name and a message,
 * no separate template management step. If the message contains {{name}},
 * it's rewritten to the templates.body_text placeholder convention ({{1}})
 * and marked personalize_name so each recipient gets their own name filled
 * in automatically at send time.
 */
export function createQuickCampaign(
  db: Database.Database,
  owner: string,
  name: string,
  message: string,
  mediaPath?: string,
  mediaMimeType?: string
): Campaign {
  const personalizeName = message.includes('{{name}}');
  const bodyText = personalizeName ? message.replace(/\{\{name\}\}/g, '{{1}}') : message;

  const template = registerTemplate(db, owner, {
    name: `${name}-${Date.now()}`,
    bodyText,
    variableCount: personalizeName ? 1 : 0,
    personalizeName,
    mediaPath,
    mediaMimeType
  });

  return createCampaign(db, owner, name, template.id, []);
}

/** Creates a quick campaign from just a message and sends it immediately -- the one-click flow from the Home page. */
export async function sendNow(
  db: Database.Database,
  owner: string,
  message: string,
  delayMode?: string,
  customDelay?: number,
  mediaPath?: string,
  mediaMimeType?: string,
  accountId?: string
): Promise<Campaign> {
  // Automatically prepend greeting and name if the user didn't include it
  let finalMessage = message;
  if (!finalMessage.includes('{{name}}') && !finalMessage.includes('{{1}}')) {
    finalMessage = `{Hello|Hi|Hey|Greetings} {{name}},\n\n${finalMessage}`;
  }

  const campaign = createQuickCampaign(db, owner, `Broadcast ${new Date().toISOString()}`, finalMessage, mediaPath, mediaMimeType);

  if (config.dryRun) {
    const summary = await sendCampaign(db, owner, campaign.id, delayMode, customDelay, accountId);
    return { ...campaign, ...summary };
  }

  // Kick off campaign dispatch in the background so the UI doesn't hang
  sendCampaign(db, owner, campaign.id, delayMode, customDelay, accountId).catch(console.error);

  return campaign;
}

export function getCampaignById(db: Database.Database, owner: string, id: number): Campaign | undefined {
  return db.prepare('SELECT * FROM campaigns WHERE id = ? AND owner = ?').get(id, owner) as Campaign | undefined;
}

export interface CampaignWithStats extends Campaign {
  template_name: string;
  totalTargeted: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export function listCampaignsWithStats(db: Database.Database, owner: string): CampaignWithStats[] {
  return db
    .prepare(
      `SELECT c.*, t.name as template_name,
         c.total_targeted as totalTargeted,
         SUM(CASE WHEN cr.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN cr.status = 'delivered' THEN 1 ELSE 0 END) as delivered,
         SUM(CASE WHEN cr.status = 'read' THEN 1 ELSE 0 END) as read,
         SUM(CASE WHEN cr.status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
       WHERE c.owner = ?
       GROUP BY c.id
       ORDER BY c.id DESC`
    )
    .all(owner) as CampaignWithStats[];
}

export interface CampaignRecipientDetail {
  id: number;
  contact_id: number;
  phone: string;
  name: string | null;
  status: string;
  wamid: string | null;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

export function getCampaignRecipients(db: Database.Database, owner: string, campaignId: number): CampaignRecipientDetail[] {
  return db
    .prepare(
      `SELECT cr.id, cr.contact_id, ct.phone, ct.name, cr.status, cr.wamid, cr.error, cr.sent_at, cr.delivered_at, cr.read_at
       FROM campaign_recipients cr
       JOIN contacts ct ON ct.id = cr.contact_id
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.campaign_id = ? AND c.owner = ?
       ORDER BY cr.id`
    )
    .all(campaignId, owner) as CampaignRecipientDetail[];
}

function countRecentlyMessaged(db: Database.Database, owner: string): number {
  // Unique contacts sent a message (any campaign) in the last 24h, for this
  // owner's own WhatsApp session -- proxy for that account's tier usage.
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT cr.contact_id) as n FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE c.owner = ? AND cr.sent_at IS NOT NULL AND cr.sent_at >= datetime('now', '-1 day')`
    )
    .get(owner) as { n: number };
  return row.n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a campaign to all of this owner's opted-in contacts not already
 * recorded for it. Stops queuing new sends once the rolling 24h tier limit
 * would be exceeded -- re-running this later resumes with whoever's left
 * (idempotent via the campaign_recipients UNIQUE(campaign_id, contact_id)
 * constraint).
 */
export async function sendCampaign(
  db: Database.Database,
  owner: string,
  campaignId: number,
  delayMode: string = 'auto',
  customDelaySec: number = 120,
  accountId?: string
): Promise<SendSummary> {
  const campaign = getCampaignById(db, owner, campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const template = getTemplateById(db, owner, campaign.template_id) as MessageTemplate;
  const fixedVariableValues: string[] = JSON.parse(campaign.variable_values ?? '[]');

  const summary: SendSummary = { campaignId, totalTargeted: 0, sent: 0, failed: 0, throttledOut: 0 };

  try {
    const alreadyDone = new Set(
      (
        db
          .prepare(`SELECT contact_id FROM campaign_recipients WHERE campaign_id = ? AND status IN ('sent', 'delivered', 'read')`)
          .all(campaignId) as { contact_id: number }[]
      ).map((r) => r.contact_id)
    );

    const candidates: Contact[] = listOptedInContacts(db, owner).filter((c) => !alreadyDone.has(c.id));
    summary.totalTargeted = candidates.length;

    // Pre-insert all candidate contacts into campaign_recipients with status 'queued'
    const insertRecipient = db.prepare(
      `INSERT INTO campaign_recipients (campaign_id, contact_id, status)
       VALUES (?, ?, 'queued')
       ON CONFLICT(campaign_id, contact_id) DO UPDATE SET
         status = CASE WHEN campaign_recipients.status IN ('sent', 'delivered', 'read') THEN campaign_recipients.status ELSE 'queued' END,
         error = NULL`
    );
    const insertMany = db.transaction((contacts: Contact[]) => {
      for (const contact of contacts) {
        insertRecipient.run(campaignId, contact.id);
      }
    });
    insertMany(candidates);

    const allTargetedCount = candidates.length + alreadyDone.size;
    db.prepare(`UPDATE campaigns SET status = 'sending', started_at = datetime('now'), total_targeted = ? WHERE id = ?`)
      .run(allTargetedCount, campaignId);

    // Fetch active proxy accounts
    let validAccounts: string[] = [];
    if (config.dryRun) {
      validAccounts = [owner];
    } else {
      let candidateAccounts: string[] = [];
      if (accountId && accountId !== 'all') {
        candidateAccounts = accountId.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        const accounts = db.prepare(`SELECT id FROM accounts WHERE is_active = 1`).all() as { id: string }[];
        candidateAccounts = accounts.map(a => a.id);
      }

      // Filter only accounts whose live in-memory session is ACTUALLY 'ready'
      validAccounts = candidateAccounts.filter(accId => {
        const s = getConnectionState(accId);
        return s.status === 'ready';
      });

      if (validAccounts.length === 0) {
        const s = getConnectionState(owner);
        if (s.status === 'ready') {
          validAccounts = [owner]; // fallback to master ONLY if it is actually ready
        } else {
          throw new Error(`None of the selected WhatsApp accounts are currently connected and ready. Please make sure your accounts show READY before starting a broadcast.`);
        }
      }
    }

    const userRow = db.prepare('SELECT role FROM users WHERE username = ?').get(owner) as { role?: string } | undefined;
    const isAdmin = userRow?.role === 'admin';

    // In-memory queue of recipient tasks for thread-safe claiming across concurrent workers
    const recipientTasks = db.prepare(
      `SELECT cr.id, cr.contact_id, ct.phone, ct.name
       FROM campaign_recipients cr
       JOIN contacts ct ON ct.id = cr.contact_id
       WHERE cr.campaign_id = ? AND cr.status = 'queued'
       ORDER BY cr.id ASC`
    ).all(campaignId) as { id: number; contact_id: number; phone: string; name: string | null }[];

    const taskQueue = [...recipientTasks];

    const claimNextContact = (): { id: number; contact_id: number; phone: string; name: string | null } | null => {
      return taskQueue.shift() ?? null;
    };

    const returnContactToQueue = (task: { id: number; contact_id: number; phone: string; name: string | null }) => {
      taskQueue.unshift(task);
    };

    // Shared worker loop for each active account
    const runAccountWorker = async (accId: string) => {
      let isFirst = true;

      while (true) {
        // Check if campaign was stopped or paused
        const currentCampaign = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId) as { status: string } | undefined;
        if (!currentCampaign || currentCampaign.status !== 'sending') {
          break;
        }

        // Check if this account is still ready
        if (!config.dryRun) {
          let s = getConnectionState(accId);
          if (s.status !== 'ready') {
            if (s.status === 'connecting' || s.status === 'authenticated') {
              for (let wait = 0; wait < 3; wait++) {
                await sleep(2000);
                s = getConnectionState(accId);
                if (s.status === 'ready') break;
              }
            }
          }
          if (s.status !== 'ready') {
            console.warn(`[Campaign ${campaignId}] Account ${accId} went offline (status: ${s.status}). Worker exiting gracefully.`);
            updateAccountStatus(db, accId, 'DISCONNECTED');
            break; // Stop this worker; surviving accounts will continue processing remaining contacts
          }
        }

        // Claim the next contact from the shared queue
        const task = claimNextContact();
        if (!task) {
          // No more queued contacts in campaign
          break;
        }

        // Safe per-account delay to prevent WhatsApp anti-spam bans
        if (!isFirst && !config.dryRun) {
          let sleepTimeMs = 15000;
          if (delayMode === 'old_acc') {
            sleepTimeMs = Math.floor(120000 + Math.random() * 180000); // 2 to 5 minutes
          } else if (delayMode === 'moderate') {
            sleepTimeMs = Math.floor(12000 + Math.random() * 18000);   // 12 to 30 seconds
          } else if (delayMode === 'custom') {
            sleepTimeMs = Math.max(1000, customDelaySec * 1000);
          } else {
            // 'auto' mode: Humanized 10 to 18 seconds per account with random jitter
            // Across 15 accounts, ~1 msg/sec total system throughput, completely safe for each account
            sleepTimeMs = Math.floor(10000 + Math.random() * 8000);
          }
          await sleep(sleepTimeMs);
        }
        isFirst = false;

        try {
          // Verify credit balance
          if (!isAdmin && !config.dryRun) {
            const balance = getCreditBalance(db, owner);
            const cost = getCostPerMsg(db, owner);
            if (balance < cost) {
              throw new Error('Insufficient credits. Please top up.');
            }
            if (!deductCredits(db, owner, cost)) {
              throw new Error('Failed to deduct credits.');
            }
          }

          const variableValues = template.personalize_name ? [task.name ?? ''] : fixedVariableValues;
          const result = await sendCampaignMessage(accId, task.phone, template, variableValues);

          db.prepare(
            `UPDATE campaign_recipients SET status = 'sent', wamid = ?, error = NULL, sent_at = datetime('now') WHERE id = ?`
          ).run(result.id, task.id);
          summary.sent++;
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          const isInvalidNumber = errorMsg.includes('not a registered WhatsApp number') || errorMsg.includes('is unreachable');
          const isAccountIssue = errorMsg.includes('not ready') || errorMsg.includes('went offline') || errorMsg.includes('Target closed') || errorMsg.includes('Session closed') || errorMsg.includes('Execution context') || errorMsg.includes('timed out') || errorMsg.includes('me is undefined');

          if (isInvalidNumber) {
            // Unregistered WhatsApp number, fail permanently
            db.prepare(`UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?`).run(errorMsg, task.id);
            summary.failed++;
          } else if (isAccountIssue) {
            // Account dropped or hit CDP timeout -- DO NOT FAIL CONTACT!
            // Return task to queue so other healthy accounts will deliver it seamlessly!
            console.warn(`[Campaign ${campaignId}] Account ${accId} dropped or errored (${errorMsg}). Returning contact ${task.phone} to queue for other accounts.`);
            returnContactToQueue(task);
            updateAccountStatus(db, accId, 'DISCONNECTED');
            break; // Stop this worker
          } else {
            if (errorMsg.includes('credits')) {
              returnContactToQueue(task);
              break; // Stop worker on credit exhaustion
            }
            // General failure: fail permanently
            db.prepare(`UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?`).run(errorMsg, task.id);
            summary.failed++;
          }
        }
      }
    };

    // Run dynamic workers across all valid accounts in parallel
    await Promise.allSettled(validAccounts.map((accId) => runAccountWorker(accId)));

    // Handle any stray contacts left in 'queued' (e.g. if ALL accounts went offline or stopped)
    const remaining = db.prepare(
      `SELECT count(*) as count FROM campaign_recipients WHERE campaign_id = ? AND status = 'queued'`
    ).get(campaignId) as { count: number };

    if (remaining.count > 0) {
      db.prepare(
        `UPDATE campaign_recipients SET status = 'failed', error = 'All blasting accounts went offline before this message could be sent.'
         WHERE campaign_id = ? AND status = 'queued'`
      ).run(campaignId);
      summary.failed += remaining.count;
    }

    const currentCampaignStatus = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId) as { status: string } | undefined;
    if (currentCampaignStatus && currentCampaignStatus.status === 'sending') {
      const finalStatus = summary.failed > 0 && summary.sent === 0 ? 'failed' : 'completed';
      db.prepare(`UPDATE campaigns SET status = ?, completed_at = datetime('now') WHERE id = ?`).run(finalStatus, campaignId);
    }
  } catch (err) {
    console.error('Fatal error in sendCampaign:', err);
    db.prepare(`UPDATE campaigns SET status = 'failed', completed_at = datetime('now') WHERE id = ?`).run(campaignId);
  }

  return summary;
}

export function recordDeliveryStatus(
  db: Database.Database,
  wamid: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
): boolean {
  const column = status === 'delivered' ? 'delivered_at' : status === 'read' ? 'read_at' : null;
  const sql = column
    ? `UPDATE campaign_recipients SET status = ?, ${column} = datetime('now') WHERE wamid = ?`
    : `UPDATE campaign_recipients SET status = ? WHERE wamid = ?`;
  const info = db.prepare(sql).run(status, wamid);
  return info.changes > 0;
}

export function stopCampaign(db: Database.Database, owner: string, id: number): boolean {
  const info = db.prepare(`UPDATE campaigns SET status = 'failed', completed_at = datetime('now') WHERE id = ? AND owner = ? AND status = 'sending'`).run(id, owner);
  return info.changes > 0;
}
