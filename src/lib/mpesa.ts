import type { ParsedMpesa } from "./types";

/**
 * Safaricom M-Pesa SMS examples:
 *   "NKJ78X9P2Q Confirmed. Ksh550.00 received from JAMES KARANJA on 5/9/2026 at 2:34 PM.
 *    New M-PESA balance is Ksh 3,420.00. Transaction cost, Ksh0.00."
 */
export const MPESA_CODE_RE = /([A-Z0-9]{9,12})\s+Confirmed/i;
export const MPESA_AMOUNT_RE = /Ksh\s?([0-9][0-9,]*\.?[0-9]*)/i;

const DECIMAL_STRING_RE = /([0-9][0-9,]*\.?[0-9]*)/;

export function parseRawAmount(raw: string): number | null {
  const m = raw.match(DECIMAL_STRING_RE);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseMpesaSms(text: string): ParsedMpesa | null {
  if (!text) return null;
  const codeMatch = text.match(MPESA_CODE_RE);
  const amountMatch = text.match(MPESA_AMOUNT_RE);

  if (!codeMatch && !amountMatch) return null;

  const code = codeMatch?.[1] ?? "";
  const rawAmount = amountMatch?.[1] ?? "";
  const amount = rawAmount ? parseRawAmount(rawAmount) : null;

  if (amount === null) return null;

  return { code, amount, raw: text.slice(0, 500) };
}

export function amountsMatch(a: number, b: number, tolerance = 0.05): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Extract an SMS string from the many JSON shapes an Android forwarder may send. */
export function extractSmsFromPayload(body: any): string[] {
  const texts: string[] = [];

  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) texts.push(v.trim());
  };

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      push(msg.body ?? msg.text ?? msg.message ?? msg.sms ?? msg.content ?? msg.snippet);
    }
  } else if (body.message && typeof body.message === "object") {
    push(body.message.text ?? body.message.body ?? body.message.message);
  } else {
    // Loose pass-through: a body may contain sms/text/message/body at root level.
    for (const key of ["sms", "text", "message", "body", "content"]) {
      const v = body[key];
      if (typeof v === "string" && v.trim()) {
        texts.push(v.trim());
        break;
      }
    }
  }

  return [...new Set(texts)];
}