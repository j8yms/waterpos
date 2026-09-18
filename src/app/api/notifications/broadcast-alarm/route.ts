import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { broadcastRingAlarm } from "@/lib/push";

export const runtime = "nodejs";

/** Broadcast a ring alarm to ALL registered rider devices.
 *  Only management can trigger this. */
export async function POST(request: NextRequest) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = String(body.message ?? "").trim() || "Management is calling all riders!";

  try {
    await broadcastRingAlarm(message);
    return Response.json({ ok: true, message: "Ring alarm broadcast sent to all riders." });
  } catch (err) {
    console.error("[broadcast-alarm] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to send broadcast alarm." },
      { status: 500 }
    );
  }
}