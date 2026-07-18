import { getDb } from '../db';
import { sendCampaign } from '../services/campaigns';
import { assertLiveCredentials, config } from '../config';

async function main() {
  const campaignId = Number(process.argv[2]);
  if (!campaignId) {
    console.error('Usage: npm run send -- <campaignId>');
    process.exit(1);
  }

  assertLiveCredentials();
  console.log(`Sending campaign ${campaignId} (DRY_RUN=${config.dryRun})...`);

  const db = getDb();
  const summary = await sendCampaign(db, campaignId);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
