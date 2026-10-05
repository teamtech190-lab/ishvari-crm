-- CRM is the inventory master. Keep this migration additive because preview and production share D1.
ALTER TABLE products ADD COLUMN total_stock INTEGER;
ALTER TABLE products ADD COLUMN shopify_allocation INTEGER;
ALTER TABLE products ADD COLUMN inventory_managed_by_crm INTEGER NOT NULL DEFAULT 0;
UPDATE products SET total_stock=stock WHERE total_stock IS NULL;
UPDATE products SET shopify_allocation=CASE WHEN shopify_product_id IS NOT NULL THEN stock ELSE 0 END WHERE shopify_allocation IS NULL;
