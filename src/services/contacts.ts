import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';

export type OptInStatus = 'pending' | 'opted_in' | 'opted_out';

export interface Contact {
  id: number;
  phone: string;
  name: string | null;
  opt_in_status: OptInStatus;
  opt_in_source: string | null;
  opt_in_at: string | null;
  opted_out_at: string | null;
}

export interface ImportRow {
  phone: string;
  name?: string;
  opted_in: boolean;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: { phone: string; reason: string }[];
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function upsertContact(
  db: Database.Database,
  phone: string,
  name: string | undefined,
  optedIn: boolean,
  source: string
): 'inserted' | 'updated' {
  const existing = db.prepare('SELECT id FROM contacts WHERE phone = ?').get(phone) as { id: number } | undefined;
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE contacts SET name = COALESCE(?, name), updated_at = ?
       ${optedIn ? ", opt_in_status = 'opted_in', opt_in_source = ?, opt_in_at = ?" : ''}
       WHERE id = ?`
    ).run(...(optedIn ? [name ?? null, now, source, now, existing.id] : [name ?? null, now, existing.id]));
    return 'updated';
  }

  db.prepare(
    `INSERT INTO contacts (phone, name, opt_in_status, opt_in_source, opt_in_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(phone, name ?? null, optedIn ? 'opted_in' : 'pending', optedIn ? source : null, optedIn ? now : null);
  return 'inserted';
}

/**
 * CSV must have columns: phone, name (optional), opted_in (true/false).
 * A contact is only ever marked opted_in if the CSV explicitly says so --
 * merely appearing in an imported list is not consent.
 */
export function importContactsFromCsv(db: Database.Database, csvContent: string, source = 'csv_import'): ImportResult {
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const result: ImportResult = { inserted: 0, updated: 0, skipped: [] };

  const tx = db.transaction((records: Record<string, string>[]) => {
    for (const row of records) {
      const phone = (row.phone ?? '').trim();
      if (!E164_RE.test(phone)) {
        result.skipped.push({ phone: phone || '(empty)', reason: 'invalid phone format, expected E.164 e.g. +15551234567' });
        continue;
      }
      const optedIn = ['true', '1', 'yes'].includes((row.opted_in ?? '').trim().toLowerCase());
      const outcome = upsertContact(db, phone, row.name, optedIn, source);
      result[outcome === 'inserted' ? 'inserted' : 'updated']++;
    }
  });

  tx(rows);
  return result;
}

export function markOptedOut(db: Database.Database, phone: string): boolean {
  const now = new Date().toISOString();
  const info = db
    .prepare(`UPDATE contacts SET opt_in_status = 'opted_out', opted_out_at = ?, updated_at = ? WHERE phone = ?`)
    .run(now, now, phone);
  return info.changes > 0;
}

export function listOptedInContacts(db: Database.Database): Contact[] {
  return db.prepare(`SELECT * FROM contacts WHERE opt_in_status = 'opted_in'`).all() as Contact[];
}

export function getContactByPhone(db: Database.Database, phone: string): Contact | undefined {
  return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone) as Contact | undefined;
}
