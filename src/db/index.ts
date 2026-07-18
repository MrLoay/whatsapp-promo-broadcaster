import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

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
