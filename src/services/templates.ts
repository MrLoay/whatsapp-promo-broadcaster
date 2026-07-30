import type Database from 'better-sqlite3';

export interface MessageTemplate {
  id: number;
  name: string;
  body_text: string | null;
  language: string;
  variable_count: number;
  personalize_name: number;
}

export interface RegisterTemplateInput {
  name: string;
  language?: string;
  variableCount?: number;
  /** Free text with {{1}}, {{2}}, ... placeholders -- the literal message sent. */
  bodyText: string;
  /** If true, {{1}} is auto-filled per recipient from contacts.name at send time instead of a fixed campaign-wide value. */
  personalizeName?: boolean;
}

/** Registers a template. bodyText IS the actual message that gets sent. */
export function registerTemplate(db: Database.Database, input: RegisterTemplateInput): MessageTemplate {
  const info = db
    .prepare(`INSERT INTO templates (name, body_text, language, variable_count, personalize_name) VALUES (?, ?, ?, ?, ?)`)
    .run(input.name, input.bodyText, input.language ?? 'en_US', input.variableCount ?? 0, input.personalizeName ? 1 : 0);
  return getTemplateById(db, info.lastInsertRowid as number)!;
}

export function getTemplateById(db: Database.Database, id: number): MessageTemplate | undefined {
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as MessageTemplate | undefined;
}

export function getTemplateByName(db: Database.Database, name: string): MessageTemplate | undefined {
  return db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as MessageTemplate | undefined;
}

export function listTemplates(db: Database.Database): MessageTemplate[] {
  return db.prepare('SELECT * FROM templates ORDER BY id').all() as MessageTemplate[];
}
