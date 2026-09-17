/**
 * Client-side JSON store for static (GitHub Pages) mode.
 *
 * Replaces every /api/* fetch with localStorage + seed.json data.
 * Seed data provides the initial snapshot; every mutation persists to
 * localStorage so sales survive page reloads without a server.
 *
 * Activated when NEXT_PUBLIC_STATIC=true (set in .env.local for the
 * Pages build, absent in the server/dev build so api() falls through
 * to normal fetch).
 */
import type {
  AuthSession,
  Customer,
  DashboardSummary,
  DispatchOrder,
  Product,
  Role,
  StaffMember,
  User,
} from "./types";
import { MASTER_ADMIN, MASTER_PIN } from "./config";

/* ── seed JSON (bundled at build) ─────────────────────────────────────────── */
import seed from "../data/seed.json";

/* ── localStorage keys ────────────────────────────────────────────────────── */
const PRODUCTS_KEY = "waterpos.static.products";
const CUSTOMERS_KEY = "waterpos.static.customers";
const STAFF_KEY = "waterpos.static.staff";
const ORDERS_KEY = (date: string) => `waterpos.static.orders.${date}`;

/* ── helpers ──────────────────────────────────────────────────────────────── */
function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Nairobi",
  });
}

function timeStr(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Africa/Nairobi",
  });
}

/* ── data accessors ───────────────────────────────────────────────────────── */
export function getProducts(): Product[] {
  return readLS<Product[]>(PRODUCTS_KEY) ?? (seed.products as Product[]);
}
export function setProducts(list: Product[]): void {
  writeLS(PRODUCTS_KEY, list);
}

export function getCustomers(): Customer[] {
  return readLS<Customer[]>(CUSTOMERS_KEY) ?? (seed.customers as Customer[]);
}
export function setCustomers(list: Customer[]): void {
  writeLS(CUSTOMERS_KEY, list);
}

interface StaffRow {
  id: string;
  name: string;
  role: string;
  pin?: string;
  active?: boolean | string;
  is_reset_pending?: boolean | string;
}

export function getStaff(): StaffRow[] {
  return readLS<StaffRow[]>(STAFF_KEY) ?? (seed.staff as StaffRow[]);
}
export function setStaff(list: StaffRow[]): void {
  writeLS(STAFF_KEY, list);
}

function isPending(s: StaffRow): boolean {
  return String(s.is_reset_pending ?? "").trim().toUpperCase() === "TRUE" || s.is_reset_pending === true;
}

/** Admin directory view — identical shape to the live /api/staff response. */
export function getStaffDirectory(): StaffMember[] {
  return getStaff()
    .filter((s) => String(s.active ?? "TRUE").toUpperCase() !== "FALSE")
    .filter((s) => String(s.role).toLowerCase() !== "master")
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: (String(s.role).toLowerCase() === "rider" ? "rider" : "management") as Role,
      is_reset_pending: isPending(s),
    }));
}

export function getOrders(date?: string): DispatchOrder[] {
  const d = date ?? todayStr();
  return readLS<DispatchOrder[]>(ORDERS_KEY(d)) ?? [];
}
export function setOrders(date: string, list: DispatchOrder[]): void {
  writeLS(ORDERS_KEY(date), list);
}

/* ── simple HMAC-free auth (static mock) ─────────────────────────────────── */
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
}

function buildToken(user: User): AuthSession {
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  return { token: `${b64url({ sub: user.id, role: user.role, exp })}.static`, user, exp };
}

export function loginPin(pin: string): AuthSession | null {
  if (pin === MASTER_PIN) {
    return buildToken({ id: MASTER_ADMIN.id, name: MASTER_ADMIN.name, role: "master" });
  }
  const staff = getStaff();
  const match = staff.find(
    (s) =>
      s.pin === pin &&
      !isPending(s) &&
      String(s.active ?? "TRUE").toUpperCase() !== "FALSE" &&
      String(s.role).toLowerCase() !== "master",
  );
  if (!match) return null;
  const role: Role =
    String(match.role).toLowerCase() === "rider" ? "rider" : "management";
  const user: User = { id: match.id, name: match.name, role };
  return buildToken(user);
}

