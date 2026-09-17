import { requireUser } from "@/lib/auth";
import { canManageStaff } from "@/lib/config";
import { listStaffUsers, updateStaffCredentials, ensureSpreadsheetStructure } from "@/lib/sheets";

export const runtime = "nodejs";

/**
 * Staff directory. Visible to the hidden master 0800 account and Vinnie only.
 * The master account is never in the USERS sheet, so it can never be listed.
 */
export async function GET(request: Request) {
  const user = requireUser(request);
  if (!user || !canManageStaff(user)) {
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
  action?: "resetPin" | "toggleSuspend";
  id?: string;
  isSuspended?: boolean;
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

  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "Missing staff id." }, { status: 400 });

  // Suspend/unsuspend is restricted to master (0800) and Vinnie only
  const canSuspend = user.role === "master" || (user.role === "management" && user.name?.toLowerCase() === "vinnie");

  if (body.action === "toggleSuspend") {
    if (!canSuspend) {
      return Response.json({ error: "Insufficient privileges to suspend/unsuspend." }, { status: 403 });
    }
    if (typeof body.isSuspended !== "boolean") {
      return Response.json({ error: "Missing isSuspended boolean." }, { status: 400 });
    }
    try {
      await ensureSpreadsheetStructure();
      const staff = await listStaffUsers();
      const target = staff.find((s) => String(s.id) === id);
      if (!target) return Response.json({ error: "Staff member not found." }, { status: 404 });

      const ok = await updateStaffCredentials(id, { isSuspended: body.isSuspended });
      if (!ok) return Response.json({ error: "Staff row not found in USERS sheet." }, { status: 404 });

      return Response.json({ ok: true, id, name: target.name, isSuspended: body.isSuspended });
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
    await ensureSpreadsheetStructure();
    const staff = await listStaffUsers();
    const target = staff.find((s) => String(s.id) === id);
    if (!target) return Response.json({ error: "Staff member not found." }, { status: 404 });

    const ok = await updateStaffCredentials(id, { pin: "", is_reset_pending: true });
    if (!ok) return Response.json({ error: "Staff row not found in USERS sheet." }, { status: 404 });

    return Response.json({ ok: true, id, name: target.name, is_reset_pending: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to reset PIN." },
      { status: 500 }
    );
  }
}