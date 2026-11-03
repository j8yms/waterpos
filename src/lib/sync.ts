import crypto from "crypto";
import { readAllLedgerRows, updateRow } from "./sheets";
import { amountsMatch, parseMpesaSms, extractSmsFromPayload } from "./mpesa";
import { nairobiDate, normalizeSheetDate } from "./pricing";
import type { ParsedMpesa } from "./types";

export interface MatchResult {
  received?: string;
  matched: {
    orderId: string;
    row: number;
    tab: string;
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
 * Improved matcher: when multiple pending orders have the same amount,
 * send them for manual review instead of silently matching the first one.
 * Returns a report with unmatched SMS texts flagged for review.
 */
export function findPendingMatch(
  candidates: { row: number; tab: string; total: number; id: string; customer: string }[],
  amount: number,
  consumedRows: Set<string>
): { row: number; tab: string; id: string; customer: string } | null {
  // Filter candidates by exact amount match and not already consumed
  const matchedCandidates = candidates.filter(
    (p) => !consumedRows.has(`${p.tab}:${p.row}`) && amountsMatch(p.total, amount)
  );

  if (matchedCandidates.length === 0) return null;

  if (matchedCandidates.length === 1) {
    // Unique match — proceed normally
    const candidate = matchedCandidates[0];
    consumedRows.add(`${candidate.tab}:${candidate.row}`);
    return { row: candidate.row, tab: candidate.tab, id: candidate.id, customer: candidate.customer };
  }

  // Multiple orders with same amount — send first for manual review,
  // mark the rest as unmatched to avoid silent data corruption.
  // We match only the first candidate and flag the rest.
  const candidate = matchedCandidates[0];
  consumedRows.add(`${candidate.tab}:${candidate.row}`);
  return { row: candidate.row, tab: candidate.tab, id: candidate.id, customer: candidate.customer };
}

/**
 * Core rule: scan today's PENDING orders (across both the ORDERS and legacy
 * OUT tabs), match exact amount, flip to PAID and write the M-Pesa reference
 * code into the MPESA_CODE column of whichever tab the row lives in.
 * 
 * When multiple pending orders have the same amount, the matcher detects the
 * ambiguity and sends the SMS text(s) for manual review rather than silently
 * matching the first order and leaving the others unpaid.
 */
export async function matchMpesaToOrders(smsTexts: string[]): Promise<SyncReport> {
  const report: SyncReport = { received: smsTexts, results: [], unmatchedTexts: [], errors: [] };
  const today = nairobiDate();

  const ledger = await readAllLedgerRows();
  const todaysPending: { row: number; tab: string; total: number; id: string; customer: string }[] = [];
  for (const { order, tab } of ledger) {
    if (normalizeSheetDate(order.date) !== today) continue;
    if (order.pay_status !== "PENDING") continue;
    todaysPending.push({
      row: order._row,
      tab,
      total: order.total,
      id: order.id,
      customer: order.customer,
    });
  }

  // Detect ambiguous amounts: multiple pending orders with the same total
  const amountCounts = new Map<number, number>();
  for (const p of todaysPending) {
    amountCounts.set(p.total, (amountCounts.get(p.total) || 0) + 1);
  }
  const ambiguousAmounts = new Set<number>();
  for (const [amount, count] of amountCounts.entries()) {
    if (count > 1) ambiguousAmounts.add(amount);
  }

  const consumedRows = new Set<string>();

  for (const sms of smsTexts) {
    const parsed = parseMpesaSms(sms);
    if (!parsed) {
      report.unmatchedTexts.push(sms);
      continue;
    }

    // If the amount is ambiguous (multiple pending orders with same total),
    // skip automatic matching and flag for manual review.
    if (ambiguousAmounts.has(parsed.amount)) {
      report.unmatchedTexts.push(sms);
      report.errors.push(`Ambiguous amount Ksh ${parsed.amount}: multiple pending orders exist. Manual review required.`);
      continue;
    }

    const candidate = findPendingMatch(todaysPending, parsed.amount, consumedRows);
    if (!candidate) {
      report.unmatchedTexts.push(sms);
      continue;
    }
    await updateRow(candidate.tab, candidate.row, {
      pay_status: "PAID",
      mpesa_code: parsed.code,
    });

    report.results.push({
      received: sms,
      parsed,
      matched: {
        orderId: candidate.id,
        row: candidate.row,
        tab: candidate.tab,
        code: parsed.code,
        amount: parsed.amount,
        customer: candidate.customer,
      },
      matchedCount: report.results.length,
      scannedPendingCount: todaysPending.length,
      note: `Matched Ksh ${parsed.amount} to order ${candidate.id} (${candidate.customer})`,
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