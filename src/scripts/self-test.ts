/* eslint-disable no-console */
/**
 * Offline, deterministic self-test for the KRA eTIMS (OSCU S2S / Tax Code B)
 * layer. Compiles green against the same lib the register route imports, and
 * the mock register is fully offline/deterministic, so it runs anywhere.
 *
 *   node --experimental-strip-types src/scripts/self-test.ts
 *
 * Requires KRA_ETIMS_MOCK=true in the environment (see .env.local.example).
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

// `tsx` doesn't auto-load .env.local. Mirror Next.js's env loading so the
// self-test can run standalone with the same configuration (incl. KRA_ETIMS_MOCK=true).
function loadEnvIfNeeded() {
  if (process.env.KRA_ETIMS_MOCK) return;
  const envFile = `${process.cwd()}/.env.local`;
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "").trim();
    process.env[m[1]] = process.env[m[1]] ?? value;
  }
}
loadEnvIfNeeded();

import {
  buildEtimsInvoicePayload,
  buildEtimsPayloadForOrder,
  etimsConfigured,
  etimsSellerConfig,
  registerEtimsInvoice,
  vatSplitLine,
  vatSplits,
} from "../lib/etims";
import { rowToOrder } from "../lib/sheets";
import type {
  DispatchOrder,
  EtimsItem,
  EtimsResult,
} from "../lib/types";

/* ── tiny frameworkless runner ──────────────────────────────────────────────── */
let passed = 0;
let failed = 0   | 0;

type TestFn = (() => void) | (() => Promise<void>);

function check(name: string, fn: TestFn): void {
  const done = (ok: boolean, err?: unknown): void => {
    if (ok) {
      passed += 1;
      process.stdout.write(`  ok  ${name}\n`);
    } else {
      failed += 1;
      process.stderr.write(`FAIL  ${name}\n  ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(() => done(true), (e) => done(false, e));
    } else {
      done(true);
    }
  } catch (e) {
    done(false, e);
  }
}

/* ── 1. Seller config gates the whole feature ───────────────────────────────── */
check("etimsConfigured() is boolean and mirrors seller config", () => {
  assert.strictEqual(typeof etimsConfigured(), "boolean");
  const seller = etimsSellerConfig();
  assert.strictEqual(typeof seller.tin, "string");
  assert.strictEqual(typeof seller.bhfId, "string");
  assert.strictEqual(typeof seller.dvcSrlNo, "string");
  assert.strictEqual(typeof seller.url, "string");
  if (!seller.mock) {
    assert.ok(seller.url.startsWith("https://") || seller.url.startsWith("http://"), "url scheme");
  }
});

/* ── 2. GST-free line split: gross → net + vat must re-sum exactly ──────────── */
check("vatSplits(1000) splits 16% VAT (Tax Code B): net 862.07 + vat 137.93", () => {
  const s = vatSplits(1000);
  assert.strictEqual(s.gross, 1000);
  assert.ok(Math.abs(s.net - 1000 / 1.16) < 0.01, `net=${s.net}`);
  assert.ok(Math.abs(s.vat - (1000 - s.net)) < 0.01, `vat=${s.vat}`);
  assert.ok(Math.abs(s.net + s.vat - s.gross) < 0.011, `net+vat=${s.net + s.vat}`);
});

check("vatSplitLine(587.5) is balanced", () => {
  const s = vatSplitLine(587.5);
  assert.strictEqual(s.gross, 587.5);
  assert.ok(Math.abs(s.net + s.vat - 587.5) < 0.01, `net+vat=${s.net + s.vat}`);
});

/* ── 3. Payload builder keeps one line per item with Tax Code B ─────────────── */
check("buildEtimsPayloadForOrder(order, items) makes one item line", () => {
  const seller = etimsSellerConfig();
  const order = {
    id: "OSCU-SELFTEST-0001",
    date: "2026-09-15",
    time: "14:30:00",
    customer: "Walk-in",
    phone: "0712345678",
    address: "Ngong Rd",
    product: "20L Jerry",
    qty: 2,
    unit_price: 500,
    profit: 422.41,
    total: 1000,
    glovo: false,
    glovo_fee: 240,
    pay_status: "PAID",
    mpesa_code: "SK1A2B3C4",
    operator: "self-test",
    driver: "Wajakoya",
    notes: "self-test",
    created_at: "2026-09-15T14:30:00Z",
  };
  const items: EtimsItem[] = [{ name: "20L Jerry", qty: 2, unitPrice: 500 }];
  const payload = buildEtimsPayloadForOrder(order, items);
  const item = payload.itemList.item[0];
  assert.strictEqual(payload.itemList.item.length, 1, "one line");
  assert.strictEqual(item.taxTyCd, "B", "Tax Code B");
  assert.strictEqual(item.taxblAmt, 862.07, "taxable 862.07");
  assert.strictEqual(item.taxAmt, 137.93, "VAT 137.93");
});

/* ── 4. Full payload (invoice-level) builder ────────────────────────────────── */
check("buildEtimsInvoicePayload(order, items) round-trips", () => {
  const seller = etimsSellerConfig();
  const order = { id: "OSCU-SELFTEST-0002", date: "2026-09-15", time: "14:30:00", customer: "Walk-in", total: 2000 } as DispatchOrder;
  const items: EtimsItem[] = [{ name: "20L Jerry", qty: 4, unitPrice: 500 }];
  const payload = buildEtimsPayloadForOrder(order, items);
  assert.ok(payload, "payload exists");
});

/* ── 5. Mock register: deterministic, offline, KRA-lookalike ───────────────── */
check("registerEtimsInvoice(payload, seller, invoiceNo) is deterministic", async () => {
  const seller = etimsSellerConfig();
  const payload = { itemList: { item: [{ taxTyCd: "B" }] }, total: 2000 };
  const a = await registerEtimsInvoice(payload, seller, "OSCU-SELFTEST-0002");
  const b = await registerEtimsInvoice(payload, seller, "OSCU-SELFTEST-0002");
  assert.ok(a.invoiceNumber.length >= 8, "invoice number length");
  assert.ok(a.cuSerialNumber.length > 0, "cu serial present");
  assert.strictEqual(a.invoiceNumber, b.invoiceNumber, "same input → same invoice");
});

/* ── 6. Sheets row → order, end to end ──────────────────────────────────────── */
check("rowToOrder maps a sheets row to DispatchOrder (snake_case)", () => {
  const row = {
    id: "OSCU-SELFTEST-0003",
    date: "2026-09-15",
    time: "14:31:00",
    customer: "Walk-in",
    phone: "0712345678",
    address: "Ngong Rd",
    product: "20L Jerry",
    qty: "2",
    unit_price: "500",
    profit: "422.41",
    total: "1000",
    glovo: "FALSE",
    glovo_fee: "240",
    pay_status: "PAID",
    mpesa_code: "SK1A2B3C4",
    operator: "self-test",
    driver: "Wajakoya",
    notes: "",
    created_at: "2026-09-15T14:31:00Z",
  };
  const order = rowToOrder(row as unknown as string[], 43);
  assert.equal(order.id, "OSCU-SELFTEST-0003");
  assert.equal(order.customer, "Walk-in");
});

/* exit */
setTimeout(() => {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 50);