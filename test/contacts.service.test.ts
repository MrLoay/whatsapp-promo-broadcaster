import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db';
import { importContactsFromCsv, markOptedOut, listOptedInContacts, listContacts, getContactByPhone } from '../src/services/contacts';

const OWNER = 'flowers';
const OTHER_OWNER = 'sunglasses';

describe('contacts service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('imports contacts as messageable, skipping invalid phone numbers', () => {
    const csv = `phone,name
+15551234567,Alice
+15559876543,Bob
notaphone,Eve`;

    const result = importContactsFromCsv(db, OWNER, csv);

    expect(result.inserted).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].phone).toBe('notaphone');

    const alice = getContactByPhone(db, OWNER, '+15551234567');
    expect(alice?.opt_in_status).toBe('opted_in');

    const bob = getContactByPhone(db, OWNER, '+15559876543');
    expect(bob?.opt_in_status).toBe('opted_in');
  });

  it('imports headerless CSV and plain .txt files correctly', () => {
    const txtContent = `+15551112222, Charlie
+15553334444, David`;

    const result = importContactsFromCsv(db, OWNER, txtContent);
    expect(result.inserted).toBe(2);
    expect(getContactByPhone(db, OWNER, '+15551112222')?.name).toBe('Charlie');
    expect(getContactByPhone(db, OWNER, '+15553334444')?.name).toBe('David');
  });

  it('every imported contact appears in the campaign-eligible list', () => {
    importContactsFromCsv(db, OWNER, `phone,name\n+15551234567,Alice\n+15559876543,Bob`);
    const eligible = listOptedInContacts(db, OWNER);
    expect(eligible).toHaveLength(2);
  });

  it('markOptedOut flips status and is reflected in eligible list', () => {
    importContactsFromCsv(db, OWNER, `phone,name\n+15551234567,Alice`);
    expect(listOptedInContacts(db, OWNER)).toHaveLength(1);

    markOptedOut(db, OWNER, '+15551234567');
    expect(listOptedInContacts(db, OWNER)).toHaveLength(0);

    const alice = getContactByPhone(db, OWNER, '+15551234567');
    expect(alice?.opt_in_status).toBe('opted_out');
    expect(alice?.opted_out_at).not.toBeNull();
  });

  it('the same phone number can exist as a separate contact under a different owner', () => {
    importContactsFromCsv(db, OWNER, `phone,name\n+15551234567,Alice (flowers customer)`);
    importContactsFromCsv(db, OTHER_OWNER, `phone,name\n+15551234567,Alice (sunglasses customer)`);

    const flowersAlice = getContactByPhone(db, OWNER, '+15551234567');
    const sunglassesAlice = getContactByPhone(db, OTHER_OWNER, '+15551234567');

    expect(flowersAlice?.name).toBe('Alice (flowers customer)');
    expect(sunglassesAlice?.name).toBe('Alice (sunglasses customer)');
    expect(flowersAlice?.id).not.toBe(sunglassesAlice?.id);
  });

  it('one owner never sees another owner\'s contacts', () => {
    importContactsFromCsv(db, OWNER, `phone,name\n+15551111111,FlowersOnly`);
    importContactsFromCsv(db, OTHER_OWNER, `phone,name\n+15552222222,SunglassesOnly`);

    expect(listContacts(db, OWNER)).toHaveLength(1);
    expect(listContacts(db, OTHER_OWNER)).toHaveLength(1);
    expect(listContacts(db, OWNER)[0].name).toBe('FlowersOnly');
    expect(listContacts(db, OTHER_OWNER)[0].name).toBe('SunglassesOnly');
  });
});
