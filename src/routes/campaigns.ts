import { Router } from 'express';
import { getDb } from '../db';
import {
  createCampaign,
  createQuickCampaign,
  getCampaignById,
  sendCampaign,
  listCampaignsWithStats,
  getCampaignRecipients,
} from '../services/campaigns';
import { requireAuth } from '../auth';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

campaignsRouter.get('/campaigns', (_req, res) => {
  res.json(listCampaignsWithStats(getDb()));
});

campaignsRouter.get('/campaigns/:id', (req, res) => {
  const campaign = getCampaignById(getDb(), Number(req.params.id));
  if (!campaign) return res.sendStatus(404);
  res.json(campaign);
});

campaignsRouter.get('/campaigns/:id/recipients', (req, res) => {
  res.json(getCampaignRecipients(getDb(), Number(req.params.id)));
});

campaignsRouter.post('/campaigns', (req, res) => {
  const { name, templateId, variableValues } = req.body ?? {};
  if (!name || !templateId) {
    return res.status(400).json({ error: 'name and templateId are required' });
  }
  try {
    const campaign = createCampaign(getDb(), name, templateId, variableValues ?? []);
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
    const campaign = createQuickCampaign(getDb(), name, message);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

campaignsRouter.post('/campaigns/:id/send', async (req, res) => {
  try {
    const summary = await sendCampaign(getDb(), Number(req.params.id));
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
