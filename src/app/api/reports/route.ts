import { requireRole } from "@/lib/auth";
import { ensureSpreadsheetStructure, invalidateCache, readAllLedgerRows, readTab, SheetsConfigError, updateRow } from "@/lib/sheets";
import { buildDebtsLedger } from "@/lib/debts";
import { parseProductLine } from "@/lib/pricing";
import { GLOVO_COMMISSION } from "@/lib/config";
import type { DebtAccount, DebtRow, DispatchOrder, GlovoMetrics, ReportsPayload, RiderMatrixRow, TopSellingItem } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Unified Reports dashboard payload — four administrative widgets computed
 * over the FULL ledger (not a date window):
 *   1. Debts Ledger   — every row with PAY STATUS = PENDING or CREDIT,
 *                       grouped by customer with per-row balances.
 *   2. Rider Matrix   — per-rider trips completed, gross cash collected,
 *                       active pending route deliveries.
 *   3. Glovo Metrics  — gross channel revenue minus commission overhead.
 *   4. Top Sellers    — top 5 items ranked by transaction volume.
 */
export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    await ensureSpreadsheetStructure();
    const ledger = await readAllLedgerRows();
    const orders = ledger.map((l) => l.order);

    // Read opening debts for the shared ledger computation.
    let openingDebts: any[] = [];
    try {
      const od = await readTab("OPENING_DEBTS");
      openingDebts = od.rows;
    } catch {
      openingDebts = [];
    }

    const debts = buildDebtsLedger(orders, openingDebts);

    const riderMatrix = buildRiderMatrix(orders);
    const glovo = buildGlovoMetrics(orders);
    const topSelling = buildTopSelling(orders);

    const payload: ReportsPayload = { debts, riderMatrix, glovo, topSelling };
    return Response.json(payload);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function buildRiderMatrix(orders: any[]): RiderMatrixRow[] {
  const byDriver = new Map<string, RiderMatrixRow>();
  for (const o of orders) {
    const driver = String(o.driver || "").trim() || "UNASSIGNED";
    const cur = byDriver.get(driver) ?? {
      driver,
      tripsCompleted: 0,
      grossCashCollected: 0,
      activePendingDeliveries: 0,
      totalDispatches: 0,
    };
    cur.totalDispatches += 1;
    if (o.pay_status === "PAID") {
      cur.tripsCompleted += 1;
      if (String(o.payment_method || "").toUpperCase() === "CASH") {
        cur.grossCashCollected = Math.round((cur.grossCashCollected + o.total) * 100) / 100;
      }
    } else {
      cur.activePendingDeliveries += 1;
    }
    byDriver.set(driver, cur);
  }
  return [...byDriver.values()].sort((a, b) => b.totalDispatches - a.totalDispatches);
}

function buildGlovoMetrics(orders: any[]): GlovoMetrics {
  const glovoOrders = orders.filter((o) => o.glovo);
  const grossRevenue = Math.round(glovoOrders.reduce((s, o) => s + o.total, 0) * 100) / 100;
  // Recover the raw (pre-commission) profit to derive true overhead:
  // storedProfit = rawProfit × (1 − c) ⇒ commission = rawProfit − storedProfit.
  const commissionOverhead = Math.round(
    glovoOrders.reduce((s, o) => s + (o.profit / (1 - GLOVO_COMMISSION) - o.profit), 0) * 100
  ) / 100;
  return {
    orders: glovoOrders.length,
    grossRevenue,
    commissionOverhead,
    netYield: Math.round((grossRevenue - commissionOverhead) * 100) / 100,
  };
}

function buildTopSelling(orders: any[]): TopSellingItem[] {
  const byName = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders) {
    const lines = parseProductLine(o.product);
    const totalQty = o.qty || lines.reduce((s, l) => s + l.qty, 0) || 1;
    for (const line of lines) {
      const cur = byName.get(line.name) ?? { qty: 0, revenue: 0 };
      cur.qty += line.qty;
      // Revenue attributed proportionally by quantity share of the order total.
      cur.revenue = Math.round((cur.revenue + (o.total * line.qty) / totalQty) * 100) / 100;
      byName.set(line.name, cur);
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue } as TopSellingItem))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
}

/** DELETE /api/reports/debt – remove a debt account customer from the ledger. */
export async function DELETE(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const { customer } = await request.json();
    if (!customer) return Response.json({ error: "Customer name required." }, { status: 400 });

    const ledger = await readAllLedgerRows();
    const ordersToRemove = ledger.filter(
      (r) =>
        String(r.order.customer || "").trim().toLowerCase() ===
          String(customer).trim().toLowerCase() &&
        (r.order.pay_status === "PENDING" ||
          String(r.order.payment_method || "").toUpperCase() === "CREDIT")
    );

    if (!ordersToRemove.length) {
      return Response.json({ error: "No matching pending/credit orders found." }, { status: 404 });
    }

    // Remove the matched orders from their respective tabs
    const updates = ordersToRemove.map((r) => {
      const update: Partial<DispatchOrder> = {
        pay_status: "REJECTED",
        payment_method: "",
        balance: 0,
        last_payment_at: new Date().toISOString(),
        notes: `Cleared debt for ${customer}: ${r.order.notes || ""}`,
      };
      return updateRow(r.tab, r.order._row, update as Record<string, any>);
    });

    await Promise.all(updates);
    invalidateCache("tab:ORDERS");
    invalidateCache("tab:REPORTS");

    return Response.json({
      ok: true,
      removed: ordersToRemove.length,
      message: `${customer}'s debt orders marked as REJECTED and cleared.`,
    });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Reports request failed.";
}