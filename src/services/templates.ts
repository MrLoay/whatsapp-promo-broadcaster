import type Database from 'better-sqlite3';

export interface MessageTemplate {
  id: number;
  name: string;
  meta_template_name: string | null;
  body_text: string | null;
  language: string;
  variable_count: number;
}

export interface RegisterTemplateInput {
  name: string;
  language?: string;
  variableCount?: number;
  /** Required if you'll send this template via the cloud_api provider: must match the name approved in Meta Business Manager. */
  metaTemplateName?: string;
  /** Required if you'll send this template via the web_js provider: free text with {{1}}, {{2}}, ... placeholders. */
  bodyText?: string;
}

/**
 * Registers a template locally. For the cloud_api provider this does NOT
 * create or submit anything to Meta -- template creation/approval happens in
 * Meta Business Manager; this record just mirrors an already-approved
 * template so campaigns can reference it by name. For the web_js provider,
 * bodyText IS the actual message that gets sent, so it must be provided.
 */
export function registerTemplate(db: Database.Database, input: RegisterTemplateInput): MessageTemplate {
  if (!input.metaTemplateName && !input.bodyText) {
    throw new Error('Provide metaTemplateName (for cloud_api) and/or bodyText (for web_js)');
  }
  const info = db
    .prepare(
      `INSERT INTO templates (name, meta_template_name, body_text, language, variable_count) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.metaTemplateName ?? null,
      input.bodyText ?? null,
      input.language ?? 'en_US',
      input.variableCount ?? 0
    );
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
