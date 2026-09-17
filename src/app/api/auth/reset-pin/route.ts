import { MASTER_PIN } from "@/lib/config";
import { signToken, toSafeUser, TOKEN_TTL_SECONDS } from "@/lib/auth";
import {
  ensureSpreadsheetStructure,
  getUsersFromSheet,
  listStaffUsers,
  updateStaffCredentials,
} from "@/lib/sheets";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Self-service credential registration. A worker whose PIN was reset by
 * management selects their identity on the login canvas, enters a new 4-digit
 * PIN twice, and is logged straight into their dashboard.
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const pin = String(body.pin ?? "").trim();
  const confirm = String(body.confirm ?? "").trim();

  if (!name) return Response.json({ error: "Missing worker identity." }, { status: 400 });
  if (!/^\d{4}$/.test(pin)) {
    return Response.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
  }
  if (confirm && confirm !== pin) {
    return Response.json({ error: "PIN entries do not match." }, { status: 400 });
  }
  if (pin === MASTER_PIN) {
    return Response.json({ error: "That PIN is reserved. Choose another." }, { status: 400 });
  }

  try {
    await ensureSpreadsheetStructure();

    const staff = await listStaffUsers();
    const target = staff.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (!target) return Response.json({ error: "Worker not found." }, { status: 404 });
    if (!target.is_reset_pending) {
      return Response.json(
        { error: "No PIN reset is pending for this worker." },
        { status: 409 }
      );
    }

    // PINs must stay unique across the crew so a code can never cross-identify.
    const users = await getUsersFromSheet();
    const taken = users.some(
      (u) => u.id !== target.id && u.pin === pin
    );
    if (taken) {
      return Response.json({ error: "That PIN is already in use. Choose another." }, { status: 409 });
    }

    const ok = await updateStaffCredentials(target.id, { pin, is_reset_pending: false });
    if (!ok) return Response.json({ error: "Staff row not found in USERS sheet." }, { status: 404 });

    const user: User = { id: target.id, name: target.name, role: target.role };
    const token = signToken(user);
    const session = {
      token,
      user: toSafeUser(user),
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    };
    return Response.json(session);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to set PIN." },
      { status: 500 }
    );
  }
}