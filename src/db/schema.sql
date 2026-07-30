CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,           -- E.164 format, e.g. +15551234567
  name TEXT,
  opt_in_status TEXT NOT NULL DEFAULT 'pending' CHECK (opt_in_status IN ('pending', 'opted_in', 'opted_out')),
  opt_in_source TEXT,                   -- e.g. 'csv_import', 'website_form', 'in_store'
  opt_in_at TEXT,
  opted_out_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,            -- local reference name
  meta_template_name TEXT,              -- unused for now; reserved for the official Meta Cloud API integration (see SETUP_META.md)
  body_text TEXT NOT NULL,              -- the literal message sent, with {{1}}, {{2}}, ... placeholders
  language TEXT NOT NULL DEFAULT 'en_US',
  variable_count INTEGER NOT NULL DEFAULT 0,
  personalize_name INTEGER NOT NULL DEFAULT 0, -- if true, {{1}} is auto-filled per recipient from contacts.name at send time
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  variable_values TEXT,                 -- JSON array of strings, applied to every recipient
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  wamid TEXT,                           -- Meta's message id, used to match webhook status updates
  error TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  UNIQUE (campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_phone TEXT NOT NULL,
  body TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  triggered_opt_out INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contacts_opt_in_status ON contacts(opt_in_status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_wamid ON campaign_recipients(wamid);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
