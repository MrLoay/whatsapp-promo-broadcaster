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
  const cleanContent = (csvContent ?? '').trim();
  if (!cleanContent) {
    return { inserted: 0, updated: 0, skipped: [] };
  }

  const result: ImportResult = { inserted: 0, updated: 0, skipped: [] };

  // Parse lines robustly regardless of delimiter (tabs, spaces, commas) or column order
  const lines = cleanContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const tx = db.transaction((lineArray: string[]) => {
    for (const rawLine of lineArray) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('phone')) continue;

      // Extract parts by comma, tab, or multi-space
      const tokens = trimmed.split(/[\t,]| {2,}/).map((t) => t.trim()).filter(Boolean);

      let rawPhone = '';
      let rawName = '';

      // Find token that looks like a phone number (contains digits and length 7-15)
      const phoneIndex = tokens.findIndex((t) => {
        const cleaned = t.replace(/[^\d+]/g, '');
        return cleaned.length >= 7 && cleaned.length <= 15;
      });

      if (phoneIndex !== -1) {
        rawPhone = tokens[phoneIndex];
        const nameTokens = tokens.filter((_, i) => i !== phoneIndex);
        rawName = nameTokens.join(' ');
      } else {
        // Fallback: try regex extract digits from line
        const digitMatch = trimmed.match(/\+?\d[\d\s-]{6,14}\d/);
        if (digitMatch) {
          rawPhone = digitMatch[0];
          rawName = trimmed.replace(digitMatch[0], '').trim();
        } else {
          rawPhone = tokens[0] ?? '';
          rawName = tokens.slice(1).join(' ');
        }
      }

      // Clean phone number: remove spaces/dashes, add leading '+' if missing
      let cleanPhone = rawPhone.replace(/[^\d+]/g, '');
      if (cleanPhone && !cleanPhone.startsWith('+')) {
        cleanPhone = '+' + cleanPhone;
      }

      if (!E164_RE.test(cleanPhone)) {
        result.skipped.push({ phone: rawPhone || rawLine, reason: 'invalid phone format, expected E.164 e.g. +601128673204' });
        continue;
      }

      const outcome = upsertContact(db, owner, cleanPhone, rawName || undefined, source);
      result[outcome === 'inserted' ? 'inserted' : 'updated']++;
    }
  });

  tx(lines);
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
