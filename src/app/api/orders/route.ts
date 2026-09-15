import { requireRole, requireUser } from "@/lib/auth";
import { appendRow, readTab, rowToOrder, rowToProduct, SheetsConfigError, updateRow } from "@/lib/sheets";
import { computeTicket, nairobiDate, nairobiTime, normalizeCustomerName, orderSummaryPublic } from "@/lib/pricing";
import { newOrderId } from "@/lib/sync";
import type { DispatchOrder, TicketItem } from "@/lib/types";

export const runtime = "nodejs";

type OrderWithRow = DispatchOrder & { _row: number };

export async function GET(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || nairobiDate();
  const driverParam = url.searchParams.get("driver");

  try {
    const read = await readTab("ORDERS");
    let orders: OrderWithRow[] = [];
    read.rows.forEach((raw, i) => {
      orders.push(rowToOrder(raw, read.rowNumbers[i]) as OrderWithRow);
    });

    orders = orders.filter((o) => o.date === date);

    if (user.role === "rider") {
      // Riders only ever see their own queue, and never financials.
      const driverName = String(driverParam || user.name).trim().toLowerCase();
      orders = orders.filter((o) => o.driver.trim().toLowerCase() === driverName);
      return Response.json({
        orders: orders.map((o) => orderSummaryPublic(o)),
      });
    }

    if (driverParam) {
      const driverName = String(driverParam).trim().toLowerCase();
      orders = orders.filter((o) => o.driver.trim().toLowerCase() === driverName);
    }

    const safe = orders.map((o) => ({
      id: o.id,
      date: o.date,
      time: o.time,
      customer: o.customer,
      phone: o.phone,
      address: o.address,
      product: o.product,
      qty: o.qty,
      unit_price: o.unit_price,
      total: o.total,
      glovo: o.glovo,
      pay_status: o.pay_status,
      driver: o.driver,
      profit: o.profit,
      mpesa_code: o.mpesa_code,
      notes: o.notes,
      created_at: o.created_at,
    }));
    return Response.json({ orders: safe });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const driver = String(body.driver ?? "").trim();
    const glovo = Boolean(body.glovo);
    const payStatus = String(body.payStatus ?? body.pay_status ?? "PENDING").toUpperCase() === "PAID" ? "PAID" : "PENDING";
    const notes = String(body.notes ?? "");
    const requested = Array.isArray(body.items) ? body.items : [];

    if (!driver) return Response.json({ error: "Driver is required." }, { status: 400 });
    if (!requested.length) return Response.json({ error: "Ticket is empty." }, { status: 400 });

    // Load product master so costs are computed server-side only.
    const productsRead = await readTab("PRODUCTS");
    const productMap = new Map(productsRead.rows.map(rowToProduct).map((p) => [p.id, p]));

    const items: TicketItem[] = [];
    for (const it of requested) {
      const product = productMap.get(String(it.productId));
      if (!product) return Response.json({ error: `Unknown product: ${it.productId}` }, { status: 400 });
      const qty = Math.max(1, Math.round(Number(it.qty) || 1));
      if (product.stock < qty) {
        return Response.json({ error: `Insufficient stock for ${product.name} (${product.stock} left).` }, { status: 409 });
      }
      items.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.selling_price,
        cost: product.wholesale_cost,
        qty,
        color: product.color,
      });
    }

    const totals = computeTicket(items, glovo);

    const customersRead = await readTab("CUSTOMERS");
    const customers = customersRead.rows.map((r) => ({
      location: String(r.location ?? ""),
      phone: String(r.phone ?? ""),
      address: String(r.address ?? ""),
    }));
    const resolved = normalizeCustomerName(String(body.customer ?? ""), customers);
    const customerName = resolved.customer || "WALK-IN CUSTOMER";

    const productLine = items.map((i) => `${i.qty} x ${i.name}`).join(" + ") || "—";
    const order: DispatchOrder = {
      id: newOrderId(),
      date: nairobiDate(),
      time: nairobiTime(),
      customer: customerName,
      phone: resolved.phone || String(body.phone ?? ""),
      address: resolved.address || String(body.address ?? ""),
      product: productLine,
      qty: items.reduce((s, i) => s + i.qty, 0),
      unit_price: items.reduce((s, i) => s + i.unitPrice * i.qty, 0) / Math.max(1, items.reduce((s, i) => s + i.qty, 0)),
      total: Math.round(totals.subtotal * 100) / 100,
      glovo,
      pay_status: payStatus,
      driver,
      profit: Math.round(totals.finalProfit * 100) / 100,
      mpesa_code: "",
      notes,
      created_at: new Date().toISOString(),
    };

    await appendRow("ORDERS", order);

    // Decrement stock after the order is safely logged.
    for (const it of items) {
      const product = productMap.get(it.productId)!;
      const pIdx = productsRead.rows.findIndex((r) => String(r.id) === it.productId);
      if (pIdx >= 0) {
        await updateRow("PRODUCTS", productsRead.rowNumbers[pIdx], {
          stock: Math.max(0, product.stock - it.qty),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return Response.json({ ok: true, order });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Orders request failed.";
}