import type { DebtAccount, DebtRow, DispatchOrder } from "./types";

export function isSharedCustomerName(name: string, customers: { location?: string; name?: string }[]): boolean {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key || key === "walk-in customer") return true;
  const matches = customers.filter((c) => String(c.location ?? c.name ?? "").trim().toLowerCase() === key);
  return matches.length > 1;
}

export function rowBalance(o: { balance?: number | string; total: number }): number {
  const b = Number(o.balance);
  return Number.isFinite(b) && b > 0 ? Math.round(b * 100) / 100 : Math.round(o.total * 100) / 100;
}

export function buildDebtsLedger(orders: any[], openingDebts: any[] = []): DebtAccount[] {
  const groups = new Map<string, DebtAccount>();
  for (const o of orders) {
    const isRelevant = o.pay_status === "PENDING" || String(o.payment_method || "").toUpperCase() === "CREDIT";
    if (!isRelevant) continue;
    const key = String(o.customer || "WALK-IN CUSTOMER").trim();
    const existing = groups.get(key);
    if (existing && existing.rows.some((r) => r.id === o.id)) continue;

    const row: DebtRow = {
      id: o.id,
      source: "order",
      date: String(o.date ?? ""),
      time: String(o.time ?? ""),
      total: Math.round(o.total * 100) / 100,
      balance: rowBalance(o),
      pay_status: o.pay_status,
      payment_method: String(o.payment_method || "") as DebtRow["payment_method"],
      driver: String(o.driver ?? ""),
    };
    const account: DebtAccount = existing ?? {
      customer: key,
      phone: String(o.phone ?? ""),
      house: String(o.address ?? ""),
      numberOfRows: 0,
      outstanding: 0,
      rows: [],
    };
    account.rows.push(row);
    account.outstanding = Math.round((account.outstanding + row.balance) * 100) / 100;
    account.numberOfRows = account.rows.length;
    groups.set(key, account);
  }

  // Merge opening debts (migrated Aronium balances)
  for (const r of openingDebts) {
    if (String(r.status ?? "").toUpperCase() === "SETTLED") continue;
    const outstanding = Number(r.outstanding);
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    const customer = String(r.customer ?? "").trim();
    if (!customer) continue;
    const existing = groups.get(customer);
    const row: DebtRow = {
      id: String(r.id ?? ""),
      source: "opening",
      date: String(r.debt_date ?? ""),
      time: "",
      total: Number(r.original_amount) || outstanding,
      balance: outstanding,
      pay_status: "PENDING",
      payment_method: "CREDIT",
      driver: "OPENING BALANCE",
    };
    if (existing) {
      existing.rows.push(row);
      existing.outstanding = Math.round((existing.outstanding + outstanding) * 100) / 100;
      existing.numberOfRows = existing.rows.length;
      if (!existing.phone) existing.phone = String(r.phone ?? "");
      if (!existing.house) existing.house = String(r.address ?? "");
    } else {
      groups.set(customer, {
        customer,
        phone: String(r.phone ?? ""),
        house: String(r.address ?? ""),
        numberOfRows: 1,
        outstanding,
        rows: [row],
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.outstanding - a.outstanding);
}
