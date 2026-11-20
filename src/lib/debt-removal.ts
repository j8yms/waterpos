import { readAllLedgerRows, readTab, updateRow, invalidateCache, SheetsConfigError } from "./sheets";
import { newOrderId } from "./sync";

export class DebtRemovalError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getProtectedOrderIds(ordersToRemove: any[], repayments: any[], paymentOps: any[]): string[] {
  const orderIds = new Set(ordersToRemove.map((r) => String(r.order.id)));
  const protectedIds = new Set<string>();
  for (const p of repayments) {
    const oid = String(p.order_id ?? "");
    if (orderIds.has(oid)) protectedIds.add(oid);
  }
  for (const op of paymentOps) {
    let allocs: any[] = [];
    try { allocs = JSON.parse(String(op.allocations ?? "[]")); } catch { allocs = []; }
    for (const a of allocs) {
      if (a && orderIds.has(String(a.id ?? ""))) protectedIds.add(String(a.id));
    }
    // also customer-level protection
  }
  return [...protectedIds];
}

export async function removeDebt(customer: string, sheets: any) {
  if (!customer) throw new DebtRemovalError("Customer name required.", 400);
  const ledger = await sheets.readAllLedgerRows();
  const ordersToRemove = ledger.filter(
    (r: any) =>
      String(r.order.customer || "").trim().toLowerCase() === String(customer).trim().toLowerCase() &&
      (r.order.pay_status === "PENDING" || String(r.order.payment_method || "").toUpperCase() === "CREDIT")
  );
  if (!ordersToRemove.length) throw new DebtRemovalError("No matching pending/credit orders found.", 404);

  const repayments = (await sheets.readTab("REPAYMENTS")).rows;
  const paymentOps = (await sheets.readTab("PAYMENT_OPERATIONS")).rows;
  const protectedIds = getProtectedOrderIds(ordersToRemove, repayments, paymentOps);
  if (protectedIds.length) {
    throw new DebtRemovalError(`Cannot remove debt with existing repayments: ${protectedIds.join(", ")}. Reverse the repayment first.`, 400);
  }

  const updates = ordersToRemove.map((r: any) => {
    const update: Record<string, any> = {
      pay_status: "REJECTED",
      payment_method: "",
      balance: 0,
      last_payment_at: new Date().toISOString(),
      notes: `Cleared debt for ${customer}: ${r.order.notes || ""}`,
    };
    return sheets.updateRow(r.tab, r.order._row, update);
  });
  await Promise.all(updates);
  sheets.invalidateCache("tab:ORDERS");
  sheets.invalidateCache("tab:REPORTS");
  return { ok: true, removed: ordersToRemove.length, message: `${customer}'s debt orders marked as REJECTED and cleared.` };
}
