export type Role = "management" | "rider";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface AuthSession {
  token: string;
  user: User;
  exp: number;
}

export interface Product {
  id: string;
  name: string;
  selling_price: number;
  wholesale_cost: number;
  unit: string;
  color: string;
  stock: number;
  is_active: boolean;
}

export interface Customer {
  id: string;
  location: string;
  phone: string;
  address: string;
  notes: string;
  is_active: boolean;
}

export interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  color: string;
}

export type PayStatus = "PAID" | "PENDING";

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
  driver: string;
  profit: number;
  mpesa_code: string;
  notes: string;
  created_at: string;
}

export type OrderRow = DispatchOrder & {
  _row: number;
};

export interface TicketItem extends CartItem {
  cost?: number;
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