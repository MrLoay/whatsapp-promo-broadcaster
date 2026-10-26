import { Router } from 'express';
import { getDb } from '../db';
import {
  createCampaign,
  createQuickCampaign,
  getCampaignById,
  sendCampaign,
  sendNow,
  listCampaignsWithStats,
  getCampaignRecipients,
  stopCampaign,
} from '../services/campaigns';
import { requireAuth } from '../auth';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

function isUserAdmin(req: any): boolean {
  if (req.session?.role === 'admin') return true;
  if (!req.session?.username) return false;
  const user = getDb().prepare('SELECT role FROM users WHERE username = ?').get(req.session.username) as { role?: string } | undefined;
  if (user?.role === 'admin') {
    req.session.role = 'admin';
    return true;
  }
  return false;
}

campaignsRouter.get('/campaigns', (req, res) => {
  res.json(listCampaignsWithStats(getDb(), req.session.username!));
});

campaignsRouter.get('/campaigns/:id', (req, res) => {
  const campaign = getCampaignById(getDb(), req.session.username!, Number(req.params.id), isUserAdmin(req));
  if (!campaign) return res.sendStatus(404);
  res.json(campaign);
});

campaignsRouter.get('/campaigns/:id/recipients', (req, res) => {
  res.json(getCampaignRecipients(getDb(), req.session.username!, Number(req.params.id), isUserAdmin(req)));
});

campaignsRouter.get('/campaigns/:id/export.csv', (req, res) => {
  const db = getDb();
  const isAdmin = isUserAdmin(req);
  const campaignId = Number(req.params.id);
  const campaign = getCampaignById(db, req.session.username!, campaignId, isAdmin);
  if (!campaign) {
    return res.status(404).send('Campaign not found');
  }

  const recipients = getCampaignRecipients(db, req.session.username!, campaignId, isAdmin);

  const escapeCSV = (str: any) => {
    if (str === null || str === undefined) return '""';
    return '"' + String(str).replace(/"/g, '""') + '"';
  };

  let csv = 'Phone,Name,Status,Reason/Error,Sent At,Delivered At,Read At\r\n';
  for (const r of recipients) {
    const errorMsg = r.error || (r.status !== 'failed' ? 'Success' : 'Unknown');
    csv += [
      escapeCSV(r.phone),
      escapeCSV(r.name || ''),
      escapeCSV(r.status ? r.status.toUpperCase() : ''),
      escapeCSV(errorMsg),
      escapeCSV(r.sent_at || ''),
      escapeCSV(r.delivered_at || ''),
      escapeCSV(r.read_at || '')
    ].join(',') + '\r\n';
  }

  const safeName = (campaign.name || `campaign_${campaign.id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_report.csv"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.send(csv);
});

campaignsRouter.post('/campaigns/:id/stop', (req, res) => {
  const stopped = stopCampaign(getDb(), req.session.username!, Number(req.params.id), isUserAdmin(req));
  if (stopped) {
    res.json({ stopped: true });
  } else {
    res.status(400).json({ error: 'Campaign is not currently sending or does not exist.' });
  }
});

campaignsRouter.post('/campaigns', (req, res) => {
  const { name, templateId, variableValues } = req.body ?? {};
  if (!name || !templateId) {
    return res.status(400).json({ error: 'name and templateId are required' });
  }
  try {
    const campaign = createCampaign(getDb(), req.session.username!, name, templateId, variableValues ?? []);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Simplified creation for the dashboard: just a name + message, no separate
// template step. Use {{name}} in the message to auto-personalize per contact.
campaignsRouter.post('/campaigns/quick', (req, res) => {
  const { name, message } = req.body ?? {};
  if (!name || !message) {
    return res.status(400).json({ error: 'name and message are required' });
  }
  try {
    const campaign = createQuickCampaign(getDb(), req.session.username!, name, message);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'data', 'media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const originalExt = path.extname(file.originalname);
    const mimeExt = file.mimetype.includes('png') ? '.png' : file.mimetype.includes('webp') ? '.webp' : '.jpg';
    const ext = originalExt || mimeExt;
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// One-click flow from the Home page: type a message, send to everyone
// opted-in right now, no separate draft/review step.
campaignsRouter.post('/campaigns/send-now', upload.single('media'), async (req, res) => {
  const { message, delayMode, customDelay, accountId, accountIds } = req.body ?? {};
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  
  const mediaPath = req.file?.path;
  const mimeType = req.file?.mimetype;

  try {
    const delayNum = customDelay ? Number(customDelay) : undefined;
    const targetAccounts = accountIds || accountId;
    const campaign = await sendNow(getDb(), req.session.username!, message, delayMode, delayNum, mediaPath, mimeType, targetAccounts);
    res.json({ started: true, campaign, ...campaign });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

campaignsRouter.post('/campaigns/:id/send', async (req, res) => {
  try {
    const summary = await sendCampaign(getDb(), req.session.username!, Number(req.params.id));
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
