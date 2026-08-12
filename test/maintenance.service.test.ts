import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { cleanupOldLogs, vacuumDb } from '../src/services/maintenance';

describe('Database Maintenance Service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
    db.exec(schemaSql);
  });

  it('purges logs older than specified days', () => {
    db.prepare("INSERT INTO contacts (owner, phone, name) VALUES ('test', '+15550000001', 'User 1')").run();
    db.prepare("INSERT INTO contacts (owner, phone, name) VALUES ('test', '+15550000002', 'User 2')").run();
    db.prepare("INSERT INTO templates (id, owner, name, body_text) VALUES (1, 'test', 'T1', 'Body')").run();
    db.prepare("INSERT INTO campaigns (id, owner, name, template_id, status) VALUES (1, 'test', 'Summer Campaign', 1, 'completed')").run();

    db.prepare(`
      INSERT INTO campaign_recipients (campaign_id, contact_id, status, sent_at)
      VALUES (1, 1, 'sent', datetime('now', '-31 days'))
    `).run();

    db.prepare(`
      INSERT INTO campaign_recipients (campaign_id, contact_id, status, sent_at)
      VALUES (1, 2, 'sent', datetime('now', '-5 days'))
    `).run();

    db.prepare(`
      INSERT INTO inbound_messages (owner, contact_phone, body, received_at)
      VALUES ('test', '+15550000001', 'Old msg', datetime('now', '-40 days'))
    `).run();

    const result = cleanupOldLogs(db, 30);
    expect(result.deletedRecipients).toBe(1);
    expect(result.deletedInbound).toBe(1);

    const remainingRecipients = db.prepare('SELECT COUNT(*) as count FROM campaign_recipients').get() as { count: number };
    expect(remainingRecipients.count).toBe(1);
  });

  it('runs VACUUM successfully', () => {
    expect(() => vacuumDb(db)).not.toThrow();
  });
});
