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
  { table: 'templates', column: 'media_path', ddl: 'ALTER TABLE templates ADD COLUMN media_path TEXT' },
  { table: 'templates', column: 'media_mime_type', ddl: 'ALTER TABLE templates ADD COLUMN media_mime_type TEXT' },
];

function applyColumnMigrations(db: Database.Database): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      db.exec(ddl);
    }
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

/** Whichever account owned all the data before multi-tenancy existed -- the first configured dashboard user. */
function legacyDataOwner(): string {
  try {
    const users = JSON.parse(config.dashboard.users) as { username: string }[];
    return users[0]?.username ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * One-time migration: adds per-account data isolation. contacts/templates
 * need a full table rebuild (not just ADD COLUMN) because their uniqueness
 * constraints change scope -- e.g. the same phone number must be allowed to
 * exist as a separate contact under two different accounts, which the old
 * single-column UNIQUE(phone) constraint would block.
 */
function migrateToMultiTenant(db: Database.Database): void {
  const owner = legacyDataOwner().replace(/'/g, "''");

  if (!hasColumn(db, 'contacts', 'owner')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE contacts RENAME TO contacts_pre_multitenant;
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        phone TEXT NOT NULL,
        name TEXT,
        opt_in_status TEXT NOT NULL DEFAULT 'pending' CHECK (opt_in_status IN ('pending', 'opted_in', 'opted_out')),
        opt_in_source TEXT,
        opt_in_at TEXT,
        opted_out_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (owner, phone)
      );
      INSERT INTO contacts (id, owner, phone, name, opt_in_status, opt_in_source, opt_in_at, opted_out_at, created_at, updated_at)
        SELECT id, '${owner}', phone, name, opt_in_status, opt_in_source, opt_in_at, opted_out_at, created_at, updated_at FROM contacts_pre_multitenant;
      DROP TABLE contacts_pre_multitenant;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }

  if (!hasColumn(db, 'templates', 'owner')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      ALTER TABLE templates RENAME TO templates_pre_multitenant;
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        meta_template_name TEXT,
        body_text TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en_US',
        variable_count INTEGER NOT NULL DEFAULT 0,
        personalize_name INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (owner, name)
      );
      INSERT INTO templates (id, owner, name, meta_template_name, body_text, language, variable_count, personalize_name, created_at)
        SELECT id, '${owner}', name, meta_template_name, body_text, language, variable_count, personalize_name, created_at FROM templates_pre_multitenant;
      DROP TABLE templates_pre_multitenant;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }

  if (!hasColumn(db, 'campaigns', 'owner')) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN owner TEXT NOT NULL DEFAULT '${owner}'`);
  }

  if (!hasColumn(db, 'inbound_messages', 'owner')) {
    db.exec(`ALTER TABLE inbound_messages ADD COLUMN owner TEXT NOT NULL DEFAULT '${owner}'`);
  }
}

// Safe to run only after migrateToMultiTenant() guarantees these columns exist.
function createPostMigrationIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contacts_owner_status ON contacts(owner, opt_in_status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner);
    CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(owner);
  `);
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
  migrateToMultiTenant(db);
  createPostMigrationIndexes(db);
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
