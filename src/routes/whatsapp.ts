import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { getConnectionState, disconnect } from '../whatsapp/webjs-client';
import { startWebJsListeners } from '../whatsapp/webjs-listeners';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get('/whatsapp/status', async (req, res) => {
  const state = getConnectionState(req.session.username!);
  const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
  res.json({ status: state.status, qrDataUrl, error: state.error });
});

whatsappRouter.post('/whatsapp/connect', (req, res) => {
  if (config.dryRun) {
    return res.status(400).json({ error: 'Set DRY_RUN=false before connecting a real WhatsApp session' });
  }
  startWebJsListeners(getDb(), req.session.username!);
  res.json({ started: true });
});

whatsappRouter.post('/whatsapp/disconnect', async (req, res) => {
  await disconnect(req.session.username!);
  res.json({ disconnected: true });
});
