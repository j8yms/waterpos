import { requireRole } from "@/lib/auth";
import { readAllLedgerRows, SheetsConfigError } from "@/lib/sheets";
import { nairobiDate, normalizeSheetDate } from "@/lib/pricing";
import type { DispatchOrder } from "@/lib/types";

export const runtime = "nodejs";

interface RiderMetrics {
  driver: string;
  dispatches: number;
  completed: number;
  pending: number;
  cashCollected: number;
  mpesaCollected: number;
  glovoOrders: number;
  routeStops: number;
  itemsDelivered: number;
  avgOrderValue: number;
}

interface CreditAccount {
  customer: string;
  house: string;
  phone: string;
  orders: number;
  outstanding: number;
  firstPendingDate: string;
  lastPendingDate: string;
}

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || nairobiDate();
  const period = url.searchParams.get("period") === "month" ? "month" : "day";

  try {
    const ledger = await readAllLedgerRows();
    const orders = ledger.map((l) => l.order);

    const key = normalizeSheetDate(date) || date;
    const monthKey = key.slice(0, 7);
    const inRange = (o: DispatchOrder) => {
      const k = normalizeSheetDate(o.date);
      return period === "month" ? k.startsWith(monthKey) : k === key;
    };
    const ranged = orders.filter(inRange);

    // ── Rider Performance Ledger ─────────────────────────────────────────────
    const byDriver = new Map<string, DispatchOrder[]>();
    for (const o of ranged) {
      const name = String(o.driver || "UNASSIGNED").trim();
      byDriver.set(name, [...(byDriver.get(name) ?? []), o]);
    }
    const riders: RiderMetrics[] = [...byDriver.entries()]
      .map(([driver, list]) => {
        const paid = list.filter((o) => o.pay_status === "PAID");
        const pending = list.filter((o) => o.pay_status === "PENDING");
        const storeCount = (method: string) =>
          paid.filter((o) => String(o.payment_method).toUpperCase() === method).reduce((s, o) => s + o.total, 0);
        return {
          driver,
          dispatches: list.length,
          completed: paid.length,
          pending: pending.length,
          cashCollected: round2(storeCount("CASH")),
          mpesaCollected: round2(storeCount("MPESA")),
          glovoOrders: list.filter((o) => o.glovo).length,
          routeStops: new Set(list.map((o) => String(o.customer || "").toLowerCase())).size,
          itemsDelivered: list.reduce((s, o) => s + o.qty, 0),
          avgOrderValue: round2(list.reduce((s, o) => s + o.total, 0) / Math.max(1, list.length)),
        };
      })
      .sort((a, b) => b.dispatches - a.dispatches);

    // ── Credit Accounts ("Madeni") ───────────────────────────────────────────
    // Outstanding balances: every PENDING dispatch across both the live ORDERS
    // tab and the legacy OUT ledger, grouped by customer / house number.
    const pendingAll = orders.filter((o) => o.pay_status === "PENDING");
    const creditMap = new Map<string, CreditAccount>();
    for (const o of pendingAll) {
      const customer = String(o.customer || "WALK-IN CUSTOMER").trim();
      const house = String(o.address || "").trim();
      const phone = String(o.phone || "").trim();
      const groupKey = `${customer}::${house}`.toLowerCase();
      const cur = creditMap.get(groupKey) ?? {
        customer,
        house,
        phone,
        orders: 0,
        outstanding: 0,
        firstPendingDate: o.date,
        lastPendingDate: o.date,
      };
      cur.orders += 1;
      cur.outstanding = round2(cur.outstanding + o.total);
      if (o.date && o.date < cur.firstPendingDate) cur.firstPendingDate = o.date;
      if (o.date && o.date > cur.lastPendingDate) cur.lastPendingDate = o.date;
      creditMap.set(groupKey, cur);
    }
    const credit = [...creditMap.values()].sort((a, b) => b.outstanding - a.outstanding);
    const creditTotal = round2(credit.reduce((s, c) => s + c.outstanding, 0));

    const summary = {
      date,
      period,
      orders: ranged.length,
      sales: round2(ranged.reduce((s, o) => s + o.total, 0)),
      paid: ranged.filter((o) => o.pay_status === "PAID").length,
      pending: ranged.filter((o) => o.pay_status === "PENDING").length,
      creditAccounts: credit.length,
      creditTotal,
    };

    return Response.json({ summary, riders, credit });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Analytics request failed.";
}