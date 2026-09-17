import { requireRole, requireUser } from "@/lib/auth";
import { deleteRow, readAllLedgerRows, readTab, rowToOrder, rowToProduct, SheetsConfigError, updateRow } from "@/lib/sheets";
import { parseProductLine } from "@/lib/pricing";
import type { PayStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const status: string = String(body.pay_status ?? "").toUpperCase();
  if (!["PAID", "PENDING"].includes(status)) {
    return Response.json({ error: "pay_status must be PAID or PENDING." }, { status: 400 });
  }

  try {
    const read = await readTab("ORDERS");
    const idx = read.rows.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return Response.json({ error: "Order not found." }, { status: 404 });

    const order = rowToOrder(read.rows[idx], read.rowNumbers[idx]);

    if (user.role === "rider") {
      const driverName = user.name.trim().toLowerCase();
      if (order.driver.trim().toLowerCase() !== driverName) {
        return Response.json({ error: "You can only update your own assigned orders." }, { status: 403 });
      }
      // Riders may ONLY flip the pay button, never touch financials.
      await updateRow("ORDERS", read.rowNumbers[idx], {
        pay_status: status as PayStatus,
      });
      return Response.json({ ok: true, pay_status: status });
    }

    await updateRow("ORDERS", read.rowNumbers[idx], {
      pay_status: status as PayStatus,
      mpesa_code: body.mpesa_code !== undefined ? String(body.mpesa_code) : undefined,
    });
    return Response.json({ ok: true, pay_status: status });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

/**
 * Void / purge a transaction entirely: restore the quantities the order
 * consumed back to PRODUCTS stock, then delete the ledger row itself. Only
 * management can nuke rows (rider queue edits are just pay flips above).
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const ledger = await readAllLedgerRows();
    const entry = ledger.find((l) => l.order.id === String(id));
    if (!entry) return Response.json({ error: "Order not found." }, { status: 404 });

    // Restore stock consumed by this order (product summaries hold qty + name).
    const productsRead = await readTab("PRODUCTS");
    const lineItems = parseProductLine(entry.order.product);
    for (const line of lineItems) {
      const pIdx = productsRead.rows.findIndex(
        (r) => String(r?.name ?? "").trim().toLowerCase() === line.name.trim().toLowerCase()
      );
      if (pIdx === -1) continue;
      const product = rowToProduct(productsRead.rows[pIdx]);
      await updateRow("PRODUCTS", productsRead.rowNumbers[pIdx], {
        stock: Math.max(0, product.stock + line.qty),
        updated_at: new Date().toISOString(),
      });
    }

    await deleteRow(entry.tab, entry.order._row);
    return Response.json({ ok: true, voided: entry.order.id });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Order update failed.";
}