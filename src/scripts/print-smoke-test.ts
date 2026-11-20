import { strict as assert } from "node:assert";
import { buildReceipt, receiptFromOrder } from "../lib/print";

const order = { id: "O1", date: "2026-11-19", time: "10:00", customer: "Walk-in", phone: "0712345678", address: "Ngong Rd", product: "20L Jerry", qty: 2, unit_price: 500, total: 1000, glovo: false, pay_status: "PAID", payment_method: "CASH", mpesa_code: "ABC123", driver: "Wajakoya" };
const settings = { businessName: "Test Shop", phone: "0700000000", address: "Test Addr", footerText: "Thanks!", showQty: true, showPrices: true, showPaymentMethod: true, showMpesaRef: true };

const data = receiptFromOrder(order, { operator: "Vinnie", settings });

assert.equal(data.businessName, "Test Shop");
assert.equal(data.phone, "0700000000");
assert.equal(data.address, "Test Addr");
assert.equal(data.footerText, "Thanks!");
assert.equal(data.showQty, true);
assert.equal(data.showPrices, true);
assert.equal(data.mpesaCode, "ABC123");
assert.equal(data.subtotal, 1000);
console.log("PASS: receiptFromOrder applies settings correctly");

// ── ESC/POS output ──────────────────────────────────────
const dash48 = "-".repeat(48);
const receiptFor = (s: object) =>
  buildReceipt({ ...receiptFromOrder(order, { operator: "Vinnie", settings: s }) });
const normalize = (s: string) => s.replace(/DATE\/TIME: .*\n/, "DATE/TIME: <TIME>\n");

// 1) Current default output (no settings provided) must be byte-identical
//    to the pre-settings layout, apart from the timestamp.
const DEFAULT_OUTPUT =
  "\u001b@\n" +
  "\u001ba\u0001\n" +
  "MIST WATER AND GAS DISTRIBUTORS\n" +
  "RHAPTA ROAD NJEMA COURT, 00100 NAIROBI\n" +
  "0769584784\n" +
  "TILL NO. 5251815\n" +
  dash48 + "\n" +
  "RECEIPT NO: O1\n" +
  "DATE/TIME: <TIME>\n" +
  "CASHIER/USER: Vinnie\n" +
  "DRIVER: Wajakoya\n" +
  dash48 + "\n" +
  "20L Jerry\n" +
  "2 x Ksh 0.00 1000.00\n" +
  "\u001b!\u0011\n" +
  "\u001b! \n" +
  "\u001bE\n" +
  "TOTAL\n" +
  "   1000.00 KSH\n" +
  "\u001bF\n" +
  "\u001b!\u0010\n" +
  "\u001b!\f\n" +
  "STATUS: PAID\n" +
  "PAID AMOUNT: 1000.00 KSH\n" +
  "AMOUNT DUE: 0.00 KSH\n" +
  "OUTSTANDING BALANCE: 0.00 KSH\n" +
  "PAYMENT CODE: ABC123\n" +
  ".VB\u0000";

const defaults = normalize(receiptFor({}));
assert.equal(defaults, DEFAULT_OUTPUT);
console.log("PASS: settings {} keeps current default ESC/POS output unchanged");

// 2) showPrices:false omits unit prices / line totals, footer is centered
//    before the cut command.
const noPrices = receiptFor({ showPrices: false, footerText: "Thank you" });
assert.ok(!noPrices.includes("Ksh 0.00"), "ESC/POS must omit unit prices");
assert.ok(!noPrices.includes("2 x Ksh"), "ESC/POS must omit qty x unit price");
assert.ok(noPrices.includes("20L Jerry\n2 x\n"), "item line keeps quantity only");
assert.ok(noPrices.includes("Thank you"), "ESC/POS must include footer text");
assert.ok(
  noPrices.includes("\u001ba\u0001" + " ".repeat(19) + "Thank you" + " ".repeat(20) + "\r"),
  "footer must be centered to 48 cols"
);
assert.ok(noPrices.indexOf("Thank you") < noPrices.indexOf("\u002eVB"), "footer must precede cut");
// TOTAL block still prints so the receipt remains usable.
assert.ok(noPrices.includes("TOTAL") && noPrices.includes("   1000.00 KSH"), "grand total stays");
console.log("PASS: showPrices:false + footerText applied to ESC/POS output");

// 3) Every toggle off hides only its own section.
const allOff = receiptFor({
  showQty: false,
  showPrices: false,
  showDiscounts: false,
  showDelivery: false,
  showPaymentMethod: false,
  showMpesaRef: false,
  showOutstanding: false,
});
assert.ok(!allOff.includes("DISCOUNT:"));
assert.ok(!allOff.includes("DELIVERY:"));
assert.ok(!allOff.includes("PAYMENT METHOD:"));
assert.ok(!allOff.includes("PAYMENT CODE:"));
assert.ok(!allOff.includes("OUTSTANDING BALANCE:"));
assert.ok(allOff.includes("STATUS: PAID"));

// 4) Explicit toggles on render each section.
const allOn = receiptFor({
  showDiscounts: true,
  showDelivery: true,
  showPaymentMethod: true,
  showMpesaRef: true,
  showOutstanding: true,
});
for (const label of ["DISCOUNT:", "DELIVERY:", "PAYMENT METHOD: CASH", "PAYMENT CODE: ABC123", "OUTSTANDING BALANCE:"]) {
  assert.ok(allOn.includes(label), `expected ${label}`);
}

// 5) Logo is not silently dropped: a note is printed (no bitmap support).
const withLogo = receiptFor({ logoDataUrl: "data:image/png;base64,AAAA" });
assert.ok(withLogo.includes("logo unsupported on thermal"));
console.log("PASS: receipt toggles and logo note applied to ESC/POS output");

process.exit(0);
