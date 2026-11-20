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
    // Find the account for this customer (by name from orders, or by opening debt customer name)
    const account = debts.find((d) => d.customer.toLowerCase() === customerName.toLowerCase()) 
      ?? debts.find((d) => openingDebts.some((od: any) => String(od.customer ?? "").toLowerCase() === d.customer.toLowerCase()));
    
    const balance = account ? account.outstanding : 0;
    const accountCount = account ? account.numberOfRows : 0;
    const sharedName = isSharedCustomerName(customerName, custRead.rows);

    const result = { customerId: id, balance, accountCount, sharedName };
    cache.set(id, { data: result, expires: Date.now() + TTL });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
