import { requireRole } from "@/lib/auth";
import { getSheets, readTab, rowToProduct, seedInitialData, SheetsConfigError } from "@/lib/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    await seedInitialData();
    const read = await readTab("PRODUCTS");
    const base = read.rows.map(rowToProduct);
    const fallbackColors = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#f43f5e", "#eab308"];
    const products = base.map((p, i) => ({
      ...p,
      color: p.color || fallbackColors[i % fallbackColors.length],
    }));
    return Response.json({ products });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Failed to load products.";
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID!;
    const { name, selling_price, wholesale_cost, unit, color, stock } = body;
    if (!name) return Response.json({ error: "Product name is required." }, { status: 400 });

    const id = "p" + Math.random().toString(36).slice(2, 8);
    const row = [
      id,
      String(name),
      Number(selling_price ?? 0),
      Number(wholesale_cost ?? 0),
      String(unit ?? "Btl"),
      String(color ?? "#475569"),
      Number(stock ?? 0),
      "TRUE",
      new Date().toISOString(),
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "PRODUCTS!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}