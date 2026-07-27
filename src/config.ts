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
    // 'cloud_api' = official Meta Business Platform (requires an approved WABA).
    // 'web_js' = interim unofficial bridge (whatsapp-web.js) for use before that's set up.
    // Switch this back to 'cloud_api' once your WABA is verified -- see SETUP_META.md.
    provider: (process.env.WHATSAPP_PROVIDER === 'web_js' ? 'web_js' : 'cloud_api') as 'cloud_api' | 'web_js',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    graphApiVersion: 'v20.0',
    webjsSessionPath: process.env.WHATSAPP_WEBJS_SESSION_PATH ?? path.join(process.cwd(), 'data', 'wwebjs_auth'),
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

export function assertLiveCredentials(): void {
  if (config.dryRun) return;
  const missing: string[] = [];
  if (!config.whatsapp.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (missing.length > 0) {
    throw new Error(
      `DRY_RUN is false but required env vars are missing: ${missing.join(', ')}. ` +
        'See SETUP_META.md, or set DRY_RUN=true to test without live credentials.'
    );
  }
}
