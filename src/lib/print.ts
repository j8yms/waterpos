import { GLOVO_COMMISSION } from "./config";

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface ReceiptData {
  businessName: string;
  businessTagline?: string;
  logoUrl?: string;  // Optional logo image URL
  shopLocation?: string;  // Optional shop/delivery location
  orderId: string;
  date: string;
  time: string;
  customer: string;
  phone: string;
  address: string;
  driver: string;
  lines: ReceiptLine[];
  subtotal: number;
  glovo: boolean;
  glovoFee: number;
  total: number;
  payStatus: "PAID" | "PENDING";
  paymentMethod?: string;
  mpesaCode?: string;
  operator: string;
  fontFamily?: string;  // Optional custom font family
  customerName?: string;  // Optional explicit customer name override
  printerWidth?: "58mm" | "80mm";  // Thermal printer width configuration
}

const ESC = "\u001b";
const RESET = `${ESC}m`;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function center(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  const padL = Math.floor((width - value.length) / 2);
  return " ".repeat(padL) + value + " ".repeat(width - value.length - padL);
}

export function buildReceiptHtml(data: ReceiptData, widthChars = 36): string {
  const L = data.printerWidth === "58mm" ? 44 : 60;
  const c = (s: string) => center(s, L);
  const p = (s: string) => pad(s, L);
  const rule = "-".repeat(L);

  // Font family: use custom if provided, otherwise default monospace for thermal printers
  const fontFamily = data.fontFamily || "'Courier New', 'Lucida Console', monospace";

  // ... rest of function uses `L` (which is widthChars parameter, default 36)

  // Logo HTML if logoUrl is provided
  const logoHtml = data.logoUrl
    ? `<img src="${data.logoUrl}" alt="Business Logo" style="width: 30mm; height: auto; margin: 0 auto; display: block; margin-bottom: 4px;" />`
    : `<pre class="big">${c(data.businessName)}</pre>`;

  const mpesaBlock = data.mpesaCode
    ? `
      <div class="mpesa-bar">${c("*** M-PESA PAYMENT ***")}</div>
      <div class="mpesa-code">${c("REF: " + data.mpesaCode)}</div>
      <div class="sep">${rule}</div>`
    : "";

  const linesHtml = data.lines
    .map((l) => {
      const nameLine = p(l.name);
      const sub = `${l.qty} x ${l.unitPrice.toFixed(2)}`.padEnd(18) + l.total.toFixed(2).padStart(18);
      return `<pre class="line">${nameLine}\n${pad(sub, L)}</pre>`;
    })
    .join("");

  const glovoLine = data.glovo
    ? `<pre class="row">${p("GLOVO COMM 20%")} ${(-data.glovoFee).toFixed(2).padStart(4)}</pre>`
    : "";

  const status = data.payStatus === "PAID" ? "PAID" : "PENDING";
  const paymentLabel = data.paymentMethod
    ? data.paymentMethod === "MPESA"
      ? "M-PESA"
      : data.paymentMethod === "GLOVO"
        ? "GLOVO ORDER"
        : data.paymentMethod === "CREDIT"
          ? "CREDIT"
          : "CASH"
    : null;
  const paymentLine = paymentLabel
    ? `<pre>${p("METHOD")} ${paymentLabel}</pre>`
    : "";

  const footerText = data.businessTagline || "Bulk Water Supply";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${data.orderId}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    font-family: ${fontFamily};
  }
  .receipt {
    padding: 6px 4px;
    color: #000;
    font-size: 12px;
    line-height: 1.35;
  }
  .mpesa-bar { font-weight: bold; background: #000; color: #fff; }
  .mpesa-code { font-weight: bold; font-size: 14px; }
  .sep { border-top: 1px dashed #000; margin: 2px 0; }
  .big { font-size: 15px; font-weight: bold; }
  pre { margin: 0; white-space: pre; font-family: inherit; font-size: 12px; }
  .row { margin: 1px 0; }
  .footer { margin-top: 6px; border-top: 1px solid #000; padding-top: 4px; }
</style>
</head>
<body>
<div class="receipt">
  ${data.logoUrl ? `<img src="${data.logoUrl}" alt="Business Logo" style="width: 30mm; height: auto; margin: 0 auto; display: block; margin-bottom: 4px;" />` : `<pre class="big">${c(data.businessName)}</pre>`}
  ${data.businessTagline ? `<pre>${c(data.businessTagline)}</pre>` : ""}
  <pre class="sep">${rule}</pre>
  ${mpesaBlock}
  <pre>${p("ORDER")} ${data.orderId}</pre>
  <pre>${p(data.date)} ${data.time}</pre>
  <pre class="sep">${rule}</pre>
  <pre>${p("CUST: " + (data.customerName || data.customer))}</pre>
  ${data.phone ? `<pre>${p("TEL: " + data.phone)}</pre>` : ""}
  ${data.address ? `<pre>${p("ADD: " + data.address)}</pre>` : ""}
  ${data.shopLocation ? `<pre>${p("LOC: " + data.shopLocation)}</pre>` : ""}
  <pre class="sep">${rule}</pre>
  ${linesHtml}
  <pre class="sep">${rule}</pre>
  <pre class="big">${p("TOTAL")} ${data.total.toFixed(2).padStart(12)}</pre>
  ${glovoLine}
  <pre>${p("PAYMENT")} ${status}</pre>
  ${paymentLine}
  <pre class="sep">${rule}</pre>
  <pre>${p("DRIVER: " + data.driver)}</pre>
  <pre>${p("OPERATOR: " + data.operator)}</pre>
  <div class="footer">
    <pre>${c("Thank you for your business!")}</pre>
    <pre>${c(footerText)}</pre>
  </div>
</div>
</body>
</html>`;
}

/**
 * Print via a hidden, fully-isolated iframe so only the receipt template prints,
 * never the POS chrome. Cross-device safe: iOS/Android Chrome can auto-pop the
 * print preview when a separate tab opens, so instead of window.open we attach
 * a dedicated print handler to the injected iframe's own window.
 */
export function printReceipt(data: ReceiptData): void {
  const html = buildReceiptHtml(data, data.printerWidth ? undefined : 36);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";

  document.body.appendChild(frame);

  const fire = () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    win.focus();
    // iOS Safari needs the print call from inside the iframe context; using a
    // tiny scripted handler is more reliable than a bare win.print() on older
    // WebKit. Keep a blank catch so no device ever dead-ends the till.
    try {
      win.print();
    } catch {
      /* some embedded webviews ignore iframe.print() */
    }
    setTimeout(() => frame.remove(), 1200);
  };

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  if (frame.contentWindow?.addEventListener) {
    frame.contentWindow.addEventListener("load", fire);
  }
  // Thermal drivers / mobile webviews often need a moment to settle; fire even
  // if the synthetic load event never arrives.
  setTimeout(fire, 120);
}

/**
 * Send receipt to the laptop's print server (cross-device printing).
 * Set env var NEXT_PUBLIC_PRINT_SERVER_URL to the laptop's print server URL
 * (e.g., "http://192.168.1.42:3001").
 * Falls back to local iframe print if not configured or on error.
 */
export async function printToNetwork(data: ReceiptData): Promise<void> {
  const printServerUrl = process.env.NEXT_PUBLIC_PRINT_SERVER_URL;
  if (!printServerUrl) {
    // No print server configured — fall back to local print
    printReceipt(data);
    return;
  }

  const html = buildReceiptHtml(data);

  try {
    const res = await fetch(`${printServerUrl}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html, type: "html" }),
    });
    if (!res.ok) throw new Error(`Print server returned ${res.status}`);
    const result = await res.json();
    console.log("✅ Network print sent:", result);
  } catch (err) {
    console.warn("⚠️ Network print failed, falling back to local:", err);
    printReceipt(data);
  }
}

export function receiptFromOrder(
  order: any,
  opts: { operator: string; businessName?: string; logoUrl?: string; fontFamily?: string; customerName?: string; shopLocation?: string }
): ReceiptData {
  const lines: ReceiptLine[] = [
    {
      name: order.product,
      qty: order.qty,
      unitPrice: order.unit_price,
      total: order.total,
    },
  ];

  return {
    businessName: opts.businessName || "MIST WATER AND GAS DISTRIBUTORS",
    logoUrl: opts.logoUrl,
    shopLocation: opts.shopLocation,
    orderId: order.id,
    date: order.date,
    time: order.time,
    customer: order.customer,
    phone: order.phone,
    address: order.address,
    driver: order.driver,
    lines,
    subtotal: order.total,
    glovo: Boolean(order.glovo),
    glovoFee: order.glovo ? order.total * GLOVO_COMMISSION : 0,
    total: order.total,
    payStatus: order.pay_status === "PAID" ? "PAID" : "PENDING",
    paymentMethod: order.payment_method || undefined,
    mpesaCode: order.mpesa_code || undefined,
    operator: opts.operator,
    fontFamily: opts.fontFamily,
    customerName: opts.customerName,
  };
}