/** Named login mirroring POST /api/auth/login (identity + PIN). */
export function loginIdentity(
  name: string,
  pin: string,
): AuthSession | { requiresSetup: true; name: string } | null {
  if (pin === MASTER_PIN) {
    return buildToken({ id: MASTER_ADMIN.id, name: MASTER_ADMIN.name, role: "master" });
  }
  const match = getStaff().find(
    (s) => s.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!match) return null;
  if (isPending(match)) return { requiresSetup: true, name: match.name };
  if (String(match.active ?? "TRUE").toUpperCase() === "FALSE") return null;
  if (match.pin !== pin) return null;
  const role: Role =
    String(match.role).toLowerCase() === "rider" ? "rider" : "management";
  return buildToken({ id: match.id, name: match.name, role });
}

/** Self-service PIN registration mirroring POST /api/auth/reset-pin. */
export function resetStaffPin(
  name: string,
  pin: string,
): AuthSession | { error: string } {
  if (!/^\d{4}$/.test(pin)) return { error: "PIN must be exactly 4 digits." };
  if (pin === MASTER_PIN) return { error: "That PIN is reserved. Choose another." };

  const staff = getStaff();
  const idx = staff.findIndex(
    (s) => s.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (idx < 0) return { error: "Worker not found." };
  if (!isPending(staff[idx])) return { error: "No PIN reset is pending for this worker." };

  const collision = staff.some((s, i) => i !== idx && s.pin === pin);
  if (collision) return { error: "That PIN is already in use. Choose another." };

  staff[idx] = { ...staff[idx], pin, is_reset_pending: false };
  setStaff(staff);

  const role: Role =
    String(staff[idx].role).toLowerCase() === "rider" ? "rider" : "management";
  return buildToken({ id: staff[idx].id, name: staff[idx].name, role });
}

/** Clear a worker's PIN and flag their record for self-service reset. */
export function resetPinForStaff(id: string): boolean {
  const staff = getStaff();
  const idx = staff.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  staff[idx] = { ...staff[idx], pin: "", is_reset_pending: true };
  setStaff(staff);
  return true;
}

/* ── dashboard ────────────────────────────────────────────────────────────── */
export function getDashboard(date?: string): DashboardSummary {
  const orders = getOrders(date);
  const d = date ?? todayStr();
  let totalSales = 0;
  let totalCost = 0;
  let totalProfit = 0;
  let glovoCommission = 0;
  let paidCount = 0;
  let pendingCount = 0;

  for (const o of orders) {
    totalSales += o.total;
    totalProfit += o.profit;
    if (o.pay_status === "PAID") paidCount++;
    else pendingCount++;
  }
  return {
    date: d,
    totalSales,
    totalCost: totalSales - totalProfit - glovoCommission,
    totalProfit,
    glovoCommission,
    paidCount,
    pendingCount,
    ordersCount: orders.length,
  };
}

/* ── create order ─────────────────────────────────────────────────────────── */
export function createOrder(body: {
  customer?: string;
  phone?: string;
  address?: string;
  product?: string;
  qty?: number;
  unit_price?: number;
  total?: number;
  glovo?: boolean;
  pay_status?: "PAID" | "PENDING";
  payment_method?: "CASH" | "MPESA" | "GLOVO" | "CREDIT" | "";
  mpesa_code?: string;
  driver?: string;
  profit?: number;
  notes?: string;
}): DispatchOrder {
  const d = todayStr();
  const order: DispatchOrder = {
    id: `ORD-${d.replace(/-/g, "")}-${Date.now().toString(36)}`,
    date: d,
    time: timeStr(),
    customer: body.customer ?? "Walk-in",
    phone: body.phone ?? "",
    address: body.address ?? "",
    product: body.product ?? "",
    qty: body.qty ?? 0,
    unit_price: body.unit_price ?? 0,
    total: body.total ?? (body.qty ?? 0) * (body.unit_price ?? 0),
    glovo: !!body.glovo,
    pay_status: body.pay_status ?? "PENDING",
    payment_method: body.payment_method ?? "",
    mpesa_code: body.mpesa_code ?? "",
    driver: body.driver ?? "",
    profit: body.profit ?? 0,
    notes: body.notes ?? "",
    created_at: new Date().toISOString(),
  };
  const orders = getOrders(d);
  orders.push(order);
  setOrders(d, orders);
  return order;
}

/* ── patch order (pay_status, driver, etims fields, etc.) ─────────────────── */
export function patchOrder(
  orderId: string,
  changes: Partial<DispatchOrder>,
): DispatchOrder | null {
  const d = todayStr();
  const orders = getOrders(d);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...changes };
  setOrders(d, orders);
  return orders[idx];
}

