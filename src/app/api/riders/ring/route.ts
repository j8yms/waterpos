import { requireRole } from "@/lib/auth";
import { notifyRiderOfDispatch } from "@/lib/push";
import { readTab } from "@/lib/sheets";
import type { DispatchOrder } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: { rider: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rider = String(body.rider ?? "").trim();
  if (!rider) return Response.json({ error: "Rider name required." }, { status: 400 });

  try {
    // Create a minimal order-like object for the push notification
    const mockOrder: DispatchOrder = {
      id: "ring-" + Date.now(),
      date: new Date().toISOString().split("T")[0],
      time: new Date().toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      customer: "RING ALERT",
      phone: "",
      address: body.message || "Management is calling you",
      product: "Please check your queue",
      qty: 0,
      unit_price: 0,
      total: 0,
      glovo: false,
      pay_status: "PENDING",
      payment_method: "",
      driver: rider,
      profit: 0,
      mpesa_code: "",
      notes: "",
      created_at: new Date().toISOString(),
    };

    await notifyRiderOfDispatch(mockOrder);

    return Response.json({ ok: true, rider });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to send ring notification." },
      { status: 500 }
    );
  }
}