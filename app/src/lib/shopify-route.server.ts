import { isAuthenticated } from "./crm-auth.server";
import { bindings } from "./bindings.server";
import {
  checkShopify,
  enableShopify,
  runShopifySync,
  shopifyStatus,
  receiveWebhook,
} from "./shopify-sync";
export async function shopifyRoute(request: Request, ctx?: ExecutionContext): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/shopify" && path !== "/api/shopify/webhook") return null;
  const env = bindings();
  try {
    if (path === "/api/shopify/webhook") {
      const response = await receiveWebhook(request, env);
      // The webhook is persisted before Shopify receives 200. Process it immediately
      // in the background; the 5-minute cron remains a durable retry fallback.
      if (response.ok && ctx) ctx.waitUntil(runShopifySync(env).catch((error) => console.error("Shopify background sync failed:", error instanceof Error ? error.message : "unknown error")));
      return response;
    }
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      return Response.json({ error: "Invalid origin" }, { status: 403 });
    if (!(await isAuthenticated(request)))
      return Response.json({ error: "Please sign in to CRM." }, { status: 401 });
    const body = (await request.json()) as any;
    const result =
      body.action === "status"
        ? await shopifyStatus(env)
        : body.action === "check"
          ? await checkShopify(env)
          : body.action === "enable"
            ? await enableShopify(env)
            : body.action === "sync"
              ? await runShopifySync(env)
              : null;
    if (!result) return Response.json({ error: "Unknown action" }, { status: 400 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify request failed";
    // No token, request body, address, or customer details are logged.
    console.error("Shopify operation failed:", message);
    const safe =
      /^(Shopify |Set SHOPIFY_|Enable read_|Only INR|This CRM|A different Shopify|Could not register)/.test(
        message,
      )
        ? message
        : message.includes("no such table")
          ? "Apply CRM database migrations before enabling Shopify sync."
          : "Shopify sync failed. Please retry and check the server logs.";
    return Response.json(
      { error: safe },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
