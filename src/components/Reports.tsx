"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearAuth, currentUser } from "@/lib/client";
import type { DispatchOrder } from "@/lib/types";
import { money, nairobiDate } from "@/lib/pricing";
import { StatCard } from "@/components/ui";

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

export default function Reports() {
  const router = useRouter();
  const me = currentUser();

  const [day, setDay] = useState(nairobiDate());
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [monthOrders, setMonthOrders] = useState<DispatchOrder[]>([]);
  const [riders, setRiders] = useState<RiderMetrics[]>([]);
  const [credit, setCredit] = useState<CreditAccount[]>([]);
  const [creditTotal, setCreditTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const dayRes = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${day}`);
      setOrders(dayRes.orders);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reports request failed.");
    }
    try {
      const m = day.slice(0, 7);
      const monthRes = await api<{ orders: DispatchOrder[] }>(`/api/orders?month=${m}`);
      setMonthOrders(monthRes.orders);
    } catch {
      /* monthly aggregation is additive */
    }
    try {
      const res = await api<{
        summary: { creditTotal: number };
        riders: RiderMetrics[];
        credit: CreditAccount[];
      }>(`/api/analytics?date=${day}&period=${period}`);
      setRiders(res.riders);
      setCredit(res.credit);
      setCreditTotal(res.summary.creditTotal);
    } catch {
      /* analytics blocks are additive */
    }
    setLoading(false);
  }, [day, period]);

  useEffect(() => {
    load();
  }, [load]);

  function logout() {
    clearAuth();
    router.replace("/");
  }

  const dayTotal = useMemo(() => orders.reduce((s, o) => s + o.total, 0), [orders]);
  const monthGross = useMemo(() => monthOrders.reduce((s, o) => s + o.total, 0), [monthOrders]);
  const monthNet = useMemo(() => monthOrders.reduce((s, o) => s + o.profit, 0), [monthOrders]);
  const monthCost = useMemo(() => monthOrders.reduce((s, o) => s + (o.total - o.profit), 0), [monthOrders]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            R
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">MIST Reports</div>
            <div className="text-[11px] text-slate-400 leading-tight">Sales ledger · rider performance · madeni credit</div>
          </div>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <Link href="/pos" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Sell
            </Link>
            <Link href="/restock" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Restock
            </Link>
            <Link href="/customers" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Customers
            </Link>
            <Link href="/catalog" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Products
            </Link>
            <Link href="/reports" className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold">
              Reports
            </Link>
          </nav>
          {me && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:block text-xs text-slate-400 truncate max-w-[90px]">{me.name}</span>
              <button
                onClick={logout}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 font-bold"
              >
                Lock
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 w-full max-w-5xl mx-auto p-3 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={day}
            max={nairobiDate()}
            onChange={(e) => setDay(e.target.value || nairobiDate())}
            className="h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 outline-none text-slate-100 bg-slate-800"
          />
          <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1">
            <button
              onClick={() => setPeriod("day")}
              className={`px-4 h-9 rounded-lg font-black text-sm transition ${
                period === "day" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              DAY
            </button>
            <button
              onClick={() => setPeriod("month")}
              className={`px-4 h-9 rounded-lg font-black text-sm transition ${
                period === "month" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              MONTH
            </button>
          </div>
          {loading && <span className="text-xs text-slate-500">Loading…</span>}
        </div>

        {err && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-bold">
            {err}
          </div>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <StatCard label="Sales (selected day)" value={money(dayTotal)} accent="text-emerald-400" />
          <StatCard label="Monthly Gross Sales" value={money(monthGross)} accent="text-sky-400" />
          <StatCard label="Monthly Net Profit" value={money(monthNet)} accent="text-amber-400" />
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <StatCard label="Monthly Cost Basis" value={money(monthCost)} accent="text-rose-400" />
          <StatCard label="Monthly Dispatch Count" value={String(monthOrders.length)} accent="text-slate-100" />
          <StatCard label="Madeni Outstanding" value={money(creditTotal)} accent="text-amber-300" />
        </section>

        {/* ── Rider Performance Ledger ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-black">
            Rider Performance Ledger · {day} ({riders.length} riders)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-black">Rider</th>
                  <th className="px-2 py-2 font-black text-right">Dispatches</th>
                  <th className="px-2 py-2 font-black text-right">Completed</th>
                  <th className="px-2 py-2 font-black text-right">Pending</th>
                  <th className="px-2 py-2 font-black text-right">Cash Collected</th>
                  <th className="px-2 py-2 font-black text-right">M-Pesa</th>
                  <th className="px-2 py-2 font-black text-right">Glovo</th>
                  <th className="px-2 py-2 font-black text-right">Stops</th>
                  <th className="px-2 py-2 font-black text-right">Items</th>
                  <th className="px-3 py-2 font-black text-right">Avg Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-600 text-sm">
                      No dispatch activity in this range.
                    </td>
                  </tr>
                )}
                {riders.map((r) => (
                  <tr key={r.driver} className="hover:bg-slate-900">
                    <td className="px-3 py-2 font-bold text-slate-100">{r.driver}</td>
                    <td className="px-2 py-2 text-right font-bold text-slate-200">{r.dispatches}</td>
                    <td className="px-2 py-2 text-right text-emerald-400 font-black">{r.completed}</td>
                    <td className="px-2 py-2 text-right text-rose-400 font-black">{r.pending}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{money(r.cashCollected)}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{money(r.mpesaCollected)}</td>
                    <td className="px-2 py-2 text-right text-amber-300">{r.glovoOrders}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.routeStops}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.itemsDelivered}</td>
                    <td className="px-3 py-2 text-right text-slate-200">{money(r.avgOrderValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Credit Accounts (Madeni) ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-amber-500/30 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-amber-500/20 text-xs uppercase tracking-wider text-amber-300 font-black">
            Credit Accounts · Madeni · Outstanding {money(creditTotal)} ({credit.length} accounts)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-black">Customer / House</th>
                  <th className="px-2 py-2 font-black">Phone</th>
                  <th className="px-2 py-2 font-black text-right">Open Orders</th>
                  <th className="px-2 py-2 font-black text-right">Outstanding</th>
                  <th className="px-3 py-2 font-black text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {credit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-600 text-sm">
                      No outstanding (PENDING) balances across the ORDERS / OUT ledgers.
                    </td>
                  </tr>
                )}
                {credit.map((c) => (
                  <tr key={`${c.customer}::${c.house}`} className="hover:bg-slate-900">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-100">{c.customer}</div>
                      {c.house && <div className="text-[11px] text-slate-500 truncate">{c.house}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-400">{c.phone || "—"}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{c.orders}</td>
                    <td className="px-2 py-2 text-right font-black text-amber-300">{money(c.outstanding)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{c.lastPendingDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-black">
            Dispatches · {day} ({orders.length})
          </div>
          <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-800">
            {orders.length === 0 && (
              <div className="text-center text-slate-600 text-sm py-8">No dispatches on this day.</div>
            )}
            {orders.map((o) => (
              <div key={o.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-100 truncate">{o.customer}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {o.time} · {o.product} · {o.driver} ·{" "}
                    <span className={o.pay_status === "PAID" ? "text-emerald-500" : "text-rose-400"}>
                      {o.pay_status}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-emerald-400">{money(o.total)}</div>
                  <div className="text-[11px] text-slate-500 font-bold">+{money(o.profit)} profit</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}