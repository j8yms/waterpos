"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheCustomers, cacheProducts, clearAuth, currentUser, flushPendingOps } from "@/lib/client";
import type { CartItem, DashboardSummary, DispatchOrder, EtimsItem, Product } from "@/lib/types";
import { money, nairobiDate } from "@/lib/pricing";
import SalesTicket from "./SalesTicket";
import PrintPrompt from "./PrintPrompt";
import { StatCard } from "@/components/ui";
import { printReceipt, receiptFromOrder } from "@/lib/print";

export default function SalesFloor() {
  const router = useRouter();
  const me = currentUser();

  const [products, setProducts] = useState<Product[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [filter, setFilter] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [glovo, setGlovo] = useState(false);
  const [payStatus, setPayStatus] = useState<"PAID" | "PENDING">("PENDING");
  const [customer, setCustomer] = useState({ location: "", phone: "", address: "" });
  const [driver, setDriver] = useState("");
  const [charging, setCharging] = useState(false);
  const [savedOrder, setSavedOrder] = useState<DispatchOrder | null>(null);
  const [savedItems, setSavedItems] = useState<EtimsItem[]>([]);
  const [etimsOn, setEtimsOn] = useState(false);
  const [kraPin, setKraPin] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [todayOrders, setTodayOrders] = useState<DispatchOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(0);

  const loadProducts = useCallback(async () => {
    try {
      const res = await api<{ products: Product[] }>("/api/pos/products");
      setProducts(res.products);
      cacheProducts(res.products);
      setErr(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Product load failed.";
      setErr(message.includes("missing") || message.includes("Configure") ? message : "Offline product cache active.");
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    try {
      const res = await api<{ staff: { id: string; name: string; role: string }[] }>("/api/staff");
      setDrivers(res.staff.filter((s) => s.role === "rider"));
    } catch {
      /* drivers optional */
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api<DashboardSummary>("/api/dashboard");
      setSummary(res);
    } catch {
      setSummary(null);
    }
  }, []);

  const loadTodayOrders = useCallback(async () => {
    try {
      const res = await api<{ orders: DispatchOrder[] }>("/api/orders");
      setTodayOrders(res.orders);
    } catch {
      setTodayOrders((prev) => prev);
    }
  }, []);

  useEffect(() => {
    const cached = tryCache<Product[]>("waterpos.products");
    if (cached && cached.length) {
      setProducts(cached);
    }
    loadProducts();
    loadDrivers();
    loadSummary();
    loadTodayOrders();
    flushPendingOps();
    api<{ customers: any[] }>("/api/pos/customers")
      .then((r) => cacheCustomers(r.customers))
      .catch(() => {});
  }, [loadProducts, loadDrivers, loadSummary, loadTodayOrders]);

  useEffect(() => {
    loadSummary();
  }, [refreshedAt, loadSummary]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = products.filter((p) => p.is_active || q);
    if (!q) return list.filter((p) => p.is_active);
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, filter]);

  function addToCart(product: Product) {
    setCart((list) => {
      const existing = list.find((it) => it.productId === product.id);
      if (existing) {
        return list.map((it) => (it.productId === product.id ? { ...it, qty: it.qty + 1 } : it));
      }
      return [
        ...list,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.selling_price,
          qty: 1,
          color: product.color,
        },
      ];
    });
  }

  async function charge() {
    if (!cart.length || !driver) return;
    setCharging(true);
    setErr(null);
    try {
      const body = {
        driver,
        customer: customer.location,
        glovo,
        payStatus,
        items: cart.map((it) => ({ productId: it.productId, qty: it.qty })),
        notes: "",
      };
      const res = await api<{ ok: boolean; order: DispatchOrder }>("/api/orders", {
        method: "POST",
        body,
      });
      setSavedOrder(res.order);
      setSavedItems(
        cart.map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.unitPrice }))
      );
      setCart([]);
      setCustomer({ location: "", phone: "", address: "" });
      setRefreshedAt(Date.now());
      loadProducts();
      loadTodayOrders();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setCharging(false);
    }
  }

  function doPrint() {
    if (!savedOrder) return;
    printReceipt(receiptFromOrder(savedOrder, { operator: me?.name || "POS" }));
  }

  function logout() {
    clearAuth();
    router.replace("/");
  }

  const today = nairobiDate();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            W
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">MIST WATER AND GAS DISTRIBUTORS</div>
            <div className="text-[11px] text-slate-400 leading-tight">Sales Dispatch · {today}</div>
          </div>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <Link href="/pos" className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold">
              Sell
            </Link>
            <Link href="/restock" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Restock
            </Link>
            <Link href="/customers" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Customers
            </Link>
            {me?.role !== "rider" && (
              <Link href="/reports" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Reports
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
        <nav className="flex sm:hidden mt-1.5 gap-1 text-sm">
          <Link href="/pos" className="flex-1 text-center px-2 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold">
            Sell
          </Link>
          <Link href="/restock" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
            Restock
          </Link>
          <Link href="/customers" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
            Customers
          </Link>
          {me?.role !== "rider" && (
            <Link href="/reports" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Reports
            </Link>
          )}
        </nav>
      </header>

      {/* Financial strip */}
      {summary && (
        <section className="px-3 pt-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <StatCard label="Total Sales" value={money(summary.totalSales)} accent="text-emerald-400" />
            <StatCard label="Profit" value={money(summary.totalProfit)} accent="text-sky-400" />
            <StatCard label="Expenditure" value={money(summary.totalCost)} accent="text-rose-400" />
            <StatCard label="Glovo Comm" value={money(summary.glovoCommission)} accent="text-amber-400" />
            <StatCard label="Open" value={`${summary.pendingCount} pending`} accent="text-rose-300" />
          </div>
        </section>
      )}

      {err && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-bold">
          {err}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-3 p-3">
        {/* Ticket */}
        <section className="lg:order-1 order-2 h-[62vh] lg:h-auto lg:max-h-[calc(100vh-160px)] flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <SalesTicket
              items={cart}
              setItems={setCart}
              glovo={glovo}
              setGlovo={setGlovo}
              payStatus={payStatus}
              setPayStatus={setPayStatus}
              customer={customer}
              setCustomer={setCustomer}
              driver={driver}
              setDriver={setDriver}
              drivers={drivers}
              onCharge={charge}
              charging={charging}
              etimsOn={etimsOn}
              setEtimsOn={setEtimsOn}
              kraPin={kraPin}
              setKraPin={setKraPin}
            />
          </div>
        </section>

        {/* Today's Sales */}
        <section className="lg:order-1 order-3 flex flex-col min-h-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black mb-2">
            Today's Sales · {today}
          </h2>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
            {todayOrders.length === 0 && (
              <div className="text-center text-slate-600 text-sm py-6">
                No dispatches yet today.
              </div>
            )}
            {todayOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-100 truncate leading-tight">
                    {o.customer}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {o.time} · {o.driver} · {o.qty} item{o.qty === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-emerald-400">{money(o.total)}</div>
                  {me?.role !== "rider" && (
                    <div className="text-[11px] text-slate-500 font-bold">
                      +{money(o.profit)} profit
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {todayOrders.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-800 rounded-2xl bg-slate-900 p-3 space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-black">
                  Today's Total Gross Sales (Ksh)
                </span>
                <span className="text-lg font-black text-emerald-400">
                  {money(todayOrders.reduce((s, o) => s + o.total, 0))}
                </span>
              </div>
              {me?.role !== "rider" && (
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-black">
                    Today's Total Profit
                  </span>
                  <span className="text-lg font-black text-sky-400">
                    {money(todayOrders.reduce((s, o) => s + o.profit, 0))}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Product grid */}
        <section className="lg:order-2 order-1 flex flex-col min-h-0">
          <div className="flex gap-2 mb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search products…"
              className="flex-1 h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 outline-none text-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5 overflow-y-auto pr-1 pb-2">
            {visible.map((p) => {
              const inCart = cart.find((it) => it.productId === p.id)?.qty ?? 0;
              const low = p.stock <= 10 && p.stock > 0;
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => !out && addToCart(p)}
                  disabled={out}
                  style={{ backgroundColor: p.color }}
                  className={`relative rounded-2xl p-3 text-left text-white shadow-lg transition active:scale-[0.96] min-h-[104px] flex flex-col justify-between ${
                    out ? "opacity-40 saturate-0" : "hover:brightness-110"
                  }`}
                >
                  {inCart > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-slate-900 text-sky-300 border border-sky-400 text-xs font-black rounded-full w-6 h-6 flex items-center justify-center">
                      {inCart}
                    </span>
                  )}
                  <div>
                    <div className="text-sm font-black leading-tight drop-shadow">{p.name}</div>
                  </div>
                  <div>
                    <div className="text-xl font-black drop-shadow">{money(p.selling_price)}</div>
                    <div
                      className={`text-[11px] font-black mt-0.5 ${
                        out ? "text-white/80" : low ? "bg-black/40 rounded px-1 inline-block" : "text-white/80"
                      }`}
                    >
                      {out ? "OUT OF STOCK" : `${p.stock} ${p.unit} left`}
                    </div>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div className="col-span-full text-center text-slate-600 py-10 text-sm">No products found.</div>
            )}
          </div>
        </section>
      </div>

      {savedOrder && (
        <PrintPrompt
          order={savedOrder}
          items={savedItems}
          initialEtimsOn={etimsOn}
          initialKraPin={kraPin}
          onEtimsRegister={async (kraPin: string) => {
            const res = await api<{ ok: boolean; order: DispatchOrder }>(
              "/api/etims/register",
              { method: "POST", body: { orderId: savedOrder.id, items: savedItems, kraPin } }
            );
            const updated = res.order;
            setSavedOrder(updated);
            return updated;
          }}
          onPrint={doPrint}
          onClose={() => setSavedOrder(null)}
        />
      )}
    </main>
  );
}

function tryCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}