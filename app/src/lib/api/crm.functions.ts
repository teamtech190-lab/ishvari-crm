import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isAuthenticated, requireDb } from "../crm-auth.server";

async function auth(request: Request) {
  if (!(await isAuthenticated(request))) throw new Error("Unauthorized");
  return requireDb();
}

export const getDashboard = createServerFn({method:"GET"}).handler(async ({request}) => {
  const db = await auth(request);
  const [orders, customers, shipped, delivered, pending] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM orders").first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM customers").first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('SHIPPED','OUT_FOR_DELIVERY')").first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='DELIVERED'").first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('NEW','PACKED')").first<{n:number}>(),
  ]);
  const recent = await db.prepare(`SELECT o.id,o.order_no,o.status,o.payment_status,o.total_paise,o.created_at,c.name,c.phone
    FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 8`).all();
  return {metrics:{orders:orders?.n??0,customers:customers?.n??0,shipped:shipped?.n??0,delivered:delivered?.n??0,pending:pending?.n??0},recent:recent.results??[]};
});

export const getCustomers = createServerFn({method:"GET"}).handler(async ({request}) => {
  const db = await auth(request);
  const r = await db.prepare("SELECT * FROM customers ORDER BY created_at DESC").all();
  return r.results ?? [];
});

export const createCustomer = createServerFn({method:"POST"})
.inputValidator(z.object({name:z.string().min(2),phone:z.string().min(8).max(20),email:z.string().email().optional().or(z.literal("")),address:z.string().optional(),city:z.string().optional(),state:z.string().optional(),pincode:z.string().optional()}))
.handler(async ({request,data}) => {
  const db=await auth(request); const id=crypto.randomUUID();
  await db.prepare("INSERT INTO customers (id,name,phone,email,address,city,state,pincode) VALUES (?,?,?,?,?,?,?,?)").bind(id,data.name,data.phone,data.email||null,data.address||null,data.city||null,data.state||null,data.pincode||null).run();
  return {id};
});

export const getOrders = createServerFn({method:"GET"}).handler(async ({request}) => {
  const db=await auth(request);
  const r=await db.prepare(`SELECT o.*,c.name customer_name,c.phone customer_phone,s.courier,s.awb,s.status shipment_status
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN shipments s ON s.order_id=o.id ORDER BY o.created_at DESC`).all();
  return r.results??[];
});

export const createOrder = createServerFn({method:"POST"})
.inputValidator(z.object({customerId:z.string().uuid(),productName:z.string().min(2),quantity:z.number().int().min(1).max(100),unitPricePaise:z.number().int().min(0),paymentMode:z.enum(["PREPAID","COD","OTHER"]),shippingPaise:z.number().int().min(0).default(0),source:z.enum(["CRM","WHATSAPP","SHOPIFY"]).default("CRM")}))
.handler(async ({request,data}) => {
  const db=await auth(request); const id=crypto.randomUUID(); const itemId=crypto.randomUUID(); const shipId=crypto.randomUUID();
  const orderNo=`ISH-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const subtotal=data.quantity*data.unitPricePaise; const gst=Math.round(subtotal*0.18); const total=subtotal+gst+data.shippingPaise;
  await db.batch([
    db.prepare("INSERT INTO orders (id,order_no,source,customer_id,status,payment_status,payment_mode,subtotal_paise,shipping_paise,gst_paise,total_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id,orderNo,data.source,data.customerId,"NEW",data.paymentMode==="COD"?"PENDING":"PAID",data.paymentMode,subtotal,data.shippingPaise,gst,total),
    db.prepare("INSERT INTO order_items (id,order_id,product_name,quantity,unit_price_paise,total_paise) VALUES (?,?,?,?,?,?)").bind(itemId,id,data.productName,data.quantity,data.unitPricePaise,subtotal),
    db.prepare("INSERT INTO shipments (id,order_id) VALUES (?,?)").bind(shipId,id)
  ]);
  return {id,orderNo};
});

export const updateOrderStatus = createServerFn({method:"POST"})
.inputValidator(z.object({id:z.string().uuid(),status:z.enum(["NEW","PACKED","SHIPPED","OUT_FOR_DELIVERY","DELIVERED","RTO","CANCELLED"])}))
.handler(async ({request,data}) => { const db=await auth(request); await db.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=?").bind(data.status,data.id).run(); return {ok:true}; });
