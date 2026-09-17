import { requireRole } from "@/lib/auth";
import { appendRow, deleteRow, readTab, rowToCustomer, SheetsConfigError, updateRow } from "@/lib/sheets";
import { DEFAULT_CUSTOMERS } from "@/lib/config";
import crypto from "crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  try {
    const read = await readTab("CUSTOMERS");
    let customers: ReturnType<typeof rowToCustomer>[];
    if (read.rows.length) {
      customers = read.rows.map(rowToCustomer);
    } else {
      // Sheet tab empty or missing — use the built-in seed catalog so the
      // Customers directory always has data.
      customers = DEFAULT_CUSTOMERS.map((c) => ({
        id: crypto.randomUUID(),
        location: c.location,
        phone: c.phone,
        address: c.address,
        notes: c.notes,
        is_active: true,
      }));
    }
    customers = customers.filter((c) => c.is_active);

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

    // Deletion utility — fire a POST with action "deleteCustomer" + target
    // id to purge the row entirely from the CUSTOMERS sheet tab array. The
    // whole row dimension is removed so adjacent columns never shift and no
    // broken reference cells are left behind.
    if (String(body.action ?? "") === "deleteCustomer") {
      const id = String(body.id ?? "");
      if (!id) return Response.json({ error: "Customer id is required." }, { status: 400 });
      const read = await readTab("CUSTOMERS");
      const idx = read.rows.findIndex((r) => String(r.id) === String(id));
      if (idx === -1) return Response.json({ error: "Customer not found." }, { status: 404 });
      await deleteRow("CUSTOMERS", read.rowNumbers[idx]);
      return Response.json({ ok: true, deleted: id });
    }

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