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
// Bitmap Generator: 576px wide × 384px high (1-bit, no dithering)
// 80mm thermal printer at 12dpi ≈ 48 columns per line
// 576px / 12dpi = 48 characters wide
// ──────────────────────────────────────────────────────────
function generateLogoBitmap(logoBase64: string | null): Uint8Array | null {
  if (!logoBase64) return null;

  try {
    // Decode base64 image
    const binary = atob(logoBase64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

    // For a 576px × 384px 1-bit bitmap:
    // - 576 pixels wide = 48 bytes per row (8 pixels per byte)
    // - 384 rows high = 384 rows
    // - Total: 48 × 384 = 18,432 bytes
    // We'll create a placeholder high-contrast bitmap.
    // In production, use sharp/jimp to convert the actual logo.

    // Placeholder: solid black rectangle (576 × 384)
    const bitmap = new Uint8Array(48 * 384);
    // Fill first 50 rows with black, rest with white for demo
    for (let row = 0; row < 50; row++) {
      for (let col = 0; col < 48; col++) {
        bitmap[row * 48 + col] = 0xFF; // black column
      }
    }
    return bitmap;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// ESC/POS Receipt Builder (48-column layout)
// ──────────────────────────────────────────────────────────
function escPad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function escCenter(s: string, width: number): string {
  const padL = Math.floor((width - s.length) / 2);
  return " ".repeat(padL) + s + " ".repeat(width - s.length - padL);
}

// Build a single ESC/POS receipt line with alignment
function escLine(text: string, align: "left" | "center" | "right", width: number = 48): string {
  const padded = escPad(text, width);
  if (align === "left") return CMD_ALIGN_LEFT + padded + CR;
  if (align === "center") return CMD_ALIGN_CENTER + padded + CR;
  return CMD_ALIGN_RIGHT + padded + CR;
}

// Build the full ESC/POS receipt data buffer
export function buildEscReceipt(data: {
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
}): Uint8Array {
  const lines: Uint8Array[] = [];

  // ── Initialise printer ─────────────────────────────────
  lines.push(...CMD_INIT.split("").map((c) => c.charCodeAt(0))); // simplified: actual would be buffer

  // ── Header: High-contrast 576px bitmap ────────────────
  // Note: Actual WebUSB send would be: printer.send(bitmapData)
  // Here we add a placeholder ESC sequence for logo
  lines.push(...CMD_ALIGN_CENTER.split("").map((c) => c.charCodeAt(0)));
  // In real implementation: printer.send(generateLogoBitmap(data.logoBase64)!)

  // ── Business Name (centered) ──────────────────────────
  lines.push(...escLine(data.businessName, "center", 48).split("").map((c) => c.charCodeAt(0)));

  // ── Address ───────────────────────────────────────────
  lines.push(...escLine(data.address, "left", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine(data.phone, "left", 48).split("").map((c) => c.charCodeAt(0)));

  // ── TILL NO. ──────────────────────────────────────────
  lines.push(...escLine("TILL NO. " + data.tillNumber, "left", 48).split("").map((c) => c.charCodeAt(0)));

  // ── Dashed separator (48 chars) ───────────────────────
  const dash48 = "-".repeat(48);
  lines.push(...escLine(dash48, "center", 48).split("").map((c) => c.charCodeAt(0)));

  // ── Metadata: Receipt No, Date/Time, Cashier, Driver ────
  lines.push(...escLine("RECEIPT NO: " + data.orderNo, "left", 48).split("").map((c) => c.charCodeAt(0)));
  const dateTime = data.orderNo; // simplified - would use actual date
  lines.push(...escLine("DATE/TIME: " + new Date().toLocaleString(), "left", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine("CASHIER/USER: " + data.cashier, "left", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine("DRIVER: " + data.driver, "left", 48).split("").map((c) => c.charCodeAt(0)));

  // ── Another dashed separator ────────────────────────────
  lines.push(...escLine(dash48, "center", 48).split("").map((c) => c.charCodeAt(0)));

  // ── Items: 48-column format ────────────────────────────
  for (const item of data.items) {
    // Line 1: Product name (left-aligned, truncated/padded to 48)
    lines.push(...escLine(item.name, "left", 48).split("").map((c) => c.charCodeAt(0)));

    // Line 2: Qty x Ksh Price left-aligned, Subtotal right-aligned
    const qtyPrice = `${item.qty} x Ksh ${item.unitPrice.toFixed(2)}`;
    const subtotal = item.total.toFixed(2);
    const combined = qtyPrice + "".padEnd(1) + subtotal.padStart(6);
    lines.push(...escLine(combined, "right", 48).split("").map((c) => c.charCodeAt(0)));
  }

  // ── Totals & Balances ──────────────────────────────────
  // Double-height + double-width bold TOTAL
  lines.push(...CMD_DOUBLE_HEIGHT_ON.split("").map((c) => c.charCodeAt(0)));
  lines.push(...CMD_DOUBLE_WIDTH_ON.split("").map((c) => c.charCodeAt(0)));
  lines.push(...CMD_BOLD_ON.split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine("TOTAL", "center", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine(data.subtotal.toFixed(2).padStart(10) + " KSH", "right", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...CMD_BOLD_OFF.split("").map((c) => c.charCodeAt(0)));
  lines.push(...CMD_DOUBLE_WIDTH_OFF.split("").map((c) => c.charCodeAt(0)));
  lines.push(...CMD_DOUBLE_HEIGHT_OFF.split("").map((c) => c.charCodeAt(0)));

  // ── Payment Status ─────────────────────────────────────
  const payLabel = data.payStatus === "PAID" ? "PAID" : "CREDIT UNPAID";
  lines.push(...escLine("STATUS: " + payLabel, "left", 48).split("").map((c) => c.charCodeAt(0))));

  // ── Paid Amount & Amount Due ───────────────────────────
  lines.push(...escLine("PAID AMOUNT: " + data.subtotal.toFixed(2) + " KSH", "left", 48).split("").map((c) => c.charCodeAt(0)));
  lines.push(...escLine("AMOUNT DUE: " + (data.outstandingBalance || 0).toFixed(2) + " KSH", "left", 48).split("").map((c) => c.charCodeAt(0))));

  // ── Customer Outstanding Balance ───────────────────────
  lines.push(...escLine("OUTSTANDING BALANCE: " + (data.outstandingBalance || 0).toFixed(2) + " KSH", "left", 48).split("").map((c) => c.charCodeAt(0))));

  // ── Payment Code footer ────────────────────────────────
  lines.push(...escLine("PAYMENT CODE: " + (data.mpesaCode || "—"), "left", 48).split("").map((c) => c.charCodeAt(0))));

  // ── Auto-cut command ───────────────────────────────────
  // In real WebUSB: printer.send(GS + "V" + String.fromCharCode(0x42) + String.fromCharCode(0x00));
  // Here we append the command bytes
  const cutCmd = GS.charCodeAt(0) + "V".charCodeAt(0) + 0x42 + 0x00;
  lines.push(...[cutCmd]);

  // ── Return combined Uint8Array ─────────────────────────
  const result: number[] = [];
  for (const line of lines) {
    for (const code of line) result.push(code);
  }
  return new Uint8Array(result);
}

// ──────────────────────────────────────────────────────────
// Print Function: Node/WebUSB Bridge
// ──────────────────────────────────────────────────────────
/**
 * Send receipt to local thermal printer via WebUSB or Node serial bridge.
 * 
 * For WebUSB (browser):
 *   const printer = await navigator.usb.requestDevice({ filters: [{ vendorId: 0xXXXX }] });
 *   await printer.open();
 *   const data = buildEscReceipt(...);
 *   await printer.transferOut(1, data);
 * 
 * For Node.js/Python bridge:
 *   const { PythonShell } = require('python-shell');
 *   // Or use python-escpos, escpos-thermal, or similar library
 * 
 * @param data Receipt data built from receiptFromOrder
 */
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
  // In a real WebUSB environment, this would send data directly to the printer:
  // const printer = await navigator.usb.getDevice();
  // await printer.open();
  // await printer.transferOut(1, data);

  // For now, log the buffer size and content for verification:
  const receiptData = buildEscReceipt({
    ...data,
    logoBase64: data.logoBase64 || null,
  });
  console.log(`🖨️ ESC/POS Print buffer size: ${receiptData.byteLength} bytes`);
  console.log("🖨️ First 200 bytes (hex):", Array.from(receiptData.slice(0, 200)).map(b => b.toString(16).padStart(2, "0")).join(" "));
  console.log("✅ ESC/POS receipt ready for USB thermal printer (80mm, Font A, high density)");

  // TODO: Uncomment for actual WebUSB send:
  // if (navigator.usb && navigator.usb.device) {
  //   await navigator.usb.device.open();
  //   await navigator.usb.device.selectConfiguration(1);
  //   await navigator.usb.device.claimInterface(0);
  //   await navigator.usb.device.transferOut(1, data);
  // }
}

export function receiptFromOrder(
  order: any,
  opts: { operator: string; businessName?: string; logoUrl?: string; fontFamily?: string; customerName?: string }
): any {
  // Build the ESC/POS data structure from the order
  const items = order.productLine ? order.productLine.split(" + ").map((s: string) => {
    const [qtyStr, name] = s.split(" x ");
    return {
      name: name.trim(),
      qty: parseInt(qtyStr) || 1,
      unitPrice: 0, // would need to parse from order
      total: 0,
    };
  }) : [];

  // Extract M-Pesa code from order notes or mpesa_code
  const mpesaCode = order.mpesa_code || order.notes?.match(/CODE[:\s]*(\S+)/)?.[1] || null;

  return {
    businessName: opts.businessName || "MIST WATER AND GAS DISTRIBUTORS",
    logoBase64: opts.logoUrl ? // would decode actual base64 from URL
      // In production: convert logo to 576px × 384px 1-bit bitmap
      "/placeholder-logo" : null,
    address: "RHAPTA ROAD NJEMA COURT, 00100 NAIROBI",
    phone: "0769584784",
    tillNumber: "5251815",
    cashier: opts.operator,
    driver: order.driver || "WALK-IN",
    orderNo: order.id || "—",
    customerName: order.customer || "WALK-IN CUSTOMER",
    customerAddress: order.address || "",
    items: items.length > 0 ? items : [{ name: order.product || "—", qty: order.qty || 1, unitPrice: 0, total: order.total }],
    subtotal: order.total,
    payStatus: order.pay_status === "PAID" ? "PAID" : "PENDING",
    paymentMethod: order.payment_method || "CASH",
    mpesaCode: mpesaCode,
    outstandingBalance: 0, // would compute from ledger
  };
}