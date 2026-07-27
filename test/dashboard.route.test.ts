import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { openDb, setDbForTests } from '../src/db';
import { createApp } from '../src/server';
import { registerTemplate } from '../src/services/templates';
import { createCampaign, sendCampaign } from '../src/services/campaigns';

describe('dashboard-facing routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    db = openDb(':memory:');
    setDbForTests(db);
    app = createApp();
    agent = request.agent(app);
    await agent.post('/auth/login').send({ username: 'testuser', password: 'testpass123' });
  });

  it('adds a single contact via POST /contacts', async () => {
    const res = await agent.post('/contacts').send({ phone: '+15551234567', name: 'Alice', opted_in: true });
    expect(res.status).toBe(201);
    expect(res.body.opt_in_status).toBe('opted_in');

    const rejected = await agent.post('/contacts').send({ phone: 'not-a-phone' });
    expect(rejected.status).toBe(400);
  });

  it('lists campaigns with per-status recipient stats via GET /campaigns', async () => {
    const template = registerTemplate(db, { name: 'summer-sale', metaTemplateName: 'summer_sale_promo', bodyText: 'Enjoy {{1}} off!', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    db.prepare(`INSERT INTO contacts (phone, opt_in_status) VALUES ('+15551111111', 'opted_in')`).run();
    await sendCampaign(db, campaign.id);

    const res = await agent.get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].template_name).toBe('summer-sale');
    expect(res.body[0].sent).toBe(1);
  });

  it('returns per-recipient detail via GET /campaigns/:id/recipients', async () => {
    const template = registerTemplate(db, { name: 'summer-sale', metaTemplateName: 'summer_sale_promo', bodyText: 'Enjoy {{1}} off!', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    db.prepare(`INSERT INTO contacts (phone, name, opt_in_status) VALUES ('+15551111111', 'Alice', 'opted_in')`).run();
    await sendCampaign(db, campaign.id);

    const res = await agent.get(`/campaigns/${campaign.id}/recipients`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].phone).toBe('+15551111111');
    expect(res.body[0].status).toBe('sent');
  });

  it('lists inbound messages via GET /inbound-messages', async () => {
    db.prepare(`INSERT INTO inbound_messages (contact_phone, body, triggered_opt_out) VALUES ('+15551111111', 'STOP', 1)`).run();

    const res = await agent.get('/inbound-messages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].triggered_opt_out).toBe(1);
  });

  it('GET /whatsapp/status reports not_applicable on the cloud_api provider', async () => {
    const res = await agent.get('/whatsapp/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: 'cloud_api', status: 'not_applicable' });
  });
});
