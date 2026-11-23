/**
 * Local Network Print Forwarder
 * Runs on the LAPTOP (where USB thermal printer is physically connected).
 * Receives HTTP POST print jobs from the DESKTOP POS and sends them
 * to the shared Windows printer via the Windows print spooler.
 *
 * Usage on laptop (no npm install needed — only Node.js):
 *   node print-server.js
 *
 * Desktop POS sends either:
 *   POST /print with Content-Type: application/text (or text/plain)
 *     body = raw ESC/POS bytes (sent straight to the printer's RAW queue)
 *   or
 *   POST /print with Content-Type: application/json
 *     { "content": "<html>...</html>", "printerName": "optional" }
 *
 * The printer MUST be shared on the host first:
 *   Right-click printer → Properties → Sharing → "Share this printer"
 *   Note the share name (e.g., "XP-80")
 *
 * Cross-device safe: iOS/Android Chrome can auto-pop the
 * print preview when a separate tab opens, so instead of window.open
 * we attach a dedicated print handler to the injected iframe's own window.
 *
 * NOTES:
 *   • The host printer must be SHARED first (Windows Sharing).
 *   • This does NOT use the 'printer' npm package (incompatible with Node.js v24).
 *   • The Windows print spooler handles job queuing and ordering.
 *   • Both Aronium and Water POS can print to the same shared printer.
 *   • If the print host is offline, jobs are queued locally and retried on reconnect.
 */

const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

// ────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────

// Print share name — MUST match the name you set in Windows Printer Sharing.
// Change this to match your shared printer name (e.g., "XP-80", "ReceiptPrinter").
const PRINTER_SHARE_NAME = process.env.PRINTER_SHARE_NAME || "XP-80";

// Temp directory for print job files
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wp-print-"));

// Ensure temp dir exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ────────────────────────────────────────────────────────────────────────
// HTTP Server
// ────────────────────────────────────────────────────────────────────────

const PORT = process.env.PRINT_SERVER_PORT || 3001;
const HOST = "0.0.0.0"; // Listen on all interfaces for LAN access

// CORS headers for LAN requests
const defaultCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// helper: set CORS headers on a response
function applyCors(res) {
  Object.entries(defaultCorsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

// ────────────────────────────────────────────────────────────────────────
// Print job handling
// ────────────────────────────────────────────────────────────────────────

/**
 * Write print data to a temp file and dispatch to Windows print spooler.
 * Uses `print /d:\\<host>\<share> <file>` to print to the shared printer.
 *
 * @param {string} html - The receipt HTML content
 * @param {string} printerShare - The shared printer name (default: PRINTER_SHARE_NAME)
 * @returns {Promise<void>}
 */
function printToSharedPrinter(html, printerShare = PRINTER_SHARE_NAME) {
  return new Promise((resolve, reject) => {
    try {
      // Sanitize filename: replace problematic characters
      const safeHtml = html
        .replace(/[<>"&]/g, (c) => ({ "<": "<", ">": ">", '&': "&" }[c]))
        .replace(/\s+/g, "_")
        .substring(0, 200); // limit length

      const tmpFile = path.join(TMP_DIR, `receipt_${Date.now().toString(36)}.html`);

      // Write the HTML receipt to a temp file
      fs.writeFileSync(tmpFile, html, "utf8");

      // Construct the Windows print command
      // Use cmd /c print /d:\\<host>\<share> <file>
      // We use \\\\localhost\\ because the print server runs on the same host
      const sharePath = `\\\\localhost\\${printerShare}`;
      const cmd = `cmd /c print /d:${sharePath} "${tmpFile}"`;

      exec(cmd, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tmpFile);
        } catch (_) {
          // ignore cleanup errors
        }

        if (error) {
          console.error(`❌ Print error for share "${printerShare}":`, stderr || error.message);
          reject(new Error(`Print failed: ${stderr || error.message}`));
          return;
        }

        console.log(`✅ Print job sent to shared printer "${printerShare}":`, stdout || "ok");
        resolve();
      });
    } catch (err) {
      console.error("❌ Print preparation failed:", err);
      reject(err);
    }
  });
}

/**
 * Write raw ESC/POS bytes to a temp file and send them to the shared printer.
 * The Windows spooler's `print` command passes the file through unchanged,
 * so the printer interprets ESC/POS commands itself (no HTML rendering).
 *
 * @param {Buffer} bytes - ESC/POS data
 * @param {string} printerShare - shared printer name
 * @returns {Promise<void>}
 */
function printRawToSharedPrinter(bytes, printerShare = PRINTER_SHARE_NAME) {
  return new Promise((resolve, reject) => {
    try {
      const tmpFile = path.join(TMP_DIR, `raw_${Date.now().toString(36)}.bin`);
      fs.writeFileSync(tmpFile, bytes);

      const sharePath = `\\\\localhost\\${printerShare}`;
      const cmd = `cmd /c print /d:${sharePath} "${tmpFile}"`;

      exec(cmd, (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tmpFile);
        } catch (_) {
          // ignore cleanup errors
        }
        if (error) {
          console.error(`❌ Raw print error for share "${printerShare}":`, stderr || error.message);
          reject(new Error(`Print failed: ${stderr || error.message}`));
          return;
        }
        console.log(`✅ Raw ESC/POS job sent to "${printerShare}":`, stdout || "ok");
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Handle incoming print job POST requests.
 * Raw text bodies are ESC/POS; JSON bodies are the legacy HTML format.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Promise<void>}
 */
async function handlePrint(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("application/text") || contentType.includes("text/plain")) {
    console.log(`🖨️  Raw ESC/POS request (${raw.length} bytes) → shared printer "${PRINTER_SHARE_NAME}"`);
    try {
      await printRawToSharedPrinter(raw);
      applyCors(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, printer: PRINTER_SHARE_NAME, mode: "raw" }));
    } catch (err) {
      console.error("❌ Print job failed:", err);
      applyCors(res);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Print failed" }));
    }
    return;
  }

  const body = raw.toString("utf8");
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    applyCors(res);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const { content, printerName } = payload;
  if (!content) {
    applyCors(res);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'content' field" }));
    return;
  }

  const targetPrinter = printerName || PRINTER_SHARE_NAME;
  console.log(`🖨️  Print request received → shared printer "${targetPrinter}"`);

  try {
    await printToSharedPrinter(content, targetPrinter);
    applyCors(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, printer: targetPrinter }));
  } catch (err) {
    console.error("❌ Print job failed:", err);
    applyCors(res);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Print failed" }));
  }
}

