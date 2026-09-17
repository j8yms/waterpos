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
  User,
} from "./types";

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
}

export function getStaff(): StaffRow[] {
  return readLS<StaffRow[]>(STAFF_KEY) ?? (seed.staff as StaffRow[]);
}
export function setStaff(list: StaffRow[]): void {
  writeLS(STAFF_KEY, list);
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
  const staff = getStaff();
  const match = staff.find(
    (s) =>
      s.pin === pin &&
      String(s.active ?? "TRUE").toUpperCase() !== "FALSE",
  );
  if (!match) return null;
  const role: Role =
    String(match.role).toLowerCase() === "rider" ? "rider" : "management";
  const user: User = { id: match.id, name: match.name, role };
  return buildToken(user);
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

  // ─── POST /api/pos/customers (add) ───
  if (method === "POST" && path === "/api/pos/customers" && body) {
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

  // ─── GET /api/staff ───
  if (method === "GET" && path === "/api/staff") {
    return { staff: getStaff() } as T;
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
    const session = loginPin(String(body.pin ?? ""));
    if (session) return session as T;
    return { error: "Invalid PIN" } as T;
  }

  // ─── POST /api/etims/register ───
  if (method === "POST" && path === "/api/etims/register" && body) {
    const orderId = String(body.orderId ?? "");
    const orders = getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { error: "Order not found" } as T;
    return registerEtimsStatic(order, body.items as { name: string; qty: number; unitPrice: number }[]) as T;
  }

  // ─── fallback: unknown route ───
  throw new Error(`Static mode: unknown route ${method} ${path}`);
}
