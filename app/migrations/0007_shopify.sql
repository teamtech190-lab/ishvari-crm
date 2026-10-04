-- External IDs are scoped to this installation's shop. Existing CRM data is preserved.
ALTER TABLE products ADD COLUMN shopify_variant_id TEXT;
ALTER TABLE products ADD COLUMN shopify_product_id TEXT;
CREATE UNIQUE INDEX products_shopify_variant ON products(shopify_variant_id);
ALTER TABLE orders ADD COLUMN shopify_order_id TEXT;
ALTER TABLE orders ADD COLUMN shopify_updated_at TEXT;
ALTER TABLE orders ADD COLUMN shopify_shipping_eligible INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX orders_shopify_id ON orders(shopify_order_id);
CREATE TABLE shopify_state (
 id INTEGER PRIMARY KEY CHECK(id=1), domain TEXT, enabled INTEGER NOT NULL DEFAULT 0,
 product_cursor TEXT, order_cursor TEXT, phase TEXT NOT NULL DEFAULT 'products',
 last_success TEXT, last_error TEXT, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shopify_state(id) VALUES(1);
CREATE TABLE shopify_events (
 id TEXT PRIMARY KEY, topic TEXT NOT NULL, resource_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT
);
CREATE INDEX shopify_events_pending ON shopify_events(processed_at,received_at);
