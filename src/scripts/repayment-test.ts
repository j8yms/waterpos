import { strict as assert } from "node:assert";
import { validateRepaymentAllocations } from "../lib/repayment-allocation";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); }
}

const debts = [
  { source: "order" as const, id: "O1", customer: "Alice", balance: 100, status: "PENDING" },
  { source: "opening" as const, id: "D1", customer: "Alice", balance: 50, status: "OPEN" },
  { source: "opening" as const, id: "D2", customer: "Bob", balance: 30, status: "OPEN" },
  { source: "opening" as const, id: "Q1", customer: "Alice", balance: 20, status: "QUARANTINED" },
];

check("valid single allocation", () => {
  const r = validateRepaymentAllocations("Alice", 40, [{ source: "opening", id: "D1", amount: 40 }], debts);
  assert.equal(r.ok, true);
  assert.equal(r.allocations?.length, 1);
});

check("valid multi-debt allocation", () => {
  const r = validateRepaymentAllocations("Alice", 120, [
    { source: "order", id: "O1", amount: 100 },
    { source: "opening", id: "D1", amount: 20 },
  ], debts);
  assert.equal(r.ok, true);
});

check("allocation total must equal payment", () => {
  const r = validateRepaymentAllocations("Alice", 100, [{ source: "opening", id: "D1", amount: 40 }], debts);
  assert.equal(r.ok, false);
});

check("cross-customer allocation rejected", () => {
  const r = validateRepaymentAllocations("Alice", 30, [{ source: "opening", id: "D2", amount: 30 }], debts);
  assert.equal(r.ok, false);
});

check("allocation above balance rejected", () => {
  const r = validateRepaymentAllocations("Alice", 60, [{ source: "opening", id: "D1", amount: 60 }], debts);
  assert.equal(r.ok, false);
});

check("quarantined debt cannot be collected", () => {
  const r = validateRepaymentAllocations("Alice", 20, [{ source: "opening", id: "Q1", amount: 20 }], debts);
  assert.equal(r.ok, false);
});

check("unknown debt rejected", () => {
  const r = validateRepaymentAllocations("Alice", 10, [{ source: "opening", id: "NOPE", amount: 10 }], debts);
  assert.equal(r.ok, false);
});

check("zero amount rejected", () => {
  const r = validateRepaymentAllocations("Alice", 10, [{ source: "opening", id: "D1", amount: 0 }], debts);
  assert.equal(r.ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
