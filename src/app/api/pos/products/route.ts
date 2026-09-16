import { requireRole } from "@/lib/auth";
import { appendRow, readTab, rowToProduct, seedInitialData, SheetsConfigError } from "@/lib/sheets";
import { DEFAULT_PRODUCTS } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const fallbackColors = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#f43f5e", "#eab308"];

  try {
    await seedInitialData();
    const read = await readTab("PRODUCTS");
    const base = read.rows.map(rowToProduct);
    const products = base.map((p, i) => ({
      ...p,
      color: p.color || fallbackColors[i % fallbackColors.length],
    }));
    return Response.json({ products });
  } catch (err) {
    // Sheets unavailable/misconfigured: serve the offline seed catalog so the
    // tile matrix keeps working. This is the same catalog Restock consumes.
    const products = DEFAULT_PRODUCTS.map((p, i) => ({
      ...p,
      color: p.color || fallbackColors[i % fallbackColors.length],
    }));
    return Response.json({ products, fromCache: true });
  }
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const { name, selling_price, wholesale_cost, unit, color, stock } = body;
    if (!name) return Response.json({ error: "Product name is required." }, { status: 400 });

    const id = "p" + Math.random().toString(36).slice(2, 8);
    // Header-driven append keeps PRODUCTS rows aligned with the sheet's
    // column set (TABS.PRODUCTS), matching the customer / order flow.
    await appendRow("PRODUCTS", {
      id,
      name: String(name),
      selling_price: Number(selling_price ?? 0),
      wholesale_cost: Number(wholesale_cost ?? 0),
      unit: String(unit ?? "Btl"),
      color: String(color ?? "#475569"),
      stock: Number(stock ?? 0),
      is_active: "TRUE",
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json(
      { error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed to create product." },
      { status: 500 }
    );
  }
}