CREATE TABLE IF NOT EXISTS business_settings (
  id INTEGER PRIMARY KEY,
  legal_name TEXT NOT NULL DEFAULT 'BestBeautys',
  brand_name TEXT NOT NULL DEFAULT 'ISHVARI',
  gstin TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'Telangana',
  pincode TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO business_settings (id,legal_name,brand_name,state) VALUES (1,'BestBeautys','ISHVARI','Telangana');
