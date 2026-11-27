/**
 * Server-side license manager. This is the ONLY way to change a license -- there is deliberately no
 * dashboard or API for it, so a customer can never raise their own limit or extend their own expiry.
 *
 * Run from the customer's instance folder (it reads that instance's .env / database):
 *   node dist/cli/license.js show
 *   node dist/cli/license.js set --customer "Customer A" --max 20 --expires 2027-01-31 [--note "..."]
 *   node dist/cli/license.js extend --days 30        (adds to the current expiry, or from today if already expired)
 *   node dist/cli/license.js log
 * Changes apply immediately; no restart is needed (except to reconnect sessions after an expired license).
 */
import { config } from '../config';
import { openDb } from '../db';
import { getLicense, getLicenseStatus, isValidLicenseDate, listLicenseLog, setLicense } from '../services/license';

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return flags;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayMYT(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function printStatus(db: ReturnType<typeof openDb>): void {
  const s = getLicenseStatus(db);
  console.log(`Database:  ${config.db.path}`);
  console.log(`Enforced:  ${s.enforced ? 'yes' : 'NO (LICENSE_ENFORCE is not true in this instance .env)'}`);
  if (!s.licensed) {
    console.log('License:   none installed');
    return;
  }
  console.log(`Customer:  ${s.customer_name}`);
  console.log(`Accounts:  ${s.used_accounts} used / ${s.max_accounts} allowed`);
  const expired = s.reason === 'expired';
  console.log(`Expires:   ${s.expires_at} (${expired ? 'EXPIRED' : `${s.days_left} days left`})`);
  console.log(`State:     ${s.active ? 'ACTIVE' : 'BLOCKED (' + s.reason + ')'}`);
}

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const db = openDb();

switch (command) {
  case 'show':
    printStatus(db);
    break;

  case 'set': {
    const current = getLicense(db);
    const customer = flags.customer ?? current?.customer_name;
    const max = flags.max !== undefined ? Number(flags.max) : current?.max_accounts;
    const expires = flags.expires ?? current?.expires_at;
    if (!customer || max === undefined || !expires) {
      fail('First-time setup needs --customer "<name>" --max <accounts> --expires YYYY-MM-DD');
    }
    try {
      setLicense(db, { customer_name: customer, max_accounts: max, expires_at: expires, note: flags.note ?? current?.note ?? null });
    } catch (err) {
      fail((err as Error).message);
    }
    console.log('License saved.');
    printStatus(db);
    break;
  }

  case 'extend': {
    const current = getLicense(db);
    if (!current) fail('No license installed yet. Use "set" first.');
    let expires = flags.expires;
    if (!expires) {
      const days = Number(flags.days);
      if (!Number.isInteger(days) || days <= 0) fail('Use --days <number> or --expires YYYY-MM-DD');
      const base = current.expires_at > todayMYT() ? current.expires_at : todayMYT();
      expires = addDays(base, days);
    }
    if (!isValidLicenseDate(expires)) fail('expires must be a valid date as YYYY-MM-DD');
    setLicense(db, { customer_name: current.customer_name, max_accounts: current.max_accounts, expires_at: expires, note: current.note });
    console.log('License extended.');
    printStatus(db);
    break;
  }

  case 'log':
    for (const row of listLicenseLog(db, 50)) console.log(`${row.at}  ${row.action}  ${row.detail ?? ''}`);
    break;

  default:
    console.log('Usage: license <show | set | extend | log>  (see the header of src/cli/license.ts)');
    process.exit(command ? 1 : 0);
}