/* ── restock ──────────────────────────────────────────────────────────────── */
export function restock(
  productId: string,
  addedUnits: number,
  newCost?: number,
  newPrice?: number,
): Product | null {
  const products = getProducts();
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) return null;
  products[idx] = {
    ...products[idx],
    stock: products[idx].stock + addedUnits,
    wholesale_cost: newCost ?? products[idx].wholesale_cost,
    selling_price: newPrice ?? products[idx].selling_price,
  };
  setProducts(products);
  return products[idx];
}

/* ── eTIMS (client-side mock — deterministic, no network) ─────────────────── */
const MOCK_BASE = 9900000000;

function deterministicInv(orderId: string, n: number): string {
  const h = [...orderId].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return String(MOCK_BASE + Math.abs(h) + n).padStart(12, "0");
}

export function registerEtimsStatic(
  order: DispatchOrder,
  items?: { name: string; qty: number; unitPrice: number }[],
): {
  ok: boolean;
  order: DispatchOrder;
  invoice: { invoiceNumber: string; cuSerialNumber: string; verificationUrl: string };
} {
  const invNum = deterministicInv(order.id, 1);
  const cuSerial = `CU-${invNum.slice(-8)}`;
  const url = `https://mock.etims.kra.go.ke/verify/${invNum}`;

  const updated = patchOrder(order.id, {
    etims_num: invNum,
    cu_serial: cuSerial,
    etims_url: url,
  }) ?? order;

  return { ok: true, order: updated, invoice: { invoiceNumber: invNum, cuSerialNumber: cuSerial, verificationUrl: url } };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * api() router — intercepts /api/* calls and routes to store
 * Called by api() in client.ts when NEXT_PUBLIC_STATIC=true
 * ───────────────────────────────────────────────────────────────────────────── */
export function staticApiRoute<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): T {
  const method = (options.method ?? "GET").toUpperCase();
  const body = options.body as Record<string, unknown> | undefined;

  // Strip query string for matching
  const [path] = url.split("?");
  const qs = url.includes("?") ? url.split("?")[1] : "";

  // ─── GET /api/pos/products ───
  if (method === "GET" && path === "/api/pos/products") {
    return { products: getProducts() } as T;
  }

  // ─── GET /api/pos/customers ───
  if (method === "GET" && path === "/api/pos/customers") {
    const q = qs.includes("q=") ? decodeURIComponent(qs.split("q=")[1]) : "";
    let list = getCustomers().filter((c) => c.is_active !== false);
    if (q) {
      const ql = q.toLowerCase();
      list = list.filter(
        (c) =>
          c.location.toLowerCase().includes(ql) ||
          c.phone.includes(ql) ||
          c.address.toLowerCase().includes(ql),
      );
    }
    return { customers: list } as T;
  }

  // ─── POST /api/pos/customers (add) / action "deleteCustomer" (purge) ───
  if (method === "POST" && path === "/api/pos/customers" && body) {
    if (body.action === "deleteCustomer") {
      const list = getCustomers().filter((c) => c.id !== body.id);
      setCustomers(list);
      return { ok: true, deleted: body.id } as T;
    }
    const list = getCustomers();
    const newC: Customer = {
      id: `cust-${Date.now().toString(36)}`,
      location: String(body.location ?? ""),
      phone: String(body.phone ?? ""),
      address: String(body.address ?? ""),
      notes: String(body.notes ?? ""),
      is_active: true,
    };
    list.push(newC);
    setCustomers(list);
    return { ok: true, customer: newC } as T;
  }

  // ─── PATCH /api/pos/customers (toggle active) ───
  if (method === "PATCH" && path === "/api/pos/customers" && body) {
    const list = getCustomers();
    const idx = list.findIndex((c) => c.id === body.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], is_active: (body.is_active as boolean) ?? !list[idx].is_active };
      setCustomers(list);
    }
    return { ok: true } as T;
  }

  // ─── GET /api/auth/identities (public roster for the login canvas) ───
  if (method === "GET" && path === "/api/auth/identities") {
    return { staff: getStaffDirectory() } as T;
  }

  // ─── GET /api/staff ───
  if (method === "GET" && path === "/api/staff") {
    return { staff: getStaffDirectory() } as T;
  }

  // ─── POST /api/staff (action: resetPin) ───
  if (method === "POST" && path === "/api/staff" && body) {
    const id = String(body.id ?? "");
    if (body.action !== "resetPin" || !id) return { error: "Unsupported action." } as T;
    const target = getStaffDirectory().find((s) => s.id === id);
    if (!target) return { error: "Staff member not found." } as T;
    resetPinForStaff(id);
    return { ok: true, id, name: target.name, is_reset_pending: true } as T;
  }

  // ─── GET /api/dashboard ───
  if (method === "GET" && path === "/api/dashboard") {
    return getDashboard() as T;
  }

  // ─── POST /api/orders (create) ───
  if (method === "POST" && path === "/api/orders" && body) {
    const order = createOrder(body as Parameters<typeof createOrder>[0]);
    return { ok: true, order } as T;
  }

  // ─── PATCH /api/orders/[id] ───
  if (method === "PATCH" && path.startsWith("/api/orders/")) {
    const orderId = path.split("/api/orders/")[1];
    if (orderId && body) {
      const updated = patchOrder(orderId, body as Partial<DispatchOrder>);
      if (updated) return { ok: true, order: updated } as T;
    }
    return { error: "Order not found" } as T;
  }

  // ─── POST /api/restock ───
  if (method === "POST" && path === "/api/restock" && body) {
    const p = restock(
      String(body.productId ?? ""),
      Number(body.addedUnits ?? 0),
      body.newCost != null ? Number(body.newCost) : undefined,
      body.newPrice != null ? Number(body.newPrice) : undefined,
    );
    if (p) return { ok: true, product: p } as T;
    return { error: "Product not found" } as T;
  }

  // ─── POST /api/auth/login ───
  if (method === "POST" && path === "/api/auth/login" && body) {
    const name = String(body.name ?? "").trim();
    const pin = String(body.pin ?? "");
    const result = name ? loginIdentity(name, pin) : loginPin(pin);
    if (result && "requiresSetup" in result) return result as T;
    if (result && "token" in result) return result as T;
    return { error: "Invalid credentials." } as T;
  }

  // ─── POST /api/auth/reset-pin ───
  if (method === "POST" && path === "/api/auth/reset-pin" && body) {
    const name = String(body.name ?? "").trim();
    const pin = String(body.pin ?? "");
    const confirm = String(body.confirm ?? "");
    if (confirm && confirm !== pin) return { error: "PIN entries do not match." } as T;
    return resetStaffPin(name, pin) as T;
  }

  // ─── POST /api/etims/register ───
  if (method === "POST" && path === "/api/etims/register" && body) {
    const orderId = String(body.orderId ?? "");
    const orders = getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { error: "Order not found" } as T;
    return registerEtimsStatic(order, body.items as { name: string; qty: number; unitPrice: number }[]) as T;
  }

  // ─── POST /api/repayments (action: logRepayment) ───
  if (method === "POST" && path === "/api/repayments" && body) {
    const customer = String(body.customer ?? "").trim().toLowerCase();
    const amount = Number(body.amount || 0);
    if (!customer || !(amount > 0)) return { error: "Customer and amount required." } as T;
    let applied = 0;
    const settledRows: string[] = [];
    // Scan every stored day's orders (static mode has no cross-day aggregation helper).
    const allKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("waterpos.static.orders.")) allKeys.push(k.replace("waterpos.static.orders.", ""));
    }
    if (!allKeys.includes(todayStr())) allKeys.push(todayStr());
    for (const d of allKeys) {
      const orders = getOrders(d);
      let changed = false;
      for (const o of orders) {
        if (applied >= amount) break;
        if (o.pay_status !== "PENDING") continue;
        if (String(o.customer).trim().toLowerCase() !== customer) continue;
        const pay = Math.min(o.total, amount - applied);
        applied += pay;
        o.pay_status = "PAID";
        changed = true;
        settledRows.push(o.id);
      }
      if (changed) setOrders(d, orders);
    }
    return { ok: true, applied, excess: Math.max(0, amount - applied), settledRows } as T;
  }

  // ─── GET /api/reports (static snapshot) ───
  if (method === "GET" && path === "/api/reports") {
    const orders: DispatchOrder[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("waterpos.static.orders.")) {
        const d = k.replace("waterpos.static.orders.", "");
        orders.push(...getOrders(d));
      }
    }
    if (!orders.length && !getOrders().length) orders.push(...getOrders());

    const debts = buildStaticDebts(orders);
    const riderMatrix = buildStaticRiderMatrix(orders);
    const glovo = buildStaticGlovo(orders);
    const topSelling = buildStaticTopSelling(orders);
    return { debts, riderMatrix, glovo, topSelling } as T;
  }

  // ─── GET /api/notifications/public-key ───
  if (method === "GET" && path === "/api/notifications/public-key") {
    // No server in static mode — never registers push; return an empty key so
    // the client silently skips subscription capture.
    return { publicKey: "" } as T;
  }

  // ─── POST /api/notifications (subscribe/unsubscribe) ───
  if (method === "POST" && path === "/api/notifications") {
    return { ok: true } as T;
  }

  // ─── fallback: unknown route ───
  throw new Error(`Static mode: unknown route ${method} ${path}`);
}

