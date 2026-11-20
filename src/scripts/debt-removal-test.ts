import { strict as assert } from "node:assert";
import { removeDebt, getProtectedOrderIds } from "../lib/debt-removal";

let passed = 0, failed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => { passed++; console.log("  ok  " + name); })
    .catch((e) => { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); });
}

function makeState(withRepayment: boolean) {
  const state: any = {
    ledger: [
      { order: { id: "O1", customer: "Alice", pay_status: "PENDING", payment_method: "CREDIT", balance: 100, total: 100, notes: "", _row: 1 }, tab: "ORDERS" },
    ],
    repayments: withRepayment ? [{ order_id: "O1", payment_ref: "r1" }] : [],
    ops: [] as any[],
  };
  const sheets: any = {
    readAllLedgerRows: async () => state.ledger,
    readTab: async (name: string) => {
      if (name === "REPAYMENTS") return { rows: state.repayments, rowNumbers: state.repayments.map((_: any, i: number) => i + 1) };
      if (name === "PAYMENT_OPERATIONS") return { rows: state.ops, rowNumbers: state.ops.map((_: any, i: number) => i + 1) };
      return { rows: [], rowNumbers: [] };
    },
    updateRow: async () => {},
    invalidateCache: () => {},
  };
  return { state, sheets };
}

async function run() {
  await check("unprotected debt can be removed", async () => {
    const { state, sheets } = makeState(false);
    const res: any = await removeDebt("Alice", sheets);
    assert.equal(res.ok, true);
    assert.equal(res.removed, 1);
  });

  await check("protected debt is refused", async () => {
    const { state, sheets } = makeState(true);
    await assert.rejects(() => removeDebt("Alice", sheets), /Cannot remove debt with existing repayments/);
  });

  await check("getProtectedOrderIds detects repayment", async () => {
    const orders = [{ order: { id: "O1" } }];
    const reps = [{ order_id: "O1" }];
    const ids = getProtectedOrderIds(orders as any, reps, []);
    assert.deepEqual(ids, ["O1"]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
run();
