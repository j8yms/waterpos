import { GLOVO_COMMISSION } from "./config";

// ──────────────────────────────────────────────────────────
// ESC/POS Command Constants (Font A, 80mm thermal printer)
// ──────────────────────────────────────────────────────────
const ESC = "\u001b";
const GS = "\u002e";
const CR = "\r";
const LF = "\n";
const FF = "\x0c"; // form feed / auto-cut in some printers

// Printer command packets
const CMD_INIT = ESC + "@";           // Initialize printer
const CMD_SELECT_FONT_A = ESC + "A";   // Select Font A (24x24 dots)
const CMD_SELECT_FONT_B = ESC + "B";   // Select Font B (12x24 dots)
const CMD_DOUBLE_HEIGHT_ON = ESC + "!" + String.fromCharCode(0x11); // Double height on
const CMD_DOUBLE_HEIGHT_OFF = ESC + "!" + String.fromCharCode(0x0c); // Double height off
const CMD_DOUBLE_WIDTH_ON = ESC + "!" + String.fromCharCode(0x20); // Double width on
const CMD_DOUBLE_WIDTH_OFF = ESC + "!" + String.fromCharCode(0x10); // Double width off
const CMD_UNDERLINE_ON = ESC + "-" + String.fromCharCode(0x01); // Single underline
const CMD_UNDERLINE_ON_2 = ESC + "-" + String.fromCharCode(0x02); // Double underline
const CMD_BOLD_ON = ESC + "E";         // Bold on
const CMD_BOLD_OFF = ESC + "F";        // Bold off
const CMD_ALIGN_LEFT = ESC + "a" + String.fromCharCode(0x00); // Left align
const CMD_ALIGN_CENTER = ESC + "a" + String.fromCharCode(0x01); // Center align
const CMD_ALIGN_RIGHT = ESC + "a" + String.fromCharCode(0x02); // Right align
const CMD_FONT_A_SIZE_24 = ESC + "$" + String.fromCharCode(0x00) + String.fromCharCode(0x00); // 24-dot font
const CMD_PRINT_MODE_2 = ESC + "!" + String.fromCharCode(0x20); // Print mode 2 (dense)
const CMD_CUT = GS + "V" + String.fromCharCode(0x42) + String.fromCharCode(0x00); // Auto cut 66mm

// ──────────────────────────────────────────────────────────
// ESC/POS Receipt Builder (48-column layout)
// ──────────────────────────────────────────────────────────
function escPad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function escCenter(s: string, width: number): string {
  if (s.length >= width) return s;
  const padL = Math.floor((width - s.length) / 2);
  return " ".repeat(padL) + s + " ".repeat(width - s.length - padL);
}

