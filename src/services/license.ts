import type Database from 'better-sqlite3';
import { config } from '../config';

export interface License {
  customer_name: string;
  max_accounts: number;
  expires_at: string; // YYYY-MM-DD
  note: string | null;
  updated_at: string;
}

export interface LicenseStatus {
  enforced: boolean;
  licensed: boolean; // a license record is installed
  active: boolean; // sending / connecting is allowed
  reason: 'ok' | 'not_enforced' | 'no_license' | 'expired';
  customer_name: string | null;
  max_accounts: number | null;
  used_accounts: number;
  expires_at: string | null;
  days_left: number | null; // negative once expired
}

/** Thrown when an action is blocked by the license (maps to HTTP 403). */
export class LicenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLicenseDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A license is valid through the END of its expiry day, Malaysia time (UTC+8, no DST). */
function expiryInstantMs(expiresAt: string): number {
  return Date.parse(`${expiresAt}T23:59:59+08:00`);
}

export function getLicense(db: Database.Database): License | undefined {
  return db
    .prepare('SELECT customer_name, max_accounts, expires_at, note, updated_at FROM license WHERE id = 1')
    .get() as License | undefined;
}

function countActiveAccounts(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE is_active = 1').get() as { n: number };
  return row.n;
}

export function getLicenseStatus(db: Database.Database, now: number = Date.now()): LicenseStatus {
  const enforced = config.license.enforce;
  const license = getLicense(db);
  const used = countActiveAccounts(db);

  if (!license) {
    return {
      enforced,
      licensed: false,
      active: !enforced,
      reason: enforced ? 'no_license' : 'not_enforced',
      customer_name: null,
      max_accounts: null,
      used_accounts: used,
      expires_at: null,
      days_left: null,
    };
  }

  const expiry = expiryInstantMs(license.expires_at);
  const expired = now > expiry;
  const daysLeft = Math.ceil((expiry - now) / 86_400_000);
  return {
    enforced,
    licensed: true,
    active: !enforced || !expired,
    reason: !enforced ? 'not_enforced' : expired ? 'expired' : 'ok',
    customer_name: license.customer_name,
    max_accounts: license.max_accounts,
    used_accounts: used,
    expires_at: license.expires_at,
    days_left: daysLeft,
  };
}

/** Blocks the action unless the license is valid. A no-op when licensing is not enforced. */
export function assertLicenseActive(db: Database.Database, now: number = Date.now()): void {
  const s = getLicenseStatus(db, now);
  if (s.active) return;
  if (s.reason === 'no_license') {
    throw new LicenseError('No license is installed for this system. Please contact support.');
  }
  throw new LicenseError(`Your license expired on ${s.expires_at}. Please contact support to renew.`);
}

/** Blocks adding / activating a WhatsApp account beyond the licensed limit. A no-op when not enforced. */
export function assertCanAddAccount(db: Database.Database, now: number = Date.now()): void {
  assertLicenseActive(db, now);
  const s = getLicenseStatus(db, now);
  if (!s.enforced || s.max_accounts === null) return;
  if (s.used_accounts >= s.max_accounts) {
    throw new LicenseError(
      `Account limit reached (${s.used_accounts}/${s.max_accounts}). Please contact support to upgrade your license.`
    );
  }
}

export function setLicense(
  db: Database.Database,
  data: { customer_name: string; max_accounts: number; expires_at: string; note?: string | null },
  who = 'cli'
): License {
  if (!data.customer_name.trim()) throw new Error('customer_name is required');
  if (!Number.isInteger(data.max_accounts) || data.max_accounts < 0) {
    throw new Error('max_accounts must be a whole number, 0 or more');
  }
  if (!isValidLicenseDate(data.expires_at)) throw new Error('expires_at must be a valid date as YYYY-MM-DD');

  const before = getLicense(db);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO license (id, customer_name, max_accounts, expires_at, note, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         customer_name = excluded.customer_name,
         max_accounts = excluded.max_accounts,
         expires_at = excluded.expires_at,
         note = excluded.note,
         updated_at = datetime('now')`
    ).run(data.customer_name.trim(), data.max_accounts, data.expires_at, data.note ?? null);

    const detail = before
      ? `max_accounts ${before.max_accounts} -> ${data.max_accounts}; expires_at ${before.expires_at} -> ${data.expires_at}; customer "${before.customer_name}" -> "${data.customer_name.trim()}"`
      : `created: customer "${data.customer_name.trim()}", max_accounts ${data.max_accounts}, expires_at ${data.expires_at}`;
    db.prepare('INSERT INTO license_log (action, detail) VALUES (?, ?)').run(`${before ? 'update' : 'create'} (${who})`, detail);
  })();
  return getLicense(db)!;
}

export function listLicenseLog(db: Database.Database, limit = 20): { at: string; action: string; detail: string | null }[] {
  return db.prepare('SELECT at, action, detail FROM license_log ORDER BY id DESC LIMIT ?').all(limit) as any[];
}
