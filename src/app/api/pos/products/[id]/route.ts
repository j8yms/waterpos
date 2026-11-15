import { requireRole } from "@/lib/auth";
import { appendRow, deleteRow, readTab, rowToProduct, SheetsConfigError, updateRow } from "@/lib/sheets";

export const runtime = "nodejs";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const read = await readTab("PRODUCTS");
    const idx = read.rows.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return Response.json({ error: "Product not found." }, { status: 404 });

    await deleteRow("PRODUCTS", read.rowNumbers[idx]);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json(
      { error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed to delete product." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const body = await request.json();
    const read = await readTab("PRODUCTS");
    const idx = read.rows.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return Response.json({ error: "Product not found." }, { status: 404 });

    const existing = rowToProduct(read.rows[idx] as any);

    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return Response.json({ error: "Product name is required." }, { status: 400 });

    const selling_price =
      body.selling_price !== undefined ? Number(body.selling_price) : existing.selling_price;
    const wholesale_cost =
      body.wholesale_cost !== undefined ? Number(body.wholesale_cost) : existing.wholesale_cost;
    const stock = body.stock !== undefined ? Number(body.stock) : existing.stock;
    const min_stock =
      body.min_stock !== undefined && body.min_stock !== null && body.min_stock !== ""
        ? Number(body.min_stock)
        : existing.min_stock;

    if (!Number.isFinite(selling_price) || selling_price < 0)
      return Response.json({ error: "Selling price must be a non-negative number." }, { status: 400 });
    if (!Number.isFinite(wholesale_cost) || wholesale_cost < 0)
      return Response.json({ error: "Cost price must be a non-negative number." }, { status: 400 });
    if (!Number.isFinite(stock) || stock < 0)
      return Response.json({ error: "Stock quantity must be a non-negative number." }, { status: 400 });
    if (min_stock !== undefined && (!Number.isFinite(min_stock) || min_stock < 0))
      return Response.json({ error: "Minimum stock must be a non-negative number." }, { status: 400 });

    const unit = body.unit !== undefined ? String(body.unit).trim() : existing.unit;
    if (!unit) return Response.json({ error: "Unit is required." }, { status: 400 });

    const category = body.category !== undefined ? String(body.category).trim() : (existing.category ?? "");
    const color = body.color !== undefined ? String(body.color).trim() : existing.color;
    const description = body.description !== undefined ? String(body.description) : (existing.description ?? "");
    const is_active =
      body.is_active !== undefined
        ? (body.is_active === true || String(body.is_active).toLowerCase() === "true")
        : existing.is_active;

    const changes: Record<string, any> = {
      name,
      category,
      selling_price,
      wholesale_cost,
      unit,
      color,
      stock: Math.round(stock),
      min_stock: min_stock === undefined ? "" : Math.round(min_stock),
      description,
      is_active: is_active ? "TRUE" : "FALSE",
      updated_at: new Date().toISOString(),
    };

    // Stock adjustment record (only when quantity actually changes).
    if (Math.round(stock) !== Math.round(existing.stock)) {
      await appendRow("STOCK_ADJUSTMENTS", {
        id: "sa" + Math.random().toString(36).slice(2, 10),
        product_id: existing.id,
        product_name: name,
        previous_stock: Math.round(existing.stock),
        new_stock: Math.round(stock),
        change: Math.round(stock) - Math.round(existing.stock),
        reason: String(body.adjustment_reason ?? body.reason ?? "Manual edit").trim() || "Manual edit",
        adjusted_by: user.name,
        adjusted_at: new Date().toISOString(),
      });
    }

    await updateRow("PRODUCTS", read.rowNumbers[idx], changes);

    const updated = rowToProduct({ ...read.rows[idx], ...changes });
    return Response.json({ ok: true, product: updated });
  } catch (err) {
    return Response.json(
      { error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed to update product." },
      { status: 500 }
    );
  }
}
