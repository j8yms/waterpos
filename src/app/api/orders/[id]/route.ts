import { requireUser } from "@/lib/auth";
import { readTab, updateRow, rowToOrder, invalidateCache } from "@/lib/sheets";
import { SheetsConfigError } from "@/lib/sheets";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "Order ID required." }, { status: 400 });

  let body: Partial<{ pay_status: string; driver: string }>;
  const validStatuses = ["PAID", "PENDING", "ON_TRANSIT", "REJECTED"];
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate pay_status if provided
  if (body.pay_status && !validStatuses.includes(body.pay_status.toUpperCase())) {
    return Response.json({ error: "Invalid pay_status." }, { status: 400 });
  }
  if (body.pay_status) body.pay_status = body.pay_status.toUpperCase();

  try {
    const read = await readTab("ORDERS");
    if (!read.rows.length) return Response.json({ error: "Order not found." }, { status: 404 });

    const idx = read.rows.findIndex((r) => String(r.id) === id);
    if (idx === -1) {
      // Also check OUT tab
      const outRead = await readTab("OUT");
      const outIdx = outRead.rows.findIndex((r) => String(r.id) === id);
      if (outIdx === -1) return Response.json({ error: "Order not found." }, { status: 404 });

      const outOrder = rowToOrder(outRead.rows[outIdx], outRead.rowNumbers[outIdx]);

      // Rider can only claim unassigned or their own orders
      if (user.role === "rider") {
        const isUnassigned = outOrder.driver.trim().toUpperCase() === "UNASSIGNED";
        const isMine = outOrder.driver.trim().toLowerCase() === user.name?.toLowerCase();
        if (!isUnassigned && !isMine) {
          return Response.json({ error: "Cannot modify this order." }, { status: 403 });
        }
      }

      const patch: Record<string, string> = {};
      if (body.pay_status) patch.pay_status = body.pay_status;
      if (body.driver) patch.driver = body.driver;

      if (Object.keys(patch).length > 0) {
        await updateRow("OUT", outRead.rowNumbers[outIdx], patch);
        invalidateCache("tab:OUT");
      }

      return Response.json({ ok: true });
    }

    const order = rowToOrder(read.rows[idx], read.rowNumbers[idx]);

    // Rider can only claim unassigned or their own orders
    if (user.role === "rider") {
      const isUnassigned = order.driver.trim().toUpperCase() === "UNASSIGNED";
      const isMine = order.driver.trim().toLowerCase() === user.name?.toLowerCase();
      if (!isUnassigned && !isMine) {
        return Response.json({ error: "Cannot modify this order." }, { status: 403 });
      }
    }

    const patch: Record<string, string> = {};
    if (body.pay_status) patch.pay_status = body.pay_status;
    if (body.driver) patch.driver = body.driver;

    if (Object.keys(patch).length > 0) {
      await updateRow("ORDERS", read.rowNumbers[idx], patch);
      invalidateCache("tab:ORDERS");
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Update failed." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = requireUser(request);
  if (!user || user.role !== "management") {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return Response.json({ error: "Order ID required." }, { status: 400 });

  try {
    const read = await readTab("ORDERS");
    const idx = read.rows.findIndex((r) => String(r.id) === id);
    if (idx >= 0) {
      // Delete from ORDERS by clearing the row (Google Sheets doesn't support easy row deletion via values API)
      // Instead, mark as voided by clearing key fields
      await updateRow("ORDERS", read.rowNumbers[idx], {
        id: `VOID-${id}`,
        customer: "VOIDED",
        total: "0",
        pay_status: "VOIDED",
      });
      return Response.json({ ok: true });
    }

    // Check OUT tab
    const outRead = await readTab("OUT");
    const outIdx = outRead.rows.findIndex((r) => String(r.id) === id);
    if (outIdx >= 0) {
      await updateRow("OUT", outRead.rowNumbers[outIdx], {
        id: `VOID-${id}`,
        customer: "VOIDED",
        total: "0",
        pay_status: "VOIDED",
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Order not found." }, { status: 404 });
  } catch (err) {
    return Response.json(
      { error: err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Delete failed." },
      { status: 500 }
    );
  }
}