import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db';
import { importContactsFromCsv, markOptedOut, listOptedInContacts, getContactByPhone } from '../src/services/contacts';

describe('contacts service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('imports contacts messageable by default, skips invalid phone numbers, excludes skip=true rows', () => {
    const csv = `phone,name,skip
+15551234567,Alice,false
+15559876543,Bob,true
notaphone,Eve,false`;

    const result = importContactsFromCsv(db, csv);

    expect(result.inserted).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].phone).toBe('notaphone');

    const alice = getContactByPhone(db, '+15551234567');
    expect(alice?.opt_in_status).toBe('opted_in');

    const bob = getContactByPhone(db, '+15559876543');
    expect(bob?.opt_in_status).toBe('opted_out');
  });

  it('only non-skipped contacts appear in the campaign-eligible list', () => {
    importContactsFromCsv(db, `phone,name,skip\n+15551234567,Alice,false\n+15559876543,Bob,true`);
    const eligible = listOptedInContacts(db);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].phone).toBe('+15551234567');
  });

  it('markOptedOut flips status and is reflected in eligible list', () => {
    importContactsFromCsv(db, `phone,name,skip\n+15551234567,Alice,false`);
    expect(listOptedInContacts(db)).toHaveLength(1);

    markOptedOut(db, '+15551234567');
    expect(listOptedInContacts(db)).toHaveLength(0);

    const alice = getContactByPhone(db, '+15551234567');
    expect(alice?.opt_in_status).toBe('opted_out');
    expect(alice?.opted_out_at).not.toBeNull();
  });
});
