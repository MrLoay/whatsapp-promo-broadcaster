import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth, requireAdmin } from '../auth';
import { getDb } from '../db';
import { getConnectionState, disconnect } from '../whatsapp/webjs-client';
import { startWebJsListeners } from '../whatsapp/webjs-listeners';
import { getAccountById, upsertAccount, listAccounts, deleteAccount } from '../services/accounts';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);
whatsappRouter.use(requireAdmin);

whatsappRouter.get('/accounts', (req, res) => {
  const db = getDb();
  const accounts = listAccounts(db);
  const states = accounts.map((acc) => {
    const state = getConnectionState(acc.id);
    return {
      id: acc.id,
      account_name: acc.account_name,
      proxy_url: acc.proxy_url,
      is_active: acc.is_active,
      status: acc.status,
      dbStatus: acc.status,
      liveStatus: state.status,
      qr: state.qr,
      error: state.error,
      phone: state.phone,
      pushname: state.pushname,
    };
  });
  res.json(states);
});

whatsappRouter.get('/whatsapp/status', async (req, res) => {
  const username = req.session.username!;
  const db = getDb();
  const state = getConnectionState(username);
  const account = getAccountById(db, username);
  const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
  res.json({
    status: state.status,
    qrDataUrl,
    error: state.error,
    account: account ?? { id: username, account_name: username, proxy_url: null, status: 'DISCONNECTED' }
  });
});

whatsappRouter.post('/whatsapp/connect', (req, res) => {
  if (config.dryRun) {
    return res.status(400).json({ error: 'Set DRY_RUN=false before connecting a real WhatsApp session' });
  }
  const db = getDb();
  const accountId = req.body?.id || req.session.username!;
  const proxyUrl = req.body?.proxy_url;

  const account = upsertAccount(db, accountId, {
    account_name: req.body?.account_name || accountId,
    ...(proxyUrl !== undefined ? { proxy_url: proxyUrl } : {})
  });

  startWebJsListeners(db, accountId, account.proxy_url);
  res.json({ started: true, account });
});

whatsappRouter.get('/whatsapp/events', (req, res) => {
  const username = req.session.username!;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const sendStatus = async () => {
    const db = getDb();
    const accounts = listAccounts(db);
    const states = accounts.map((acc) => {
      const state = getConnectionState(acc.id);
      return {
        id: acc.id,
        account_name: acc.account_name,
        proxy_url: acc.proxy_url,
        is_active: acc.is_active,
        dbStatus: acc.status,
        liveStatus: state.status,
        qr: state.qr,
        error: state.error,
        phone: state.phone,
        pushname: state.pushname,
      };
    });

    const userState = getConnectionState(username);
    const userAccount = getAccountById(db, username);
    const qrDataUrl = userState.qr ? await QRCode.toDataURL(userState.qr) : null;

    const payload = JSON.stringify({
      accounts,
      states,
      status: userState.status,
      qrDataUrl,
      error: userState.error,
      account: userAccount ?? { id: username, account_name: username, proxy_url: null, status: 'DISCONNECTED' },
    });
    res.write(`data: ${payload}\n\n`);
  };

  sendStatus();
  const interval = setInterval(sendStatus, 3000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

whatsappRouter.post('/whatsapp/disconnect', async (req, res) => {
  const accountId = req.body?.id || req.session.username!;
  await disconnect(accountId);
  const db = getDb();
  upsertAccount(db, accountId, { status: 'DISCONNECTED' });
  res.json({ disconnected: true });
});

import fs from 'fs';
import path from 'path';

whatsappRouter.post('/whatsapp/delete', async (req, res) => {
  const accountId = req.body?.id;
  if (!accountId) return res.status(400).json({ error: 'Missing account id' });
  await disconnect(accountId);
  const db = getDb();
  deleteAccount(db, accountId);
  const safeClientId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionDir = path.join(config.whatsapp.webjsSessionPath, `session-${safeClientId}`);
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch {}
  res.json({ deleted: true });
});

whatsappRouter.post('/whatsapp/edit-name', async (req, res) => {
  const accountId = req.body?.id;
  const newName = req.body?.account_name;
  if (!accountId || !newName) return res.status(400).json({ error: 'Missing account id or name' });
  
  const db = getDb();
  const account = getAccountById(db, accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  
  upsertAccount(db, accountId, { account_name: newName });
  res.json({ updated: true });
});

whatsappRouter.post('/whatsapp/toggle', async (req, res) => {
  const accountId = req.body?.id;
  const isActive = req.body?.is_active;
  if (!accountId || typeof isActive !== 'boolean') return res.status(400).json({ error: 'Missing account id or is_active boolean' });
  
  const db = getDb();
  const account = getAccountById(db, accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  
  upsertAccount(db, accountId, { is_active: isActive ? 1 : 0 });
  
  if (!isActive) {
    await disconnect(accountId);
  } else {
    // Attempt to start listeners again if ticked
    startWebJsListeners(db, accountId, account.proxy_url);
  }
  
  res.json({ toggled: true, is_active: isActive });
});
