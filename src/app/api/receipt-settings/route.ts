import { requireRole } from "@/lib/auth";
import { appendRow, ensureSpreadsheetStructure, readTab, SheetsConfigError, updateRow } from "@/lib/sheets";

export const runtime = "nodejs";

const DEFAULT_SETTINGS = {
  businessName: "MIST WATER AND GAS DISTRIBUTORS",
  businessTagline: "Bulk Water Supply",
  phone: "",
  address: "",
  footerText: "Thank you for your business!",
  width: "80",
  fontSize: "12",
  showQty: true,
  showPrices: true,
  showDiscounts: true,
  showDelivery: true,
  showPaymentMethod: true,
  showMpesaRef: true,
  showOutstanding: true,
  logoDataUrl: "",
};

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    await ensureSpreadsheetStructure();
    const read = await readTab("RECEIPT_SETTINGS");
    if (!read.rows.length) return Response.json({ settings: DEFAULT_SETTINGS });
    const last = read.rows[read.rows.length - 1];
    const parsed = JSON.parse(String(last.settings_json ?? "{}"));
    return Response.json({ settings: { ...DEFAULT_SETTINGS, ...parsed } });
  } catch (err) {
    return Response.json({ error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    await ensureSpreadsheetStructure();
    const body = await request.json();
    const settings = { ...DEFAULT_SETTINGS, ...(body.settings ?? {}) };
    await appendRow("RECEIPT_SETTINGS", {
      id: "rs-" + Date.now(),
      settings_json: JSON.stringify(settings),
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, settings });
  } catch (err) {
    return Response.json({ error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
