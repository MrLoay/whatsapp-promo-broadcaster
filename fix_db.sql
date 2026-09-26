PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE campaigns_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  variable_values TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  owner TEXT NOT NULL DEFAULT 'ForgeCodes'
);
INSERT INTO campaigns_new SELECT id, name, template_id, variable_values, status, created_at, started_at, completed_at, owner FROM campaigns;
DROP TABLE campaigns;
ALTER TABLE campaigns_new RENAME TO campaigns;

CREATE TABLE campaign_recipients_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  wamid TEXT,
  error TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  UNIQUE (campaign_id, contact_id)
);
INSERT INTO campaign_recipients_new SELECT id, campaign_id, contact_id, status, wamid, error, sent_at, delivered_at, read_at FROM campaign_recipients;
DROP TABLE campaign_recipients;
ALTER TABLE campaign_recipients_new RENAME TO campaign_recipients;

CREATE INDEX idx_campaign_recipients_wamid ON campaign_recipients(wamid);
CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaigns_owner ON campaigns(owner);

COMMIT;
PRAGMA foreign_keys = ON;
