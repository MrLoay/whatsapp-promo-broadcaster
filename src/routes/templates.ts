import { Router } from 'express';
import { getDb } from '../db';
import { registerTemplate, listTemplates } from '../services/templates';
import { requireAuth } from '../auth';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get('/templates', (_req, res) => {
  res.json(listTemplates(getDb()));
});

templatesRouter.post('/templates', (req, res) => {
  const { name, metaTemplateName, bodyText, language, variableCount } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const template = registerTemplate(getDb(), {
      name,
      metaTemplateName,
      bodyText,
      language: language ?? 'en_US',
      variableCount: variableCount ?? 0,
    });
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
