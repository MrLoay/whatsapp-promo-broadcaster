import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import request from 'supertest';
import { openDb, setDbForTests } from '../src/db';
import { importContactsFromCsv } from '../src/services/contacts';
import { createQuickCampaign, sendCampaign, getCampaignById } from '../src/services/campaigns';
import { getTemplateById } from '../src/services/templates';
import { createApp } from '../src/server';
import { config } from '../src/config';

describe('quick campaign creation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    importContactsFromCsv(db, `phone,name,opted_in\n+15551111111,Alice,true\n+15552222222,Bob,true`);
  });

  it('creates a plain-message campaign with no personalization needed', () => {
    const campaign = createQuickCampaign(db, 'Weekend Deal', 'Enjoy 20% off this weekend!');
    expect(campaign.status).toBe('draft');
    const template = getTemplateById(db, campaign.template_id);
    expect(template?.personalize_name).toBe(0);
    expect(template?.body_text).toBe('Enjoy 20% off this weekend!');
  });

  it('detects {{name}} and marks the template for per-recipient personalization', () => {
    const campaign = createQuickCampaign(db, 'Weekend Deal', 'Hi {{name}}, enjoy 20% off!');
    const template = getTemplateById(db, campaign.template_id);
    expect(template?.personalize_name).toBe(1);
    expect(template?.variable_count).toBe(1);
    expect(template?.body_text).toBe('Hi {{1}}, enjoy 20% off!');
  });
});

describe('personalized send substitutes each recipient\'s own name', () => {
  let db: Database.Database;
  const originalProvider = config.whatsapp.provider;

  beforeEach(() => {
    db = openDb(':memory:');
    importContactsFromCsv(db, `phone,name,opted_in\n+15551111111,Alice,true\n+15552222222,Bob,true`);
    config.whatsapp.provider = 'web_js'; // dry-run web_js logs the rendered text, letting us assert on it
  });

  afterEach(() => {
    config.whatsapp.provider = originalProvider;
  });

  it('sends each contact their own name, not a shared value', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const campaign = createQuickCampaign(db, 'Weekend Deal', 'Hi {{name}}, enjoy 20% off!');

    await sendCampaign(db, campaign.id);

    const loggedText = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(loggedText).toContain('Hi Alice, enjoy 20% off!');
    expect(loggedText).toContain('Hi Bob, enjoy 20% off!');
    logSpy.mockRestore();
  });
});

describe('POST /campaigns/quick', () => {
  let db: Database.Database;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    db = openDb(':memory:');
    setDbForTests(db);
    importContactsFromCsv(db, `phone,name,opted_in\n+15551111111,Alice,true`);
    const app = createApp();
    agent = request.agent(app);
    await agent.post('/auth/login').send({ username: 'testuser', password: 'testpass123' });
  });

  it('creates a draft campaign from just a name and message', async () => {
    const res = await agent.post('/campaigns/quick').send({ name: 'Weekend Deal', message: 'Hi {{name}}!' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
  });

  it('rejects a missing message', async () => {
    const res = await agent.post('/campaigns/quick').send({ name: 'Weekend Deal' });
    expect(res.status).toBe(400);
  });
});
