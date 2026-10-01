CREATE TABLE IF NOT EXISTS admin_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO admin_auth (id, salt, password_hash)
VALUES (1, 'ishvari-crm-admin-v1', 'a6710a89c303084ffe954a1ab9fac7052cabd6e7bef0459fcb1e02f6487e2865');
