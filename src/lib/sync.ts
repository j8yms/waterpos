import crypto from "crypto";
import { readTab, rowToOrder, updateRow } from "./sheets";
import { amountsMatch, parseMpesaSms, extractSmsFromPayload } from "./mpesa";
import { nairobiDate } from "./pricing";
import type { ParsedMpesa } from "./types";

export interface MatchResult {
  received?: string;
  matched: {
    orderId: string;
    row: number;
    code: string;
    amount: number;
    customer: string;
  } | null;
  matchedCount: number;
  scannedPendingCount: number;
  parsed: ParsedMpesa | null;
  note: string;
}

export interface SyncReport {
  received: string[];
  results: MatchResult[];
  unmatchedTexts: string[];
  errors: string[];
}

/**
 * Pure matcher over today's PENDING rows. Returns the first row whose total
 * matches the paid amount (within tolerance), skipping consumed rows.
 */
export function findPendingMatch(
  candidates: { row: number; total: number; id: string; customer: string }[],
  amount: number,
  consumedRows: Set<number>
): { row: number; id: string; customer: string } | null {
  const candidate = candidates.find((p) => !consumedRows.has(p.row) && amountsMatch(p.total, amount));
  if (!candidate) return null;
  consumedRows.add(candidate.row);
  return { row: candidate.row, id: candidate.id, customer: candidate.customer };
}

/**
 * Core rule: scan today's PENDING orders, match exact amount, flip to PAID and
 * write the M-Pesa reference code into the MPESA_CODE column.
 */
export async function matchMpesaToOrders(smsTexts: string[]): Promise<SyncReport> {
  const report: SyncReport = { received: smsTexts, results: [], unmatchedTexts: [], errors: [] };
  const today = nairobiDate();

  const ordersRead = await readTab("ORDERS");
  const todaysPending: { row: number; total: number; id: string; customer: string }[] = [];
  for (let i = 0; i < ordersRead.rows.length; i++) {
    const raw = ordersRead.rows[i];
    const order = rowToOrder(raw, ordersRead.rowNumbers[i]);
    if (order.date !== today) continue;
    if (order.pay_status !== "PENDING") continue;
    todaysPending.push({
      row: ordersRead.rowNumbers[i],
      total: order.total,
      id: order.id,
      customer: order.customer,
    });
  }

  const consumedRows = new Set<number>();

  for (const sms of smsTexts) {
    const parsed = parseMpesaSms(sms);
    if (!parsed) {
      report.unmatchedTexts.push(sms);
      continue;
    }

    const candidate = findPendingMatch(todaysPending, parsed.amount, consumedRows);
    if (!candidate) {
      report.unmatchedTexts.push(sms);
      continue;
    }
    await updateRow("ORDERS", candidate.row, {
      pay_status: "PAID",
      mpesa_code: parsed.code,
    });

    report.results.push({
      received: sms,
      parsed,
      matched: {
        orderId: candidate.id,
        row: candidate.row,
        code: parsed.code,
        amount: parsed.amount,
        customer: candidate.customer,
      },
      matchedCount: report.results.length,
      scannedPendingCount: todaysPending.length,
      note: `Matched ${money(parsed.amount)} to order ${candidate.id} (${candidate.customer})`,
    });
  }

  return report;
}

export function newOrderId(): string {
  return "ORD-" + crypto.randomBytes(3).toString("hex").toUpperCase() + "-" + Math.floor(100 + Math.random() * 900);
}

function money(n: number): string {
  return `Ksh ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { extractSmsFromPayload };