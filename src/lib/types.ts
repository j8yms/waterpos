export type Role = "management" | "rider" | "master";

export interface User {
  id: string;
  name: string;
  role: Role;
}

/** A staff record as shown in the Admin staff directory (never includes the
 *  hidden master account, and never exposes the PIN itself). */
export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  pin: string;
  is_reset_pending: boolean;
  isSuspended: boolean;
}

export interface AuthSession {
  token: string;
  user: User;
  exp: number;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  selling_price: number;
  wholesale_cost: number;
  unit: string;
  color: string;
  stock: number;
  min_stock?: number;
  description?: string;
  is_active: boolean;
  source_id?: string;
}

export interface Customer {
  id: string;
  location: string;
  phone: string;
  address: string;
  notes: string;
  is_active: boolean;
  source_id?: string;
}

export interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  color: string;
}

export type PayStatus = "PAID" | "PENDING" | "ON_TRANSIT" | "REJECTED";

export type PaymentMethod = "CASH" | "MPESA" | "GLOVO" | "CREDIT";

export interface DispatchOrder {
  id: string;
  date: string;
  time: string;
  customer: string;
  phone: string;
  address: string;
  product: string;
  qty: number;
  unit_price: number;
  total: number;
  glovo: boolean;
  pay_status: PayStatus;
  payment_method: PaymentMethod | "";
  driver: string;
  profit: number;
  mpesa_code: string;
  notes: string;
  created_at: string;
  etims_num?: string;
  cu_serial?: string;
  etims_url?: string;
  // Debt-repayment bookkeeping — remaining balance on a PENDING/CREDIT row
  // ("" / missing means "as yet unsettled", treated as the full total) plus
  // the ISO timestamp of the most recent recorded repayment.
  balance?: number | string;
  last_payment_at?: string;
}

export type OrderRow = DispatchOrder & {
  _row: number;
};

export interface TicketItem extends CartItem {
  cost?: number;
}

export interface EtimsItem {
  name: string;
  qty: number;
  unitPrice: number;
}

export interface EtimsResult {
  invoiceNumber: string;
  cuSerialNumber: string;
  verificationUrl: string;
}

export interface VatSplits {
  gross: number;
  net: number;
  vat: number;
}

export interface ParsedMpesa {
  code: string;
  amount: number;
  raw: string;
}

export interface DashboardSummary {
  date: string;
  totalSales: number;
  totalCost: number;
  totalProfit: number;
  glovoCommission: number;
  paidCount: number;
  pendingCount: number;
  ordersCount: number;
}

/** A single open debt ledger row grouped under a customer account. */
export interface DebtRow {
  id: string;
  source?: "order" | "opening";
  date: string;
  time: string;
  total: number;
  balance: number;
  pay_status: PayStatus;
  payment_method: PaymentMethod | "";
  driver: string;
}

/** A customer's aggregated open debt account (PAY STATUS = PENDING or CREDIT). */
export interface DebtAccount {
  customer: string;
  phone: string;
  house: string;
  numberOfRows: number;
  outstanding: number;
  rows: DebtRow[];
}

/** All-time per-rider performance snapshot for the Rider Matrix widget. */
export interface RiderMatrixRow {
  driver: string;
  tripsCompleted: number;
  grossCashCollected: number;
  activePendingDeliveries: number;
  totalDispatches: number;
}

/** Glovo channel yield block: gross revenue minus commission overhead. */
export interface GlovoMetrics {
  orders: number;
  grossRevenue: number;
  commissionOverhead: number;
  netYield: number;
}

/** Top-selling aggregate (ranked by volume). */
export interface TopSellingItem {
  name: string;
  qty: number;
  revenue: number;
}

/** Full report payload for the unified Reports dashboard widgets. */
export interface ReportsPayload {
  debts: DebtAccount[];
  riderMatrix: RiderMatrixRow[];
  glovo: GlovoMetrics;
  topSelling: TopSellingItem[];
}