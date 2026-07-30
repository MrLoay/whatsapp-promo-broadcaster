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
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off!', variableCount: 1 });
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
    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off!', variableCount: 1 });
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

  it('GET /whatsapp/status reports idle when no session has been started', async () => {
    const res = await agent.get('/whatsapp/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
  });

  it('POST /whatsapp/disconnect is a safe no-op when nothing is connected', async () => {
    const res = await agent.post('/whatsapp/disconnect');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disconnected: true });
  });

  it('DELETE /contacts/:id removes the contact and their send history', async () => {
    const add = await agent.post('/contacts').send({ phone: '+15551234567', name: 'Alice', opted_in: true });
    const contactId = add.body.id;

    const template = registerTemplate(db, { name: 'summer-sale', bodyText: 'Enjoy {{1}} off!', variableCount: 1 });
    const campaign = createCampaign(db, 'Summer Sale', template.id, ['20%']);
    await sendCampaign(db, campaign.id);
    expect(db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE contact_id = ?').get(contactId).n).toBe(1);

    const del = await agent.delete(`/contacts/${contactId}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE contact_id = ?').get(contactId).n).toBe(0);

    const missing = await agent.delete(`/contacts/${contactId}`);
    expect(missing.status).toBe(404);
  });

  it('POST /campaigns/send-now creates and immediately sends a campaign to all opted-in contacts', async () => {
    await agent.post('/contacts').send({ phone: '+15551111111', name: 'Alice', opted_in: true });
    await agent.post('/contacts').send({ phone: '+15552222222', name: 'Bob', opted_in: false });

    const res = await agent.post('/campaigns/send-now').send({ message: 'Hi {{name}}, enjoy 20% off!' });
    expect(res.status).toBe(200);
    expect(res.body.totalTargeted).toBe(1); // only Alice, Bob isn't opted in
    expect(res.body.sent).toBe(1);

    const campaigns = await agent.get('/campaigns');
    expect(campaigns.body).toHaveLength(1);
    expect(campaigns.body[0].status).toBe('completed');
  });

  it('POST /campaigns/send-now requires a message', async () => {
    const res = await agent.post('/campaigns/send-now').send({});
    expect(res.status).toBe(400);
  });
});
