import { requireRole } from "@/lib/auth";
import { appendRow, ensureSpreadsheetStructure, readAllLedgerRows, SheetsConfigError, updateRow } from "@/lib/sheets";
import { nairobiDate, nairobiTime } from "@/lib/pricing";
import { newOrderId } from "@/lib/sync";
import { toNumber } from "@/lib/numbers";
import type { PayStatus } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Debts Repayment Engine — action "logRepayment".
 *
 * Applies an incoming currency amount against a customer's open ledger rows
 * (PAY STATUS = PENDING or payment type = CREDIT), oldest first:
 *   - reduces each row's BALANCE to zero (or less if partially cleared),
 *   - stamps LAST_PAYMENT_AT with the execution timestamp,
 *   - flips a row to PAY STATUS = PAID once fully settled,
 *   - appends the incoming amount to the REPAYMENTS cash/M-Pesa flow log.
 *
 * Management-only, matching the admin-gated Reports dashboard.
 */
export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (String(body.action ?? "") !== "logRepayment") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  const customer = String(body.customer ?? "").trim();
  const amount = toNumber(body.amount);
  const method = String(body.method ?? "CASH").toUpperCase();
  if (!customer) return Response.json({ error: "Customer name is required." }, { status: 400 });
  if (!(amount > 0)) return Response.json({ error: "Repayment amount must be greater than zero." }, { status: 400 });
  if (!["CASH", "MPESA"].includes(method)) {
    return Response.json({ error: "Repayment method must be CASH or MPESA." }, { status: 400 });
  }

  try {
    // Ensure the balance/last_payment_at columns and REPAYMENTS tab exist.
    await ensureSpreadsheetStructure();

    const ledger = await readAllLedgerRows();
    const key = customer.toLowerCase();
    const open = ledger
      .filter(({ order }) => {
        if (String(order.customer).trim().toLowerCase() !== key) return false;
        return order.pay_status === "PENDING" || String(order.payment_method).toUpperCase() === "CREDIT";
      })
      .sort((a, b) => (a.order.date + a.order.time).localeCompare(b.order.date + b.order.time));

    if (!open.length) {
      return Response.json({ error: "No open debt found for this customer." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const timestamp = `${nairobiDate()} ${nairobiTime()}`;
    let remaining = amount;
    const settledIds: string[] = [];
    const touchedIds: string[] = [];

    for (const { order, tab } of open) {
      if (remaining <= 0) break;
      // Legacy rows created before the balance column carry no balance → the
      // full total is still outstanding.
      const current = Number(order.balance);
      const balance = Number.isFinite(current) && current > 0 ? current : order.total;
      const paid = Math.min(balance, remaining);
      if (paid <= 0) continue;

      const newBalance = Math.max(0, Math.round((balance - paid) * 100) / 100);
      const fullySettled = newBalance <= 0;
      const changes: Record<string, any> = {
        balance: newBalance,
        last_payment_at: nowIso,
      };
      if (fullySettled) {
        changes.pay_status = "PAID" as PayStatus;
      }

      await updateRow(tab, order._row, changes);

      // Append the incoming amount to the cash/M-Pesa cash flow log.
      await appendRow("REPAYMENTS", {
        id: newOrderId(),
        date: nairobiDate(),
        time: nairobiTime(),
        customer: order.customer,
        order_id: order.id,
        amount: Math.round(paid * 100) / 100,
        method,
        notes: fullySettled ? "Settled in full" : "Partial repayment",
        created_at: nowIso,
      });

      remaining = Math.max(0, Math.round((remaining - paid) * 100) / 100);
      touchedIds.push(order.id);
      if (fullySettled) settledIds.push(order.id);
    }

    const applied = Math.round((amount - remaining) * 100) / 100;
    const result = {
      ok: true,
      applied,
      excess: Math.round(remaining * 100) / 100,
      timestamp,
      touchedRows: touchedIds.length,
      rows: touchedIds,
      settledRows: settledIds,
      remainingAfter: Math.max(0, Math.round(remaining * 100) / 100),
    };
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Repayment request failed.";
}