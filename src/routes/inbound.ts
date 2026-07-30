import { Router } from 'express';
import { getDb } from '../db';
import { requireAuth } from '../auth';

export const inboundRouter = Router();
inboundRouter.use(requireAuth);

inboundRouter.get('/inbound-messages', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM inbound_messages WHERE owner = ? ORDER BY id DESC').all(req.session.username!));
});