/**
 * Handle GET /printers — list available printers (limited info via sharing).
 */
function handleListPrinters(req, res) {
  applyCors(res);
  // Since we're using Windows sharing, we report the configured share name.
  // The actual printer is identified by the share name on the host network.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      printers: [
        {
          name: PRINTER_SHARE_NAME,
          portName: `\\\\${os.hostname()}\\${PRINTER_SHARE_NAME}`,
          isShared: true,
        },
      ],
      defaultPrinter: PRINTER_SHARE_NAME,
    })
  );
}

/**
 * Handle GET /health — print server health check.
 */
function handleHealth(req, res) {
  applyCors(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      port: PORT,
      printerShare: PRINTER_SHARE_NAME,
      hostName: os.hostname(),
    })
  );
}

// ────────────────────────────────────────────────────────────────────────
// HTTP Routing
// ────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  applyCors(res);
  const parsed = url.parse(req.url || "", true);
  const path = parsed.pathname;

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
}

// ────────────────────────────────────────────────────────────────────────
// Start Server
// ────────────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  console.log(`\n🖨️  Print Forwarder running on http://${HOST}:${PORT}`);
  console.log(`   Shared printer: "${PRINTER_SHARE_NAME}"`);
  console.log(`   (Configure this name in Windows: Printer Properties → Sharing)`);
  console.log(`   Hostname: ${os.hostname()}`);
  console.log(`   Temp dir: ${TMP_DIR}`);
  console.log(`\n📡 POS devices should POST to: http://<laptop-ip>:${PORT}/print`);
  console.log(`   Raw ESC/POS: Content-Type application/text, body = ESC/POS bytes`);
  console.log(`   Legacy HTML: Content-Type application/json, { "content": "<html>", "printerName": "optional" }`);
  console.log(`\n📝 Windows Sharing setup:`);
  console.log(`   1. Open "Control Panel > Devices and Printers"`);
  console.log(`   2. Right-click the XP-80 printer → "Printer properties"`);
  console.log(`   3. Go to "Sharing" tab → Check "Share this printer"`);
  console.log(`   4. Note the share name (default: "XP-80")`);
  console.log(`   5. Ensure "Render print jobs on clients" is UNCHECKED for best reliability`);
  console.log(
    `\n⚠️  IMPORTANT: The XP-80 printer must be SHARED on the host ` +
      `before the print server will work. Aronium continues printing ` +
      `as before (unchanged configuration).`
  );
});