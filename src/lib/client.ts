import type { AuthSession, Customer, DispatchOrder, Product, User } from "./types";

const AUTH_KEY = "waterpos.auth";
const PRODUCTS_KEY = "waterpos.products";
const CUSTOMERS_KEY = "waterpos.customers";
const ORDERS_KEY = (date: string) => `waterpos.orders.${date}`;
const QUEUE_KEY = "waterpos.queue";
const STAFF_KEY = "waterpos.staff";
const SCHEMA_VERSION_KEY = "waterpos.schema_version";
const CURRENT_SCHEMA_VERSION = 3; // Bump to clear stale Macharia/Kamau staff data

/** Run one-time migrations to clear stale cached data. */
function runMigrations(): void {
  if (typeof window === "undefined") return;
  try {
    const storedVersion = parseInt(localStorage.getItem(SCHEMA_VERSION_KEY) || "0", 10);
    if (storedVersion >= CURRENT_SCHEMA_VERSION) return;

    if (storedVersion < 3) {
      // v3: Remove deleted staff (Macharia, Kamau) from cached staff data
      try {
        const raw = localStorage.getItem("waterpos.staff");
        if (raw) {
          const staff = JSON.parse(raw);
          const validNames = ["Vinnie", "Emma", "Tracy", "Wajakoya"];
          const filtered = Array.isArray(staff)
            ? staff.filter((s: any) => s?.name && validNames.includes(s.name))
            : [];
          localStorage.setItem("waterpos.staff", JSON.stringify(filtered));
        }
      } catch {
        localStorage.removeItem("waterpos.staff");
      }
    }

    localStorage.setItem(SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION));
  } catch {
    // If migration fails, clear everything to prevent crashes
    localStorage.clear();
  }
}

// Run migrations immediately on module load (client-side only)
if (typeof window !== "undefined") {
  runMigrations();
}

export interface StoredAuth {
  token: string;
  user: User;
  exp: number;
}

export function loadAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredAuth;
    if (session.exp < Date.now() / 1000) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveAuth(session: AuthSession): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("waterpos:auth"));
  }
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function currentUser(): User | null {
  return loadAuth()?.user ?? null;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode: cache silently disabled
  }
}

interface QueueOp {
  id: string;
  url: string;
  method: string;
  body: unknown;
  createdAt: number;
}

const QUEUE_OPS_KEY = "waterpos.pendingOps";

export function enqueueOfflineOp(url: string, method: string, body: unknown): void {
  try {
    const ops: QueueOp[] = JSON.parse(localStorage.getItem(QUEUE_OPS_KEY) || "[]");
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ops.push({ id, url, method, body, createdAt: Date.now() });
    localStorage.setItem(QUEUE_OPS_KEY, JSON.stringify(ops));
  } catch {
    /* noop */
  }
}

/**
 * Retry any locally queued offline operations once connectivity is back.
 * Returns true if every queued op succeeded.
 */
export async function flushPendingOps(): Promise<boolean> {
  const ops = getQueuedOps();
  if (!ops.length) return true;
  let allOk = true;
  for (const op of ops) {
    try {
      await api(op.url, { method: op.method, body: op.body });
      clearQueuedOp(op.id);
    } catch {
      allOk = false;
      break;
    }
  }
  return allOk;
}

export function getQueuedOps(): QueueOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_OPS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearQueuedOp(id: string): void {
  try {
    const ops = getQueuedOps().filter((o) => o.id !== id);
    localStorage.setItem(QUEUE_OPS_KEY, JSON.stringify(ops));
  } catch {
    /* noop */
  }
}

export async function api<T = any>(
  url: string,
  options: { method?: string; body?: unknown; silent?: boolean } = {}
): Promise<T> {
  /* ── static / GitHub Pages mode: route to JSON store, no server needed ── */
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_STATIC === "true"
  ) {
    try {
      const { staticApiRoute } = await import("./store");
      return staticApiRoute<T>(url, { method: options.method, body: options.body });
    } catch (err) {
      throw new Error(
        "Static mode store import failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  const session = loadAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    if (options.method && options.method !== "GET") {
      enqueueOfflineOp(url, options.method, options.body);
    }
    throw new Error("Network unavailable: change queued locally and will retry.");
  }

  if (!res.ok && res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") {
      window.location.replace("/?expired=1");
    }
    throw new Error("Session expired. Please sign in again.");
  }

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status}).`);
  }
  return data as T;
}

export function cacheProducts(list: Product[]): void {
  writeCache(PRODUCTS_KEY, list);
}
export function cachedProducts(): Product[] | null {
  return readCache<Product[]>(PRODUCTS_KEY);
}

export function cacheCustomers(list: Customer[]): void {
  writeCache(CUSTOMERS_KEY, list);
}
export function cachedCustomers(): Customer[] | null {
  return readCache<Customer[]>(CUSTOMERS_KEY);
}

export function cacheOrders(date: string, orders: DispatchOrder[]): void {
  writeCache(ORDERS_KEY(date), orders);
}
export function cachedOrders(date: string): DispatchOrder[] | null {
  return readCache<DispatchOrder[]>(ORDERS_KEY(date));
}

export function cacheAssignments(orders: Partial<DispatchOrder>[]): void {
  writeCache(QUEUE_KEY, orders);
}
export function cachedAssignments(): Partial<DispatchOrder>[] | null {
  return readCache<Partial<DispatchOrder>[]>(QUEUE_KEY);
}