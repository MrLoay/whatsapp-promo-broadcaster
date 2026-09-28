import type Database from 'better-sqlite3';

export function getCreditBalance(db: Database.Database, owner: string): number {
  const row = db.prepare(`SELECT balance FROM user_credits WHERE owner = ?`).get(owner) as { balance: number } | undefined;
  // If the user doesn't exist in the credits table yet, they have 0 balance by default
  return row?.balance ?? 0;
}

export function getCostPerMsg(db: Database.Database, owner: string): number {
  const row = db.prepare(`SELECT cost_per_msg FROM user_credits WHERE owner = ?`).get(owner) as { cost_per_msg: number } | undefined;
  return row?.cost_per_msg ?? 0.13;
}

export function topupCredits(db: Database.Database, owner: string, amount: number): number {
  const info = db.prepare(`
    INSERT INTO user_credits (owner, balance, cost_per_msg, updated_at)
    VALUES (?, ?, 0.13, datetime('now'))
    ON CONFLICT(owner) DO UPDATE SET
      balance = balance + excluded.balance,
      updated_at = excluded.updated_at
  `).run(owner, amount);
  
  return getCreditBalance(db, owner);
}

export function deductCredits(db: Database.Database, owner: string, amount: number): boolean {
  const result = db.prepare(`
    UPDATE user_credits 
    SET balance = balance - ?, updated_at = datetime('now')
    WHERE owner = ? AND balance >= ?
  `).run(amount, owner, amount);
  
  return result.changes > 0;
}
