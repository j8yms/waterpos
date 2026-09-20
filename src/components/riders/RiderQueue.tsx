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

function notifyServiceWorkerClearAlarm() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ type: "CLEAR_ALARM" });
    }).catch(() => {});
  }
}

function playNotificationSound(tone: string) {
  try {
    const audio = new Audio(`/sounds/${tone}.mp3`);
    audio.volume = 0.8;
    audio.play().catch(() => {});
  } catch {
    // fallback: silent
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
  const [notificationTone, setNotificationTone] = useState<string>("default");
  const [showSettings, setShowSettings] = useState(false);

  // Heartbeat to keep presence online
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceIdRef = useRef<string>("default");

  // Initialize device ID and notification tone from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("waterpos.rider.device_id");
    if (stored) deviceIdRef.current = stored;
    else {
      const newId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("waterpos.rider.device_id", newId);
      deviceIdRef.current = newId;
    }
    const tone = localStorage.getItem("waterpos.rider.notification_tone");
    if (tone) setNotificationTone(tone);
  }, []);

  // Send presence heartbeat
  const sendHeartbeat = useCallback(async (status: "online" | "offline") => {
    if (!me) return;
    try {
      await api("/api/rider/presence", {
        method: status === "online" ? "POST" : "DELETE",
        body: status === "online" ? { status: "online", device_id: deviceIdRef.current } : undefined,
        silent: true,
      });
    } catch {
      // silent fail
    }
  }, [me]);

  // Start/stop heartbeat
  useEffect(() => {
    if (!me) return;
    sendHeartbeat("online");
    heartbeatRef.current = setInterval(() => sendHeartbeat("online"), 25_000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      sendHeartbeat("offline");
    };
  }, [me, sendHeartbeat]);

  // Visibility change handling
  useEffect(() => {
    if (!me) return;
    const handleVisibility = () => {
      if (document.hidden) {
        sendHeartbeat("offline");
      } else {
        sendHeartbeat("online");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [me, sendHeartbeat]);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}`);
      const fresh = res.orders ?? [];

      setOrders((prev) => {
        const prevIds = new Set(prev.map(o => o.id));
        const newlyAssigned = fresh.filter(o => !prevIds.has(o.id));
        if (newlyAssigned.length) {
          setNewOrderIds((s) => new Set([...s, ...newlyAssigned.map(o => o.id)]));
          newlyAssigned.forEach(o => setTimeout(() => setNewOrderIds(s => { const ns = new Set(s); ns.delete(o.id); return ns; }), 8000));
          // Play notification sound for new orders
          newlyAssigned.forEach(() => playNotificationSound(notificationTone));
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
  }, [me, notificationTone]);

  useEffect(() => {
    load();
    flushPendingOps();
    const handle = window.setInterval(load, 60_000);
    return () => window.clearInterval(handle);
  }, [load]);

async function claimOrder(order: DispatchOrder) {
    const isUpForGrabs = order.driver.trim().toUpperCase() === "UP FOR GRABS" || order.driver.trim().toUpperCase() === "UNASSIGNED" || order.driver.trim() === "";
    if (!order.id || !isUpForGrabs) return;
    setSaving(order.id);
    setErr(null);
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { driver: me?.name || "", pay_status: "PENDING" } });
      // Force fresh fetch to avoid stale cache
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}&_=${Date.now()}`);
      setOrders(res.orders ?? []);
      cacheAssignments(res.orders ?? []);
      // Notify service worker to stop the alarm
      notifyServiceWorkerClearAlarm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to claim order.");
    } finally {
      setSaving(null);
    }
  }

  async function rejectOrder(order: DispatchOrder) {
    if (!order.id) return;
    setSaving(order.id);
    setErr(null);
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { driver: "UNASSIGNED", pay_status: "REJECTED" } });
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}&_=${Date.now()}`);
      setOrders(res.orders ?? []);
      cacheAssignments(res.orders ?? []);
      notifyServiceWorkerClearAlarm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reject order.");
    } finally {
      setSaving(null);
    }
  }

  async function startTransit(order: DispatchOrder) {
    if (!order.id) return;
    setSaving(order.id);
    setErr(null);
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { pay_status: "ON_TRANSIT" } });
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}&_=${Date.now()}`);
      setOrders(res.orders ?? []);
      cacheAssignments(res.orders ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start transit.");
    } finally {
      setSaving(null);
    }
  }

  async function markDelivered(order: DispatchOrder) {
    if (!order.id) return;
    setSaving(order.id);
    setErr(null);
    try {
      await api(`/api/orders/${order.id}`, { method: "PATCH", body: { pay_status: "PAID" } });
      const res = await api<{ orders: DispatchOrder[] }>(`/api/orders?date=${nairobiDate()}&_=${Date.now()}`);
      setOrders(res.orders ?? []);
      cacheAssignments(res.orders ?? []);
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

  const deliveredCount = orders.filter((o) => o.pay_status === "PAID").length;
  const pendingCount = orders.filter((o) => o.pay_status === "PENDING").length;
  const transitCount = orders.filter((o) => o.pay_status === "ON_TRANSIT").length;
  const unassignedCount = orders.filter((o) => o.driver.trim().toUpperCase() === "UNASSIGNED" || o.driver.trim().toUpperCase() === "UP FOR GRABS").length;

  const tones = [
    { value: "default", label: "Default" },
    { value: "chime", label: "Chime" },
    { value: "alert", label: "Alert" },
    { value: "bell", label: "Bell" },
    { value: "ding", label: "Ding" },
  ];

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-500/20 text-slate-300 hover:text-sky-300 font-bold"
            >
              ⚙️
            </button>
            <button
              onClick={logout}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 font-bold"
            >
              Lock
            </button>
          </div>
        </div>
        <div className="flex gap-2 mt-2 text-[11px] font-black flex-wrap">
          <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300">
            {deliveredCount} Delivered
          </span>
          <span className="px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300">
            {transitCount} On Transit
          </span>
          <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300">
            {pendingCount} Pending
          </span>
          {unassignedCount > 0 && (
            <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300">
              {unassignedCount} Up for Grabs
            </span>
          )}
        </div>
      </header>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl">
            <h2 className="font-black text-lg mb-4">Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Notification Tone</label>
                <select
                  value={notificationTone}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNotificationTone(val);
                    localStorage.setItem("waterpos.rider.notification_tone", val);
                    playNotificationSound(val);
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {tones.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="w-full mt-4 px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-black"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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
              const onTransit = o.pay_status === "ON_TRANSIT";
              const pending = o.pay_status === "PENDING";
              const rejected = o.pay_status === "REJECTED";
              const busy = saving === o.id;
              const isNew = newOrderIds.has(o.id);
              const isUnassigned = o.driver.trim().toUpperCase() === "UNASSIGNED" || o.driver.trim().toUpperCase() === "UP FOR GRABS";
              const isMine = o.driver.trim().toLowerCase() === me?.name?.toLowerCase();
              return (
                <li
                  key={o.id}
                  className={`rounded-2xl border p-3.5 transition-all duration-300 ${
                    delivered
                      ? "bg-emerald-950/40 border-emerald-700/50 opacity-60"
                      : onTransit
                        ? "bg-sky-950/30 border-sky-600/50 ring-2 ring-sky-500"
                        : rejected
                          ? "bg-rose-950/30 border-rose-600/50 opacity-70"
                          : isUnassigned
                            ? "bg-amber-950/30 border-amber-600/50 ring-2 ring-amber-500 animate-pulse"
                            : isNew
                              ? "bg-sky-950/30 border-sky-600/50 ring-2 ring-sky-500"
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
                        delivered ? "bg-emerald-500/20 text-emerald-300"
                        : onTransit ? "bg-sky-500/20 text-sky-300"
                        : rejected ? "bg-rose-500/20 text-rose-300"
                        : isUnassigned ? "bg-amber-500/20 text-amber-300"
                        : pending ? "bg-rose-500/20 text-rose-300"
                        : "bg-slate-500/20 text-slate-300"
                      }`}
                    >
                      {delivered ? "✓ Delivered"
                      : onTransit ? "🚚 On Transit"
                      : rejected ? "✗ Rejected"
                      : isUnassigned ? "⚡ Up for Grabs"
                      : pending ? "⏳ Pending"
                      : "Pending"}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-sm">
                    <span className="text-slate-300 font-bold truncate pr-2">{o.product}</span>
                    <span className="font-black text-sky-300 shrink-0">{money(o.total ?? 0)}</span>
                  </div>

                  {delivered ? (
                    <div className="mt-3 text-center text-xs text-slate-500">Completed — {o.time}</div>
                  ) : isUnassigned ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => claimOrder(o)}
                        disabled={busy}
                        className="flex-1 h-12 rounded-xl font-black bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-[0.97] disabled:opacity-50 shadow-lg shadow-emerald-900/30"
                      >
                        {busy ? "…" : "ACCEPT ✓"}
                      </button>
                      <button
                        onClick={() => rejectOrder(o)}
                        disabled={busy}
                        className="flex-1 h-12 rounded-xl font-black bg-rose-600 hover:bg-rose-500 text-white transition active:scale-[0.97] disabled:opacity-50 shadow-lg shadow-rose-900/30"
                      >
                        {busy ? "…" : "REJECT ✗"}
                      </button>
                    </div>
                  ) : isMine && pending ? (
                    <button
                      onClick={() => startTransit(o)}
                      disabled={busy}
                      className="mt-3 w-full h-14 rounded-xl font-black bg-sky-600 hover:bg-sky-500 text-white transition active:scale-[0.97] disabled:opacity-50 shadow-lg shadow-sky-900/30"
                    >
                      {busy ? "…" : "🚚 Start Transit"}
                    </button>
                  ) : isMine && onTransit ? (
                    <button
                      onClick={() => markDelivered(o)}
                      disabled={busy}
                      className="mt-3 w-full h-14 rounded-xl font-black bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-[0.97] disabled:opacity-50 shadow-lg shadow-emerald-900/30"
                    >
                      {busy ? "…" : "✓ Mark Delivered"}
                    </button>
                  ) : isMine && rejected ? (
                    <div className="mt-3 text-center text-xs text-rose-400">You rejected this order</div>
                  ) : (
                    <div className="mt-3 text-center text-xs text-slate-500">Assigned to {o.driver}</div>
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