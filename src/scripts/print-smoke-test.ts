import { strict as assert } from "node:assert";
import { receiptFromOrder } from "../lib/print";

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
process.exit(0);
