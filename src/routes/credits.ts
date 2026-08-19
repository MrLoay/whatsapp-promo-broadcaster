import { Router } from 'express';
import { getDb } from '../db';
import { getCreditBalance, topupCredits } from '../services/credits';
import { requireAuth } from '../auth';

export const creditsRouter = Router();
creditsRouter.use(requireAuth);

creditsRouter.get('/credits', (req, res) => {
  const balance = getCreditBalance(getDb(), req.session.username!);
  res.json({ balance });
});

// For testing purposes, allow top-up via API. In production, this would be tied to a payment gateway.
creditsRouter.post('/credits/topup', (req, res) => {
  const { amount } = req.body ?? {};
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }
  const newBalance = topupCredits(getDb(), req.session.username!, amount);
  res.json({ balance: newBalance });
});
