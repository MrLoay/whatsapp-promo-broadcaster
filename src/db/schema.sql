CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,                  -- dashboard username that owns this contact (each account's data is fully separate)
  phone TEXT NOT NULL,                  -- E.164 format, e.g. +15551234567
  name TEXT,
  opt_in_status TEXT NOT NULL DEFAULT 'pending' CHECK (opt_in_status IN ('pending', 'opted_in', 'opted_out')),
  opt_in_source TEXT,                   -- e.g. 'csv_import', 'website_form', 'in_store'
  opt_in_at TEXT,
  opted_out_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, phone)                 -- the same phone number can exist as a separate contact under a different owner
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,                   -- local reference name, unique per owner
  meta_template_name TEXT,              -- unused for now; reserved for the official Meta Cloud API integration (see SETUP_META.md)
  body_text TEXT NOT NULL,              -- the literal message sent, with {{1}}, {{2}}, ... placeholders
  language TEXT NOT NULL DEFAULT 'en_US',
  variable_count INTEGER NOT NULL DEFAULT 0,
  personalize_name INTEGER NOT NULL DEFAULT 0, -- if true, {{1}} is auto-filled per recipient from contacts.name at send time
  media_path TEXT,
  media_mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, name)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  variable_values TEXT,                 -- JSON array of strings, applied to every recipient
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'failed')),
  total_targeted INTEGER DEFAULT 0,
  scheduling_mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (scheduling_mode IN ('round_robin', 'batch_sync')),
  batch_rest_seconds INTEGER NOT NULL DEFAULT 60,
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
  account_id TEXT,
  account_name TEXT,
  phone TEXT,                           -- snapshot of contacts.phone so reports survive contact deletion
  name TEXT,                            -- snapshot of contacts.name
  UNIQUE (campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,                  -- which account's WhatsApp session received this message
  contact_phone TEXT NOT NULL,
  body TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  triggered_opt_out INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_wamid ON campaign_recipients(wamid);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  account_name TEXT,
  proxy_url TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('DISCONNECTED', 'CONNECTING', 'QR_READY', 'READY', 'BANNED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

-- One license per deployment (single row). Changed ONLY by the server-side CLI (npm run license),
-- never through the dashboard, so a customer cannot raise their own limit.
CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  customer_name TEXT NOT NULL,
  max_accounts INTEGER NOT NULL CHECK (max_accounts >= 0),
  expires_at TEXT NOT NULL,             -- YYYY-MM-DD, valid through the end of that day (Malaysia time)
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS license_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  detail TEXT
);

-- Indexes on the `owner` column are NOT created here on purpose: this file
-- runs unconditionally via CREATE TABLE/INDEX IF NOT EXISTS on every boot,
-- including against pre-existing databases from before multi-tenancy that
-- don't have `owner` yet. Creating an index on a column that doesn't exist
-- yet would fail immediately, before the migration in db/index.ts has a
-- chance to add it. Those indexes are created programmatically after the
-- migration runs instead -- see createPostMigrationIndexes() in db/index.ts.

CREATE TABLE IF NOT EXISTS user_credits (
  owner TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  cost_per_msg REAL NOT NULL DEFAULT 0.13,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
