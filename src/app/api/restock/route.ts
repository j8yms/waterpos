import { requireRole } from "@/lib/auth";
import { readTab, SheetsConfigError, updateRow } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = requireRole(request, "management");
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