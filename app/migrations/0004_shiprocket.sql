ALTER TABLE shipments ADD COLUMN shiprocket_order_id TEXT;
ALTER TABLE shipments ADD COLUMN shiprocket_shipment_id TEXT;
ALTER TABLE shipments ADD COLUMN courier_id INTEGER;
ALTER TABLE shipments ADD COLUMN weight_kg REAL NOT NULL DEFAULT 0.5;
ALTER TABLE shipments ADD COLUMN length_cm REAL NOT NULL DEFAULT 15;
ALTER TABLE shipments ADD COLUMN breadth_cm REAL NOT NULL DEFAULT 10;
ALTER TABLE shipments ADD COLUMN height_cm REAL NOT NULL DEFAULT 5;
ALTER TABLE shipments ADD COLUMN shiprocket_status TEXT;
CREATE INDEX IF NOT EXISTS idx_shipments_sr_order ON shipments(shiprocket_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_sr_shipment ON shipments(shiprocket_shipment_id);

ALTER TABLE business_settings ADD COLUMN shiprocket_pickup_location TEXT DEFAULT 'Primary';
ALTER TABLE business_settings ADD COLUMN shiprocket_pickup_pincode TEXT;
