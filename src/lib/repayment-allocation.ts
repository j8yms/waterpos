export type DebtSource = "order" | "opening";

export interface AllocationInput {
  source: string;
  id: string;
  amount: number;
}

export interface DebtRecord {
  source: DebtSource;
  id: string;
  customer: string;
  balance: number;
  status?: string;
}

export interface ResolvedAllocation {
  source: DebtSource;
  id: string;
  amount: number;
  balance: number;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  allocations?: ResolvedAllocation[];
}

export function validateRepaymentAllocations(
  customer: string,
  amount: number,
  allocations: AllocationInput[],
  debts: DebtRecord[]
): ValidationResult {
  const key = customer.trim().toLowerCase();
  if (!key) return { ok: false, error: "Customer name is required." };
  if (!(amount > 0)) return { ok: false, error: "Repayment amount must be greater than zero." };

  const totalAlloc = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  if (Math.round(totalAlloc * 100) !== Math.round(amount * 100)) {
    return { ok: false, error: "Allocation total must equal payment amount." };
  }

  const resolved: ResolvedAllocation[] = [];
  for (const a of allocations) {
    if (!a || typeof a !== "object") return { ok: false, error: "Invalid allocation." };
    if (a.source !== "order" && a.source !== "opening") return { ok: false, error: "Invalid allocation source." };
    if (!a.id) return { ok: false, error: "Allocation id is required." };
    const amt = Number(a.amount);
    if (!(amt > 0)) return { ok: false, error: "Allocation amount must be greater than zero." };

    const debt = debts.find((d) => d.source === a.source && d.id === a.id);
    if (!debt) return { ok: false, error: "Debt not found." };
    if (debt.customer.trim().toLowerCase() !== key) return { ok: false, error: "Cross-customer allocation is not allowed." };
    if (debt.source === "opening" && String(debt.status ?? "").toUpperCase() === "QUARANTINED") {
      return { ok: false, error: "Quarantined debt cannot be collected." };
    }
    if (amt > debt.balance + 1e-9) return { ok: false, error: "Allocation exceeds outstanding balance." };
    resolved.push({ source: a.source, id: a.id, amount: amt, balance: debt.balance });
  }

  return { ok: true, allocations: resolved };
}
