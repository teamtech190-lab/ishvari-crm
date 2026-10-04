import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  syncOrder,
  syncProduct,
  receiveWebhook,
  verifyWebhook,
  paise,
  shopDomain,
  runShopifySync,
} from "../src/lib/shopify-sync.ts";
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).sort())
    sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  const db: any = {
    prepare(sql: string) {
      return {
        values: [] as any[],
        bind(...args: any[]) {
          this.values = args;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...this.values) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...this.values) };
        },
        async run() {
          return { meta: sqlite.prepare(sql).run(...this.values) };
        },
      };
    },
    async batch(statements: any[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}
const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "INR" } });
const order = () => ({
  id: "gid://shopify/Order/101",
  name: "#1001",
  createdAt: "2026-10-04T10:00:00Z",
  updatedAt: "2026-10-04T10:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  taxesIncluded: true,
  paymentGatewayNames: ["Cashfree"],
  shippingAddress: {
    name: "Test Buyer",
    phone: "9999999999",
    address1: "Test address",
    city: "Hyderabad",
    province: "Telangana",
    zip: "500001",
  },
  totalPriceSet: bag("699.00"),
  totalTaxSet: bag("106.63"),
  totalShippingPriceSet: bag("0.00"),
  lineItems: {
    nodes: [
      {
        id: "gid://shopify/LineItem/1",
        name: "Oil",
        quantity: 1,
        originalTotalSet: bag("799.00"),
        discountAllocations: [{ allocatedAmountSet: bag("100.00") }],
        taxLines: [{ priceSet: bag("106.63") }],
        variant: null,
      },
    ],
    pageInfo: { hasNextPage: false },
  },
});
const product = () => ({
  id: "gid://shopify/Product/1",
  title: "Oil",
  status: "ACTIVE",
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Default Title",
        sku: "TEST",
        price: "699.00",
        inventoryQuantity: 3,
        taxable: true,
      },
    ],
    pageInfo: { hasNextPage: false },
  },
});
function environment(db: any) {
  return {
    DB: db,
    SHOPIFY_SHOP_DOMAIN: "test.myshopify.com",
    SHOPIFY_CLIENT_ID: crypto.randomUUID(),
    SHOPIFY_CLIENT_SECRET: "test-secret",
  };
}
function mockApi(t: any, get: (query: string) => any) {
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (String(_url).includes("/oauth/"))
      return Response.json({ access_token: "test-only", expires_in: 86400 });
    return Response.json({ data: get(JSON.parse(init.body).query) });
  });
}
test("INR parsing is exact and domains cannot inject a destination", () => {
  assert.equal(paise("699"), 69900);
  assert.equal(paise("106.63"), 10663);
  assert.throws(() => paise("NaN"));
  assert.throws(() => paise("0.001"));
  assert.throws(() => shopDomain({ SHOPIFY_SHOP_DOMAIN: "test.myshopify.com/evil" }));
});
test("import is idempotent, preserves total and local shipping progress, and applies cancellation", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  let o: any = order();
  mockApi(t, () => ({ order: o }));
  await syncOrder(env, o.id);
  await syncOrder(env, o.id);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM orders").get()!.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM shipments").get()!.n, 1);
  const r: any = sqlite.prepare("SELECT * FROM orders").get();
  assert.equal(r.total_paise, 69900);
  assert.equal(r.gst_paise, 10663);
  assert.equal(r.subtotal_paise, 59237);
  assert.equal(
    sqlite.prepare("SELECT unit_price_paise FROM order_items").get()!.unit_price_paise,
    69900,
  );
  sqlite.exec("UPDATE orders SET status='PACKED'");
  o.updatedAt = "2026-10-04T11:00:00Z";
  await syncOrder(env, o.id);
  assert.equal(sqlite.prepare("SELECT status FROM orders").get()!.status, "PACKED");
  o.updatedAt = "2026-10-04T12:00:00Z";
  o.cancelledAt = o.updatedAt;
  o.displayFinancialStatus = "REFUNDED";
  await syncOrder(env, o.id);
  assert.equal(sqlite.prepare("SELECT status FROM orders").get()!.status, "CANCELLED");
  assert.equal(
    sqlite.prepare("SELECT payment_status FROM orders").get()!.payment_status,
    "REFUNDED",
  );
  assert.equal(sqlite.prepare("SELECT count(*) n FROM customers").get()!.n, 1);
});
test("variants update without duplicates; deleted products are inactive, not erased", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  let p: any = product();
  mockApi(t, () => ({ product: p }));
  await syncProduct(env, p.id);
  p.variants.nodes[0].price = "749.00";
  await syncProduct(env, p.id);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM products WHERE shopify_variant_id IS NOT NULL").get()!.n,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT price_paise FROM products WHERE shopify_variant_id IS NOT NULL").get()!
      .price_paise,
    74900,
  );
  p = null;
  await syncProduct(env, "gid://shopify/Product/1");
  assert.equal(
    sqlite.prepare("SELECT active FROM products WHERE shopify_variant_id IS NOT NULL").get()!
      .active,
    0,
  );
});
test("webhook signature validates raw bytes, rejects tampering, persists once and rejects another shop", async () => {
  const { db, sqlite } = database();
  const env = environment(db);
  sqlite.exec("UPDATE shopify_state SET enabled=1,domain='test.myshopify.com'");
  const raw = JSON.stringify({ id: 101 });
  const signature = createHmac("sha256", "test-secret").update(raw).digest("base64");
  const headers = {
    "X-Shopify-Hmac-Sha256": signature,
    "X-Shopify-Shop-Domain": "test.myshopify.com",
    "X-Shopify-Topic": "orders/create",
    "X-Shopify-Webhook-Id": "event-1",
  };
  const req = (h = headers, body = raw) =>
    new Request("https://crm.ishvari.in/api/shopify/webhook", { method: "POST", headers: h, body });
  assert.equal((await receiveWebhook(req(), env)).status, 200);
  assert.equal((await receiveWebhook(req(), env)).status, 200);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM shopify_events").get()!.n, 1);
  assert.equal((await receiveWebhook(req(headers, raw + " "), env)).status, 401);
  assert.equal(
    (await receiveWebhook(req({ ...headers, "X-Shopify-Shop-Domain": "other.myshopify.com" }), env))
      .status,
    403,
  );
  assert.equal(
    await verifyWebhook(new TextEncoder().encode(raw).buffer, "bad", "test-secret"),
    false,
  );
});
test("failed import rolls back customer/order/items as one transaction", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  const o = order();
  mockApi(t, () => ({ order: o }));
  sqlite.exec(
    "CREATE TRIGGER reject_item BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  await assert.rejects(syncOrder(env, o.id));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM orders").get()!.n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM customers").get()!.n, 0);
});
test("lease blocks concurrent sync and failed API run retains event for retry", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  sqlite.prepare("UPDATE shopify_state SET enabled=1,lease_until=?").run(Date.now() + 60000);
  assert.deepEqual(await runShopifySync(env), { busy: true });
  sqlite.exec(
    "UPDATE shopify_state SET lease_until=0; INSERT INTO shopify_events(id,topic,resource_id) VALUES('retry','orders/create','gid://shopify/Order/101')",
  );
  mockApi(t, () => {
    throw new Error("Test API outage");
  });
  await assert.rejects(runShopifySync(env));
  assert.equal(sqlite.prepare("SELECT processed_at FROM shopify_events").get()!.processed_at, null);
  assert.equal(sqlite.prepare("SELECT lease_until FROM shopify_state").get()!.lease_until, 0);
  assert.equal(sqlite.prepare("SELECT attempts FROM shopify_events").get()!.attempts, 1);
});

