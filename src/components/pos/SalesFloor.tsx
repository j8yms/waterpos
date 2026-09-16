"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheCustomers, cacheProducts, clearAuth, currentUser, flushPendingOps } from "@/lib/client";
import type { CartItem, DashboardSummary, DispatchOrder, EtimsItem, PaymentMethod, Product } from "@/lib/types";
import { money, nairobiDate, computeTicket } from "@/lib/pricing";
import ProductSearch from "./ProductSearch";
import CustomerSearch from "./CustomerSearch";
import TransactionTable from "./TransactionTable";
import CommandMatrix from "./CommandMatrix";
import PrintPrompt from "./PrintPrompt";
import CheckoutModal from "./CheckoutModal";
import { StatCard } from "@/components/ui";
import { printReceipt, receiptFromOrder } from "@/lib/print";

export default function SalesFloor() {
  const router = useRouter();
  const me = currentUser();

  const [products, setProducts] = useState<Product[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [glovo, setGlovo] = useState(false);
  const [customer, setCustomer] = useState({ location: "", phone: "", address: "" });
  const [driver, setDriver] = useState("");
  const [charging, setCharging] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState<"CASH" | "MPESA" | null>(null);
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

  function addToCart(product: Product) {
    setCart((list) => {
      const existing = list.find((it) => it.productId === product.id);
      if (existing) {
        return list.map((it) => (it.productId === product.id ? { ...it, qty: it.qty + 1 } : it));
      }
      const next = [
        ...list,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.selling_price,
          qty: 1,
          color: product.color,
        },
      ];
      return next;
    });
  }

  function deleteLine() {
    setCart((list) => {
      const target = selected ?? list[list.length - 1]?.productId ?? null;
      if (!target) return list;
      setSelected((s) => (s === target ? null : s));
      return list.filter((it) => it.productId !== target);
    });
  }

  function voidOrder() {
    setCart([]);
    setSelected(null);
  }

  function openCheckout(method: "CASH" | "MPESA" | null) {
    if (!cart.length) return;
    setCheckoutMethod(method);
    setCheckoutOpen(true);
  }

  async function charge(payment: {
    paymentMethod: "CASH" | "MPESA";
    tendered: number;
    change: number;
    mpesaCode: string;
  }) {
    if (!cart.length || !driver) return;
    setCharging(true);
    setErr(null);
    // Glovo flips the payout mapping: the order is remitted via the Glovo
    // channel (PENDING until Glovo pays out) even though the till still
    // records the customer's actual tender (CASH or M-PESA).
    const glovoFlag = glovo;
    const payStatus: "PAID" | "PENDING" = glovoFlag ? "PENDING" : "PAID";
    try {
      const body = {
        driver,
        customer: customer.location,
        glovo: glovoFlag,
        paymentMethod: payment.paymentMethod,
        payStatus,
        mpesa_code: payment.mpesaCode || "",
        tendered: payment.tendered || 0,
        change: payment.change || 0,
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
      setSelected(null);
      setCustomer({ location: "", phone: "", address: "" });
      setDriver("");
      setCheckoutOpen(false);
      setGlovo(false);
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
  const isAdmin = me?.role === "management";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 pt-2">
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
            {isAdmin && (
              <Link href="/catalog" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Products
              </Link>
            )}
            {isAdmin && (
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
          {isAdmin && (
            <Link href="/catalog" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Products
            </Link>
          )}
          {isAdmin && (
            <Link href="/reports" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Reports
            </Link>
          )}
        </nav>

        {/* Top horizontal search banner (Aronium product search location) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_220px] gap-2 mt-2 pb-2 items-start">
          <ProductSearch products={products} onAdd={addToCart} />
          <CustomerSearch value={customer} onChange={setCustomer} />
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
              Assign Rider
            </label>
            <select
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="w-full h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
            >
              <option value="">Select rider…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
              <option value="WALK-IN">WALK-IN (no rider)</option>
            </select>
          </div>
        </div>
      </header>

      {/* Financial strip */}
      {summary && (
        <section className="px-3 pt-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <StatCard label="Total Sales" value={money(summary.totalSales)} accent="text-emerald-400" />
            {isAdmin ? (
              <StatCard label="Profit" value={money(summary.totalProfit)} accent="text-sky-400" />
            ) : (
              <StatCard label="Dispatches" value={`${summary.ordersCount}`} accent="text-sky-400" />
            )}
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

      {/* Aronium split-screen body: 60% transaction table / 40% command matrix */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 p-3">
        <div className="flex flex-col min-h-0 gap-3 lg:h-[calc(100vh-280px)]">
          <div className="flex-1 min-h-0">
            <TransactionTable
              items={cart}
              setItems={setCart}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          {/* Today's Sales feed */}
          <div className="h-44 shrink-0 flex flex-col min-h-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black mb-2">
              Today's Sales · {today}
            </h2>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
              {todayOrders.length === 0 && (
                <div className="text-center text-slate-600 text-sm py-4">
                  No dispatches yet today.
                </div>
              )}
              {todayOrders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800"
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
                    {isAdmin && (
                      <div className="text-[11px] text-slate-500 font-bold">
                        +{money(o.profit)} profit
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {todayOrders.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800 flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-black">
                  Today's Gross Sales
                </span>
                <span className="text-lg font-black text-emerald-400">
                  {money(todayOrders.reduce((s, o) => s + o.total, 0))}
                </span>
              </div>
            )}
          </div>
        </div>

        <CommandMatrix
          hasItems={cart.length > 0}
          selected={selected}
          glovo={glovo}
          onToggleGlovo={() => setGlovo((v) => !v)}
          onPayment={() => openCheckout(null)}
          onCash={() => openCheckout("CASH")}
          onMpesa={() => openCheckout("MPESA")}
          onDelete={deleteLine}
          onVoid={voidOrder}
          etimsOn={etimsOn}
          setEtimsOn={setEtimsOn}
          kraPin={kraPin}
          setKraPin={setKraPin}
          showAdmin={isAdmin}
        />
      </div>

      {checkoutOpen && (
        <CheckoutModal
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          onRegister={charge}
          charging={charging}
          total={computeTicket(cart, glovo).subtotal}
          glovo={glovo}
          setGlovo={setGlovo}
          etimsOn={etimsOn}
          setEtimsOn={setEtimsOn}
          kraPin={kraPin}
          setKraPin={setKraPin}
          initialMethod={checkoutMethod}
        />
      )}

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