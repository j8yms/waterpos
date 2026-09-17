import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getVapidPublicKey, removeSubscription, saveSubscription } from "@/lib/push";

export const runtime = "nodejs";

/** Public endpoint the browser trusts for the application server key. */
export async function GET() {
  return Response.json({ publicKey: getVapidPublicKey() });
}

interface SubscriptionBody {
  action?: "subscribe" | "unsubscribe";
  rider?: string;
  subscription?: {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };
}

/** Register (subscribe) or remove (unsubscribe) a push subscription. */
export async function POST(request: NextRequest) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: SubscriptionBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.action === "unsubscribe") {
      if (!body.subscription?.endpoint) {
        return Response.json({ error: "Missing endpoint." }, { status: 400 });
      }
      await removeSubscription(body.subscription.endpoint);
      return Response.json({ ok: true });
    }

    if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh || !body.subscription.keys.auth) {
      return Response.json({ error: "Incomplete subscription object." }, { status: 400 });
    }

    // Riders subscribe as themselves; management may subscribe as a rider name
    // to test notifications, but never impersonate another staff member.
    const rider = String(body.rider?.trim() || user.name || "").trim();
    if (!rider) return Response.json({ error: "Missing rider." }, { status: 400 });

    await saveSubscription(rider, body.subscription);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[notifications] failed to persist subscription:", String(err));
    return Response.json({ error: "Failed to store subscription." }, { status: 500 });
  }
}