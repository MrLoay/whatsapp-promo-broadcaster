import { Router } from 'express';
import { getDb } from '../db';
import { createCampaign, getCampaignById, sendCampaign } from '../services/campaigns';

export const campaignsRouter = Router();

campaignsRouter.get('/campaigns/:id', (req, res) => {
  const campaign = getCampaignById(getDb(), Number(req.params.id));
  if (!campaign) return res.sendStatus(404);
  res.json(campaign);
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

campaignsRouter.post('/campaigns/:id/send', async (req, res) => {
  try {
    const summary = await sendCampaign(getDb(), Number(req.params.id));
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
