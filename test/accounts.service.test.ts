import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db';
import type Database from 'better-sqlite3';
import {
  upsertAccount,
  getAccountById,
  listAccounts,
  updateAccountStatus,
  deleteAccount,
} from '../src/services/accounts';

describe('accounts service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('creates and retrieves an account record with proxy_url and status', () => {
    const acc = upsertAccount(db, 'user1', {
      account_name: 'Store 1',
      proxy_url: 'http://user:pass@1.2.3.4:8080',
      status: 'DISCONNECTED',
    });

    expect(acc.id).toBe('user1');
    expect(acc.account_name).toBe('Store 1');
    expect(acc.proxy_url).toBe('http://user:pass@1.2.3.4:8080');
    expect(acc.status).toBe('DISCONNECTED');

    const fetched = getAccountById(db, 'user1');
    expect(fetched).toEqual(acc);
  });

  it('updates account status and last_active correctly', () => {
    upsertAccount(db, 'user2', { account_name: 'Store 2', status: 'CONNECTING' });

    updateAccountStatus(db, 'user2', 'READY');
    let fetched = getAccountById(db, 'user2');
    expect(fetched?.status).toBe('READY');
    expect(fetched?.last_active).toBeDefined();

    updateAccountStatus(db, 'user2', 'BANNED');
    fetched = getAccountById(db, 'user2');
    expect(fetched?.status).toBe('BANNED');
  });

  it('lists accounts and deletes an account', () => {
    upsertAccount(db, 'acc1', { account_name: 'Acc 1' });
    upsertAccount(db, 'acc2', { account_name: 'Acc 2' });

    expect(listAccounts(db)).toHaveLength(2);

    const deleted = deleteAccount(db, 'acc1');
    expect(deleted).toBe(true);
    expect(listAccounts(db)).toHaveLength(1);
    expect(getAccountById(db, 'acc1')).toBeUndefined();
  });
});
