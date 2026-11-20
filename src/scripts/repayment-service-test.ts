import { strict as assert } from "node:assert";
import { processRepayment } from "../lib/repayment-service";

let passed = 0, failed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => { passed++; console.log("  ok  " + name); })
    .catch((e) => { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); });
}

function makeState() {
  const state: any = {
    ledger: [
      { order: { id: "O1", customer: "Alice", pay_status: "PENDING", payment_method: "CREDIT", balance: 100, total: 100, _row: 1 }, tab: "ORDERS" },
    ],
    opening: [
      { id: "D1", customer: "Alice", outstanding: 50, original_amount: 50, status: "OPEN" },
    ],
    repayments: [] as any[],
    ops: [] as any[],
    opItems: [] as any[],
  };
  const sheets: any = {
    ensureSpreadsheetStructure: async () => {},
    readTab: async (name: string) => {
      if (name === "REPAYMENTS") return { rows: state.repayments, rowNumbers: state.repayments.map((_: any, i: number) => i + 1) };
      if (name === "OPENING_DEBTS") return { rows: state.opening, rowNumbers: state.opening.map((_: any, i: number) => i + 1) };
      if (name === "PAYMENT_OPERATIONS") return { rows: state.ops, rowNumbers: state.ops.map((_: any, i: number) => i + 1) };
      if (name === "PAYMENT_OPERATION_ITEMS") return { rows: state.opItems, rowNumbers: state.opItems.map((_: any, i: number) => i + 1) };
      return { rows: [], rowNumbers: [] };
    },
    readAllLedgerRows: async () => state.ledger,
    updateRow: async (tab: string, rowNumber: number, changes: any) => {
      if (tab === "ORDERS" || tab === "OUT") {
        const r = state.ledger.find((l: any) => l.order._row === rowNumber);
        Object.assign(r.order, changes);
      } else if (tab === "OPENING_DEBTS") {
        Object.assign(state.opening[rowNumber - 1], changes);
      } else if (tab === "PAYMENT_OPERATIONS") {
        Object.assign(state.ops[rowNumber - 1], changes);
      }
    },
    appendRow: async (tab: string, record: any) => {
      if (tab === "REPAYMENTS") state.repayments.push({ ...record });
      else if (tab === "PAYMENT_OPERATIONS") state.ops.push({ ...record });
      else if (tab === "PAYMENT_OPERATION_ITEMS") state.opItems.push({ ...record });
    },
  };
  return { state, sheets };
}

async function runTests() {
  await check("successful single allocation", async () => {
    const { state, sheets } = makeState();
    const res: any = await processRepayment({ action: "logRepayment", customer: "Alice", amount: 40, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 40 }], payment_ref: "p1" }, sheets);
    assert.equal(res.ok, true);
    assert.equal(state.opening[0].outstanding, 10);
    assert.equal(state.repayments.length, 1);
  });

  await check("successful multiple allocation", async () => {
    const { state, sheets } = makeState();
    const res: any = await processRepayment({ action: "logRepayment", customer: "Alice", amount: 120, method: "CASH", allocations: [{ source: "order", id: "O1", amount: 100 }, { source: "opening", id: "D1", amount: 20 }], payment_ref: "p2" }, sheets);
    assert.equal(res.ok, true);
    assert.equal(state.ledger[0].order.balance, 0);
    assert.equal(state.opening[0].outstanding, 30);
    assert.equal(state.repayments.length, 2);
  });

  await check("duplicate payment_ref does not deduct twice", async () => {
    const { state, sheets } = makeState();
    await processRepayment({ action: "logRepayment", customer: "Alice", amount: 10, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 10 }], payment_ref: "dup" }, sheets);
    const firstBalance = state.opening[0].outstanding;
    const res: any = await processRepayment({ action: "logRepayment", customer: "Alice", amount: 10, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 10 }], payment_ref: "dup" }, sheets);
    assert.equal(res.duplicate, true);
    assert.equal(state.opening[0].outstanding, firstBalance);
    assert.equal(state.repayments.length, 1);
  });

  await check("quarantined debt rejected", async () => {
    const { state, sheets } = makeState();
    state.opening[0].status = "QUARANTINED";
    await assert.rejects(() => processRepayment({ action: "logRepayment", customer: "Alice", amount: 10, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 10 }], payment_ref: "q" }, sheets));
    assert.equal(state.opening[0].outstanding, 50);
  });

  await check("missing allocations rejected", async () => {
    const { state, sheets } = makeState();
    await assert.rejects(() => processRepayment({ action: "logRepayment", customer: "Alice", amount: 10, method: "CASH", payment_ref: "m" }, sheets));
  });

  await check("allocation above balance rejected", async () => {
    const { state, sheets } = makeState();
    await assert.rejects(() => processRepayment({ action: "logRepayment", customer: "Alice", amount: 60, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 60 }], payment_ref: "a" }, sheets));
    assert.equal(state.opening[0].outstanding, 50);
  });

  await check("cross-customer allocation rejected", async () => {
    const { state, sheets } = makeState();
    await assert.rejects(() => processRepayment({ action: "logRepayment", customer: "Bob", amount: 10, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 10 }], payment_ref: "c2" }, sheets));
  });

  await check("concurrent same payment_ref does not double deduct", async () => {
    const { state, sheets } = makeState();
    const req = { action: "logRepayment", customer: "Alice", amount: 10, method: "CASH", allocations: [{ source: "opening", id: "D1", amount: 10 }], payment_ref: "concurrent" };
    const [a, b] = await Promise.allSettled([processRepayment(req, sheets), processRepayment(req, sheets)]);
    // One may be duplicate; balance should only drop by 10
    assert.equal(state.opening[0].outstanding, 40);
    assert.equal(state.repayments.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
