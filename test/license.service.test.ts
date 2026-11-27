import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { config } from '../src/config';
import { openDb } from '../src/db';
import { upsertAccount } from '../src/services/accounts';
import { importContactsFromCsv } from '../src/services/contacts';
import {
  LicenseError,
  assertCanAddAccount,
  assertLicenseActive,
  getLicenseStatus,
  listLicenseLog,
  setLicense,
} from '../src/services/license';
import { ProxyError, redactProxy, validateAccountProxy } from '../src/services/proxies';
import { sendNow } from '../src/services/campaigns';

const OWNER = 'cust';
const D = (iso: string) => Date.parse(iso);

describe('license service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    config.license.enforce = true;
  });
  afterEach(() => {
    config.license.enforce = false;
  });

  it('blocks everything when enforced and no license is installed', () => {
    expect(getLicenseStatus(db)).toMatchObject({ enforced: true, licensed: false, active: false, reason: 'no_license' });
    expect(() => assertLicenseActive(db)).toThrow(LicenseError);
    expect(() => assertLicenseActive(db)).toThrow(/No license/);
  });

  it('allows everything when not enforced (existing deployments keep working)', () => {
    config.license.enforce = false;
    expect(getLicenseStatus(db)).toMatchObject({ enforced: false, active: true, reason: 'not_enforced' });
    expect(() => assertLicenseActive(db)).not.toThrow();
    expect(() => assertCanAddAccount(db)).not.toThrow();
  });

  it('is valid through the END of the expiry day (Malaysia time), then expires', () => {
    setLicense(db, { customer_name: 'A', max_accounts: 20, expires_at: '2027-01-31' });
    expect(getLicenseStatus(db, D('2027-01-31T23:00:00+08:00'))).toMatchObject({ active: true, reason: 'ok' });
    const after = getLicenseStatus(db, D('2027-02-01T00:00:01+08:00'));
    expect(after).toMatchObject({ active: false, reason: 'expired' });
    expect(after.days_left!).toBeLessThanOrEqual(0);
    expect(() => assertLicenseActive(db, D('2027-02-01T00:00:01+08:00'))).toThrow(/expired on 2027-01-31/);
  });

  it('enforces the account limit and counts only active accounts', () => {
    setLicense(db, { customer_name: 'A', max_accounts: 2, expires_at: '2099-01-01' });
    upsertAccount(db, 'a1', {});
    upsertAccount(db, 'a2', {});
    expect(getLicenseStatus(db).used_accounts).toBe(2);
    expect(() => assertCanAddAccount(db)).toThrow(/Account limit reached \(2\/2\)/);

    upsertAccount(db, 'a2', { is_active: 0 }); // deactivating frees a slot
    expect(() => assertCanAddAccount(db)).not.toThrow();
  });

  it('raising the limit requires setLicense and is written to the audit log', () => {
    setLicense(db, { customer_name: 'A', max_accounts: 20, expires_at: '2099-01-01' });
    setLicense(db, { customer_name: 'A', max_accounts: 40, expires_at: '2099-01-01' });
    const log = listLicenseLog(db);
    expect(log).toHaveLength(2);
    expect(log[0].detail).toMatch(/max_accounts 20 -> 40/);
  });

  it('rejects invalid license data', () => {
    expect(() => setLicense(db, { customer_name: 'A', max_accounts: -1, expires_at: '2099-01-01' })).toThrow();
    expect(() => setLicense(db, { customer_name: 'A', max_accounts: 5, expires_at: '2099-02-30' })).toThrow(/valid date/);
    expect(() => setLicense(db, { customer_name: ' ', max_accounts: 5, expires_at: '2099-01-01' })).toThrow();
  });

  it('refuses to start a broadcast on an expired license, but allows it on a valid one', async () => {
    importContactsFromCsv(db, OWNER, 'phone,name\n+15551111111,Alice');
    setLicense(db, { customer_name: 'A', max_accounts: 5, expires_at: '2000-01-01' });
    await expect(sendNow(db, OWNER, 'hello')).rejects.toThrow(LicenseError);

    setLicense(db, { customer_name: 'A', max_accounts: 5, expires_at: '2099-01-01' });
    const campaign = await sendNow(db, OWNER, 'hello');
    expect(campaign.id).toBeGreaterThan(0);
  });
});

describe('proxy rules', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('redacts credentials, leaving only protocol://host:port', () => {
    expect(redactProxy('http://user:secret@1.2.3.4:8080')).toBe('http://1.2.3.4:8080');
    expect(redactProxy('socks5://u:p@host.example:1080')).toBe('socks5://host.example:1080');
    expect(redactProxy(null)).toBeNull();
    expect(redactProxy('not a url')).toBe('[invalid proxy]');
  });

  it('requires a well-formed proxy', () => {
    expect(() => validateAccountProxy(db, 'a1', null)).toThrow(ProxyError);
    expect(() => validateAccountProxy(db, 'a1', '')).toThrow(/required/);
    expect(() => validateAccountProxy(db, 'a1', 'ftp://1.2.3.4:21')).toThrow(/Invalid proxy/);
    expect(() => validateAccountProxy(db, 'a1', 'http://1.2.3.4')).toThrow(/Invalid proxy/); // no port
    expect(() => validateAccountProxy(db, 'a1', 'http://u:p@1.2.3.4:8080')).not.toThrow();
  });

  it('never lets two accounts share the same proxy host:port (even with different credentials)', () => {
    upsertAccount(db, 'a1', { account_name: 'First', proxy_url: 'http://u1:p1@1.2.3.4:8080' });
    expect(() => validateAccountProxy(db, 'a2', 'http://u2:p2@1.2.3.4:8080')).toThrow(/already used by account "First"/);
    expect(() => validateAccountProxy(db, 'a2', 'http://u2:p2@1.2.3.4:8081')).not.toThrow(); // different port is OK
    expect(() => validateAccountProxy(db, 'a1', 'http://u1:p1@1.2.3.4:8080')).not.toThrow(); // an account may keep its own
  });
});
