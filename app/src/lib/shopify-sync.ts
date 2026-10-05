import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import * as Q from "./shopify-queries.ts";
export type ShopifyEnv = {
  DB?: D1Database;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
};
const VERSION = "2026-10";
const CALLBACK = "https://crm.ishvari.in/api/shopify/webhook";
const TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "APP_UNINSTALLED",
];
let tokenCache: { key: string; token: string; expires: number } | undefined;
export function shopDomain(env: ShopifyEnv) {
  const domain = env.SHOPIFY_SHOP_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new Error("Set SHOPIFY_SHOP_DOMAIN to your myshopify.com domain.");
  return domain;
}
export async function graphql(
  env: ShopifyEnv,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const domain = shopDomain(env);
  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET)
    throw new Error("Shopify client credentials are missing.");
  const key = `${domain}:${env.SHOPIFY_CLIENT_ID}:${env.SHOPIFY_CLIENT_SECRET}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!tokenCache || tokenCache.key !== key || tokenCache.expires < Date.now() + 60000) {
      const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.SHOPIFY_CLIENT_ID,
          client_secret: env.SHOPIFY_CLIENT_SECRET,
        }),
      });
      if (!r.ok)
        throw new Error(
          `Shopify authentication failed (${r.status}). Check app installation, organization and client credentials.`,
        );
      const a = (await r.json()) as any;
      if (!a.access_token || !Number.isFinite(a.expires_in))
        throw new Error("Shopify token response was incomplete.");
      tokenCache = { key, token: a.access_token, expires: Date.now() + a.expires_in * 1000 };
    }
    const r = await fetch(`https://${domain}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": tokenCache.token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401 && attempt === 0) {
      tokenCache = undefined;
      continue;
    }
    if (!r.ok) throw new Error(`Shopify API failed (${r.status}). Retry sync.`);
    const body = (await r.json()) as any;
    if (body.errors?.length) {
      if (body.errors.some((e: any) => e.extensions?.code === "ACCESS_DENIED"))
        throw new Error(
          "Shopify denied access. Check read_orders, read_products and protected customer data access.",
        );
      throw new Error(
        "Shopify could not complete the query. Check app access or retry after API throttling.",
      );
    }
    return body.data;
  }
  throw new Error("Shopify authentication failed.");
}
export function paise(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Invalid Shopify money amount.");
  const [a, b = ""] = value.split(".");
  const amount = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Shopify amount is too large.");
  return amount;
}
function money(bag: any) {
  if (bag?.shopMoney?.currencyCode !== "INR")
    throw new Error("Only INR Shopify orders are supported.");
  return paise(bag.shopMoney.amount);
}
export function orderAmounts(o: any) {
  const total = money(o.totalPriceSet),
    tax = money(o.totalTaxSet),
    shipping = money(o.totalShippingPriceSet);
  return { total, tax, shipping, subtotal: total - tax - shipping };
}
export function paymentStatus(status: string) {
  return (
    (
      {
        PAID: "PAID",
        REFUNDED: "REFUNDED",
        PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
        PARTIALLY_PAID: "PARTIALLY_PAID",
        VOIDED: "VOIDED",
        AUTHORIZED: "AUTHORIZED",
      } as Record<string, string>
    )[status] || "PENDING"
  );
}
const dbOf = (env: ShopifyEnv) => {
  if (!env.DB) throw new Error("CRM database is missing.");
  return env.DB;
};
export async function syncProduct(
  env: ShopifyEnv,
  id: string,
  guard: () => Promise<void> = async () => {},
) {
  const db = dbOf(env);
  let after: string | null = null;
  let product: any;
  const variants: any[] = [];
  let pages = 0;
  do {
    if (++pages > 5) throw new Error("Shopify product exceeds the supported 500 variants.");
    const data = await graphql(env, Q.PRODUCT_QUERY, { id, after });
    product = data.product;
    if (!product) break;
    variants.push(...product.variants.nodes);
    after = product.variants.pageInfo.hasNextPage ? product.variants.pageInfo.endCursor : null;
  } while (after);
  await guard();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE products SET active=0 WHERE shopify_product_id=?").bind(id),
  ];
  if (product)
    for (const v of variants) {
      const existing = await db
        .prepare("SELECT id,gst_percent,inventory_managed_by_crm FROM products WHERE shopify_variant_id=?")
        .bind(v.id)
        .first<any>();
      // Deliberately do not guess a match by product name or overwrite manual CRM records.
      const pid = existing?.id || crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO products(id,name,sku,price_paise,gst_percent,stock,active,shopify_variant_id,shopify_product_id,image_url,total_stock,shopify_allocation,inventory_managed_by_crm) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shopify_variant_id) DO UPDATE SET name=CASE WHEN products.inventory_managed_by_crm=1 THEN products.name ELSE excluded.name END,sku=CASE WHEN products.inventory_managed_by_crm=1 THEN products.sku ELSE excluded.sku END,price_paise=CASE WHEN products.inventory_managed_by_crm=1 THEN products.price_paise ELSE excluded.price_paise END,stock=CASE WHEN products.inventory_managed_by_crm=1 THEN products.stock ELSE excluded.stock END,active=excluded.active,image_url=excluded.image_url,total_stock=COALESCE(products.total_stock,excluded.total_stock),shopify_allocation=COALESCE(products.shopify_allocation,excluded.shopify_allocation)`,
          )
          .bind(
            pid,
            product.title + (v.title === "Default Title" ? "" : ` — ${v.title}`),
            v.sku || null,
            paise(v.price),
            v.taxable ? (existing?.gst_percent ?? 18) : 0,
            v.inventoryQuantity ?? 0,
            product.status === "ACTIVE" ? 1 : 0,
            v.id,
            id,
            product.featuredImage?.url || null,
            v.inventoryQuantity ?? 0,
            v.inventoryQuantity ?? 0,
            0,
          ),
      );
    }
  // D1 batch is atomic; a partial catalog cannot replace the previous product.
  await db.batch(statements);
}
export async function syncOrder(
  env: ShopifyEnv,
  id: string,
  guard: () => Promise<void> = async () => {},
) {
  const db = dbOf(env);
  let after: string | null = null;
  let order: any;
  const items: any[] = [];
  let pages = 0;
  do {
    if (++pages > 5) throw new Error("Shopify order exceeds the supported 500 line items.");
    const data = await graphql(env, Q.ORDER_QUERY, { id, after });
    order = data.order;
    if (!order) return;
    items.push(...order.lineItems.nodes);
    after = order.lineItems.pageInfo.hasNextPage ? order.lineItems.pageInfo.endCursor : null;
  } while (after);
  const a = order.shippingAddress || order.billingAddress || {};
  await guard();
  const existing = await db
    .prepare("SELECT id,customer_id,status,shopify_updated_at FROM orders WHERE shopify_order_id=?")
    .bind(id)
    .first<any>();
  const previousItems = existing
    ? await db.prepare("SELECT id,product_id,quantity FROM order_items WHERE order_id=?").bind(existing.id).all<any>()
    : { results: [] as any[] };
  if (existing?.shopify_updated_at && existing.shopify_updated_at >= order.updatedAt) return;
  const oid = existing?.id || crypto.randomUUID(),
    cid = existing?.customer_id || crypto.randomUUID();
  const amounts = orderAmounts(order);
  // Shopify cancellation wins; other CRM shipping progress is retained.
  const status = order.cancelledAt
    ? "CANCELLED"
    : existing?.status || (order.displayFulfillmentStatus === "FULFILLED" ? "SHIPPED" : "NEW");
  const cod = order.paymentGatewayNames.some((x: string) => /cash on delivery|\bcod\b/i.test(x));
  const created = new Date(order.createdAt).toISOString().slice(0, 19).replace("T", " ");
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO customers(id,name,phone,email,address,city,state,pincode) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,email=excluded.email,address=excluded.address,city=excluded.city,state=excluded.state,pincode=excluded.pincode,updated_at=datetime('now')`,
      )
      .bind(
        cid,
        a.name || "Shopify customer",
        a.phone || order.phone || "",
        order.email || null,
        [a.address1, a.address2].filter(Boolean).join(", "),
        a.city || null,
        a.province || null,
        a.zip || null,
      ),
    db
      .prepare(
        `INSERT INTO orders(id,order_no,source,customer_id,status,payment_status,payment_mode,subtotal_paise,shipping_paise,gst_paise,total_paise,price_includes_tax,created_at,shopify_order_id,shopify_updated_at,notes,shopify_shipping_eligible) VALUES(?,?,'SHOPIFY',?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shopify_order_id) DO UPDATE SET status=excluded.status,payment_status=excluded.payment_status,payment_mode=excluded.payment_mode,subtotal_paise=excluded.subtotal_paise,shipping_paise=excluded.shipping_paise,gst_paise=excluded.gst_paise,total_paise=excluded.total_paise,price_includes_tax=excluded.price_includes_tax,shopify_updated_at=excluded.shopify_updated_at,notes=excluded.notes,shopify_shipping_eligible=excluded.shopify_shipping_eligible,updated_at=datetime('now')`,
      )
      .bind(
        oid,
        `SHOPIFY-${order.name}`,
        cid,
        status,
        paymentStatus(order.displayFinancialStatus),
        cod ? "COD" : "PREPAID",
        amounts.subtotal,
        amounts.shipping,
        amounts.tax,
        amounts.total,
        order.taxesIncluded ? 1 : 0,
        created,
        id,
        order.updatedAt,
        "Imported from Shopify. Amounts include Shopify discounts. Use the original Shopify invoice for tax details.",
        a.countryCodeV2 === "IN" &&
          a.address1 &&
          a.zip &&
          (a.phone || order.phone) &&
          order.displayFulfillmentStatus === "UNFULFILLED" &&
          (order.displayFinancialStatus === "PAID" ||
            (cod && order.displayFinancialStatus === "PENDING"))
          ? 1
          : 0,
      ),
    db.prepare("DELETE FROM order_items WHERE order_id=?").bind(oid),
  ];
  for (const item of items) {
    const product = item.variant
      ? await db
          .prepare("SELECT id FROM products WHERE shopify_variant_id=?")
          .bind(item.variant.id)
          .first<any>()
      : null;
    const gross =
      money(item.originalTotalSet) -
      item.discountAllocations.reduce((n: number, d: any) => n + money(d.allocatedAmountSet), 0);
    const tax = item.taxLines.reduce((n: number, t: any) => n + money(t.priceSet), 0);
    statements.push(
      db
        .prepare(
          "INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price_paise,total_paise) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          oid,
          product?.id || null,
          item.name,
          item.quantity,
          item.quantity ? Math.round(gross / item.quantity) : 0,
          order.taxesIncluded ? gross - tax : gross,
        ),
    );
  }
  if (!existing)
    statements.push(
      db
        .prepare("INSERT INTO shipments(id,order_id,status) VALUES(?,?,?)")
        .bind(crypto.randomUUID(), oid, status === "SHIPPED" ? "SHIPPED" : "NOT_CREATED"),
    );

  // Reconcile Shopify inventory to the latest order quantities. The ledger keys make
  // repeated webhooks/syncs safe and quantity edits apply only their net difference.
  const previousByProduct = new Map<string, number>();
  for (const it of previousItems.results || [])
    if (it.product_id) previousByProduct.set(it.product_id, (previousByProduct.get(it.product_id) || 0) + Number(it.quantity || 0));
  const currentByProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.variant) continue;
    const product = await db.prepare("SELECT id,inventory_managed_by_crm FROM products WHERE shopify_variant_id=?").bind(item.variant.id).first<any>();
    if (product?.id && product.inventory_managed_by_crm)
      currentByProduct.set(product.id, (currentByProduct.get(product.id) || 0) + Number(item.quantity || 0));
  }
  const inventoryProducts = new Set([...previousByProduct.keys(), ...currentByProduct.keys()]);
  for (const productId of inventoryProducts) {
    const previousQty = previousByProduct.get(productId) || 0;
    const currentQty = currentByProduct.get(productId) || 0;
    // A cancelled Shopify order no longer reserves physical or online stock.
    // On the first cancellation sync this restores the quantity previously applied.
    const effectiveCurrentQty = order.cancelledAt ? 0 : currentQty;
    const delta = previousQty - effectiveCurrentQty;
    if (!delta) continue;
    const key = `shopify:${id}:inventory:${order.updatedAt}:${productId}`;
    statements.push(
      db.prepare("UPDATE products SET total_stock=MAX(0,total_stock+?),stock=MAX(0,total_stock+?),shopify_allocation=MAX(0,MIN(total_stock+?,shopify_allocation+?)) WHERE id=? AND inventory_managed_by_crm=1")
        .bind(delta,delta,delta,delta,productId),
      db.prepare("INSERT OR IGNORE INTO inventory_movements(id,product_id,order_id,reference_key,source,kind,quantity_delta,allocation_delta) VALUES(?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),productId,oid,key,"SHOPIFY",delta<0?"SALE":"ADJUSTMENT",delta,delta),
    );
  }
  await db.batch(statements);
}
export async function checkShopify(env: ShopifyEnv) {
  const data = await graphql(env, Q.SHOP_QUERY);
  if (data.shop.currencyCode !== "INR") throw new Error("This CRM supports INR only.");
  if (!data.shop.taxesIncluded)
    throw new Error(
      "Shopify catalog prices must include tax before enabling this CRM integration.",
    );
  const scopes = data.currentAppInstallation.accessScopes.map((s: any) => s.handle);
  if (!["read_products", "read_orders"].every((s) => scopes.includes(s)))
    throw new Error(
      "Enable read_products and read_orders, then approve the updated app permissions.",
    );
  return data.shop;
}
export async function enableShopify(env: ShopifyEnv) {
  const db = dbOf(env),
    shop = await checkShopify(env);
  const state = await db.prepare("SELECT domain FROM shopify_state WHERE id=1").first<any>();
  if (state?.domain && state.domain !== shop.myshopifyDomain)
    throw new Error("A different Shopify store is already linked to this CRM.");
  const found: any[] = [];
  let after: string | null = null;
  do {
    const data = await graphql(env, Q.WEBHOOK_LIST, { after });
    found.push(...data.webhookSubscriptions.nodes);
    after = data.webhookSubscriptions.pageInfo.hasNextPage
      ? data.webhookSubscriptions.pageInfo.endCursor
      : null;
  } while (after);
  for (const topic of TOPICS)
    if (!found.some((x) => x.topic === topic && x.uri === CALLBACK)) {
      const data = await graphql(env, Q.WEBHOOK_CREATE, {
        topic,
        input: { uri: CALLBACK, format: "JSON" },
      });
      if (data.webhookSubscriptionCreate.userErrors.length)
        throw new Error(`Could not register Shopify webhook ${topic}. Check app permissions.`);
    }
  await db
    .prepare("UPDATE shopify_state SET domain=?,enabled=1,last_error=NULL WHERE id=1")
    .bind(shop.myshopifyDomain)
    .run();
  return { name: shop.name, domain: shop.myshopifyDomain };
}
export async function verifyWebhook(raw: ArrayBuffer, signature: string | null, secret: string) {
  if (!signature) return false;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (bytes.length !== 32) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, bytes, raw);
}
export async function receiveWebhook(request: Request, env: ShopifyEnv) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.SHOPIFY_CLIENT_SECRET) return new Response("Not configured", { status: 503 });
  // Reject oversized bodies while streaming; do not buffer an unbounded request.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2_000_000) {
      await reader.cancel();
      return new Response("Too large", { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  if (
    !(await verifyWebhook(
      bytes.buffer,
      request.headers.get("X-Shopify-Hmac-Sha256"),
      env.SHOPIFY_CLIENT_SECRET,
    ))
  )
    return new Response("Invalid signature", { status: 401 });
  const db = dbOf(env),
    state = await db.prepare("SELECT domain,enabled FROM shopify_state WHERE id=1").first<any>();
  const domain = request.headers.get("X-Shopify-Shop-Domain");
  if (!state?.domain || domain !== state.domain)
    return new Response("Unknown shop", { status: 403 });
  const topic = request.headers.get("X-Shopify-Topic") || "";
  if (
    ![
      "orders/create",
      "orders/updated",
      "orders/cancelled",
      "products/create",
      "products/update",
      "products/delete",
      "app/uninstalled",
    ].includes(topic)
  )
    return new Response("Ignored");
  if (topic === "app/uninstalled") {
    await db
      .prepare("UPDATE shopify_state SET enabled=0,last_error=? WHERE id=1")
      .bind("Shopify app was uninstalled. Reinstall and enable sync.")
      .run();
    tokenCache = undefined;
    return new Response("OK");
  }
  if (!state.enabled) return new Response("Sync disabled", { status: 503 });
  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const kind = topic.startsWith("products/") ? "Product" : "Order";
  const resource =
    body.admin_graphql_api_id ||
    (Number.isSafeInteger(body.id) ? `gid://shopify/${kind}/${body.id}` : "");
  if (!new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(resource))
    return new Response("Invalid ID", { status: 400 });
  const event = request.headers.get("X-Shopify-Webhook-Id");
  if (!event || event.length > 200) return new Response("Missing event ID", { status: 400 });
  // Persist before returning 200; the scheduled worker retries failed API/import work.
  await db
    .prepare("INSERT OR IGNORE INTO shopify_events(id,topic,resource_id) VALUES(?,?,?)")
    .bind(event, topic, resource)
    .run();
  return new Response("OK");
}
export async function runShopifySync(env: ShopifyEnv) {
  const db = dbOf(env),
    lease = crypto.randomUUID(),
    now = Date.now();
  const state = await db.prepare("SELECT * FROM shopify_state WHERE id=1").first<any>();
  if (!state?.enabled) return { enabled: false };
  const lock = await db
    .prepare("UPDATE shopify_state SET lease=?,lease_until=? WHERE id=1 AND lease_until<?")
    .bind(lease, now + 300000, now)
    .run();
  if (!lock.meta.changes) return { busy: true };
  try {
    const guard = async () => {
      const r = await db
        .prepare("UPDATE shopify_state SET lease_until=? WHERE id=1 AND lease=?")
        .bind(Date.now() + 300000, lease)
        .run();
      if (!r.meta.changes) throw new Error("Shopify sync lease expired. Retry sync.");
    };
    const events = await db
      .prepare(
        "SELECT id,topic,resource_id FROM shopify_events WHERE processed_at IS NULL ORDER BY attempts,received_at LIMIT 5",
      )
      .all<any>();
    let firstError: unknown;
    let processed = 0;
    for (const e of events.results) {
      try {
        await guard();
        await (e.topic.startsWith("products/") ? syncProduct : syncOrder)(
          env,
          e.resource_id,
          guard,
        );
        await db
          .prepare("UPDATE shopify_events SET processed_at=datetime('now') WHERE id=?")
          .bind(e.id)
          .run();
        processed++;
      } catch (error) {
        firstError ??= error;
        await db
          .prepare("UPDATE shopify_events SET attempts=attempts+1 WHERE id=?")
          .bind(e.id)
          .run();
      }
    }
    // Each invocation imports a bounded page. Repeated scans reconcile missed updates for resources still present in Shopify.
    const products = state.phase === "products";
    const data = await graphql(env, products ? Q.PRODUCT_IDS : Q.ORDER_IDS, {
      after: products ? state.product_cursor : state.order_cursor,
    });
    const connection = products ? data.products : data.orders;
    for (const node of connection.nodes) {
      await guard();
      await (products ? syncProduct : syncOrder)(env, node.id, guard);
    }
    const next = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    await db
      .prepare(
        `UPDATE shopify_state SET ${products ? "product_cursor" : "order_cursor"}=?,phase=?,last_success=datetime('now'),last_error=NULL WHERE id=1 AND lease=?`,
      )
      .bind(next, next ? state.phase : products ? "orders" : "products", lease)
      .run();
    await db
      .prepare("DELETE FROM shopify_events WHERE processed_at < datetime('now','-7 days')")
      .run();
    if (firstError) throw firstError;
    return {
      processed: processed + connection.nodes.length,
      phase: next ? state.phase : products ? "orders" : "products",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify sync failed";
    await db
      .prepare("UPDATE shopify_state SET last_error=? WHERE id=1 AND lease=?")
      .bind(message, lease)
      .run();
    throw error;
  } finally {
    await db
      .prepare("UPDATE shopify_state SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?")
      .bind(lease)
      .run();
  }
}
export async function shopifyStatus(env: ShopifyEnv) {
  const db = dbOf(env),
    state = await db
      .prepare("SELECT domain,enabled,phase,last_success,last_error FROM shopify_state WHERE id=1")
      .first();
  const pending = await db
    .prepare("SELECT COUNT(*) n FROM shopify_events WHERE processed_at IS NULL")
    .first<any>();
  return {
    ...state,
    configured: !!(env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET),
    pending: pending?.n || 0,
  };
}
