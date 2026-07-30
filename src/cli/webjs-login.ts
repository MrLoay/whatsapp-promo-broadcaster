import { config } from '../config';
import { ensureReady } from '../whatsapp/webjs-client';

async function main() {
  const owner = process.argv[2];
  if (!owner) {
    console.error('Usage: npm run whatsapp:login -- <dashboard-username>');
    process.exit(1);
  }
  if (config.dryRun) {
    console.error('DRY_RUN is true -- set DRY_RUN=false in .env before logging in (dry run never opens a real session).');
    process.exit(1);
  }

  console.log(`Starting whatsapp-web.js session for ${owner}...`);
  await ensureReady(owner);
  console.log('Logged in. Session saved -- future runs will reuse it without re-scanning.');
  console.log('You can now Ctrl+C and run "npm run dev", or use the dashboard.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
