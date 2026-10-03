-- Correct only the original anti-dandruff catalog seed. Do not rewrite invoices.
UPDATE products SET name='Ishvari Anti Dandruff Ritual Oil', price_paise=69900
WHERE id='prod-ishvari-scalp-balance' AND price_paise IN (39900,59900,69900);

-- Legacy invoices used exclusive rates. Preserve that distinction.
ALTER TABLE orders ADD COLUMN price_includes_tax INTEGER NOT NULL DEFAULT 0;
