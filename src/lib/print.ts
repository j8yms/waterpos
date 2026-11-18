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
  const padL = Math.floor((width - s.length) / 2);
  return " ".repeat(padL) + s + " ".repeat(width - s.length - padL);
}

function escLine(text: string, align: "left" | "center" | "right", width: number = 48): string {
  const padded = escPad(text, width);
  if (align === "left") return CMD_ALIGN_LEFT + padded + CR;
  if (align === "center") return CMD_ALIGN_CENTER + padded + CR;
  return CMD_ALIGN_RIGHT + padded + CR;
}

// Build the full ESC/POS receipt data buffer
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
}): string {
  const lines: string[] = [];

  // ── Initialise printer ─────────────────────────────────
  lines.push(CMD_INIT);

  // ── Header: High-contrast 576px bitmap ────────────────
  // Note: Actual WebUSB send would be: printer.send(bitmapData)
  // Here we add a placeholder for the logo
  lines.push(CMD_ALIGN_CENTER);

  // ── Business Name (centered) ──────────────────────────
  lines.push(`${data.businessName}`);

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
    // Line 1: Product name (left-aligned, padded to 48)
    lines.push(`${item.name}`);

    // Line 2: Qty x Ksh Price left-aligned, Subtotal right-aligned
    const qtyPrice = `${item.qty} x Ksh ${item.unitPrice.toFixed(2)}`;
    const subtotal = `${item.total.toFixed(2)}`;
    lines.push(`${qtyPrice} ${subtotal.padStart(6)}`);
  }

  // ── Totals & Balances ──────────────────────────────────
  // Double-height + double-width bold TOTAL
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

  // ── Customer Outstanding Balance ───────────────────────
  lines.push(`OUTSTANDING BALANCE: ${(data.outstandingBalance || 0).toFixed(2)} KSH`);

  // ── Payment Code footer ────────────────────────────────
  lines.push(`PAYMENT CODE: ${data.mpesaCode || "—"}`);

  // ── Auto-cut command ───────────────────────────────────
  lines.push(CMD_CUT);

  // Return as string (will be sent to printer via WebUSB or serial)
  return lines.join(LF);
}

// ──────────────────────────────────────────────────────────
// Print Function: WebUSB Bridge
// ──────────────────────────────────────────────────────────
/**
 * Send receipt to local thermal printer via WebUSB.
 * 
 * For WebUSB (browser):
 *   const printer = await navigator.usb.requestDevice({ filters: [{ vendorId: 0xXXXX }] });
 *   await printer.open();
 *   const receiptData = buildReceipt({...});
 *   const encoder = new TextEncoder();
 *   await printer.transferOut(1, encoder.encode(receiptData));
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
  // await printer.transferOut(1, new TextEncoder().encode(buildReceipt(data)));

  // For now, return the built receipt string for verification:
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
  //   await printer.transferOut(1, new TextEncoder().encode(receipt));
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