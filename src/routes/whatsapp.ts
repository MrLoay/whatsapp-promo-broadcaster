import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth } from '../auth';
import { getConnectionState, ensureReady, disconnect } from '../whatsapp/webjs-client';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get('/whatsapp/status', async (_req, res) => {
  const state = getConnectionState();
  const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
  res.json({ status: state.status, qrDataUrl, error: state.error });
});

whatsappRouter.post('/whatsapp/connect', (_req, res) => {
  if (config.dryRun) {
    return res.status(400).json({ error: 'Set DRY_RUN=false before connecting a real WhatsApp session' });
  }
  ensureReady().catch(() => {
    /* errors surface via GET /whatsapp/status */
  });
  res.json({ started: true });
});

whatsappRouter.post('/whatsapp/disconnect', async (_req, res) => {
  await disconnect();
  res.json({ disconnected: true });
});
