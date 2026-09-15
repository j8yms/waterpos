import { requireUser } from "@/lib/auth";
import { appendRow, readTab, SheetsConfigError, updateRow } from "@/lib/sheets";
import { nairobiDate, nairobiTime } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const productId = String(body.productId ?? "");
    const addedUnits = Math.max(0, Math.round(Number(body.addedUnits ?? 0)));
    const newWholesale = body.wholesale_cost !== undefined ? Number(body.wholesale_cost) : undefined;
    const newPrice = body.selling_price !== undefined ? Number(body.selling_price) : undefined;

    if (!productId || addedUnits <= 0) {
      return Response.json({ error: "Product and a positive restock quantity are required." }, { status: 400 });
    }

    const read = await readTab("PRODUCTS");
    const idx = read.rows.findIndex((r) => String(r.id) === String(productId));
    if (idx === -1) return Response.json({ error: "Product not found." }, { status: 404 });

    const current = read.rows[idx];
    const currentStock = Math.max(0, Math.round(Number(current.stock) || 0));
    const productName = String(current.name ?? "UNKNOWN");

    // 1. Append a stock-in entry to the IN tab (audit log). ORDERS / sales
    //    (OUT) rows are never touched here.
    await appendRow("IN", {
      id: `IN-${Date.now().toString(36)}`,
      date: nairobiDate(),
      time: nairobiTime(),
      product_id: productId,
      product: productName,
      qty_added: addedUnits,
      unit_cost: newWholesale ?? (Number(current.wholesale_cost) || 0),
      new_price: newPrice ?? (Number(current.selling_price) || 0),
      operator: user.name,
      created_at: new Date().toISOString(),
    });

    // 2. Update the PRODUCTS master stock (and optional cost/price).
    const changes: Record<string, any> = {
      stock: currentStock + addedUnits,
      updated_at: new Date().toISOString(),
    };
    if (newWholesale !== undefined && Number.isFinite(newWholesale)) changes.wholesale_cost = newWholesale;
    if (newPrice !== undefined && Number.isFinite(newPrice)) changes.selling_price = newPrice;

    await updateRow("PRODUCTS", read.rowNumbers[idx], changes);

    return Response.json({ ok: true, stock: currentStock + addedUnits });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Restock failed.";
}