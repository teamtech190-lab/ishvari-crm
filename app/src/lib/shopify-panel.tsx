import { useEffect, useState } from "react";
export function ShopifyPanel({ onSaved }: { onSaved: () => Promise<void> }) {
  const [state, setState] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function api(action: string) {
    const r = await fetch("/api/shopify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Shopify request failed");
    return data;
  }
  async function refresh() {
    setState(await api("status"));
  }
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);
  async function run(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await api(action);
      setMessage(
        action === "check"
          ? `Connected to ${r.name}`
          : action === "enable"
            ? "Automatic sync enabled. Import continues every 5 minutes."
            : action === "push_inventory"
              ? `Reconciled ${r.updated || 0} managed products to Shopify inventory.`
              : r.busy
              ? "A sync is already running."
              : `Synced ${r.processed || 0} records. More records are imported on the next run.`,
      );
      await refresh();
      await onSaved();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content">
      <div className="panel">
        <div className="section-kicker">SHOPIFY CONNECTION</div>
        <h2>Orders & products</h2>
        <p>
          Import Shopify orders and product variants into your CRM. Manage Shopify products in
          Shopify; changes arrive here automatically after sync is enabled.
        </p>
        <p>
          <b>{state?.enabled ? "Sync enabled" : "Sync not enabled"}</b> ·{" "}
          {state?.domain || "Store not verified yet"}
        </p>
        <p>
          Last successful sync: {state?.last_success || "Not yet"} · Pending events:{" "}
          {state?.pending ?? 0}
        </p>
        {state?.last_error && <p className="error">{state.last_error}</p>}
        <div className="top-actions">
          <button className="ghost" disabled={busy} onClick={() => run("check")}>
            Test connection
          </button>
          <button className="primary" disabled={busy} onClick={() => run("enable")}>
            {busy ? "Working…" : state?.enabled ? "Verify sync setup" : "Enable sync"}
          </button>
          <button className="ghost" disabled={busy || !state?.enabled} onClick={() => run("sync")}>
            Sync now
          </button>
          <button
            className="ghost"
            disabled={busy || !state?.enabled}
            onClick={() => run("push_inventory")}
          >
            Reconcile inventory
          </button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => refresh().catch((e) => setMessage(e.message))}
          >
            Check status
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        <p className="settings-help">
          Initial import runs in small batches. Orders available through the app (normally the last
          60 days) are imported. Shopify totals and discounts are preserved. Existing CRM products
          stay separate; imported product GST defaults to 18% when taxable and needs review before
          using it for manual orders. Shipping updates made in CRM are not yet sent back to Shopify.
        </p>
      </div>
    </section>
  );
}
