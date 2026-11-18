import crypto from "crypto";
import { TAX_CODE, VAT_RATE } from "./config";
import type { EtimsItem, EtimsResult, VatSplits } from "./types";

/**
 * ── KRA eTIMS (OSCU S2S) integration ─────────────────────────────────────────
 *
 * Two modes:
 *   • REAL  — requires KRA_ETIMS_URL + KRA_ETIMS_TIN + KRA_ETIMS_API_SECRET etc.
 *             in .env.local. Builds the KRA OSCU invoice payload and POSTs it
 *             to the KRA endpoint, then writes invoiceNumber / cuSerialNumber /
 *             verificationUrl back to the ORDERS sheet.
 *   • MOCK  — set KRA_ETIMS_MOCK=true. No network calls: returns deterministic
 *             fake invoice data so the whole flow (toggle → print → QR) can be
 *             tested immediately, even offline.
 */

const MOCK_INVOICE_BASE = 9900000000;
const TAX_TYPE_VAT = "B"; // KRA code for regular VAT

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * VAT-per-ticket-split. The checkout grand total is VAT-inclusive and walks
 * back to an 16% VAT figure exactly as KRA expects:
 *   taxSubtotal = grandTotal - (grandTotal / 1.16)
 *   netSubtotal = grandTotal - taxSubtotal
 */
export function vatSplits(grandTotal: number): VatSplits {
  const gross = round2(grandTotal);
  const net = round2(gross / (1 + VAT_RATE));
  const vat = round2(gross - net);
  return { gross, net, vat };
}

/** VAT split per line item (each line is treated as its own VAT bloc). */
export function vatSplitLine(lineGross: number): { gross: number; net: number; vat: number } {
  const gross = round2(lineGross);
  const net = round2(gross / (1 + VAT_RATE));
  const vat = round2(gross - net);
  return { gross, net, vat };
}

export interface EtimsSellerConfig {
  tin: string;
  bhfId: string;
  dvcSrlNo: string;
  apiSecret: string;
  url: string;
  mock?: boolean;
  taxCd?: string;
}

export function etimsConfigured(): boolean {
  return Boolean(
    process.env.KRA_ETIMS_URL &&
      (process.env.KRA_ETIMS_MOCK === "true" ||
        (process.env.KRA_ETIMS_TIN && process.env.KRA_ETIMS_API_SECRET))
  );
}

export function etimsSellerConfig(): EtimsSellerConfig {
  return {
    tin: String(process.env.KRA_ETIMS_TIN || "").trim(),
    bhfId: String(process.env.KRA_ETIMS_BHF_ID || "00").trim(),
    dvcSrlNo: String(process.env.KRA_ETIMS_DEVICE_SERIAL || "").trim(),
    apiSecret: String(process.env.KRA_ETIMS_API_SECRET || "").trim(),
    url: String(process.env.KRA_ETIMS_URL || "").trim(),
    mock: String(process.env.KRA_ETIMS_MOCK || "").trim() === "true",
    taxCd: process.env.KRA_ETIMS_TAX_CD || TAX_CODE,
  };
}

/** Build the single OSCU invoice payload sent to KRA. */
export function buildEtimsInvoicePayload(
  input: {
    invoiceNo: string;
    tranDt: string;
    salesDt: string;
    customerName: string;
    customerKraPin: string;
    items: EtimsItem[];
    remark: string;
  },
  seller: EtimsSellerConfig
): Record<string, any> {
  const hasTpin = /^[A-Z]\d{10}[A-Z]$/i.test(String(input.customerKraPin || "").trim());
  const custNm = hasTpin ? String(input.customerName || "CASH CUSTOMER").trim() : "CASH CUSTOMER";
  const custTpin = hasTpin ? String(input.customerKraPin).trim().toUpperCase() : "";

  const itemList = input.items.map((it, i) => {
    const gross = round2(it.unitPrice * it.qty);
    const { net, vat } = vatSplitLine(gross);
    return {
      itemSeq: i + 1,
      itemCd: String(i + 1).padStart(9, "0"),
      itemNm: String(it.name).slice(0, 150),
      pkgUnitCd: "EA",
      qty: Math.round(it.qty),
      prc: round2(it.unitPrice),
      splyAmt: gross,
      totDcAmt: 0,
      totAddTaxAmt: 0,
      taxTyCd: seller.taxCd || TAX_TYPE_VAT,
      taxblAmt: net,
      taxAmt: vat,
      totAmt: gross,
    };
  });

  const totAmt = round2(itemList.reduce((s, it) => s + it.splyAmt, 0));
  const totTaxblAmt = round2(itemList.reduce((s, it) => s + it.taxblAmt, 0));
  const totTaxAmt = round2(itemList.reduce((s, it) => s + it.taxAmt, 0));

  return {
    tin: seller.tin,
    bhfId: seller.bhfId,
    dvcSrlNo: seller.dvcSrlNo,
    invoiceNo: input.invoiceNo,
    pblIp: "-",
    tranDt: input.tranDt,
    tranCd: "SALE",
    custTpin: custTpin || "-",
    custNm,
    custBhfNm: custNm,
    salesDt: input.salesDt,
    itemList: { item: itemList },
    itemTotCnt: itemList.length,
    trdPrc: totAmt,
    dcRt: 0,
    dcAmt: 0,
    slsTotAmt: totAmt,
    totTaxblAmt,
    totTaxAmt,
    totAmt,
    rcptTotAmt: totAmt,
    payTotAmt: totAmt,
    payList: { pay: [{ payTyCd: "PAYNT", payAmt: totAmt }] },
    taxList: { tax: [{ taxCd: "VAT", taxRt: Math.round(VAT_RATE * 100), taxblAmt: totTaxblAmt, taxAmt: totTaxAmt, prcgAmt: totAmt }] },
    refndDpstAmt: 0,
    remark: input.remark,
    regrNm: custNm,
    regrId: "-",
    mobDvcId: "-",
  };
}

