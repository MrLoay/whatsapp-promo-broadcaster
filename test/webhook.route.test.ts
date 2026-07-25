import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { openDb, setDbForTests } from '../src/db';
import { importContactsFromCsv } from '../src/services/contacts';
import { registerTemplate } from '../src/services/templates';
import { createCampaign, sendCampaign } from '../src/services/campaigns';
import { createApp } from '../src/server';
import { config } from '../src/config';

describe('webhook route', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    setDbForTests(db);
    app = createApp();
    // No META_APP_SECRET configured in test env, so signature check is skipped (see signature.ts).
    config.webhook.verifyToken = 'test-verify-token';
  });

  it('responds to the GET verification handshake with the challenge', async () => {
    const res = await request(app)
      .get('/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('rejects the GET handshake with a wrong verify token', async () => {
    const res = await request(app)
      .get('/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });

    expect(res.status).toBe(403);
  });

  it('updates campaign_recipients status on a delivery status webhook event', async () => {
    importContactsFromCsv(db, `phone,name,opted_in\n+15551111111,Alice,true`);
    const template = registerTemplate(db, { name: 'summer-sale', metaTemplateName: 'summer_sale_promo', bodyText: 'Enjoy {{1}} off this summer!', language: 'en_US', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    await sendCampaign(db, campaign.id);

    const recipient = db.prepare('SELECT * FROM campaign_recipients LIMIT 1').get() as any;

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: recipient.wamid, status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(200);
    const updated = db.prepare('SELECT * FROM campaign_recipients WHERE id = ?').get(recipient.id) as any;
    expect(updated.status).toBe('delivered');
  });

  it('marks a contact opted_out when they reply STOP', async () => {
    importContactsFromCsv(db, `phone,name,opted_in\n+15551111111,Alice,true`);

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '15551111111', text: { body: 'STOP' } }],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(200);
    const contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get('+15551111111') as any;
    expect(contact.opt_in_status).toBe('opted_out');

    const inbound = db.prepare('SELECT * FROM inbound_messages').all() as any[];
    expect(inbound).toHaveLength(1);
    expect(inbound[0].triggered_opt_out).toBe(1);
  });
});
