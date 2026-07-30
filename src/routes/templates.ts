import { Router } from 'express';
import { getDb } from '../db';
import { registerTemplate, listTemplates } from '../services/templates';
import { requireAuth } from '../auth';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get('/templates', (req, res) => {
  res.json(listTemplates(getDb(), req.session.username!));
});

templatesRouter.post('/templates', (req, res) => {
  const { name, bodyText, language, variableCount } = req.body ?? {};
  if (!name || !bodyText) {
    return res.status(400).json({ error: 'name and bodyText are required' });
  }
  try {
    const template = registerTemplate(getDb(), req.session.username!, {
      name,
      bodyText,
      language: language ?? 'en_US',
      variableCount: variableCount ?? 0,
    });
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
