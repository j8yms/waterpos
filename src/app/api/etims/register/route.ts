import { requireUser } from "@/lib/auth";
import { buildEtimsPayloadForOrder, etimsSellerConfig, registerEtimsInvoice } from "@/lib/etims";
import { readTab, rowToOrder, SheetsConfigError, updateRow } from "@/lib/sheets";
import type { DispatchOrder, EtimsItem } from "@/lib/types";

export const runtime = "nodejs";

type OrderWithRow = DispatchOrder & { _row: number };

export async function POST(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    const orderId = String(body.orderId ?? "");
    const items = (Array.isArray(body.items) ? body.items : []) as EtimsItem[];

    if (!orderId) return Response.json({ error: "orderId is required." }, { status: 400 });
    if (!items.length) return Response.json({ error: "Ticket is empty." }, { status: 400 });

    const read = await readTab("ORDERS");
    const orders: OrderWithRow[] = read.rows.map((raw, i) =>
      rowToOrder(raw, read.rowNumbers[i]) as OrderWithRow
    );
    const order = orders.find((o) => o.id === orderId);
    if (!order) return Response.json({ error: "Order not found." }, { status: 404 });

    if (order.etims_num) {
      return Response.json({
        ok: true,
        order,
        invoice: {
          invoiceNumber: order.etims_num,
          cuSerialNumber: order.cu_serial ?? "",
          verificationUrl: order.etims_url ?? "",
        },
        alreadyRegistered: true,
      });
    }

    // Build the KRA payload and register (mock when KRA_ETIMS_MOCK=true).
    const payload = buildEtimsPayloadForOrder(order, items);
    const seller = etimsSellerConfig();
    const result = await registerEtimsInvoice(payload, seller, order.id);

    // Persist the returned invoice metadata back on the ORDERS row.
    await updateRow("ORDERS", order._row, {
      etims_num: result.invoiceNumber,
      cu_serial: result.cuSerialNumber,
      etims_url: result.verificationUrl,
    });

    return Response.json({
      ok: true,
      order: {
        ...order,
        etims_num: result.invoiceNumber,
        cu_serial: result.cuSerialNumber,
        etims_url: result.verificationUrl,
      },
      invoice: result,
    });
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 500 });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  return err instanceof Error ? err.message : "eTIMS register failed.";
}