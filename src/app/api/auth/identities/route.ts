import { listStaffUsers } from "@/lib/sheets";

export const runtime = "nodejs";

/**
 * Public identity roster for the login canvas. Returns only names/roles plus
 * the reset-pending flag — never PINs — so a worker can select who they are.
 * The hidden master account is not stored in the sheet and is never listed.
 */
export async function GET() {
  try {
    const staff = await listStaffUsers();
    return Response.json({
      staff: staff
        .filter((s) => s.role !== "master")
        .map((s) => ({
          id: s.id,
          name: s.name,
          role: s.role,
          is_reset_pending: s.is_reset_pending,
        })),
    });
  } catch {
    return Response.json({ staff: [] });
  }
}