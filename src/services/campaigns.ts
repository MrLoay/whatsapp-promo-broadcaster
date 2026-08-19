import type Database from 'better-sqlite3';
import { config } from '../config';
import { sendCampaignMessage } from '../whatsapp/dispatch';
import { listOptedInContacts, type Contact } from './contacts';
import { getTemplateById, registerTemplate, type MessageTemplate } from './templates';
import { getCreditBalance, deductCredits } from './credits';

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
  mediaMimeType?: string
): Promise<SendSummary> {
  // Automatically prepend greeting and name if the user didn't include it
  let finalMessage = message;
  if (!finalMessage.includes('{{name}}') && !finalMessage.includes('{{1}}')) {
    finalMessage = `{Hello|Hi|Hey|Greetings} {{name}},\n\n${finalMessage}`;
  }

  const campaign = createQuickCampaign(db, owner, `Broadcast ${new Date().toISOString()}`, finalMessage, mediaPath, mediaMimeType);
  return sendCampaign(db, owner, campaign.id, delayMode, customDelay);
}

export function getCampaignById(db: Database.Database, owner: string, id: number): Campaign | undefined {
  return db.prepare('SELECT * FROM campaigns WHERE id = ? AND owner = ?').get(id, owner) as Campaign | undefined;
}

export interface CampaignWithStats extends Campaign {
  template_name: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export function listCampaignsWithStats(db: Database.Database, owner: string): CampaignWithStats[] {
  return db
    .prepare(
      `SELECT c.*, t.name as template_name,
         SUM(CASE WHEN cr.status = 'sent' THEN 1 ELSE 0 END) as sent,
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
  customDelaySec: number = 120
): Promise<SendSummary> {
  const campaign = getCampaignById(db, owner, campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const template = getTemplateById(db, owner, campaign.template_id) as MessageTemplate;
  const fixedVariableValues: string[] = JSON.parse(campaign.variable_values ?? '[]');

  db.prepare(`UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?`).run(campaignId);

  // Only recipients already sent/delivered/read are done -- 'failed' ones are
  // retried on the next call, so re-running a campaign fixes transient errors
  // (e.g. the whatsapp-web.js "no message id" quirk) without creating duplicates.
  const alreadyDone = new Set(
    (
      db
        .prepare(`SELECT contact_id FROM campaign_recipients WHERE campaign_id = ? AND status != 'failed'`)
        .all(campaignId) as { contact_id: number }[]
    ).map((r) => r.contact_id)
  );

  const candidates: Contact[] = listOptedInContacts(db, owner).filter((c) => !alreadyDone.has(c.id));

  const summary: SendSummary = { campaignId, totalTargeted: candidates.length, sent: 0, failed: 0, throttledOut: 0 };
  let recentlyMessaged = countRecentlyMessaged(db, owner);
  const defaultIntervalMs = 1000 / Math.max(1, config.throttle.messagesPerSecond);

  const upsertRecipient = db.prepare(
    `INSERT INTO campaign_recipients (campaign_id, contact_id, status, wamid, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, contact_id) DO UPDATE SET
       status = excluded.status, wamid = excluded.wamid, error = excluded.error, sent_at = excluded.sent_at`
  );

  let isFirst = true;
  for (const contact of candidates) {
    if (recentlyMessaged >= config.throttle.tierLimitPer24h) {
      summary.throttledOut++;
      continue;
    }

    // Determine delay BEFORE sending next message (except first message)
    if (!isFirst) {
      let sleepTimeMs = defaultIntervalMs;
      if (delayMode === 'old_acc') {
        // 2 to 5 minutes randomized (120,000ms to 300,000ms)
        sleepTimeMs = Math.floor(120000 + Math.random() * 180000);
      } else if (delayMode === 'moderate') {
        // 10 to 30 seconds randomized (10,000ms to 30,000ms)
        sleepTimeMs = Math.floor(10000 + Math.random() * 20000);
      } else if (delayMode === 'custom') {
        sleepTimeMs = Math.max(1000, customDelaySec * 1000);
      }
      await sleep(sleepTimeMs);
    }
    isFirst = false;

    try {
      const balance = getCreditBalance(db, owner);
      if (balance <= 0) {
        throw new Error('Insufficient credits. Please top up.');
      }
      if (!deductCredits(db, owner, 1)) {
        throw new Error('Failed to deduct credits.');
      }

      const variableValues = template.personalize_name ? [contact.name ?? ''] : fixedVariableValues;
      const result = await sendCampaignMessage(owner, contact.phone, template, variableValues);
      upsertRecipient.run(campaignId, contact.id, 'sent', result.id, null, new Date().toISOString());
      summary.sent++;
      recentlyMessaged++;
    } catch (err) {
      upsertRecipient.run(campaignId, contact.id, 'failed', null, (err as Error).message, null);
      summary.failed++;
      if ((err as Error).message.includes('credits')) {
        break; // Stop campaign if out of credits
      }
    }
  }

  const finalStatus = summary.failed > 0 && summary.sent === 0 ? 'failed' : 'completed';
  db.prepare(`UPDATE campaigns SET status = ?, completed_at = datetime('now') WHERE id = ?`).run(finalStatus, campaignId);

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
