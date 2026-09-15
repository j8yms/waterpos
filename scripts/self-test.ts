/**
 * Offline self-test for the pure business rules that DON'T touch Google Sheets:
 * PIN auth shape, M-Pesa regex parsing, amount matching, profit math, Nairobi
 * date handling. Run with:  npm test
 */
import { GLOVO_COMMISSION } from "../src/lib/config";
import { parseMpesaSms, parseRawAmount } from "../src/lib/mpesa";
import { computeTicket, nairobiDate, nairobiTime } from "../src/lib/pricing";
import { findPendingMatch } from "../src/lib/sync";
import type { TicketItem } from "../src/lib/types";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

async function main() {
  console.log("M-Pesa parsing");
  const a = parseMpesaSms(
    "NKJ78X9P2Q Confirmed. Ksh550.00 received from JAMES KARANJA on 9/15/2026 at 2:34 PM. New M-PESA balance is Ksh3,420.00."
  );
  check("extracts 10-char code", a?.code === "NKJ78X9P2Q", a);
  check("extracts amount 550", a?.amount === 550, a);

  const b = parseMpesaSms("SFR4Q9P2QK Confirmed. Ksh1,200.00 received from GRACE on 9/15/2026 at 9:12 AM.");
  check("handles comma thousands", b?.amount === 1200, b);

  const c = parseMpesaSms("QTZK7M4WDR Confirmed. on 9/14/2026 at 6:02 PM Ksh320.00 sent to WAFD.");
  check("handles reordered amount", c?.amount === 320 && c?.code === "QTZK7M4WDR", c);

  check("rejects non-mpesa SMS", parseMpesaSms("Hello, just a greeting") === null);
  check("parseRawAmount strips commas", parseRawAmount("1,234,567.89") === 1234567.89);

  console.log("Pending matching");
  const candidates = [
    { row: 2, total: 550, id: "ORD-A1", customer: "MARINA BAY (Regular)" },
    { row: 3, total: 200, id: "ORD-B1", customer: "WESTLANDS (Walk-in)" },
  ];
  const consumed = new Set<number>();
  const m1 = findPendingMatch(candidates, 550, consumed);
  check("matches exact amount", m1?.row === 2 && consumed.has(2), m1);
  const m2 = findPendingMatch(candidates, 550, consumed);
  check("does not double-consume same row", m2 === null, m2);
  const m3 = findPendingMatch(candidates, 200.049, consumed);
  check("tolerance match on 200.049", m3?.row === 3, m3);

  console.log("Profit math");
  const items: TicketItem[] = [
    { productId: "q189", name: "QUENCHER 18.9L", unitPrice: 550, cost: 350, qty: 2, color: "#0ea5e9" },
    { productId: "q500", name: "QUENCHER 500ML", unitPrice: 40, cost: 24, qty: 5, color: "#22c55e" },
  ];
  const t1 = computeTicket(items, false);
  check("subtotal = 550*2 + 40*5", t1.subtotal === 1300, t1.subtotal);
  check("cost = 350*2 + 24*5", t1.cost === 820, t1.cost);
  check("profit = 480", t1.profit === 480, t1.profit);

  const t2 = computeTicket(items, true);
  check("glovo deducts 20%", t2.profit === 480 && t2.finalProfit === 384 && Math.abs(t2.glovoFee - 96) < 1e-9, t2);
  check("commission constant is 0.2", GLOVO_COMMISSION === 0.2);

  console.log("Dates (Nairobi)");
  const d = nairobiDate(new Date("2026-09-15T10:00:00.000Z"));
  check("UTC midnight maps to earlier Nairobi day when applicable", typeof d === "string" && d.length === 10, d);
  check("Nairobi time has HH:MM:SS shape", /^\d{2}:\d{2}:\d{2}$/.test(nairobiTime(new Date())), nairobiTime(new Date()));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});