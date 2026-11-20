import { requireRole } from "@/lib/auth";
import { appendRow, ensureSpreadsheetStructure, readAllLedgerRows, readTab, SheetsConfigError, updateRow } from "@/lib/sheets";
import { processRepayment } from "@/lib/repayment-service";

export const runtime = "nodejs";

let repaymentLock: Promise<void> = Promise.resolve();
function acquireRepaymentLock(): Promise<() => void> {
  let release!: () => void;
  const wait = repaymentLock.then(() => {
    return () => { release(); };
  });
  repaymentLock = new Promise<void>((resolve) => { release = resolve; });
  return wait;
}

export async function POST(request: Request) {
  const user = requireRole(request, "management");
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const release = await acquireRepaymentLock();
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const sheets = {
      ensureSpreadsheetStructure,
      readTab,
      readAllLedgerRows,
      updateRow,
      appendRow,
    };

    try {
      const result = await processRepayment(body, sheets);
      return Response.json(result);
    } catch (err) {
      const msg = err instanceof SheetsConfigError ? err.message : err instanceof Error ? err.message : "Repayment request failed.";
      return Response.json({ error: msg }, { status: 400 });
    }
  } finally {
    release();
  }
}
