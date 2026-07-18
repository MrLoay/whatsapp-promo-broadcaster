import type Database from 'better-sqlite3';

export interface MessageTemplate {
  id: number;
  name: string;
  meta_template_name: string;
  language: string;
  variable_count: number;
}

/**
 * Registers a template locally. This does NOT create or submit the template
 * to Meta -- template creation/approval happens in Meta Business Manager (or
 * via the separate Message Templates API). This record just mirrors an
 * already-approved template so campaigns can reference it by name.
 */
export function registerTemplate(
  db: Database.Database,
  name: string,
  metaTemplateName: string,
  language: string,
  variableCount: number
): MessageTemplate {
  const info = db
    .prepare(
      `INSERT INTO templates (name, meta_template_name, language, variable_count) VALUES (?, ?, ?, ?)`
    )
    .run(name, metaTemplateName, language, variableCount);
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
