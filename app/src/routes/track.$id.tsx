import { createFileRoute } from "@tanstack/react-router";
import { requireDb } from "../lib/crm-auth.server";

export const Route=createFileRoute("/track/$id")({
  loader: async ({params}) => {
    const db=requireDb();
    const row=await db.prepare("SELECT o.order_no,o.status,s.courier,s.awb FROM orders o LEFT JOIN shipments s ON s.order_id=o.id WHERE o.id=?").bind(params.id).first<{order_no:string,status:string,courier:string|null,awb:string|null}>();
    return row??null;
  },
  component:()=>{const row=Route.useLoaderData(); return <div className="min-h-dvh bg-[#f7f4ed] p-6 text-[#18382f]"><div className="mx-auto mt-16 max-w-lg rounded-3xl bg-white p-8 shadow-sm"><div className="text-xs font-semibold tracking-[0.25em] text-[#789080]">ISHVARI</div><h1 className="mt-4 text-3xl font-semibold">Shipment tracking</h1>{row?<div className="mt-8 space-y-4"><div><span className="text-sm text-slate-500">Order</span><div className="font-medium">{row.order_no}</div></div><div><span className="text-sm text-slate-500">Status</span><div className="font-medium">{row.status.replaceAll("_"," ")}</div></div>{row.courier&&<div><span className="text-sm text-slate-500">Courier</span><div className="font-medium">{row.courier}</div></div>}{row.awb&&<div><span className="text-sm text-slate-500">AWB</span><div className="font-medium">{row.awb}</div></div>}</div>:<p className="mt-6 text-slate-500">Tracking details are not available.</p>}</div></div>}
});
