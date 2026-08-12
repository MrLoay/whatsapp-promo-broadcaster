import type Database from 'better-sqlite3';

export type AccountStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'READY' | 'BANNED';

export interface Account {
  id: string;
  account_name: string | null;
  proxy_url: string | null;
  status: AccountStatus;
  created_at: string;
  last_active: string | null;
}

export function getAccountById(db: Database.Database, id: string): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export function listAccounts(db: Database.Database): Account[] {
  return db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as Account[];
}

export function upsertAccount(
  db: Database.Database,
  id: string,
  data: { account_name?: string | null; proxy_url?: string | null; status?: AccountStatus; last_active?: string | null }
): Account {
  const existing = getAccountById(db, id);
  if (!existing) {
    db.prepare(
      `INSERT INTO accounts (id, account_name, proxy_url, status, last_active)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      data.account_name ?? null,
      data.proxy_url ?? null,
      data.status ?? 'DISCONNECTED',
      data.last_active ?? null
    );
  } else {
    const account_name = data.account_name !== undefined ? data.account_name : existing.account_name;
    const proxy_url = data.proxy_url !== undefined ? data.proxy_url : existing.proxy_url;
    const status = data.status !== undefined ? data.status : existing.status;
    const last_active = data.last_active !== undefined ? data.last_active : existing.last_active;

    db.prepare(
      `UPDATE accounts SET account_name = ?, proxy_url = ?, status = ?, last_active = ? WHERE id = ?`
    ).run(account_name, proxy_url, status, last_active, id);
  }

  return getAccountById(db, id)!;
}

export function updateAccountStatus(
  db: Database.Database,
  id: string,
  status: AccountStatus,
  lastActive?: string
): void {
  const now = lastActive ?? (status === 'READY' ? new Date().toISOString() : undefined);
  if (now) {
    db.prepare(`UPDATE accounts SET status = ?, last_active = ? WHERE id = ?`).run(status, now, id);
  } else {
    db.prepare(`UPDATE accounts SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function deleteAccount(db: Database.Database, id: string): boolean {
  const info = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  return info.changes > 0;
}
