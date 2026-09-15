import { requireRole } from "@/lib/auth";
import { getUsersFromSheet } from "@/lib/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const users = await getUsersFromSheet();
    return Response.json({
      staff: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    });
  } catch {
    return Response.json({ staff: [] });
  }
}