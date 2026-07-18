import express, { type Express } from 'express';
import { config } from './config';
import { webhookRouter } from './routes/webhook';
import { contactsRouter } from './routes/contacts';
import { templatesRouter } from './routes/templates';
import { campaignsRouter } from './routes/campaigns';

export function createApp(): Express {
  const app = express();

  // Webhook route needs the raw body for signature verification, so it's
  // mounted before the JSON body parser and handles its own body parsing.
  app.use(webhookRouter);

  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  app.use(contactsRouter);
  app.use(templatesRouter);
  app.use(campaignsRouter);

  app.get('/health', (_req, res) => res.json({ ok: true, dryRun: config.dryRun }));

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.server.port, () => {
    console.log(`Server listening on port ${config.server.port} (DRY_RUN=${config.dryRun})`);
  });
}
