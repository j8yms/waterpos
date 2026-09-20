import { requireUser } from "@/lib/auth";
import { readTab, updateRow, appendRow } from "@/lib/sheets";

export const runtime = "nodejs";

const PRESENCE_TAB = "RIDER_PRESENCE";
const PRESENCE_HEADERS = ["rider", "status", "last_seen", "device_id"];

export async function GET(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  // Only management/master can see all riders' presence
  if (user.role !== "management" && user.role !== "master") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const read = await readTab(PRESENCE_TAB);
    const presence = read.rows.map((r) => ({
      rider: String(r.rider ?? "").trim(),
      status: String(r.status ?? "offline").trim(),
      last_seen: String(r.last_seen ?? "").trim(),
      device_id: String(r.device_id ?? "").trim(),
    })).filter((p) => p.rider);

    return Response.json({ presence });
  } catch {
    return Response.json({ presence: [] });
  }
}

export async function POST(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  if (user.role !== "rider") {
    return Response.json({ error: "Forbidden: riders only." }, { status: 403 });
  }

  let body: { status: string; device_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { status, device_id } = body;
  if (!status || !["online", "offline"].includes(status)) {
    return Response.json({ error: "Status must be 'online' or 'offline'." }, { status: 400 });
  }

  try {
    // Ensure tab exists
    try {
      await readTab(PRESENCE_TAB);
    } catch {
      await appendRow(PRESENCE_TAB, {
        rider: "",
        status: "",
        last_seen: "",
        device_id: "",
      });
    }

    const read = await readTab(PRESENCE_TAB);
    const idx = read.rows.findIndex(
      (r) => String(r.rider ?? "").trim().toLowerCase() === user.name.toLowerCase()
        && String(r.device_id ?? "").trim() === (device_id || "default")
    );

    const now = new Date().toISOString();
    const row = {
      rider: user.name,
      status,
      last_seen: now,
      device_id: device_id || "default",
    };

    if (idx >= 0) {
      await updateRow(PRESENCE_TAB, read.rowNumbers[idx], row);
    } else {
      await appendRow(PRESENCE_TAB, row);
    }

    return Response.json({ ok: true, status, last_seen: now });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = requireUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  if (user.role !== "rider") {
    return Response.json({ error: "Forbidden: riders only." }, { status: 403 });
  }

  const url = new URL(request.url);
  const device_id = url.searchParams.get("device_id") || "default";

  try {
    const read = await readTab(PRESENCE_TAB);
    const idx = read.rows.findIndex(
      (r) => String(r.rider ?? "").trim().toLowerCase() === user.name.toLowerCase()
        && String(r.device_id ?? "").trim() === device_id
    );

    if (idx >= 0) {
      await updateRow(PRESENCE_TAB, read.rowNumbers[idx], { status: "offline", last_seen: new Date().toISOString() });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}