function escRight(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function escLine(text: string, align: "left" | "center" | "right", width: number = 48): string {
  if (align === "left") return CMD_ALIGN_LEFT + escPad(text, width) + CR;
  if (align === "center") return CMD_ALIGN_CENTER + escCenter(text, width) + CR;
  return CMD_ALIGN_RIGHT + escRight(text, width) + CR;
}

// Receipt settings flags. `undefined` means "setting absent" and falls back to
// the historical (pre-settings) layout so existing receipts do not change.
export type ReceiptSettings = {
  footerText?: string;
  receiptWidth?: "58" | "80";
  showQty?: boolean;
  showPrices?: boolean;
  showDiscounts?: boolean;
  showDelivery?: boolean;
  showPaymentMethod?: boolean;
  showMpesaRef?: boolean;
  showOutstanding?: boolean;
  discount?: number;
  deliveryFee?: number;
};

// Build the full ESC/POS receipt data string
export function buildReceipt(data: {
  businessName: string;
  logoBase64: string | null;
  address: string;
  phone: string;
  tillNumber: string;
  cashier: string;
  driver: string;
  orderNo: string;
  customerName: string;
  customerAddress: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  payStatus: "PAID" | "PENDING";
  paymentMethod: string;
  mpesaCode: string | null;
  outstandingBalance: number;
} & ReceiptSettings): string {
  const lines: string[] = [];

  // Settings fallbacks: undefined = legacy behaviour (settings never provided).
  const showQty = data.showQty ?? true;
  const showPrices = data.showPrices ?? true;
  const showDiscounts = data.showDiscounts ?? false;
  const showDelivery = data.showDelivery ?? false;
  const showPaymentMethod = data.showPaymentMethod ?? false;
  const showMpesaRef = data.showMpesaRef ?? true;
  const showOutstanding = data.showOutstanding ?? true;

  // ── Initialise printer ─────────────────────────────────
  lines.push(CMD_INIT);

  // ── Header: High-contrast 576px bitmap ────────────────
  lines.push(CMD_ALIGN_CENTER);

  // This builder has no ESC/POS raster (GS v 0) support, so a logo cannot be
  // printed. Never drop it silently: warn and print a visible note instead.
  if (data.logoBase64) {
    console.warn("⚠️ Receipt logo present but logo unsupported on thermal (no ESC/POS bitmap support) — logo skipped");
    lines.push(escLine("[logo unsupported on thermal]", "center"));
  }

  lines.push(data.businessName);

  // ── Address ───────────────────────────────────────────
  lines.push(data.address);
  lines.push(data.phone);

  // ── TILL NO. ──────────────────────────────────────────
  lines.push(`TILL NO. ${data.tillNumber}`);

  // ── Dashed separator (48 chars) ───────────────────────
  const dash48 = "-".repeat(48);
  lines.push(dash48);

  // ── Metadata: Receipt No, Date/Time, Cashier, Driver ────
  lines.push(`RECEIPT NO: ${data.orderNo}`);
  lines.push(`DATE/TIME: ${new Date().toLocaleString()}`);
  lines.push(`CASHIER/USER: ${data.cashier}`);
  lines.push(`DRIVER: ${data.driver}`);

  // ── Another dashed separator ────────────────────────────
  lines.push(dash48);

  // ── Items: 48-column format ────────────────────────────
  for (const item of data.items) {
    lines.push(`${item.name}`);
    const parts: string[] = [];
    if (showQty) parts.push(`${item.qty} x`);
    if (showPrices) {
      parts.push(`Ksh ${item.unitPrice.toFixed(2)}`);
      parts.push(item.total.toFixed(2).padStart(6));
    }
    if (parts.length > 0) lines.push(parts.join(" "));
  }

  // ── Totals & Balances ──────────────────────────────────
  lines.push(CMD_DOUBLE_HEIGHT_ON);
  lines.push(CMD_DOUBLE_WIDTH_ON);
  lines.push(CMD_BOLD_ON);
  lines.push(`TOTAL`);
  lines.push(`${data.subtotal.toFixed(2).padStart(10)} KSH`);
  lines.push(CMD_BOLD_OFF);
  lines.push(CMD_DOUBLE_WIDTH_OFF);
  lines.push(CMD_DOUBLE_HEIGHT_OFF);

  // ── Payment Status ─────────────────────────────────────
  const payLabel = data.payStatus === "PAID" ? "PAID" : "CREDIT UNPAID";
  lines.push(`STATUS: ${payLabel}`);

  // ── Paid Amount & Amount Due ───────────────────────────
  lines.push(`PAID AMOUNT: ${data.subtotal.toFixed(2)} KSH`);
  lines.push(`AMOUNT DUE: ${(data.outstandingBalance || 0).toFixed(2)} KSH`);

  // ── Discount ───────────────────────────────────────────
  if (showDiscounts) {
    lines.push(`DISCOUNT: ${(data.discount || 0).toFixed(2)} KSH`);
  }

  // ── Delivery charge ────────────────────────────────────
  if (showDelivery) {
    lines.push(`DELIVERY: ${(data.deliveryFee || 0).toFixed(2)} KSH`);
  }

  // ── Payment method ─────────────────────────────────────
  if (showPaymentMethod) {
    lines.push(`PAYMENT METHOD: ${data.paymentMethod || "CASH"}`);
  }

  // ── Customer Outstanding Balance ───────────────────────
  if (showOutstanding) {
    lines.push(`OUTSTANDING BALANCE: ${(data.outstandingBalance || 0).toFixed(2)} KSH`);
  }

  // ── Payment Code footer ────────────────────────────────
  if (showMpesaRef) {
    lines.push(`PAYMENT CODE: ${data.mpesaCode || "—"}`);
  }

  // ── Custom footer (centered, max 48 cols) ──────────────
  const footer = (data.footerText || "").trim();
  if (footer) {
    lines.push(escLine(footer.slice(0, 48), "center"));
  }

  // ── Auto-cut command ───────────────────────────────────
  lines.push(CMD_CUT);

  return lines.join(LF);
}

// ──────────────────────────────────────────────────────────
// Print Function: WebUSB Bridge
// ──────────────────────────────────────────────────────────
export async function printReceiptEscPos(data: {
  businessName: string;
  logoBase64: string | null;
  address: string;
  phone: string;
  tillNumber: string;
  cashier: string;
  driver: string;
  orderNo: string;
  customerName: string;
  customerAddress: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  payStatus: "PAID" | "PENDING";
  paymentMethod: string;
  mpesaCode: string | null;
  outstandingBalance: number;
}): Promise<void> {
  const receipt = buildReceipt({
    ...data,
    logoBase64: data.logoBase64 || null,
  });
  console.log(`🖨️ ESC/POS Receipt ready (${receipt.length} chars)`);
  console.log("🖨️ First 200 chars:", receipt.substring(0, 200));
  console.log("✅ ESC/POS receipt ready for USB thermal printer (80mm, Font A, high density)");

  // TODO: Uncomment for actual WebUSB send:
  // if (navigator.usb && navigator.usb.device) {
  //   await navigator.usb.device.open();
  //   await navigator.usb.device.selectConfiguration(1);
  //   await navigator.usb.device.claimInterface(0);
  //   await navigator.usb.device.transferOut(1, new TextEncoder().encode(receipt));
  // }
}

/** Send receipt to the laptop's print server (cross-device printing).
 * Set env var NEXT_PUBLIC_PRINT_SERVER_URL to the laptop's print server URL
 * (e.g., "http://192.168.1.42:3001").
 * Falls back to local print if not configured.
 */
export async function printToNetwork(data: {
  businessName: string;
  logoBase64: string | null;
  address: string;
  phone: string;
  tillNumber: string;
  cashier: string;
  driver: string;
  orderNo: string;
  customerName: string;
  customerAddress: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  payStatus: "PAID" | "PENDING";
  paymentMethod: string;
  mpesaCode: string | null;
  outstandingBalance: number;
}): Promise<{ ok: boolean; error?: string }> {
  const printServerUrl = process.env.NEXT_PUBLIC_PRINT_SERVER_URL;
  if (!printServerUrl) {
    return { ok: false, error: "Print server not configured (set NEXT_PUBLIC_PRINT_SERVER_URL)" };
  }

  const receipt = buildReceipt({
    ...data,
    logoBase64: data.logoBase64 || null,
  });

  try {
    const res = await fetch(`${printServerUrl}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/text" },
      body: receipt,
    });
    if (!res.ok) throw new Error(`Print server returned ${res.status}`);
    console.log("✅ Network print sent to", printServerUrl);
    return { ok: true };
  } catch (err) {
    console.warn("⚠️ Network print failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Print failed - check printer connection" };
  }
}

// ── Helper: Convert order to receipt data ────────────────
export function receiptFromOrder(
  order: any,
  opts: {
    operator: string;
    businessName?: string;
    logoUrl?: string;
    fontFamily?: string;
    customerName?: string;
    shopLocation?: string;
    settings?: {
      businessName?: string;
      businessTagline?: string;
      phone?: string;
      address?: string;
      footerText?: string;
      logoDataUrl?: string;
      receiptWidth?: "58" | "80";
      showQty?: boolean;
      showPrices?: boolean;
      showDiscounts?: boolean;
      showDelivery?: boolean;
      showPaymentMethod?: boolean;
      showMpesaRef?: boolean;
      showOutstanding?: boolean;
    };
  }
): any {
  const items = order.productLine ? order.productLine.split(" + ").map((s: string) => {
    const [qtyStr, name] = s.split(" x ");
    return {
      name: name.trim(),
      qty: parseInt(qtyStr) || 1,
      unitPrice: 0,
      total: 0,
    };
  }) : [];

  const s = opts.settings ?? {};
  const mpesaCode = order.mpesa_code || order.notes?.match(/CODE[:\s]*(\S+)/)?.[1] || null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  return {
    businessName: s.businessName || opts.businessName || "MIST WATER AND GAS DISTRIBUTORS",
    businessTagline: s.businessTagline,
    logoBase64: s.logoDataUrl || (opts.logoUrl ? "/placeholder-logo" : null),
    address: s.address || "RHAPTA ROAD NJEMA COURT, 00100 NAIROBI",
    phone: s.phone || "0769584784",
    tillNumber: "5251815",
    cashier: opts.operator,
    driver: order.driver || "WALK-IN",
    orderNo: order.id || "—",
    customerName: opts.customerName || order.customer || "WALK-IN CUSTOMER",
    customerAddress: order.address || "",
    items: items.length > 0 ? items : [{ name: order.product || "—", qty: order.qty || 1, unitPrice: 0, total: order.total }],
    subtotal: order.total,
    payStatus: order.pay_status === "PAID" ? "PAID" : "PENDING",
    paymentMethod: order.payment_method || "CASH",
    mpesaCode: mpesaCode,
    outstandingBalance: 0,
    footerText: s.footerText,
    receiptWidth: s.receiptWidth,
    showQty: s.showQty,
    showPrices: s.showPrices,
    showDiscounts: s.showDiscounts,
    showDelivery: s.showDelivery,
    showPaymentMethod: s.showPaymentMethod,
    showMpesaRef: s.showMpesaRef,
    showOutstanding: s.showOutstanding,
    discount: num(order.discount ?? order.discount_amount),
    deliveryFee: num(order.delivery_fee ?? order.glovo_fee ?? order.delivery_charge),
  };
}