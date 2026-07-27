import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { openDb, setDbForTests } from '../src/db';
import { createApp } from '../src/server';

describe('dashboard auth', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    setDbForTests(db);
    app = createApp();
  });

  it('rejects protected routes without logging in', async () => {
    const res = await request(app).get('/contacts');
    expect(res.status).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    const res = await request(app).post('/auth/login').send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('allows access to protected routes after logging in', async () => {
    const agent = request.agent(app);

    const login = await agent.post('/auth/login').send({ username: 'testuser', password: 'testpass123' });
    expect(login.status).toBe(200);
    expect(login.body.username).toBe('testuser');

    const contacts = await agent.get('/contacts');
    expect(contacts.status).toBe(200);

    const me = await agent.get('/auth/me');
    expect(me.body.username).toBe('testuser');
  });

  it('logs out and revokes access', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ username: 'testuser', password: 'testpass123' });
    expect((await agent.get('/contacts')).status).toBe(200);

    await agent.post('/auth/logout');
    expect((await agent.get('/contacts')).status).toBe(401);
  });

  it('the webhook and health routes stay unauthenticated', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    const webhookVerify = await request(app)
      .get('/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '123' });
    // No verify token configured in test env -> mismatch -> 403, but importantly not 401 (not auth-gated).
    expect(webhookVerify.status).not.toBe(401);
  });
});
