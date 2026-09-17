import { requireRole } from "@/lib/auth";
import { deleteRow, readTab, SheetsConfigError } from "@/lib/sheets";

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