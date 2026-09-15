import { extractSmsFromPayload, matchMpesaToOrders } from "@/lib/sync";
import { SheetsConfigError } from "@/lib/sheets";

export const runtime = "nodejs";

const WEBHOOK_SECRET = process.env.MPESA_WEBHOOK_SECRET;

export async function POST(request: Request) {
  // Optional shared-secret header so only your Android forwarder can write.
  if (WEBHOOK_SECRET) {
    const provided = request.headers.get("x-webhook-secret");
    if (!provided || provided !== WEBHOOK_SECRET) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const texts = extractSmsFromPayload(body ?? {});
  if (!texts.length) {
    return Response.json({ error: "No SMS text found in payload." }, { status: 400 });
  }

  try {
    const report = await matchMpesaToOrders(texts);
    if (report.errors.length) {
      return Response.json({ ...report, error: report.errors.join("; ") }, { status: 500 });
    }
    return Response.json(report);
  } catch (err) {
    if (err instanceof SheetsConfigError) {
      return Response.json({ error: err.message }, { status: 500 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Webhook processing failed." },
      { status: 500 }
    );
  }
}