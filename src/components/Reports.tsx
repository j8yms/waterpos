"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearAuth, currentUser } from "@/lib/client";
import { canManageStaff } from "@/lib/config";
import type { DebtAccount, GlovoMetrics, RiderMatrixRow, TopSellingItem } from "@/lib/types";
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
  const canStaff = canManageStaff(me);

  const [day, setDay] = useState(nairobiDate());
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [monthOrders, setMonthOrders] = useState<DispatchOrder[]>([]);
  const [riders, setRiders] = useState<RiderMetrics[]>([]);
  const [credit, setCredit] = useState<CreditAccount[]>([]);
  const [creditTotal, setCreditTotal] = useState(0);
  const [debts, setDebts] = useState<DebtAccount[]>([]);
  const [riderMatrix, setRiderMatrix] = useState<RiderMatrixRow[]>([]);
  const [glovo, setGlovo] = useState<GlovoMetrics | null>(null);
  const [topSelling, setTopSelling] = useState<TopSellingItem[]>([]);
  const [repaying, setRepaying] = useState<string | null>(null);
  const [repayingRowId, setRepayingRowId] = useState<string>("");
  const [repayAmount, setRepayAmount] = useState("");
  const [repayMethod, setRepayMethod] = useState<"CASH" | "MPESA">("CASH");
  const [repayBusy, setRepayBusy] = useState(false);
  const [repayMsg, setRepayMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
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
    try {
      const reports = await api<{
        debts: DebtAccount[];
        riderMatrix: RiderMatrixRow[];
        glovo: GlovoMetrics;
        topSelling: TopSellingItem[];
      }>(`/api/reports`);
      setDebts(reports.debts);
      setRiderMatrix(reports.riderMatrix);
      setGlovo(reports.glovo);
      setTopSelling(reports.topSelling);
    } catch {
      /* reports widgets are additive */
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

  async function recordRepayment(account: DebtAccount, selectedRowId?: string) {
    const amount = parseFloat(repayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setRepayMsg({ kind: "err", text: "Enter a positive repayment amount." });
      return;
    }
    const row = account.rows.find((r) => r.id === selectedRowId) ?? account.rows[0];
    if (!row) {
      setRepayMsg({ kind: "err", text: "Select a debt to repay." });
      return;
    }
    const source = row.source ?? (String(row.id).startsWith("od") ? "opening" : "order");
    setRepayBusy(true);
    setRepayMsg(null);
    try {
      const res = await api<{
        ok: boolean;
        applied: number;
        excess: number;
        settledRows: string[];
      }>("/api/repayments", {
        method: "POST",
        body: {
          action: "logRepayment",
          customer: account.customer,
          amount,
          method: repayMethod,
          allocations: [{ source, id: row.id, amount }],
        },
      });
      setRepayMsg({
        kind: "ok",
        text: `${money(res.applied ?? 0)} recorded for ${account.customer}${
          res.settledRows.length ? ` — ${res.settledRows.length} order(s) settled.` : "."
        }`,
      });
      setRepaying(null);
      setRepayAmount("");
      load();
    } catch (e) {
      setRepayMsg({ kind: "err", text: e instanceof Error ? e.message : "Repayment failed." });
    } finally {
      setRepayBusy(false);
    }
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
            {canStaff && (
              <Link href="/staff" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Staff
              </Link>
            )}
            {canStaff && (
              <Link href="/receipts" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Receipts
              </Link>
            )}
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
          <StatCard label="Sales (selected day)" value={money(dayTotal ?? 0)} accent="text-emerald-400" />
          <StatCard label="Monthly Gross Sales" value={money(monthGross ?? 0)} accent="text-sky-400" />
          <StatCard label="Monthly Net Profit" value={money(monthNet ?? 0)} accent="text-amber-400" />
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <StatCard label="Monthly Cost Basis" value={money(monthCost ?? 0)} accent="text-rose-400" />
          <StatCard label="Monthly Dispatch Count" value={String(monthOrders.length)} accent="text-slate-100" />
          <StatCard label="Madeni Outstanding" value={money(creditTotal ?? 0)} accent="text-amber-300" />
        </section>

        {repayMsg && (
          <div
            className={`px-3 py-2 rounded-xl text-sm font-bold ${
              repayMsg.kind === "ok"
                ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                : "bg-rose-500/15 border border-rose-500/40 text-rose-300"
            }`}
          >
            {repayMsg.text}
          </div>
        )}

        {/* ── 1. Debts Ledger & Repayment Node ─────────────────────────────── */}
        <section className="rounded-2xl border border-amber-500/30 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-amber-500/20 text-xs uppercase tracking-wider text-amber-300 font-black flex items-baseline justify-between gap-2">
            <span>Debts Ledger &amp; Repayment Node</span>
            <span className="text-amber-200/80 normal-case tracking-normal text-[11px]">
              {debts.reduce((s, d) => s + d.outstanding, 0) > 0
                ? `Total open ${money(debts.reduce((s, d) => s + (d.outstanding ?? 0), 0))}`
                : "All caught up"}
            </span>
          </div>
          {debts.length === 0 && (
            <div className="px-3 py-6 text-center text-slate-600 text-sm">
              No rows with PAY STATUS = PENDING or payment type = CREDIT.
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-800">
            {debts.map((d) => (
              <div key={d.customer} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-black text-slate-100 truncate">{d.customer}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {d.phone || "—"} · {d.house || "no house"} · {d.numberOfRows} open order
                      {d.numberOfRows === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-black text-amber-300">
                    {money(d.outstanding ?? 0)}
                  </div>
                  <button
                    onClick={() => {
                      if (repaying === d.customer) {
                        setRepaying(null);
                      } else {
                        setRepaying(d.customer);
                        setRepayingRowId(d.rows[0]?.id ?? "");
                        setRepayAmount("");
                        setRepayMsg(null);
                      }
                    }}
                    className="shrink-0 px-3 h-9 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 font-black text-xs transition"
                  >
                    {repaying === d.customer ? "Cancel" : "Record Repayment"}
                  </button>
                </div>

                {/* Inline repayment input */}
                {repaying === d.customer && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 border border-amber-500/20 p-2">
                    <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5">
                      {(["CASH", "MPESA"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setRepayMethod(m)}
                          className={`px-3 h-8 rounded-md text-xs font-black transition ${
                            repayMethod === m ? "bg-sky-500 text-white" : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <select
                      value={repayingRowId || d.rows[0]?.id || ""}
                      onChange={(e) => setRepayingRowId(e.target.value)}
                      className="h-9 px-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs"
                    >
                      {d.rows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} — {money(r.balance ?? 0)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(e.target.value)}
                      placeholder="Amount…"
                      className="h-9 flex-1 min-w-[120px] px-3 rounded-lg bg-slate-800 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-sm"
                    />
                    <button
                      onClick={() => recordRepayment(d, repayingRowId || d.rows[0]?.id)}
                      disabled={repayBusy}
                      className="px-4 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition disabled:opacity-50"
                    >
                      {repayBusy ? "Applying…" : "Apply"}
                    </button>
                  </div>
                )}

                {/* Open rows for this customer */}
                {repaying === d.customer && (
                  <div className="mt-1.5 space-y-1">
                    {d.rows.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-900/60 text-[11px]"
                      >
                        <span className="text-slate-500 font-bold shrink-0">
                          {r.date.slice(5)} {r.time}
                        </span>
                        <span className="flex-1 truncate text-slate-300">
                          {r.payment_method || "—"} · {r.driver}
                        </span>
                        <span className="shrink-0 text-slate-400 font-bold">{money(r.balance ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── 2. Rider Performance Matrix ──────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-black">
            Rider Performance Matrix · all time · {riderMatrix.length} riders
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-black">Rider</th>
                  <th className="px-2 py-2 font-black text-right">Trips Completed</th>
                  <th className="px-2 py-2 font-black text-right">Gross Cash Collected</th>
                  <th className="px-3 py-2 font-black text-right">Active Pending Deliveries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {riderMatrix.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-600 text-sm">
                      No dispatch activity on record.
                    </td>
                  </tr>
                )}
                {riderMatrix.map((r) => (
                  <tr key={r.driver} className="hover:bg-slate-900">
                    <td className="px-3 py-2 font-bold text-slate-100">{r.driver}</td>
                    <td className="px-2 py-2 text-right text-emerald-400 font-black">{r.tripsCompleted}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{money(r.grossCashCollected ?? 0)}</td>
                    <td className="px-3 py-2 text-right text-rose-400 font-black">{r.activePendingDeliveries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 3. Glovo Performance Metrics ─────────────────────────────────── */}
        <section className="rounded-2xl border border-purple-500/30 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-purple-500/20 text-xs uppercase tracking-wider text-purple-300 font-black">
            Glovo Performance Metrics · net channel yield
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3">
            <StatCard
              label="Gross Channel Revenue"
              value={glovo ? money(glovo.grossRevenue ?? 0) : "—"}
              accent="text-purple-300"
            />
            <StatCard
              label="Commission Overhead (20%)"
              value={glovo ? money(glovo.commissionOverhead ?? 0) : "—"}
              accent="text-rose-400"
            />
            <StatCard
              label="Net Channel Yield"
              value={glovo ? money(glovo.netYield ?? 0) : "—"}
              accent="text-emerald-400"
            />
          </div>
          <div className="px-3 pb-3 text-[11px] text-slate-500">
            {glovo ? `${glovo.orders} Glovo-tagged order(s) all time.` : "No Glovo records yet."}
          </div>
        </section>

        {/* ── 4. Top 5 Best Selling Items ──────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-black">
            Top 5 Best Selling Items · by volume
          </div>
          <div className="p-3 space-y-2">
            {topSelling.length === 0 && (
              <div className="text-center text-slate-600 text-sm py-4">No product volume on record.</div>
            )}
            {topSelling.map((t, i) => {
              const max = Math.max(1, ...topSelling.map((x) => x.qty));
              const pct = Math.round((t.qty / max) * 100);
              return (
                <div key={t.name} className="flex items-center gap-2">
                  <div className="w-5 shrink-0 text-sm font-black text-slate-500">{i + 1}</div>
                  <div className="w-40 shrink-0">
                    <div className="text-xs font-bold text-slate-200 truncate">{t.name}</div>
                  </div>
                  <div className="flex-1 h-5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        i === 0 ? "bg-emerald-500" : "bg-sky-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-16 shrink-0 text-right text-sm font-black text-slate-100">
                    {t.qty}
                  </div>
                  <div className="w-24 shrink-0 text-right text-[11px] text-slate-500 font-bold">
                    {money(t.revenue ?? 0)}
                  </div>
                </div>
              );
            })}
          </div>
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
                    <td className="px-2 py-2 text-right text-slate-200">{money(r.cashCollected ?? 0)}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{money(r.mpesaCollected ?? 0)}</td>
                    <td className="px-2 py-2 text-right text-amber-300">{r.glovoOrders}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.routeStops}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.itemsDelivered}</td>
                    <td className="px-3 py-2 text-right text-slate-200">{money(r.avgOrderValue ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Credit Accounts (Madeni) ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-amber-500/30 bg-slate-950 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-amber-500/20 text-xs uppercase tracking-wider text-amber-300 font-black">
            Credit Accounts · Madeni · Outstanding {money(creditTotal ?? 0)} ({credit.length} accounts)
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
                    <td className="px-2 py-2 text-right font-black text-amber-300">{money(c.outstanding ?? 0)}</td>
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
                  <div className="text-sm font-black text-emerald-400">{money(o.total ?? 0)}</div>
                  <div className="text-[11px] text-slate-500 font-bold">+{money(o.profit ?? 0)} profit</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}