test("successful worker run drains a queued order and advances import cursor", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  sqlite.exec(
    "UPDATE shopify_state SET enabled=1; INSERT INTO shopify_events(id,topic,resource_id) VALUES('ok','orders/create','gid://shopify/Order/101')",
  );
  mockApi(t, (q) =>
    q.includes("CrmOrder(")
      ? { order: order() }
      : { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
  );
  const result = await runShopifySync(env);
  assert.equal(result.processed, 1);
  assert.equal(result.phase, "orders");
  assert.ok(sqlite.prepare("SELECT processed_at FROM shopify_events").get()!.processed_at);
  assert.equal(sqlite.prepare("SELECT lease_until FROM shopify_state").get()!.lease_until, 0);
});
test("all product variant pages are imported before deactivating removed variants", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  let calls = 0;
  mockApi(t, () => {
    const p = product();
    calls++;
    p.variants.nodes[0].id = "gid://shopify/ProductVariant/" + calls;
    (p.variants.pageInfo as any) = { hasNextPage: calls === 1, endCursor: "next" };
    return { product: p };
  });
  await syncProduct(env, "gid://shopify/Product/1");
  assert.equal(calls, 2);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM products WHERE shopify_product_id IS NOT NULL AND active=1")
      .get()!.n,
    2,
  );
});

test("only unfulfilled paid or COD domestic orders are eligible for shipping", async (t) => {
  const { db, sqlite } = database();
  const env = environment(db);
  const o: any = order();
  o.shippingAddress.countryCodeV2 = "IN";
  mockApi(t, () => ({ order: o }));
  await syncOrder(env, o.id);
  assert.equal(
    sqlite.prepare("SELECT shopify_shipping_eligible FROM orders").get()!.shopify_shipping_eligible,
    1,
  );
  o.updatedAt = "2026-10-04T11:00:00Z";
  o.displayFulfillmentStatus = "PARTIALLY_FULFILLED";
  await syncOrder(env, o.id);
  assert.equal(
    sqlite.prepare("SELECT shopify_shipping_eligible FROM orders").get()!.shopify_shipping_eligible,
    0,
  );
  o.updatedAt = "2026-10-04T12:00:00Z";
  o.displayFulfillmentStatus = "UNFULFILLED";
  o.shippingAddress.countryCodeV2 = "US";
  await syncOrder(env, o.id);
  assert.equal(
    sqlite.prepare("SELECT shopify_shipping_eligible FROM orders").get()!.shopify_shipping_eligible,
    0,
  );
});
