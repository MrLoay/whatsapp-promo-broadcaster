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
import { systemRouter } from './routes/system';
import { creditsRouter } from './routes/credits';
import { adminRouter } from './routes/admin';
import { scheduleDbMaintenance } from './services/maintenance';

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
  app.use(systemRouter);
  app.use(creditsRouter);
  app.use(adminRouter);

  return app;
}

if (require.main === module) {
  const app = createApp();
  const { getDb } = require('./db');
  const db = getDb();

  // Schedule automated 30-day log purge & VACUUM maintenance task
  scheduleDbMaintenance(db);

  if (!config.dryRun) {
    // Lazy-required so a dry-run boot never pulls in Puppeteer. Each
    // configured dashboard account gets its own WhatsApp session -- if it
    // was previously linked, this resumes it automatically without a new
    // QR scan; if not, it just sits idle until that account clicks Connect.
    const { startWebJsListeners } = require('./whatsapp/webjs-listeners');
    const { getAccountById } = require('./services/accounts');
    try {
      // Start listeners only for accounts registered in the database (e.g. proxy broadcast accounts)
      const allAccounts = db.prepare(`SELECT id, proxy_url FROM accounts WHERE status != 'DISCONNECTED' AND is_active = 1`).all() as { id: string, proxy_url: string | null }[];
      const launchAccounts = async () => {
        for (const account of allAccounts) {
          startWebJsListeners(db, account.id, account.proxy_url);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };
      launchAccounts();
    } catch (err) {
      console.error('Failed to auto-reconnect WhatsApp accounts:', (err as Error).message);
    }
  }

  const server = app.listen(config.server.port, () => {
    console.log(`Server listening on port ${config.server.port} (DRY_RUN=${config.dryRun})`);
  });

  const gracefulShutdown = async () => {
    console.log('\n[Graceful Shutdown] Server is shutting down...');
    if (!config.dryRun) {
      try {
        const { destroyAll } = require('./whatsapp/webjs-client');
        await destroyAll();
      } catch (err) {
        console.error('Error during WhatsApp session teardown:', err);
      }
    }
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      console.error('Could not close gracefully, forcing exit.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGQUIT', gracefulShutdown);
}