function extractNested(obj: any, keys: string[]): string {
  for (const k of keys) {
    const direct = obj?.[k];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return String(direct);
    }
    if (obj?.data && typeof obj.data === "object") {
      const inner = obj.data[k];
      if (inner !== undefined && inner !== null && String(inner).trim() !== "") {
        return String(inner);
      }
    }
  }
  return "";
}

function pick(resultKeys: string[], cuKeys: string[], urlKeys: string[], body: any): EtimsResult {
  const invoiceNumber =
    extractNested(body, resultKeys) ||
    extractNested(body, ["invoiceNumber", "invoiceNo", "invcNo", "invoiceNoVal", "rcptNo"]);
  const cuSerialNumber =
    extractNested(body, cuKeys) || extractNested(body, ["cuSerialNumber", "cuSerialNo", "cuSrlNo", "dvcSrlNo"]) ||
    extractNested(body, ["cusSerialNumber"]);
  const verificationUrl =
    extractNested(body, urlKeys) ||
    extractNested(body, ["verificationUrl", "verfyUrl", "qrUrl", "verificationURL", "qrCodeUrl"]);

  if (!invoiceNumber || !cuSerialNumber || !verificationUrl) {
    throw new Error(
      `KRA eTIMS response was missing invoice data. invoiceNumber=${invoiceNumber || "?"} cuSerialNumber=${cuSerialNumber || "?"} verificationUrl=${verificationUrl || "?"}`
    );
  }
  return { invoiceNumber, cuSerialNumber, verificationUrl };
}

function kraSignature(tin: string, timestamp: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${tin}${timestamp}`)
    .digest("hex")
    .toUpperCase();
}


/** Register one invoice with KRA (or return mock data when KRA_ETIMS_MOCK=true). */
export async function registerEtimsInvoice(
  payload: Record<string, any>,
  seller: EtimsSellerConfig,
  invoiceNo: string
): Promise<EtimsResult> {
  if (seller.mock) {
    // Deterministic per invoiceNo so repeated calls for the same invoice
    // return the same KRA invoice number (mock mode only).
    let hash = 0;
    for (let i = 0; i < String(invoiceNo || "").length; i++) {
      hash = (hash * 31 + String(invoiceNo).charCodeAt(i)) >>> 0;
    }
    const seq = (hash % 100000) + 1;
    const invoiceNumber = String((MOCK_INVOICE_BASE + seq).toLocaleString("en-US", { useGrouping: false }));
    return {
      invoiceNumber,
      cuSerialNumber: "MOCK-CU0001",
      verificationUrl: `https://verify.kra.go.ke/etims?inv=${invoiceNumber}&ref=cash`,
    };
  }

  if (!seller.url || !seller.tin || !seller.apiSecret) {
    throw new Error(
      "KRA eTIMS is not configured. Add KRA_ETIMS_URL, KRA_ETIMS_TIN and KRA_ETIMS_API_SECRET to .env.local, or set KRA_ETIMS_MOCK=true to test offline."
    );
  }

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const signature = kraSignature(seller.tin, timestamp, seller.apiSecret);

  const res = await fetch(seller.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      TIN: seller.tin,
      timestamp,
      signature,
      ...(process.env.KRA_ETIMS_EXTRA_HEADERS
        ? (() => {
            try {
              return JSON.parse(process.env.KRA_ETIMS_EXTRA_HEADERS);
            } catch {
              return {};
            }
          })()
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`KRA eTIMS responded ${res.status}: ${text.slice(0, 300)}`);
  }

  try {
    return pick([], [], [], body);
  } catch (e) {
    if (
      typeof body === "object" &&
      body !== null &&
      (body.resultCd !== undefined || body.resultCode !== undefined || body.code !== undefined)
    ) {
      throw new Error(`KRA eTIMS rejected the invoice: ${text.slice(0, 300)}`);
    }
    throw e;
  }
}

/** Produce an invoice payload that survives the full mock/self-test path. */
export function buildEtimsPayloadForOrder(order: any, items: EtimsItem[]): Record<string, any> {
  const seller = etimsSellerConfig();
  return buildEtimsInvoicePayload(
    {
      invoiceNo: order.id,
      tranDt: `${order.date.replace(/-/g, "")}${String(order.time || "000000").replace(/:/g, "")}`,
      salesDt: order.date.replace(/-/g, ""),
      customerName: order.customer,
      customerKraPin: "",
      items,
      remark: `Dispatch ${order.id}`,
    },
    seller
  );
}
