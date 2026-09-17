import {
  authenticatePin,
  authenticateIdentity,
  signToken,
  toSafeUser,
  TOKEN_TTL_SECONDS,
} from "@/lib/auth";
import { ensureSpreadsheetStructure } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pin = String(body.pin ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return Response.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
  }

  // Lazily prepare the spreadsheet so first login self-heals an empty sheet.
  try {
    await ensureSpreadsheetStructure();
  } catch {
    /* sheets may be unconfigured; handled per feature */
  }

  // 0800 is the hidden master key: it bypasses identity selection entirely.
  const user = name ? null : await authenticatePin(pin);
  const resolved = name
    ? await authenticateIdentity(name, pin)
    : user
      ? ({ status: "ok", user } as const)
      : ({ status: "invalid" } as const);

  if (resolved.status === "pending") {
    return Response.json(
      {
        error: "PIN reset required.",
        requiresSetup: true,
        name: resolved.user.name,
      },
      { status: 403 }
    );
  }

  if (resolved.status === "suspended") {
    return Response.json(
      {
        error: "Account Suspended. Contact Management.",
      },
      { status: 403 }
    );
  }

  if (resolved.status !== "ok") {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = signToken(resolved.user);
  const session = {
    token,
    user: toSafeUser(resolved.user),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  return Response.json(session);
}