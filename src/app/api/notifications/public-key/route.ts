import { getVapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";

/** Public endpoint the browser trusts for the application server key. */
export async function GET() {
  return Response.json({ publicKey: getVapidPublicKey() });
}