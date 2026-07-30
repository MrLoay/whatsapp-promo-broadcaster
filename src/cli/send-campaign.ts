import { getDb } from '../db';
import { sendCampaign } from '../services/campaigns';
import { config } from '../config';

async function main() {
  const owner = process.argv[2];
  const campaignId = Number(process.argv[3]);
  if (!owner || !campaignId) {
    console.error('Usage: npm run send -- <dashboard-username> <campaignId>');
    process.exit(1);
  }

  console.log(`Sending campaign ${campaignId} for ${owner} (DRY_RUN=${config.dryRun})...`);

  const db = getDb();
  const summary = await sendCampaign(db, owner, campaignId);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
