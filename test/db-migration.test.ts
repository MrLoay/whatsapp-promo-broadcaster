import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { openDb } from '../src/db';

describe('db column migrations', () => {
  it('adds personalize_name to a pre-existing templates table missing that column', () => {
    // Simulate a database created before personalize_name existed: build the
    // old-shape table by hand, then open it through openDb() and confirm the
    // migration heals it instead of throwing "no such column".
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        meta_template_name TEXT,
        body_text TEXT,
        language TEXT NOT NULL DEFAULT 'en_US',
        variable_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(`INSERT INTO templates (name, body_text) VALUES ('old-template', 'Hi there')`).run();
    db.close();

    // openDb() re-runs schema.sql (CREATE TABLE IF NOT EXISTS -- no-op here)
    // plus the column migrations against a real file so this exercises the
    // exact path production uses, not just an in-memory shortcut.
    const dbPath = path.join(__dirname, 'tmp-migration-test.db');
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });

    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        meta_template_name TEXT,
        body_text TEXT,
        language TEXT NOT NULL DEFAULT 'en_US',
        variable_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seedDb.prepare(`INSERT INTO templates (name, body_text) VALUES ('old-template', 'Hi there')`).run();
    seedDb.close();

    const migrated = openDb(dbPath);
    const columns = migrated.prepare('PRAGMA table_info(templates)').all() as { name: string }[];
    expect(columns.some((c) => c.name === 'personalize_name')).toBe(true);
    expect(columns.some((c) => c.name === 'owner')).toBe(true);

    const existingRow = migrated.prepare(`SELECT * FROM templates WHERE name = 'old-template'`).get() as any;
    expect(existingRow.personalize_name).toBe(0);
    expect(existingRow.owner).toBe('testuser'); // first configured DASHBOARD_USERS account in the test env

    migrated.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });
  });

  it('rebuilds a pre-multitenant contacts table so the same phone can exist under different owners', () => {
    const dbPath = path.join(__dirname, 'tmp-migration-test-contacts.db');
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });

    // Simulate the old pre-multitenant schema: phone globally UNIQUE, no owner column.
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        name TEXT,
        opt_in_status TEXT NOT NULL DEFAULT 'pending',
        opt_in_source TEXT,
        opt_in_at TEXT,
        opted_out_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seedDb.prepare(`INSERT INTO contacts (phone, name, opt_in_status) VALUES ('+15551234567', 'Alice', 'opted_in')`).run();
    seedDb.close();

    const migrated = openDb(dbPath);
    const columns = migrated.prepare('PRAGMA table_info(contacts)').all() as { name: string }[];
    expect(columns.some((c) => c.name === 'owner')).toBe(true);

    const existing = migrated.prepare(`SELECT * FROM contacts WHERE phone = '+15551234567'`).get() as any;
    expect(existing.owner).toBe('testuser');
    expect(existing.name).toBe('Alice');

    // The old table only allowed one row per phone number, period. After the
    // rebuild, the same phone must be allowed as a separate contact for a
    // different owner -- this is the whole point of the migration.
    migrated.prepare(`INSERT INTO contacts (owner, phone, name, opt_in_status) VALUES ('otheruser', '+15551234567', 'Bob', 'opted_in')`).run();
    const both = migrated.prepare(`SELECT * FROM contacts WHERE phone = '+15551234567'`).all() as any[];
    expect(both).toHaveLength(2);

    migrated.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });
  });
});
