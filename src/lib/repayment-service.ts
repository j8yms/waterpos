import { ensureSpreadsheetStructure, readAllLedgerRows, readTab, updateRow, appendRow, SheetsConfigError } from "./sheets";
import { nairobiDate, nairobiTime } from "./pricing";
import { newOrderId } from "./sync";
import { toNumber } from "./numbers";
import { validateRepaymentAllocations } from "./repayment-allocation";

export interface RepaymentSheets {
  ensureSpreadsheetStructure(): Promise<void>;
  readTab(name: string): Promise<{ rows: any[]; rowNumbers: number[] }>;
  readAllLedgerRows(): Promise<any[]>;
  updateRow(tab: string, rowNumber: number, changes: Record<string, any>): Promise<void>;
  appendRow(tab: string, record: Record<string, any>): Promise<void>;
}

export interface RepaymentRequest {
  action?: string;
  customer?: string;
  amount?: any;
  method?: string;
  allocations?: any[];
  payment_ref?: string;
}

let serviceLock: Promise<void> = Promise.resolve();
function acquireServiceLock(): Promise<() => void> {
  let release!: () => void;
  const wait = serviceLock.then(() => () => { release(); });
  serviceLock = new Promise<void>((resolve) => { release = resolve; });
  return wait;
}

export async function processRepayment(req: RepaymentRequest, sheets: RepaymentSheets) {
  const release = await acquireServiceLock();
  try {
  if (String(req.action ?? "") !== "logRepayment") {
    throw new Error("Unknown action.");
  }
  const customer = String(req.customer ?? "").trim();
  const amount = toNumber(req.amount);
  const method = String(req.method ?? "CASH").toUpperCase();
  if (!customer) throw new Error("Customer name is required.");
  if (!(amount > 0)) throw new Error("Repayment amount must be greater than zero.");
  if (!["CASH", "MPESA"].includes(method)) throw new Error("Repayment method must be CASH or MPESA.");

  const paymentRef = String(req.payment_ref ?? "").trim();
  const allocations = Array.isArray(req.allocations) ? req.allocations : null;
  if (!allocations || !allocations.length) {
    throw new Error("Explicit allocations are required for repayments.");
  }

  await sheets.ensureSpreadsheetStructure();

  // Idempotency
  const effectivePaymentRef = paymentRef || ("pay-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  const rep = await sheets.readTab("REPAYMENTS");
  if (rep.rows.some((r: any) => String(r.payment_ref ?? "") === effectivePaymentRef)) {
    return { ok: true, duplicate: true, applied: 0, payment_ref: effectivePaymentRef };
  }

  const ledger = await sheets.readAllLedgerRows();
  const od = await sheets.readTab("OPENING_DEBTS");
  const key = customer.toLowerCase();

  const debtsForValidation: { source: "order" | "opening"; id: string; customer: string; balance: number; status?: string }[] = [];
  for (const l of ledger) {
    if (String(l.order.customer).trim().toLowerCase() !== key) continue;
    if (!(l.order.pay_status === "PENDING" || String(l.order.payment_method).toUpperCase() === "CREDIT")) continue;
    const bal = Number(l.order.balance) > 0 ? Number(l.order.balance) : Number(l.order.total);
    debtsForValidation.push({ source: "order", id: l.order.id, customer: l.order.customer, balance: bal });
  }
  for (const r of od.rows) {
    if (String(r.customer ?? "").trim().toLowerCase() !== key) continue;
    const bal = Number(r.outstanding) > 0 ? Number(r.outstanding) : Number(r.original_amount);
    debtsForValidation.push({ source: "opening", id: r.id, customer: String(r.customer ?? ""), balance: bal, status: String(r.status ?? "") });
  }

  const validation = validateRepaymentAllocations(customer, amount, allocations, debtsForValidation);
  if (!validation.ok) throw new Error(validation.error || "Invalid allocation.");

  const resolved: { source: "order" | "opening"; id: string; rowNumber: number; tab?: string; balance: number; amount: number }[] = [];
  for (const v of validation.allocations ?? []) {
    if (v.source === "order") {
      const lr = ledger.find((l: any) => l.order.id === v.id);
      resolved.push({ source: "order", id: v.id, rowNumber: lr!.order._row, tab: lr!.tab, balance: v.balance, amount: v.amount });
    } else {
      const idx = od.rows.findIndex((r: any) => r.id === v.id);
      resolved.push({ source: "opening", id: v.id, rowNumber: od.rowNumbers[idx], balance: v.balance, amount: v.amount });
    }
  }

  // Operation ledger
  const ops = await sheets.readTab("PAYMENT_OPERATIONS");
  const existingOp = ops.rows.find((r: any) => String(r.payment_ref ?? "") === effectivePaymentRef);
  if (existingOp && String(existingOp.status ?? "") === "COMPLETED") {
    return { ok: true, duplicate: true, applied: 0, payment_ref: effectivePaymentRef };
  }
  const opItemsRead = await sheets.readTab("PAYMENT_OPERATION_ITEMS");
  const existingItems = opItemsRead.rows.filter((r: any) => String(r.payment_ref ?? "") === effectivePaymentRef);

  if (!existingOp) {
    await sheets.appendRow("PAYMENT_OPERATIONS", {
      id: newOrderId(),
      payment_ref: effectivePaymentRef,
      customer,
      amount: Math.round(amount * 100) / 100,
      method,
      status: "PENDING",
      allocations: JSON.stringify(allocations),
      error: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    for (const r of resolved) {
      await sheets.appendRow("PAYMENT_OPERATION_ITEMS", {
        id: newOrderId(),
        payment_ref: effectivePaymentRef,
        debt_source: r.source === "order" ? "order" : "opening",
        debt_id: r.id,
        amount: Math.round(r.amount * 100) / 100,
        status: "PENDING",
        error: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  const pendingResolved = resolved.filter((r) => {
    const item = existingItems.find((i: any) => String(i.debt_source) === r.source && String(i.debt_id) === r.id);
    return !item || String(item.status ?? "") !== "COMPLETED";
  });

  const nowIso = new Date().toISOString();
  const timestamp = nairobiDate() + " " + nairobiTime();
  let applied = 0;
  const touched: string[] = [];
  const settled: string[] = [];
  for (const r of pendingResolved) {
    const newBalance = Math.max(0, Math.round((r.balance - r.amount) * 100) / 100);
    const fullySettled = newBalance <= 0;
    try {
      if (r.source === "order") {
        const changes: Record<string, any> = { balance: newBalance, last_payment_at: nowIso };
        if (fullySettled) changes.pay_status = "PAID";
        await sheets.updateRow(r.tab!, r.rowNumber, changes);
      } else {
        const changes: Record<string, any> = { outstanding: newBalance, last_payment_at: nowIso };
        if (fullySettled) changes.status = "SETTLED";
        await sheets.updateRow("OPENING_DEBTS", r.rowNumber, changes);
      }
      await sheets.appendRow("REPAYMENTS", {
        id: newOrderId(),
        date: nairobiDate(),
        time: nairobiTime(),
        customer,
        order_id: r.id,
        amount: Math.round(r.amount * 100) / 100,
        method,
        debt_source: r.source === "order" ? "order" : "opening",
        payment_ref: effectivePaymentRef,
        notes: fullySettled ? "Settled in full" : "Partial repayment",
        created_at: nowIso,
      });
      applied = Math.round((applied + r.amount) * 100) / 100;
      touched.push(r.id);
      if (fullySettled) settled.push(r.id);
    } catch (e) {
      await sheets.appendRow("PAYMENT_OPERATIONS", {
        id: newOrderId(),
        payment_ref: effectivePaymentRef + "-FAIL",
        customer,
        amount: 0,
        method,
        status: "FAILED",
        allocations: JSON.stringify([{ failed: r.id }]),
        error: e instanceof Error ? e.message : String(e),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      throw e;
    }
  }

  // mark operation completed
  const opRows = await sheets.readTab("PAYMENT_OPERATIONS");
  const opIdx = opRows.rows.findIndex((r: any) => String(r.payment_ref ?? "") === effectivePaymentRef && String(r.status ?? "") === "PENDING");
  if (opIdx >= 0) {
    await sheets.updateRow("PAYMENT_OPERATIONS", opRows.rowNumbers[opIdx], { status: "COMPLETED", updated_at: new Date().toISOString() });
  }

  return {
    ok: true,
    applied,
    excess: 0,
    timestamp: nairobiDate() + " " + nairobiTime(),
    touchedRows: touched.length,
    rows: touched,
    settledRows: settled,
    remainingAfter: 0,
    payment_ref: effectivePaymentRef,
  };
  } finally {
    release();
  }
}
