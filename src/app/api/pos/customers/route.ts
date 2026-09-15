import { requireRole } from "@/lib/auth";
import { appendRow, readTab, rowToCustomer, SheetsConfigError, updateRow } from "@/lib/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  try {
    const read = await readTab("CUSTOMERS");
    let customers = read.rows.map(rowToCustomer).filter((c) => c.is_active);

    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      customers = customers.filter((c) => {
        const loc = c.location.toLowerCase();
        const phone = c.phone;
        const address = c.address.toLowerCase();
        return terms.every((t) => loc.includes(t) || phone.includes(t) || address.includes(t));
      });
    }

    customers.sort((a, b) => a.location.localeCompare(b.location));
    return Response.json({ customers: customers.slice(0, 25) });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const location = String(body.location ?? "").trim();
    if (!location) return Response.json({ error: "Location name is required." }, { status: 400 });

    const id = "c" + Math.random().toString(36).slice(2, 8);
    await appendRow("CUSTOMERS", {
      id,
      location,
      phone: String(body.phone ?? ""),
      address: String(body.address ?? ""),
      notes: String(body.notes ?? ""),
      is_active: "TRUE",
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const { id, location, phone, address, notes, is_active } = body;
    const read = await readTab("CUSTOMERS");
    const idx = read.rows.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return Response.json({ error: "Customer not found." }, { status: 404 });

    await updateRow("CUSTOMERS", read.rowNumbers[idx], {
      location: location !== undefined ? String(location) : undefined,
      phone: phone !== undefined ? String(phone) : undefined,
      address: address !== undefined ? String(address) : undefined,
      notes: notes !== undefined ? String(notes) : undefined,
      is_active: is_active !== undefined ? (is_active ? "TRUE" : "FALSE") : undefined,
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Customers request failed.";
}