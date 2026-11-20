import { strict as assert } from "node:assert";
import { buildDebtsLedger, isSharedCustomerName } from "../lib/debts";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); }
}

check("same name different ids: different balances via opening debts", () => {
  const orders: any[] = [];
  const opening = [
    { id: "D1", customer: "Alice", customer_id: "C1", outstanding: 100, original_amount: 100, status: "OPEN" },
    { id: "D2", customer: "Alice", customer_id: "C2", outstanding: 50, original_amount: 50, status: "OPEN" },
  ];
  const debts = buildDebtsLedger(orders, opening);
  // Composite keys → separate accounts
  assert.equal(debts.length, 2);
});

check("balance includes opening debts only", () => {
  const orders: any[] = [];
  const opening = [{ id: "D1", customer: "Bob", outstanding: 75, original_amount: 75, status: "OPEN" }];
  const debts = buildDebtsLedger(orders, opening);
  assert.equal(debts.length, 1);
  assert.equal(debts[0].outstanding, 75);
  assert.equal(debts[0].rows[0].source, "opening");
});

check("settled opening debts excluded", () => {
  const orders: any[] = [];
  const opening = [{ id: "D1", customer: "Charlie", outstanding: 0, original_amount: 50, status: "SETTLED" }];
  const debts = buildDebtsLedger(orders, opening);
  assert.equal(debts.length, 0);
});

check("isSharedCustomerName: unique name → false", () => {
  const customers = [{ location: "Alice" }, { location: "Bob" }];
  assert.equal(isSharedCustomerName("Alice", customers), false);
});

check("isSharedCustomerName: duplicate name → true", () => {
  const customers = [{ location: "Alice" }, { location: "Alice" }];
  assert.equal(isSharedCustomerName("Alice", customers), true);
});

check("isSharedCustomerName: WALK-IN → true", () => {
  const customers = [{ location: "Walk-in" }];
  assert.equal(isSharedCustomerName("WALK-IN CUSTOMER", customers), true);
});

check("composite key: two same-named customers with distinct opening debts → separate accounts", () => {
  const orders: any[] = [];
  const opening = [
    { id: "D1", customer: "Alice", customer_id: "C1", outstanding: 100, original_amount: 100, status: "OPEN" },
    { id: "D2", customer: "Alice", customer_id: "C2", outstanding: 50, original_amount: 50, status: "OPEN" },
  ];
  const debts = buildDebtsLedger(orders, opening);
  assert.equal(debts.length, 2);
  assert.equal(debts[0].outstanding + debts[1].outstanding, 150);
});

check("opening debt without customer_id falls back to name key", () => {
  const orders: any[] = [];
  const opening = [{ id: "D1", customer: "Bob", outstanding: 75, original_amount: 75, status: "OPEN" }];
  const debts = buildDebtsLedger(orders, opening);
  assert.equal(debts.length, 1);
  assert.equal(debts[0].outstanding, 75);
});

check("two customers same name: combined balance documented", () => {
  const orders: any[] = [];
  const opening = [
    { id: "D1", customer: "Alice", outstanding: 100, original_amount: 100, status: "OPEN" },
    { id: "D2", customer: "Alice", outstanding: 50, original_amount: 50, status: "OPEN" },
  ];
  const debts = buildDebtsLedger(orders, opening);
  // Without customer_id, both key by name → single account with 150
  assert.equal(debts.length, 1);
  assert.equal(debts[0].outstanding, 150);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
