import { requireUser } from "@/lib/auth";
import { readTab, rowToOrder, SheetsConfigError } from "@/lib/sheets";
import { nairobiDate } from "@/lib/pricing";
import { GLOVO_COMMISSION } from "@/lib/config";
import type { DashboardSummary } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Riders get personal stats only (assigned orders), never company financials.
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || nairobiDate();

  try {
    const read = await readTab("ORDERS");
    const orders = read.rows.map((raw, i) => rowToOrder(raw, read.rowNumbers[i]));

    if (user.role === "rider") {
      const mine = orders.filter(
        (o) => o.date === date && o.driver.trim().toLowerCase() === user.name.trim().toLowerCase()
      );
      return Response.json({
        date,
        driver: user.name,
        assigned: mine.length,
        paid: mine.filter((o) => o.pay_status === "PAID").length,
        pending: mine.filter((o) => o.pay_status === "PENDING").length,
      });
    }

    const day = orders.filter((o) => o.date === date);
    const totalSales = day.reduce((s, o) => s + o.total, 0);
    const totalProfit = day.reduce((s, o) => s + o.profit, 0);
    // Recover the raw (pre-commission) profit for Glovo orders to derive real COGS:
    // storedProfit = rawProfit × (1 − commission) ⇒ rawProfit = storedProfit / (1 − commission)
    const totalCost = day.reduce(
      (s, o) => s + (o.total - (o.glovo ? o.profit / (1 - GLOVO_COMMISSION) : o.profit)),
      0
    );
    const glovoCommission = day
      .filter((o) => o.glovo)
      .reduce((s, o) => s + (o.profit / (1 - GLOVO_COMMISSION) - o.profit), 0);

    const summary: DashboardSummary = {
      date,
      totalSales: round2(totalSales),
      totalCost: round2(totalCost),
      totalProfit: round2(totalProfit),
      glovoCommission: round2(glovoCommission),
      paidCount: day.filter((o) => o.pay_status === "PAID").length,
      pendingCount: day.filter((o) => o.pay_status === "PENDING").length,
      ordersCount: day.length,
    };

    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Dashboard request failed.";
}