-- One legal invoice sequence shared by Shopify, WhatsApp and direct CRM orders.
ALTER TABLE orders ADD COLUMN invoice_no TEXT;
CREATE UNIQUE INDEX orders_invoice_no ON orders(invoice_no);
CREATE TABLE IF NOT EXISTS invoice_sequence (
  id INTEGER PRIMARY KEY CHECK(id=1),
  next_number INTEGER NOT NULL
);
INSERT OR IGNORE INTO invoice_sequence(id,next_number) VALUES(1,1);
