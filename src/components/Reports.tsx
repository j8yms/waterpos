"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearAuth, currentUser } from "@/lib/client";
import type { DispatchOrder } from "@/lib/types";
import { money, nairobiDate } from "@/lib/pricing";
import { StatCard } from "@/components/ui";

export default function Reports() {
  const router = useRouter();
  const me = currentUser();

  const [day, setDay] = useState(nairobiDate());
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [monthOrders, setMonthOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const month = useMemo(() => day.slice(0, 7), [day]);

  const load = useCallback(
    async (d: string) => {
      setLoading(true);
      setErr(null);
      try {
        const dayRes = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${d}`);
        setOrders(dayRes.orders);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Reports request failed.");
      }
      try {
        const m = d.slice(0, 7);
        const monthRes = await api<{ orders: DispatchOrder[] }>(`/api/orders?month=${m}`);
        setMonthOrders(monthRes.orders);
      } catch {
        /* monthly aggregation is additive */
      }
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    load(day);
  }, [day, load]);

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
            <div className="text-[11px] text-slate-400 leading-tight">Sales ledger · historical</div>
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

      <div className="flex-1 w-full max-w-4xl mx-auto p-3 space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={day}
            max={nairobiDate()}
            onChange={(e) => setDay(e.target.value || nairobiDate())}
            className="h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 outline-none text-slate-100"
          />
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

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <StatCard label="Monthly Cost Basis" value={money(monthCost)} accent="text-rose-400" />
          <StatCard label="Monthly Dispatch Count" value={String(monthOrders.length)} accent="text-slate-100" />
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
                    {o.time} · {o.product} · {o.driver}
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