import { requireRole, requireUser } from "@/lib/auth";
import { appendRow, readTab, rowToOrder, rowToProduct, SheetsConfigError, updateRow } from "@/lib/sheets";
import { computeTicket, nairobiDate, nairobiTime, normalizeCustomerName, normalizeSheetDate, orderSummaryPublic } from "@/lib/pricing";
import { notifyRiderOfDispatch } from "@/lib/push";
import { newOrderId } from "@/lib/sync";
import type { DispatchOrder, TicketItem } from "@/lib/types";

export const runtime = "nodejs";

type OrderWithRow = DispatchOrder & { _row: number };

/** Read the live sales ledger, preferring ORDERS but falling back to the
 *  legacy "OUT" tab that earlier spreadsheet versions used as the dispatch log. */
async function readLedger() {
  const primary = await readTab("ORDERS");
  if (primary.rows.length) return primary;
  try {
    const legacy = await readTab("OUT");
    if (legacy.rows.length) return legacy;
  } catch {
    /* OUT absent — fall through */
  }
  return primary;
}

export async function GET(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || nairobiDate();
  const month = url.searchParams.get("month");
  const driverParam = url.searchParams.get("driver");

  try {
    const read = await readLedger();
    let orders: OrderWithRow[] = [];
    read.rows.forEach((raw, i) => {
      orders.push(rowToOrder(raw, read.rowNumbers[i]) as OrderWithRow);
    });

    // Match the requested day against any date layout the sheet may hold, not
    // just the exact YYYY-MM-DD string the app writes.
    const todayKey = month ? "" : normalizeSheetDate(date) || date;
    const monthKey = month ? normalizeSheetDate(month + "-01")?.slice(0, 7) ?? month : "";

    orders = month
      ? orders.filter((o) => {
          const key = normalizeSheetDate(o.date);
          return key.length >= 7 && key.startsWith(monthKey || month);
        })
      : orders.filter((o) => normalizeSheetDate(o.date) === todayKey);

    if (user.role === "rider") {
      // Riders only ever see their own queue, and never financials.
      // Show orders assigned to this rider OR unassigned ("up for grabs").
      const driverName = String(driverParam || user.name).trim().toLowerCase();
      orders = orders.filter(
        (o) => o.driver.trim().toLowerCase() === driverName || o.driver.trim().toUpperCase() === "UNASSIGNED"
      );
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
      payment_method: o.payment_method,
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
    const paymentMethodRaw = String(body.paymentMethod ?? "").trim().toUpperCase();
    const paymentMethod: "CASH" | "MPESA" | "GLOVO" | "CREDIT" | "" =
      paymentMethodRaw === "CASH" ||
      paymentMethodRaw === "MPESA" ||
      paymentMethodRaw === "GLOVO" ||
      paymentMethodRaw === "CREDIT"
        ? paymentMethodRaw
        : "";
    // CASH settles instantly; M-PESA and GLOVO-channel orders stay PENDING
    // until payment clears; CREDIT (madeni) stays PENDING until collected.
    const payStatus: "PAID" | "PENDING" =
      paymentMethod === "CASH" && !glovo
        ? "PAID"
        : paymentMethod === "CREDIT"
          ? "PENDING"
          : String(body.payStatus ?? body.pay_status ?? "PENDING").toUpperCase() === "PAID"
            ? "PAID"
            : "PENDING";
    const notes = String(body.notes ?? "");
    const requested = Array.isArray(body.items) ? body.items : [];

    if (!driver) return Response.json({ error: "Driver is required." }, { status: 400 });
    if (!requested.length) return Response.json({ error: "Ticket is empty." }, { status: 400 });

    // Load product master & customers ONCE (single read each, not per item)
    const [productsRead, customersRead] = await Promise.all([
      readTab("PRODUCTS"),
      readTab("CUSTOMERS"),
    ]);

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

    const totals = computeTicket(items, glovo || paymentMethod === "GLOVO");

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
      glovo: glovo || paymentMethod === "GLOVO",
      pay_status: payStatus,
      payment_method: paymentMethod,
      driver,
      profit: Math.round(totals.finalProfit * 100) / 100,
      mpesa_code: String(body.mpesa_code ?? body.mpesaCode ?? ""),
      notes,
      created_at: new Date().toISOString(),
      balance: payStatus === "PENDING" ? Math.round(totals.subtotal * 100) / 100 : 0,
      last_payment_at: "",
    };

    await appendRow("ORDERS", order);

    // Fire the dispatch push to the assigned rider once the order is safely
    // on the ledger. Non-blocking: a push failure must never fail the order.
    void notifyRiderOfDispatch(order).catch(() => {
      /* push is best-effort */
    });

    // Batch stock updates: single read already done, use updateRow for each (sparse write)
    // This avoids re-reading PRODUCTS tab for each item.
    const stockUpdates = items.map((it) => {
      const product = productMap.get(it.productId)!;
      const pIdx = productsRead.rows.findIndex((r) => String(r.id) === it.productId);
      return pIdx >= 0
        ? updateRow("PRODUCTS", productsRead.rowNumbers[pIdx], {
            stock: Math.max(0, product.stock - it.qty),
            updated_at: new Date().toISOString(),
          })
        : Promise.resolve();
    });
    await Promise.all(stockUpdates);

    return Response.json({ ok: true, order });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "Orders request failed.";
}