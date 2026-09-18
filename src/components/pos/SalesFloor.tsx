"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheProducts, clearAuth, currentUser, flushPendingOps } from "@/lib/client";
import type { CartItem, DashboardSummary, DispatchOrder, EtimsItem, Product } from "@/lib/types";
import { money, nairobiDate, computeTicket, parseProductLine } from "@/lib/pricing";
import { DEFAULT_RIDERS, canManageStaff } from "@/lib/config";
import ProductSearch from "./ProductSearch";
import TransactionTable from "./TransactionTable";
import CommandMatrix from "./CommandMatrix";
import PrintPrompt from "./PrintPrompt";
import CheckoutModal from "./CheckoutModal";
import { StatCard } from "@/components/ui";
import { printToNetwork, receiptFromOrder } from "@/lib/print";

const WALK_IN = "WALK-IN";

export default function SalesFloor() {
  const router = useRouter();
  const me = currentUser();

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [glovo, setGlovo] = useState(false);
  const [customer, setCustomer] = useState({ location: "", phone: "", address: "" });
  const [driver, setDriver] = useState(WALK_IN);
  const [newRiderName, setNewRiderName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState<"CASH" | "MPESA" | "CREDIT" | null>(null);
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

  async function ringRider(rider: string) {
    if (!rider || rider === WALK_IN) return;
    try {
      await api("/api/riders/ring", { method: "POST", body: { rider, message: `New order ready for ${rider}` } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ring failed.");
    }
  }

  useEffect(() => {
    const cached = tryCache<Product[]>("waterpos.products");
    if (cached && cached.length) {
      setProducts(cached);
    }
    loadProducts();
    loadSummary();
    loadTodayOrders();
    flushPendingOps();
  }, [loadProducts, loadSummary, loadTodayOrders]);

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

  async function voidOrder() {
    if (editingId) {
      try {
        await api(`/api/orders/${editingId}`, { method: "DELETE" });
      } catch {
        /* void failure surfaced via reload below */
      }
      setEditingId(null);
      setRefreshedAt(Date.now());
      loadProducts();
    }
    setCart([]);
    setSelected(null);
    setCustomer({ location: "", phone: "", address: "" });
  }

  /** Reload a saved PENDING sale back into the active cart for edit/complete/void. */
  function reloadOrder(o: DispatchOrder) {
    const lines = products
      ? parseProductLine(o.product)
          .map((l) => {
            const product = products.find((p) => p.name.trim().toLowerCase() === l.name.trim().toLowerCase());
            return product
              ? { productId: product.id, name: product.name, unitPrice: product.selling_price, qty: l.qty, color: product.color }
              : null;
          })
          .filter((x): x is CartItem => x !== null)
      : [];
    if (!lines.length) return;
    setCart(lines);
    setSelected(null);
    setGlovo(o.glovo);
    setCustomer({ location: o.customer, phone: o.phone, address: o.address });
    setDriver(o.driver || WALK_IN);
    setNewRiderName("");
    setEditingId(o.id);
    setErr(null);
  }

  function openCheckout(method: "CASH" | "MPESA" | "CREDIT" | null) {
    if (!cart.length) return;
    setCheckoutMethod(method);
    setCheckoutOpen(true);
  }

  function riderIsSet(): boolean {
    const rider = driver === "NEW_RIDER" ? newRiderName.trim() : driver;
    return rider.length > 0;
  }

  async function charge(payment: {
    paymentMethod: "CASH" | "MPESA" | "CREDIT";
    tendered: number;
    change: number;
    mpesaCode: string;
    customerName: string;
    phone: string;
    location: string;
    print: boolean;
  }) {
    if (!cart.length || !riderIsSet() || charging) return;
    setCharging(true);
    setErr(null);
    const rider = driver === "NEW_RIDER" ? newRiderName.trim() : driver;
    // CREDIT (madeni) and GLOVO stay PENDING in the ledger.
    const glovoFlag = glovo;
    const payStatus: "PAID" | "PENDING" =
      payment.paymentMethod === "CREDIT" ? "PENDING" : glovoFlag ? "PENDING" : "PAID";
    try {
      const body = {
        driver: rider,
        customer: payment.customerName || payment.location || customer.location,
        phone: payment.phone || customer.phone,
        address: payment.location || customer.address,
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
      // If this cart was reloaded from a saved pending sale, purge the
      // superseded ledger row so no duplicate quantities linger.
      if (editingId && editingId !== res.order.id) {
        try {
          await api(`/api/orders/${editingId}`, { method: "DELETE" });
        } catch {
          /* superseded row already gone — ignore */
        }
      }
      if (payment.print) {
        setSavedOrder(res.order);
        setSavedItems(cart.map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.unitPrice })));
      } else {
        setSavedOrder(null);
        setSavedItems([]);
      }
      setCart([]);
      setSelected(null);
      setCustomer({ location: "", phone: "", address: "" });
      setDriver(WALK_IN);
      setNewRiderName("");
      setEditingId(null);
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

  async function doPrint() {
    if (!savedOrder) return;
    await printToNetwork(receiptFromOrder(savedOrder, { operator: me?.name || "POS" }));
  }

  function logout() {
    clearAuth();
    router.replace("/");
  }

  const today = nairobiDate();
  const isAdmin = me?.role === "management" || me?.role === "master";
  const canStaff = canManageStaff(me);

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
            {canStaff && (
              <Link href="/staff" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Staff
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
          {canStaff && (
            <Link href="/staff" className="flex-1 text-center px-2 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Staff
            </Link>
          )}
        </nav>

        {/* Top horizontal search banner: product search + rider assignment only */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-2 mt-2 pb-2 items-start">
          <ProductSearch products={products} onAdd={addToCart} />
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
              Assign Rider
            </label>
            <div className="flex gap-2">
              <select
                value={driver}
                onChange={(e) => {
                  const v = e.target.value;
                  setDriver(v);
                  if (v === "NEW_RIDER") setNewRiderName("");
                }}
                className="flex-1 h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
              >
                <option value={WALK_IN}>WALK-IN (no rider)</option>
                {DEFAULT_RIDERS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="NEW_RIDER">New rider…</option>
              </select>
              <button
                onClick={() => ringRider(driver)}
                disabled={driver === WALK_IN || driver === "NEW_RIDER"}
                className="h-12 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="Ring rider"
              >
                🔔 Ring
              </button>
            </div>
            {driver === "NEW_RIDER" && (
              <input
                value={newRiderName}
                onChange={(e) => setNewRiderName(e.target.value)}
                placeholder="Enter rider name"
                autoFocus
                className="mt-1.5 w-full h-11 px-3 rounded-xl bg-slate-900 border border-amber-600/50 focus:border-amber-500 outline-none text-slate-100 text-sm placeholder:text-slate-600"
              />
            )}
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
          driver={driver === "NEW_RIDER" ? newRiderName.trim() || "NEW_RIDER" : driver}
          initialCustomerName={customer.location}
          initialPhone={customer.phone}
          initialLocation={customer.address}
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

      {/* Today's Sales — full list at bottom */}
      <section className="p-3 lg:px-20">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black">
              Today's Sales · {today}
            </h2>
            {todayOrders.length > 0 && (
              <span className="text-lg font-black text-emerald-400">
                {money(todayOrders.reduce((s, o) => s + o.total, 0))}
              </span>
            )}
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {todayOrders.length === 0 ? (
              <div className="text-center text-slate-600 text-sm py-8">
                No dispatches yet today.
              </div>
            ) : (
              todayOrders.map((o) => {
                const pending = o.pay_status === "PENDING";
                return (
                  <div
                    key={o.id}
                    onClick={pending ? () => reloadOrder(o) : undefined}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${
                      pending
                        ? "border-amber-600/40 bg-amber-500/5 cursor-pointer hover:bg-amber-500/10"
                        : "border-slate-800 bg-slate-900"
                    } ${editingId === o.id ? "ring-1 ring-sky-400" : ""}`}
                    title={pending ? "Tap to reload this pending sale into the active cart" : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold truncate leading-tight ${pending ? "text-amber-200" : "text-slate-100"}`}>
                        {o.customer}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {o.time} · {o.driver} · {o.qty} item{o.qty === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-black ${pending ? "text-amber-300" : "text-emerald-400"}`}>
                        {money(o.total)}
                      </div>
                      {isAdmin && (
                        <div className="text-[11px] text-slate-500 font-bold">
                          +{money(o.profit)} profit
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await printToNetwork(receiptFromOrder(o, { operator: me?.name || "POS" }));
                      }}
                      className="shrink-0 w-9 h-9 rounded-lg bg-slate-800 hover:bg-sky-600 text-sky-300 hover:text-white text-sm transition active:scale-95"
                      title="Reprint receipt"
                      aria-label="Reprint receipt"
                    >
                      🖨️
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
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