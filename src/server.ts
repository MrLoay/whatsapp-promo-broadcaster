import express, { type Express } from 'express';
import path from 'path';
import session from 'express-session';
import { config } from './config';
import { webhookRouter } from './routes/webhook';
import { contactsRouter } from './routes/contacts';
import { templatesRouter } from './routes/templates';
import { campaignsRouter } from './routes/campaigns';
import { inboundRouter } from './routes/inbound';
import { whatsappRouter } from './routes/whatsapp';
import { authRouter } from './auth';

export function createApp(): Express {
  const app = express();

  // Webhook route needs the raw body for signature verification, so it's
  // mounted before the JSON body parser and handles its own body parsing.
  app.use(webhookRouter);

  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));

  app.use(
    session({
      secret: config.dashboard.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: !config.dryRun && process.env.NODE_ENV === 'production' },
    })
  );

  app.use(authRouter);

  app.get('/health', (_req, res) => res.json({ ok: true, dryRun: config.dryRun }));

  // Static dashboard pages are served (and requests for them terminated)
  // before the API routers below, so login.html/style.css/etc. are reachable
  // without a session -- the pages themselves hold no data, they just call
  // the (auth-gated) API below and redirect to /login.html on a 401.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Each of these routers requires auth internally (router.use(requireAuth))
  // since sends messages, manages contacts, or reads business data -- the
  // dashboard is meant to be reachable remotely by more than just the person
  // at this keyboard.
  app.use(contactsRouter);
  app.use(templatesRouter);
  app.use(campaignsRouter);
  app.use(inboundRouter);
  app.use(whatsappRouter);

  return app;
}

if (require.main === module) {
  const app = createApp();

  if (!config.dryRun) {
    // Lazy-required so a dry-run boot never pulls in Puppeteer.
    const { getDb } = require('./db');
    const { startWebJsListeners } = require('./whatsapp/webjs-listeners');
    startWebJsListeners(getDb());
  }

  app.listen(config.server.port, () => {
    console.log(`Server listening on port ${config.server.port} (DRY_RUN=${config.dryRun})`);
  });
}
