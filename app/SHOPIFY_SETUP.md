# Shopify CRM sync

This integration reads Shopify orders and product variants into the CRM. It does not write product, order, fulfillment or inventory changes back to Shopify.

## Deploy

1. Keep these Worker secrets: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`.
2. `SHOPIFY_SHOP_DOMAIN` is configured in wrangler.jsonc as `ishvari-9710.myshopify.com`. No credentials belong in git.
3. From `app`, run `npm ci` and `npm run deploy`. The deploy script builds, applies D1 migrations (including 0007_shopify.sql), then deploys. For Cloudflare Git builds, use `npm run build` as the build command and `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` as the deploy command, with root directory `app`.
4. Sign in to CRM, open **Shopify**, click **Test connection**, then **Enable sync**. Enable verifies INR, tax-inclusive catalog settings and read_orders/read_products before registering webhook subscriptions.
5. Click **Sync now** to import the next small batch, or let the five-minute Cron Trigger finish the import. Check last successful sync, pending events and errors.

The endpoint is `https://crm.ishvari.in/api/shopify/webhook`. The app must be installed on a store in the same Shopify organization for client-credentials authentication. Token renewal occurs server-side. Protected customer data access may be required to read addresses and contact fields.

## Behavior and limitations

- Webhooks are HMAC-verified against the raw bytes and checked against the verified canonical store domain. A webhook is acknowledged only after its resource ID is durably queued in D1. No webhook payload or token is stored in that queue.
- A lease prevents concurrent sync runs; expired leases recover automatically. Failed events remain queued for retry. Duplicate event IDs and Shopify order/variant IDs cannot create duplicate imports.
- Product deletion or removal of a variant deactivates imported records, retaining historical order items. Repeated scans reconcile missed updates for resources that still exist. A deletion missed while subscriptions are absent requires a reconciliation pass or manual archival; it is not inferred from incomplete pages.
- Existing manually entered CRM orders/products are not matched by name or SKU. Imported products remain separate to avoid linking the wrong record. Their taxable GST defaults to 18% and should be reviewed for manual-order use. Shopify order tax totals come from Shopify, never that default.
- Initial order import covers the app's available order window (normally the last 60 days). Older orders require additional Shopify access. Resources over 500 variants or line items fail explicitly instead of silently truncating.
- Local shipping progress is preserved on order updates; Shopify cancellations take precedence. Refunded/cancelled orders cannot be sent to Shiprocket through the normal create action without review.
- Shopify tax/discount structures may have mixed rates. Imported orders link to their original Shopify order for invoices instead of using the CRM's single-rate manual invoice renderer.
- Shopify shipping status updates, two-way tracking, WhatsApp automation and historical customer deduplication are outside this change.

References: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant and https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
