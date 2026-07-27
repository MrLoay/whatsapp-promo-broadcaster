import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// CREATE TABLE IF NOT EXISTS in schema.sql only handles brand-new databases --
// it never adds columns to a table that already exists from a prior deploy.
// Each entry here is applied idempotently (checked against the live schema)
// so upgrading an existing database is automatic instead of a manual step.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'templates', column: 'personalize_name', ddl: 'ALTER TABLE templates ADD COLUMN personalize_name INTEGER NOT NULL DEFAULT 0' },
];

function applyColumnMigrations(db: Database.Database): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      db.exec(ddl);
    }
  }
}

export function openDb(dbPath: string = config.db.path): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  applyColumnMigrations(db);
  return db;
}

let sharedDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!sharedDb) sharedDb = openDb();
  return sharedDb;
}

/** Test-only: injects an isolated DB (e.g. in-memory) as the shared instance used by routes. */
export function setDbForTests(db: Database.Database): void {
  sharedDb = db;
}
