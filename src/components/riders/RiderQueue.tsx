"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, cacheAssignments, clearAuth, currentUser, flushPendingOps } from "@/lib/client";
import { money, nairobiDate } from "@/lib/pricing";
import { printToNetwork, receiptFromOrder } from "@/lib/print";
import { Spinner } from "@/components/ui";
import type { DispatchOrder } from "@/lib/types";

function tryCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export default function RiderQueue() {
  const router = useRouter();
  const me = currentUser();
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}`);
      const fresh = res.orders ?? [];
      
      // Detect newly assigned orders (not in current state)
      setOrders((prev) => {
        const prevIds = new Set(prev.map(o => o.id));
        const newlyAssigned = fresh.filter(o => !prevIds.has(o.id));
        if (newlyAssigned.length) {
          setNewOrderIds((s) => new Set([...s, ...newlyAssigned.map(o => o.id)]));
          // Auto-clear "new" highlight after 8 seconds
          newlyAssigned.forEach(o => setTimeout(() => setNewOrderIds(s => { const ns = new Set(s); ns.delete(o.id); return ns; }), 8000));
        }
        return fresh;
      });
      cacheAssignments(fresh);
    } catch (e) {
      const cached = tryCache<DispatchOrder[]>("waterpos.queue");
      if (cached) setOrders(cached);
      setErr(e instanceof Error ? "Offline — showing cached queue." : "Failed to load queue.");
    } finally {
      setLoading(false);
    }
  }, [me]);

  // Initial load + periodic refresh (every 30s) — only updates changed orders
  useEffect(() => {
    load();
    flushPendingOps();
    const handle = window.setInterval(load, 30_000);
    return () => window.clearInterval(handle);
  }, [load]);

  // Mark as delivered (single action — no PENDING toggle)
  async function markDelivered(order: DispatchOrder) {
    if (!order.id) return;
    setSaving(order.id);
    setErr(null);
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { pay_status: "PAID" } });
      setOrders((list) =>
        list.map((o) => (o.id === order.id ? { ...o, pay_status: "PAID" as const } : o))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(null);
    }
  }

  function logout() {
    clearAuth();
    router.replace("/");
  }

  const pendingCount = orders.filter((o) => o.pay_status === "PENDING").length;
  const deliveredCount = orders.filter((o) => o.pay_status === "PAID").length;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            R
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight">RIDER QUEUE</div>
            <div className="text-[11px] text-slate-400 leading-tight">
              {me?.name} · {nairobiDate()}
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 font-bold"
          >
            Lock
          </button>
        </div>
        <div className="flex gap-2 mt-2 text-[11px] font-black">
          <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300">
            {deliveredCount} Delivered
          </span>
          <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300">
            {pendingCount} Pending
          </span>
        </div>
      </header>

      <section className="flex-1 px-3 py-3">
        {err && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-bold">
            {err}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Spinner />
            <span className="ml-3">Loading your queue…</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-slate-600">
            <div className="text-4xl mb-3">🚚</div>
            <p className="font-bold text-slate-400">No orders assigned to {me?.name} today.</p>
            <p className="text-sm">Check back shortly.</p>
          </div>
        ) : (
          <ul className="space-y-3 max-w-2xl mx-auto">
            {orders.map((o) => {
              const delivered = o.pay_status === "PAID";
              const busy = saving === o.id;
              const isNew = newOrderIds.has(o.id);
              return (
                <li
                  key={o.id}
                  className={`rounded-2xl border p-3.5 transition-all duration-300 ${
                    delivered
                      ? "bg-emerald-950/40 border-emerald-700/50 opacity-60"
                      : isNew
                        ? "bg-amber-950/30 border-amber-600/50 ring-2 ring-amber-500 animate-pulse"
                        : "bg-slate-900 border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-base font-black text-slate-100">{o.customer}</div>
                      <div className="text-xs text-slate-400 break-words">
                        {o.address} · {o.phone}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-black px-2 py-1 rounded-lg ${
                        delivered ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {delivered ? "✓ Delivered" : "Pending"}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-sm">
                    <span className="text-slate-300 font-bold truncate pr-2">{o.product}</span>
                    <span className="font-black text-sky-300 shrink-0">{money(o.total ?? 0)}</span>
                  </div>

                  {delivered ? (
                    <div className="mt-3 text-center text-xs text-slate-500">Completed — {o.time}</div>
                  ) : (
                    <button
                      onClick={() => markDelivered(o)}
                      disabled={busy}
                      className="mt-3 w-full h-14 rounded-xl font-black bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-[0.97] disabled:opacity-50 shadow-lg shadow-emerald-900/30"
                    >
                      {busy ? "…" : "✓ Mark Delivered"}
                    </button>
                  )}

                  {o.mpesa_code && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-sky-950/40 border border-sky-700/50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wide text-sky-400 font-black">
                          M-Pesa reference
                        </div>
                        <div className="font-black text-sky-200 truncate">{o.mpesa_code}</div>
                      </div>
                      <button
                        onClick={async () =>
                          await printToNetwork(receiptFromOrder(o, { operator: me?.name || "Rider" }))
                        }
                        className="shrink-0 text-xs font-black px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white active:scale-95 transition"
                      >
                        🖨️ RECEIPT
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}