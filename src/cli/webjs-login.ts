import { config } from '../config';
import { ensureReady } from '../whatsapp/webjs-client';

async function main() {
  if (config.whatsapp.provider !== 'web_js') {
    console.error('WHATSAPP_PROVIDER is not set to "web_js" in .env -- nothing to log in to.');
    process.exit(1);
  }
  if (config.dryRun) {
    console.error('DRY_RUN is true -- set DRY_RUN=false in .env before logging in (dry run never opens a real session).');
    process.exit(1);
  }

  console.log('Starting whatsapp-web.js session...');
  await ensureReady();
  console.log('Logged in. Session saved -- future runs will reuse it without re-scanning.');
  console.log('You can now Ctrl+C and run "npm run dev" or "npm run send -- <campaignId>".');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
