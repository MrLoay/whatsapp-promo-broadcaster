import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { requireAuth } from '../auth';

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get('/whatsapp/status', async (_req, res) => {
  if (config.whatsapp.provider !== 'web_js') {
    return res.json({ provider: config.whatsapp.provider, status: 'not_applicable' });
  }
  // Lazy-required so booting on cloud_api never pulls in Puppeteer.
  const { getConnectionState } = require('../whatsapp/webjs-client');
  const state = getConnectionState();
  const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
  res.json({ provider: 'web_js', status: state.status, qrDataUrl, error: state.error });
});

whatsappRouter.post('/whatsapp/connect', (_req, res) => {
  if (config.whatsapp.provider !== 'web_js') {
    return res.status(400).json({ error: 'WHATSAPP_PROVIDER is not set to web_js' });
  }
  if (config.dryRun) {
    return res.status(400).json({ error: 'Set DRY_RUN=false before connecting a real WhatsApp session' });
  }
  const { ensureReady } = require('../whatsapp/webjs-client');
  ensureReady().catch(() => {
    /* errors surface via GET /whatsapp/status */
  });
  res.json({ started: true });
});
