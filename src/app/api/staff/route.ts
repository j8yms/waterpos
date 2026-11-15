import crypto from "crypto";
import { requireUser } from "@/lib/auth";

import { listStaffUsers, findAndUpdateStaff, appendRow, getUsersFromSheet } from "@/lib/sheets";
import { canManageStaff } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Staff directory. Visible to the hidden master 0800 account and Vinnie only.
 * The master account is never in the USERS sheet, so it can never be listed.
 */
export async function GET(request: Request) {
  const user = requireUser(request);
  if (!user || user.role !== "management" && user.role !== "master") {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const staff = await listStaffUsers();
    return Response.json({
      staff: staff.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        is_reset_pending: s.is_reset_pending,
        isSuspended: s.isSuspended,
      })),
    });
  } catch {
    return Response.json({ staff: [] });
  }
}

interface StaffBody {
  action?: "resetPin" | "toggleSuspend" | "create";
  id?: string;
  isSuspended?: boolean;
  name?: string;
  role?: "rider" | "management";
  pin?: string;
}

/**
 * Clear a user's PIN and flag their record for self-service re-registration.
 * The worker then sets their own PIN from the login canvas.
 */
export async function POST(request: Request) {
  const user = requireUser(request);
  if (!user || !canManageStaff(user)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: StaffBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Master (0800) can do everything. Vinnie can create staff only.
  const isMaster = user.role === "master";
  const canSuspendOrCreate = isMaster || (user.role === "management" && user.name?.toLowerCase() === "vinnie");

  if (body.action === "create") {
    if (!canSuspendOrCreate) {
      return Response.json({ error: "Insufficient privileges to create staff." }, { status: 403 });
    }
    const name = String(body.name ?? "").trim();
    const role = body.role;
    const pin = String(body.pin ?? "").trim();
    if (!name) return Response.json({ error: "Name required." }, { status: 400 });
    if (!role || !["rider", "management"].includes(role)) return Response.json({ error: "Role must be 'rider' or 'management'." }, { status: 400 });
    if (!/^\d{4}$/.test(pin)) return Response.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
    if (pin === "0800") return Response.json({ error: "PIN 0800 is reserved." }, { status: 400 });

    try {
      // Check for duplicate name/PIN using full user list (includes PINs)
      const allUsers = await getUsersFromSheet();
      if (allUsers.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
        return Response.json({ error: "A staff member with this name already exists." }, { status: 409 });
      }
      if (allUsers.some((u) => u.pin === pin)) {
        return Response.json({ error: "This PIN is already assigned to another staff member." }, { status: 409 });
      }

      const newId = crypto.randomUUID();
      await appendRow("USERS", {
        id: newId,
        name,
        pin,
        role,
        active: "TRUE",
        is_reset_pending: "FALSE",
        isSuspended: "FALSE",
      });

      return Response.json({ ok: true, id: newId, name, role });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to create staff." },
        { status: 500 }
      );
    }
  }

  // Only master (0800) can reset PIN or suspend/unsuspend
  if (!isMaster) {
    return Response.json({ error: "Insufficient privileges. Only Super Admin can reset PIN or suspend." }, { status: 403 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "Missing staff id." }, { status: 400 });

  if (body.action === "toggleSuspend") {
    if (typeof body.isSuspended !== "boolean") {
      return Response.json({ error: "Missing isSuspended boolean." }, { status: 400 });
    }
    try {
      const result = await findAndUpdateStaff(id, { isSuspended: body.isSuspended });
      if (!result.ok) return Response.json({ error: "Staff member not found." }, { status: 404 });

      return Response.json({ ok: true, id, name: result.name, isSuspended: body.isSuspended });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to toggle suspend." },
        { status: 500 }
      );
    }
  }

  if (body.action !== "resetPin") {
    return Response.json({ error: "Unsupported action." }, { status: 400 });
  }

  try {
    const result = await findAndUpdateStaff(id, { pin: "", is_reset_pending: true });
    if (!result.ok) return Response.json({ error: "Staff member not found." }, { status: 404 });

    return Response.json({ ok: true, id, name: result.name, is_reset_pending: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to reset PIN." },
      { status: 500 }
    );
  }
}