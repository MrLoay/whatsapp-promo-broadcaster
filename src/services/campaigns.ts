import type Database from 'better-sqlite3';
import { config } from '../config';
import { sendTemplateMessage } from '../whatsapp/client';
import { listOptedInContacts, type Contact } from './contacts';
import { getTemplateById, type MessageTemplate } from './templates';

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
  if (variableValues.length !== template.variable_count) {
    throw new Error(
      `Template "${template.name}" expects ${template.variable_count} variable(s), got ${variableValues.length}`
    );
  }
  const info = db
    .prepare(`INSERT INTO campaigns (name, template_id, variable_values) VALUES (?, ?, ?)`)
    .run(name, templateId, JSON.stringify(variableValues));
  return getCampaignById(db, info.lastInsertRowid as number)!;
}

export function getCampaignById(db: Database.Database, id: number): Campaign | undefined {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Campaign | undefined;
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
  const variableValues: string[] = JSON.parse(campaign.variable_values ?? '[]');

  db.prepare(`UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?`).run(campaignId);

  const alreadyTargeted = new Set(
    (db.prepare('SELECT contact_id FROM campaign_recipients WHERE campaign_id = ?').all(campaignId) as { contact_id: number }[]).map(
      (r) => r.contact_id
    )
  );

  const candidates: Contact[] = listOptedInContacts(db).filter((c) => !alreadyTargeted.has(c.id));

  const summary: SendSummary = { campaignId, totalTargeted: candidates.length, sent: 0, failed: 0, throttledOut: 0 };
  let recentlyMessaged = countRecentlyMessaged(db);
  const intervalMs = 1000 / Math.max(1, config.throttle.messagesPerSecond);

  const insertRecipient = db.prepare(
    `INSERT INTO campaign_recipients (campaign_id, contact_id, status, wamid, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const contact of candidates) {
    if (recentlyMessaged >= config.throttle.tierLimitPer24h) {
      summary.throttledOut++;
      continue;
    }

    try {
      const result = await sendTemplateMessage(contact.phone, template.meta_template_name, template.language, variableValues);
      insertRecipient.run(campaignId, contact.id, 'sent', result.wamid, null, new Date().toISOString());
      summary.sent++;
      recentlyMessaged++;
    } catch (err) {
      insertRecipient.run(campaignId, contact.id, 'failed', null, (err as Error).message, null);
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
