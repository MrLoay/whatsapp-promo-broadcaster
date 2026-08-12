import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { getConnectionState, disconnect } from '../whatsapp/webjs-client';
import { startWebJsListeners } from '../whatsapp/webjs-listeners';
import { getAccountById, upsertAccount } from '../services/accounts';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

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
  const username = req.session.username!;
  const proxyUrl = req.body?.proxy_url;

  const account = upsertAccount(db, username, {
    account_name: req.body?.account_name || username,
    ...(proxyUrl !== undefined ? { proxy_url: proxyUrl } : {})
  });

  startWebJsListeners(db, username, account.proxy_url);
  res.json({ started: true, account });
});

whatsappRouter.get('/whatsapp/events', (req, res) => {
  const username = req.session.username!;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendStatus = async () => {
    const db = getDb();
    const state = getConnectionState(username);
    const account = getAccountById(db, username);
    const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
    const payload = JSON.stringify({
      status: state.status,
      qrDataUrl,
      error: state.error,
      account: account ?? { id: username, account_name: username, proxy_url: null, status: 'DISCONNECTED' },
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
  const username = req.session.username!;
  await disconnect(username);
  res.json({ disconnected: true });
});
