export function inclusiveTotals(quantity: number, unitPricePaise: number, gstPercent: number, shippingPaise = 0) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0 || !Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100 || !Number.isSafeInteger(shippingPaise) || shippingPaise < 0) throw new Error("Invalid order amounts");
  const gross = quantity * unitPricePaise;
  if (!Number.isSafeInteger(gross + shippingPaise)) throw new Error("Order amount is too large");
  const subtotal = Math.round(gross * 100 / (100 + gstPercent));
  return { gross, subtotal, gst: gross - subtotal, total: gross + shippingPaise };
}
export const ORDER_STATUSES = ["NEW", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RTO", "CANCELLED"];
export function orderStatusForShipment(status: string): string | null {
  return ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RTO"].includes(status) ? status : null;
}
export function shipmentStatusForOrder(status: string): string | null {
  return orderStatusForShipment(status);
}
