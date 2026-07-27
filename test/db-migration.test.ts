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

    const existingRow = migrated.prepare(`SELECT * FROM templates WHERE name = 'old-template'`).get() as any;
    expect(existingRow.personalize_name).toBe(0);

    migrated.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });
  });
});