/* ── static reports helpers (mirror of /api/reports) ──────────────────────── */
function buildStaticDebts(orders: DispatchOrder[]): unknown[] {
  const groups = new Map<string, unknown>();
  for (const o of orders) {
    const isRelevant = o.pay_status === "PENDING" || String(o.payment_method || "").toUpperCase() === "CREDIT";
    if (!isRelevant) continue;
    const key = String(o.customer || "WALK-IN CUSTOMER").trim();
    const g: any = groups.get(key) ?? { customer: key, phone: o.phone, house: o.address, numberOfRows: 0, outstanding: 0, rows: [] };
    g.rows.push({
      id: o.id,
      date: o.date,
      time: o.time,
      total: o.total,
      balance: Number(o.balance) > 0 ? o.balance : o.total,
      pay_status: o.pay_status,
      payment_method: o.payment_method,
      driver: o.driver,
    });
    g.numberOfRows = g.rows.length;
    g.outstanding += Number(o.balance) > 0 ? Number(o.balance) : o.total;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a: any, b: any) => b.outstanding - a.outstanding);
}

function buildStaticRiderMatrix(orders: DispatchOrder[]): unknown[] {
  const byDriver = new Map<string, any>();
  for (const o of orders) {
    const driver = String(o.driver || "UNASSIGNED");
    const cur = byDriver.get(driver) ?? { driver, tripsCompleted: 0, grossCashCollected: 0, activePendingDeliveries: 0, totalDispatches: 0 };
    cur.totalDispatches += 1;
    if (o.pay_status === "PAID") {
      cur.tripsCompleted += 1;
      if (String(o.payment_method || "").toUpperCase() === "CASH") cur.grossCashCollected += o.total;
    } else {
      cur.activePendingDeliveries += 1;
    }
    byDriver.set(driver, cur);
  }
  return [...byDriver.values()].sort((a, b) => b.totalDispatches - a.totalDispatches);
}

function buildStaticGlovo(orders: DispatchOrder[]): unknown {
  const gl = orders.filter((o) => o.glovo);
  const grossRevenue = Math.round(gl.reduce((s, o) => s + o.total, 0) * 100) / 100;
  const commissionOverhead = Math.round(gl.reduce((s, o) => s + (o.profit / 0.8 - o.profit), 0) * 100) / 100;
  return { orders: gl.length, grossRevenue, commissionOverhead, netYield: Math.round((grossRevenue - commissionOverhead) * 100) / 100 };
}

function buildStaticTopSelling(orders: DispatchOrder[]): unknown[] {
  const byName = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders) {
    for (const part of String(o.product || "").split("+")) {
      const m = part.trim().match(/^(\d+)\s*x\s*(.+)$/);
      if (!m) continue;
      const qty = parseInt(m[1], 10) || 1;
      const name = m[2].trim();
      if (!name) continue;
      const cur = byName.get(name) ?? { qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += (o.total * qty) / Math.max(1, o.qty);
      byName.set(name, cur);
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
}
