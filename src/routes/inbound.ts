import { Router } from 'express';
import { getDb } from '../db';
import { requireAuth } from '../auth';

export const inboundRouter = Router();
inboundRouter.use(requireAuth);

inboundRouter.get('/inbound-messages', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM inbound_messages ORDER BY id DESC').all());
});
