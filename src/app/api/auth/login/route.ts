import { authenticatePin, signToken, toSafeUser, TOKEN_TTL_SECONDS } from "@/lib/auth";
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
  if (!/^\d{4}$/.test(pin)) {
    return Response.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
  }

  const user = await authenticatePin(pin);
  if (!user) {
    return Response.json({ error: "Invalid PIN." }, { status: 401 });
  }

  // Lazily prepare the spreadsheet so first login self-heals an empty sheet.
  try {
    await ensureSpreadsheetStructure();
  } catch {
    /* sheets may be unconfigured; handled per feature */
  }

  const token = signToken(user);
  const session = {
    token,
    user: toSafeUser(user),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  return Response.json(session);
}