/**
 * Local Network Print Forwarder
 * Runs on the LAPTOP (where USB thermal printer is physically connected).
 * Receives HTTP POST print jobs from the DESKTOP POS and sends them to the local printer.
 *
 * Usage on laptop:
 *   npm install printer
 *   node print-server.js
 *
 * Desktop POS sends: POST http://<laptop-lan-ip>:3001/print
 *   { "content": "<html>...</html>", "printerName": "optional-specific-printer" }
 */

const http = require("http");
const url = require("url");
let printer;
try {
  printer = require("printer");
} catch {
  console.error("❌ 'printer' package not installed. Run: npm install printer");
  process.exit(1);
}

const PORT = process.env.PRINT_SERVER_PORT || 3001;
const HOST = "0.0.0.0"; // Listen on all interfaces for LAN access

// Default printer name (empty = system default). Can be overridden per request.
const DEFAULT_PRINTER = process.env.DEFAULT_PRINTER || "";

function getPrinterName(requestPrinter: string | undefined): string {
  return requestPrinter || DEFAULT_PRINTER || printer.getDefaultPrinterName();
}

function listPrinters() {
  try {
    return printer.getPrinters();
  } catch {
    return [];
  }
}

function printHTML(html: string, printerName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    printer.printDirect({
      data: html,
      type: "RAW", // Send raw HTML; printer driver handles rendering
      printer: printerName,
      success: (jobId) => {
        console.log(`✅ Print job ${jobId} sent to "${printerName}"`);
        resolve();
      },
      error: (err) => {
        console.error(`❌ Print failed on "${printerName}":`, err);
        reject(err);
      },
    });
  });
}

function printText(text: string, printerName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    printer.printDirect({
      data: text,
      type: "TEXT",
      printer: printerName,
      success: (jobId) => {
        console.log(`✅ Text print job ${jobId} sent to "${printerName}"`);
        resolve();
      },
      error: (err) => {
        console.error(`❌ Text print failed on "${printerName}":`, err);
        reject(err);
      },
    });
  });
}

async function handlePrint(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = "";
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const { content, printerName, type = "html" } = payload;
  if (!content) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'content' field" }));
    return;
  }

  const targetPrinter = getPrinterName(printerName);
  console.log(`🖨️  Print request received → ${targetPrinter} (${type})`);

  try {
    if (type === "text") {
      await printText(content, targetPrinter);
    } else {
      await printHTML(content, targetPrinter);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, printer: targetPrinter }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Print failed" }));
  }
}

async function handleListPrinters(req: http.IncomingMessage, res: http.ServerResponse) {
  const printers = listPrinters();
  const defaultPrinter = printer.getDefaultPrinterName();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ printers, defaultPrinter }));
}

async function handleHealth(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", port: PORT, defaultPrinter: printer.getDefaultPrinterName() }));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);
  const path = parsed.pathname;

  // CORS for local LAN requests from desktop POS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && path === "/printers") {
      await handleListPrinters(req, res);
    } else if (req.method === "GET" && path === "/health") {
      await handleHealth(req, res);
    } else if (req.method === "POST" && path === "/print") {
      await handlePrint(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (err) {
    console.error("Server error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🖨️  Print Forwarder running on http://${HOST}:${PORT}`);
  console.log(`   Default printer: ${printer.getDefaultPrinterName() || "(none set)"}`);
  console.log(`   Available printers:`);
  listPrinters().forEach((p: any) => console.log(`     - ${p.name}${p.name === printer.getDefaultPrinterName() ? " (default)" : ""}`));
  console.log(`\n📡 Desktop POS should POST to: http://<laptop-lan-ip>:${PORT}/print`);
  console.log(`   Payload: { "content": "<receipt-html>", "printerName": "optional", "type": "html|text" }`);
  console.log(`\n💡 To find laptop LAN IP: run 'ipconfig' on laptop and use the IPv4 address (e.g., 192.168.1.42)`);
});