import type Database from 'better-sqlite3';
import { config } from '../config';
import { sendCampaignMessage } from '../whatsapp/dispatch';
import { listOptedInContacts, type Contact } from './contacts';
import { getTemplateById, registerTemplate, type MessageTemplate } from './templates';

export interface Campaign {
  id: number;
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
  name: string,
  templateId: number,
  variableValues: string[]
): Campaign {
  const template = getTemplateById(db, templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);
  // personalize_name templates get their {{1}} filled per-recipient at send
  // time from contacts.name, so a fixed campaign-wide value isn't required.
  if (!template.personalize_name && variableValues.length !== template.variable_count) {
    throw new Error(
      `Template "${template.name}" expects ${template.variable_count} variable(s), got ${variableValues.length}`
    );
  }
  const info = db
    .prepare(`INSERT INTO campaigns (name, template_id, variable_values) VALUES (?, ?, ?)`)
    .run(name, templateId, JSON.stringify(variableValues));
  return getCampaignById(db, info.lastInsertRowid as number)!;
}

/**
 * Simplified campaign creation for the dashboard: just a name and a message,
 * no separate template management step. If the message contains {{name}},
 * it's rewritten to the templates.body_text placeholder convention ({{1}})
 * and marked personalize_name so each recipient gets their own name filled
 * in automatically at send time.
 */
export function createQuickCampaign(db: Database.Database, name: string, message: string): Campaign {
  const personalizeName = message.includes('{{name}}');
  const bodyText = personalizeName ? message.replace(/\{\{name\}\}/g, '{{1}}') : message;

  const template = registerTemplate(db, {
    name: `${name}-${Date.now()}`,
    bodyText,
    variableCount: personalizeName ? 1 : 0,
    personalizeName,
  });

  return createCampaign(db, name, template.id, []);
}

/** Creates a quick campaign from just a message and sends it immediately -- the one-click flow from the Home page. */
export async function sendNow(db: Database.Database, message: string): Promise<SendSummary> {
  const campaign = createQuickCampaign(db, `Broadcast ${new Date().toISOString()}`, message);
  return sendCampaign(db, campaign.id);
}

export function getCampaignById(db: Database.Database, id: number): Campaign | undefined {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Campaign | undefined;
}

export interface CampaignWithStats extends Campaign {
  template_name: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export function listCampaignsWithStats(db: Database.Database): CampaignWithStats[] {
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
       GROUP BY c.id
       ORDER BY c.id DESC`
    )
    .all() as CampaignWithStats[];
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

export function getCampaignRecipients(db: Database.Database, campaignId: number): CampaignRecipientDetail[] {
  return db
    .prepare(
      `SELECT cr.id, cr.contact_id, ct.phone, ct.name, cr.status, cr.wamid, cr.error, cr.sent_at, cr.delivered_at, cr.read_at
       FROM campaign_recipients cr
       JOIN contacts ct ON ct.id = cr.contact_id
       WHERE cr.campaign_id = ?
       ORDER BY cr.id`
    )
    .all(campaignId) as CampaignRecipientDetail[];
}

function countRecentlyMessaged(db: Database.Database): number {
  // Unique contacts sent a message (any campaign) in the last 24h -- proxy for tier usage.
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT contact_id) as n FROM campaign_recipients
       WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-1 day')`
    )
    .get() as { n: number };
  return row.n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a campaign to all opted-in contacts not already recorded for it.
 * Stops queuing new sends once the rolling 24h tier limit would be exceeded --
 * re-running this later resumes with whoever's left (idempotent via the
 * campaign_recipients UNIQUE(campaign_id, contact_id) constraint).
 */
export async function sendCampaign(db: Database.Database, campaignId: number): Promise<SendSummary> {
  const campaign = getCampaignById(db, campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const template = getTemplateById(db, campaign.template_id) as MessageTemplate;
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

  const candidates: Contact[] = listOptedInContacts(db).filter((c) => !alreadyDone.has(c.id));

  const summary: SendSummary = { campaignId, totalTargeted: candidates.length, sent: 0, failed: 0, throttledOut: 0 };
  let recentlyMessaged = countRecentlyMessaged(db);
  const intervalMs = 1000 / Math.max(1, config.throttle.messagesPerSecond);

  const upsertRecipient = db.prepare(
    `INSERT INTO campaign_recipients (campaign_id, contact_id, status, wamid, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, contact_id) DO UPDATE SET
       status = excluded.status, wamid = excluded.wamid, error = excluded.error, sent_at = excluded.sent_at`
  );

  for (const contact of candidates) {
    if (recentlyMessaged >= config.throttle.tierLimitPer24h) {
      summary.throttledOut++;
      continue;
    }

    try {
      const variableValues = template.personalize_name ? [contact.name ?? ''] : fixedVariableValues;
      const result = await sendCampaignMessage(contact.phone, template, variableValues);
      upsertRecipient.run(campaignId, contact.id, 'sent', result.id, null, new Date().toISOString());
      summary.sent++;
      recentlyMessaged++;
    } catch (err) {
      upsertRecipient.run(campaignId, contact.id, 'failed', null, (err as Error).message, null);
      summary.failed++;
    }

    await sleep(intervalMs);
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
