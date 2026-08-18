import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';

export type OptInStatus = 'pending' | 'opted_in' | 'opted_out';

export interface Contact {
  id: number;
  owner: string;
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
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: { phone: string; reason: string }[];
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Every contact added here is messageable -- the boutique owner is expected
 * to only add numbers of people they've already been in contact with. The
 * one automatic exception is a STOP reply (see markOptedOut), which always
 * overrides this. Contacts are scoped per dashboard account (owner) -- the
 * same phone number can exist as a separate contact under a different owner.
 */
export function upsertContact(
  db: Database.Database,
  owner: string,
  phone: string,
  name: string | undefined,
  source: string
): 'inserted' | 'updated' {
  const existing = db.prepare('SELECT id FROM contacts WHERE owner = ? AND phone = ?').get(owner, phone) as
    | { id: number }
    | undefined;
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE contacts SET name = COALESCE(?, name), opt_in_status = 'opted_in', opt_in_source = ?, opt_in_at = ?, updated_at = ? WHERE id = ?`
    ).run(name ?? null, source, now, now, existing.id);
    return 'updated';
  }

  db.prepare(
    `INSERT INTO contacts (owner, phone, name, opt_in_status, opt_in_source, opt_in_at)
     VALUES (?, ?, ?, 'opted_in', ?, ?)`
  ).run(owner, phone, name ?? null, source, now);
  return 'inserted';
}

/** CSV or plain text lines must have: phone, name (optional). Handles headerless and header-based files. */
export function importContactsFromCsv(
  db: Database.Database,
  owner: string,
  csvContent: string,
  source = 'csv_import'
): ImportResult {
  const cleanContent = csvContent.trim();
  if (!cleanContent) {
    return { inserted: 0, updated: 0, skipped: [] };
  }

  let rows: Record<string, string>[] = [];
  try {
    rows = parse(cleanContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    // Check if header parsed correctly (i.e. 'phone' column exists)
    if (rows.length > 0 && !('phone' in rows[0])) {
      // Fallback: parse without headers
      const rawRows = parse(cleanContent, { columns: false, skip_empty_lines: true, trim: true }) as string[][];
      rows = rawRows.map((r) => ({ phone: r[0] ?? '', name: r[1] ?? '' }));
    }
  } catch {
    // Fallback line-by-line parsing for informal .txt files
    const lines = cleanContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    rows = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return { phone: parts[0] ?? '', name: parts[1] ?? '' };
    });
  }

  const result: ImportResult = { inserted: 0, updated: 0, skipped: [] };

  const tx = db.transaction((records: Record<string, string>[]) => {
    for (const row of records) {
      const phone = (row.phone ?? '').trim();
      // Skip header row if fallback added it
      if (phone.toLowerCase() === 'phone') continue;

      if (!E164_RE.test(phone)) {
        result.skipped.push({ phone: phone || '(empty)', reason: 'invalid phone format, expected E.164 e.g. +15551234567' });
        continue;
      }
      const outcome = upsertContact(db, owner, phone, row.name, source);
      result[outcome === 'inserted' ? 'inserted' : 'updated']++;
    }
  });

  tx(rows);
  return result;
}

/** owner identifies whose WhatsApp session received the STOP -- only that account's contact is affected. */
export function markOptedOut(db: Database.Database, owner: string, phone: string): boolean {
  const now = new Date().toISOString();
  const info = db
    .prepare(`UPDATE contacts SET opt_in_status = 'opted_out', opted_out_at = ?, updated_at = ? WHERE owner = ? AND phone = ?`)
    .run(now, now, owner, phone);
  return info.changes > 0;
}

export function listOptedInContacts(db: Database.Database, owner: string): Contact[] {
  return db.prepare(`SELECT * FROM contacts WHERE owner = ? AND opt_in_status = 'opted_in'`).all(owner) as Contact[];
}

export function listContacts(db: Database.Database, owner: string): Contact[] {
  return db.prepare('SELECT * FROM contacts WHERE owner = ? ORDER BY id').all(owner) as Contact[];
}

export function getContactByPhone(db: Database.Database, owner: string, phone: string): Contact | undefined {
  return db.prepare('SELECT * FROM contacts WHERE owner = ? AND phone = ?').get(owner, phone) as Contact | undefined;
}

/** Deletes a contact (and its send history) -- scoped to owner so one account can't delete another's contact by guessing an id. */
export function deleteContact(db: Database.Database, owner: string, id: number): boolean {
  const tx = db.transaction((contactId: number) => {
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND owner = ?').get(contactId, owner);
    if (!contact) return { changes: 0 };
    db.prepare('DELETE FROM campaign_recipients WHERE contact_id = ?').run(contactId);
    return db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
  });
  const info = tx(id);
  return info.changes > 0;
}
