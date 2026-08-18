import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { getConnectionState, disconnect } from '../whatsapp/webjs-client';
import { startWebJsListeners } from '../whatsapp/webjs-listeners';
import { getAccountById, upsertAccount, listAccounts, deleteAccount } from '../services/accounts';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get('/accounts', (req, res) => {
  const db = getDb();
  const accounts = listAccounts(db);
  res.json(accounts);
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
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendStatus = async () => {
    const db = getDb();
    const accounts = listAccounts(db);
    const states = accounts.map((acc) => {
      const state = getConnectionState(acc.id);
      return {
        id: acc.id,
        account_name: acc.account_name,
        proxy_url: acc.proxy_url,
        dbStatus: acc.status,
        liveStatus: state.status,
        qr: state.qr,
        error: state.error,
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

whatsappRouter.post('/whatsapp/delete', async (req, res) => {
  const accountId = req.body?.id;
  if (!accountId) return res.status(400).json({ error: 'Missing account id' });
  await disconnect(accountId);
  const db = getDb();
  deleteAccount(db, accountId);
  res.json({ deleted: true });
});
