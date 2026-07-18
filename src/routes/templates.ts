import { Router } from 'express';
import { getDb } from '../db';
import { registerTemplate, listTemplates } from '../services/templates';

export const templatesRouter = Router();

templatesRouter.get('/templates', (_req, res) => {
  res.json(listTemplates(getDb()));
});

templatesRouter.post('/templates', (req, res) => {
  const { name, metaTemplateName, language, variableCount } = req.body ?? {};
  if (!name || !metaTemplateName) {
    return res.status(400).json({ error: 'name and metaTemplateName are required' });
  }
  try {
    const template = registerTemplate(getDb(), name, metaTemplateName, language ?? 'en_US', variableCount ?? 0);
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
