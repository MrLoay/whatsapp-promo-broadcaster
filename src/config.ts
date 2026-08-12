import 'dotenv/config';
import path from 'path';

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const config = {
  dryRun: boolFromEnv(process.env.DRY_RUN, true),

  whatsapp: {
    // Sends via whatsapp-web.js (an unofficial bridge -- see WEBJS_INTERIM.md).
    // The official Meta Cloud API integration will come back once a WABA is
    // approved -- see SETUP_META.md.
    webjsSessionPath: process.env.WHATSAPP_WEBJS_SESSION_PATH ?? path.join(process.cwd(), 'data', 'wwebjs_auth'),
    maxConcurrentSessions: intFromEnv(process.env.MAX_CONCURRENT_SESSIONS, 10),
    heartbeatIntervalMs: intFromEnv(process.env.HEARTBEAT_INTERVAL_MS, 60000),
  },

  webhook: {
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
  },

  server: {
    port: intFromEnv(process.env.PORT, 3000),
  },

  db: {
    path: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'app.db'),
  },

  throttle: {
    tierLimitPer24h: intFromEnv(process.env.TIER_LIMIT_PER_24H, 250),
    messagesPerSecond: intFromEnv(process.env.MESSAGES_PER_SECOND, 5),
  },

  dashboard: {
    // Session cookie signing secret -- set a long random value in production.
    sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me',
    // JSON array of {"username":"...","passwordHash":"..."} -- generate hashes with `npm run hash-password -- <plaintext>`.
    users: process.env.DASHBOARD_USERS ?? '[]',
  },
};
