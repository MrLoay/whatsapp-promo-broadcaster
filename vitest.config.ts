import { defineConfig } from 'vitest/config';
import bcrypt from 'bcryptjs';

// Fixed test credentials: username "testuser", password "testpass123".
const TEST_USERS = JSON.stringify([{ username: 'testuser', passwordHash: bcrypt.hashSync('testpass123', 4) }]);

export default defineConfig({
  test: {
    // Tests must run in isolated dry-run/cloud_api mode regardless of
    // whatever the developer's local .env is currently set to (e.g. a real
    // web_js session for manual testing) -- dotenv only fills in env vars
    // that aren't already set, so these take precedence over .env.
    env: {
      DRY_RUN: 'true',
      WHATSAPP_PROVIDER: 'cloud_api',
      SESSION_SECRET: 'test-session-secret',
      DASHBOARD_USERS: TEST_USERS,
    },
  },
});
