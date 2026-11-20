import { requireRole } from "@/lib/auth";
import { readAllLedgerRows, readTab, SheetsConfigError } from "@/lib/sheets";
import { buildDebtsLedger, isSharedCustomerName } from "@/lib/debts";

export const runtime = "nodejs";

// Simple in-memory cache
const cache = new Map<string, { data: any; expires: number }>();
const TTL = 30_000;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const cached = cache.get(id);
  if (cached && Date.now() < cached.expires) {
    return Response.json(cached.data);
  }

  try {
    // Look up customer by id to get their name (orders store customer name)
    const custRead = await readTab("CUSTOMERS");
    const custRow = custRead.rows.find((r: any) => String(r.id) === String(id));
    const customerName = custRow ? String(custRow.location ?? "").trim() : "";

    const ledger = await readAllLedgerRows();
    const orders = ledger.map((l: any) => l.order);

    let openingDebts: any[] = [];
    try {
      const od = await readTab("OPENING_DEBTS");
      openingDebts = od.rows.filter((r: any) => String(r.customer_id ?? "") === String(id));
    } catch {
      openingDebts = [];
    }

    const debts = buildDebtsLedger(orders, openingDebts);
    // Find accounts for this customer: by customer_id (opening debt) or by name (order debt)
    const matchingAccounts = debts.filter((d) => {
      // Check if any opening debt row belongs to this customer_id
      const hasOpeningForThis = d.rows.some((r: any) => r.source === "opening" && openingDebts.some((od: any) => String(od.id) === r.id));
      // Or if the account name matches and has no opening debts (order debt)
      const isOrderAccount = d.rows.some((r: any) => r.source === "order") && d.customer.toLowerCase() === customerName.toLowerCase() && !d.rows.some((r: any) => r.source === "opening");
      return hasOpeningForThis || isOrderAccount;
    });
    const balance = matchingAccounts.reduce((s, a) => s + a.outstanding, 0);
    const accountCount = matchingAccounts.reduce((s, a) => s + a.numberOfRows, 0);
    const sharedName = isSharedCustomerName(customerName, custRead.rows);

    const result = { customerId: id, balance, accountCount, sharedName };
    cache.set(id, { data: result, expires: Date.now() + TTL });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
