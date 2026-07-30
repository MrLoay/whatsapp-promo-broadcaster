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
} from '../services/campaigns';
import { requireAuth } from '../auth';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

campaignsRouter.get('/campaigns', (req, res) => {
  res.json(listCampaignsWithStats(getDb(), req.session.username!));
});

campaignsRouter.get('/campaigns/:id', (req, res) => {
  const campaign = getCampaignById(getDb(), req.session.username!, Number(req.params.id));
  if (!campaign) return res.sendStatus(404);
  res.json(campaign);
});

campaignsRouter.get('/campaigns/:id/recipients', (req, res) => {
  res.json(getCampaignRecipients(getDb(), req.session.username!, Number(req.params.id)));
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

// One-click flow from the Home page: type a message, send to everyone
// opted-in right now, no separate draft/review step.
campaignsRouter.post('/campaigns/send-now', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  try {
    const summary = await sendNow(getDb(), req.session.username!, message);
    res.json(summary);
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
