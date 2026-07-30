import fs from 'fs';
import { getDb } from '../db';
import { importContactsFromCsv } from '../services/contacts';

function main() {
  const owner = process.argv[2];
  const filePath = process.argv[3];
  if (!owner || !filePath) {
    console.error('Usage: npm run import -- <dashboard-username> <path-to-contacts.csv>');
    console.error('CSV columns required: phone,name');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const db = getDb();
  const result = importContactsFromCsv(db, owner, csvContent);

  console.log(`Inserted: ${result.inserted}, Updated: ${result.updated}, Skipped: ${result.skipped.length}`);
  if (result.skipped.length > 0) {
    console.log('Skipped rows:');
    for (const s of result.skipped) console.log(`  ${s.phone}: ${s.reason}`);
  }
}

main();
