import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db';
import { importContactsFromCsv } from '../src/services/contacts';
import { registerTemplate } from '../src/services/templates';
import { createCampaign, sendCampaign, recordDeliveryStatus, getCampaignById } from '../src/services/campaigns';

describe('campaigns service (DRY_RUN)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    importContactsFromCsv(
      db,
      `phone,name,skip\n+15551111111,Alice,false\n+15552222222,Bob,false\n+15553333333,Carl,true`
    );
  });

  it('creates a campaign and validates variable count against the template', () => {
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off this summer!', language: 'en_US', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    expect(campaign.status).toBe('draft');

    expect(() => createCampaign(db, 'Bad', template.id, [])).toThrow(/expects 1 variable/);
  });

  it('sends only to opted-in contacts and records recipient rows (dry run, no network)', async () => {
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off this summer!', language: 'en_US', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);

    const summary = await sendCampaign(db, campaign.id);

    expect(summary.totalTargeted).toBe(2); // Alice + Bob, not Carl (not opted in)
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);

    const completed = getCampaignById(db, campaign.id);
    expect(completed?.status).toBe('completed');

    const recipients = db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ?').all(campaign.id) as any[];
    expect(recipients).toHaveLength(2);
    expect(recipients.every((r) => r.status === 'sent' && r.wamid?.startsWith('dryrun-'))).toBe(true);
  });

  it('is idempotent: re-sending a completed campaign does not duplicate recipients', async () => {
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off this summer!', language: 'en_US', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);

    await sendCampaign(db, campaign.id);
    const secondRun = await sendCampaign(db, campaign.id);

    expect(secondRun.totalTargeted).toBe(0);
    const recipients = db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ?').all(campaign.id) as any[];
    expect(recipients).toHaveLength(2);
  });

  it('recordDeliveryStatus updates recipient status by wamid', async () => {
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off this summer!', language: 'en_US', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    await sendCampaign(db, campaign.id);

    const recipient = db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ? LIMIT 1').get(campaign.id) as any;
    const changed = recordDeliveryStatus(db, recipient.wamid, 'delivered');

    expect(changed).toBe(true);
    const updated = db.prepare('SELECT * FROM campaign_recipients WHERE id = ?').get(recipient.id) as any;
    expect(updated.status).toBe('delivered');
    expect(updated.delivered_at).not.toBeNull();
  });
});
