import type { Product, Role } from "./types";

export const NAIROBI_TZ = "Africa/Nairobi";
export const GLOVO_COMMISSION = 0.2;

// The fixed assignment rider array shown on the Sales Floor, per the refactor
// spec. "New rider" is handled as a distinct dynamic option in the UI.
export const DEFAULT_RIDERS: string[] = ["Wajakoya"];
export const VAT_RATE = 0.16; // KRA VAT charged on the gross sale amount
export const TAX_CODE = "B"; // KRA item tax type: B = regular VAT

export const DEFAULT_PINS: Record<string, string> = {
  VINNIE: process.env.PIN_VINNIE || "2486",
  EMMA: process.env.PIN_EMMA || "1947",
  TRACY: process.env.PIN_TRACY || "9503",
  WAJAKOYA: process.env.PIN_WAFAKOYA || process.env.PIN_WAJAKOYA || "7721",
};

/**
 * Hidden master Super Admin (business owner).
 * - PIN 0800 permanently bypasses every standard employee pathway.
 * - Never written to the USERS sheet and never listed in any staff directory,
 *   so it stays invisible to Vinnie, Emma, Tracy and all riders.
 * - 0800 is reserved: it can never be assigned as another user's PIN.
 */
export const MASTER_PIN = "0800";
export const MASTER_ADMIN: { id: string; name: string; role: Role } = {
  id: "master-owner",
  name: "Owner",
  role: "master",
};

/** Staff Management (PIN reset panel) is limited to the hidden master (0800)
 *  and the named lead admin (Vinnie) only — not every management account. */
export const STAFF_MANAGER_NAMES: string[] = ["vinnie"];
export function canManageStaff(
  user: { name?: string; role?: Role } | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "master") return true;
  if (user.role !== "management") return false;
  return STAFF_MANAGER_NAMES.includes(String(user.name ?? "").trim().toLowerCase());
}

export const DEFAULT_STAFF: {
  id: string;
  name: string;
  role: Role;
  pin: string;
  is_reset_pending: boolean;
  isSuspended: boolean;
}[] = [
  { id: "vin", name: "Vinnie", role: "management", pin: DEFAULT_PINS.VINNIE, is_reset_pending: false, isSuspended: false },
  { id: "emm", name: "Emma", role: "management", pin: DEFAULT_PINS.EMMA, is_reset_pending: false, isSuspended: false },
  { id: "tra", name: "Tracy", role: "management", pin: DEFAULT_PINS.TRACY, is_reset_pending: false, isSuspended: false },
  { id: "waj", name: "Wajakoya", role: "rider", pin: DEFAULT_PINS.WAJAKOYA, is_reset_pending: false, isSuspended: false },
];

export const DEFAULT_PRODUCTS: Product[] = [
  { id: "q189", name: "QUENCHER 18.9L", selling_price: 550, wholesale_cost: 350, unit: "Btl", color: "#0ea5e9", stock: 120, is_active: true },
  { id: "q500", name: "QUENCHER 500ML", selling_price: 40, wholesale_cost: 24, unit: "Pkt", color: "#22c55e", stock: 300, is_active: true },
  { id: "cq189", name: "COOL RUNNER 18.9L", selling_price: 500, wholesale_cost: 320, unit: "Btl", color: "#f59e0b", stock: 80, is_active: true },
  { id: "pc750", name: "PURE CHILL 750ML", selling_price: 60, wholesale_cost: 40, unit: "Btl", color: "#8b5cf6", stock: 200, is_active: true },
  { id: "st189", name: "STILL 18.9L", selling_price: 480, wholesale_cost: 310, unit: "Btl", color: "#14b8a6", stock: 60, is_active: true },
  { id: "sp1", name: "SPARKLING 1L", selling_price: 90, wholesale_cost: 60, unit: "Btl", color: "#ec4899", stock: 140, is_active: true },
  { id: "q600", name: "QUENCHER 600ML", selling_price: 50, wholesale_cost: 30, unit: "Btl", color: "#f43f5e", stock: 250, is_active: true },
  { id: "cool500", name: "COOL RUNNER 500ML", selling_price: 35, wholesale_cost: 20, unit: "Pkt", color: "#eab308", stock: 220, is_active: true },
];

export const DEFAULT_CUSTOMERS: { location: string; phone: string; address: string; notes: string }[] = [
  { location: "MARINA BAY (Regular)", phone: "0700000001", address: "Marina Bay, House 12", notes: "" },
  { location: "MOMBASA ROAD (Regular)", phone: "0700000002", address: "Mombasa Rd, Gate 4", notes: "" },
  { location: "WESTLANDS (Walk-in)", phone: "0700000003", address: "Westlands, Ragati Rd", notes: "" },
  { location: "KIAMBU (Weekly)", phone: "0700000004", address: "Kiambu Town, Kenyatta Ave", notes: "" },
  { location: "KAHAWA (Regular)", phone: "0700000005", address: "Kahawa Wendani", notes: "" },
];

export const LEDGER_HEADERS: string[] = [
  "id",
  "date",
  "time",
  "customer",
  "phone",
  "address",
  "product",
  "qty",
  "unit_price",
  "total",
  "glovo",
  "pay_status",
  "driver",
  "profit",
  "mpesa_code",
  "notes",
  "etims_num",
  "cu_serial",
  "etims_url",
  "created_at",
  "payment_method",
  // Debt-repayment tracking: remaining balance on the ledger row plus the
  // ISO timestamp of the last recorded repayment ("" = never repaid).
  "balance",
  "last_payment_at",
];

export const TABS: Record<string, string[]> = {
  PRODUCTS: ["id", "name", "selling_price", "wholesale_cost", "unit", "color", "stock", "is_active", "updated_at"],
  CUSTOMERS: ["id", "location", "phone", "address", "notes", "is_active", "updated_at"],
  // ORDERS is the live dispatch ledger; OUT is the legacy tab earlier
  // spreadsheet versions used. Both share the same layout so reads,
  // writes and the M-PESA matcher stay correct regardless of which tab
  // a row lives in.
  ORDERS: LEDGER_HEADERS,
  OUT: LEDGER_HEADERS,
  USERS: ["id", "name", "pin", "role", "active", "is_reset_pending", "isSuspended"],
  IN: ["id", "date", "time", "product_id", "product", "qty_added", "unit_cost", "new_price", "operator", "created_at"],
  // REPAYMENTS is the cash/M-Pesa cash-flow log appended to on every
  // recorded debt repayment (action "logRepayment").
  REPAYMENTS: ["id", "date", "time", "customer", "order_id", "amount", "method", "notes", "created_at"],
  // SUBSCRIPTIONS stores one row per rider device that opted into Web-Push
  // dispatch alerts (rider, endpoint, p256dh, auth).
  SUBSCRIPTIONS: ["rider", "endpoint", "p256dh", "auth", "created_at"],
};

export const SEED_TABS = ["PRODUCTS", "CUSTOMERS", "ORDERS", "USERS", "IN", "REPAYMENTS", "SUBSCRIPTIONS"];