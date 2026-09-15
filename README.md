# Quenchers Water · Bulk Delivery POS

A mobile-first, Aronium-style Point of Sale for a bulk water delivery business.
Built with **Next.js 16 (App Router) + Tailwind v4** on a **Node/Express-style route handler** backend,
streaming every transaction into **Google Sheets** as its persistent database.

The local Windows PC runs the server 24/7. A background webhook endpoint listens for SMS forwarded
by an Android gateway app on the store phone, parses M-Pesa confirmations with regex, and
**auto-marks matching pending orders as PAID** with the transaction code written to the ledger.

---

## 1. Quick Start

Prerequisites: Node.js 20.9+ on the store PC.

```bash
npm install
cp .env.local.example .env.local   # then fill in your SPREADSHEET_ID + credentials
npm run dev                          # or: npm run build && npm start
```

Open `http://localhost:3000` on the POS PC. Any other device on the LAN can open
`http://<PC-LAN-IP>:3000`.

---

## 2. Google Sheets Setup (the "database")

1. Create a new Google Spreadsheet (e.g. **"Quenchers Water POS"**).
2. Copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/**1AbC...**/edit` → put it in `SPREADSHEET_ID`.
3. Create a service account:
   - console.cloud.google.com → your project → **APIs & Services → Credentials → Create Credentials → Service Account**.
   - Enable the **Google Sheets API** for the project.
   - Download the JSON key file and note the `client_email`.
4. Share your spreadsheet with the service account email (Editor).
5. Put the credentials in `.env.local` (path, inline JSON, or email+key — see example file).

On first login the app **auto-creates the required tabs and headers**:

| Tab        | Purpose                                                    |
| ---------- | ---------------------------------------------------------- |
| `PRODUCTS` | Product master: name, selling price, wholesale cost, stock |
| `CUSTOMERS`| Location autocomplete data (name, phone, address)          |
| `ORDERS`   | Daily dispatch ledger + profit + M-Pesa reference codes    |
| `USERS`    | Optional PIN/role table (falls back to `.env` PINs)        |

If `PRODUCTS` is empty it seeds the default water catalogue; if `CUSTOMERS` is empty it seeds
starter locations.

---

## 3. Roles & 4-Digit PINs

Default PINs (override in `.env.local`):

| Person      | Role         | Default PIN |
| ----------- | ------------ | ----------- |
| Vinnie      | Management   | `2486`      |
| Emma        | Management   | `1947`      |
| Tracy       | Management   | `9503`      |
| Wajakoya    | Rider        | `7721`      |
| Macharia    | Rider        | `3150`      |
| Kamau       | Rider        | `6082`      |

**Management** (`/` → `/pos`) sees the sales floor, restock, customer management, and the daily
financial strip (total sales / **profit** / expenditure / Glovo commission).

**Riders** land on `/queue` — a read-only list of only their assigned orders with big **PAID** /
**PENDING** buttons. Profit, costs, and company totals are never sent to the rider UI or API.

---

## 4. Profit Rules (server-side)

Profits are computed on the server the moment a dispatch ticket is saved — clients never send or
see wholesale costs:

```
Profit per line = (Selling Price − Wholesale Cost) × Quantity
Total Profit    = Σ line profits
If GLOVO is ON: Profit = Profit × 0.8   (20% commission deducted)
```

`profit` is stored per order row; `total − profit` gives expenditure.

---

## 5. M-Pesa Auto-Sync (the background listener)

### 5.1 The webhook
`POST /api/mpesa-webhook` accepts JSON containing the raw SMS text. Payload accepted shapes:

```json
{ "sms": "NKJ78X9P2Q Confirmed. Ksh550.00 received from JAMES K. on 9/15/2026 at 2:34 PM..." }
{ "message": { "body": "NKJ78X9P2Q Confirmed. ..." } }
{ "messages": [ { "text": "NKJ78X9P2Q Confirmed. ..." }, ... ] }
```

Optional security: if `MPESA_WEBHOOK_SECRET` is set, the forwarder must send
header `x-webhook-secret: <value>` or it gets `403`.

### 5.2 Regex parsing
- Transaction code: `/([A-Z0-9]{9,12})\s+Confirmed/`
- Amount: `/Ksh\s?([0-9][0-9,]*\.?[0-9]*)/`

### 5.3 Automatic match & write
The engine reads **today's** ledger rows, and for every incoming SMS:
1. balances the exact amount against **PENDING** orders for today,
2. flips `PAY STATUS` → `PAID`,
3. writes the M-Pesa reference into the row's **`MPESA_CODE`** column.

The receipt printer is then able to inject that code at the top of the thermal receipt.

### 5.4 Android forwarder setup (store phone)
1. Install an SMS-forwarding gateway (e.g. **SMS Forwarder**, MacroDroid, or Tasker).
2. Create a rule: on SMS from Safaricom **MPESA / e.g. account name** → HTTP POST the full message body.
3. URL: `http://<PC-LAN-IP>:3000/api/mpesa-webhook`
   (make sure `HOSTNAME=0.0.0.0` is set and Windows firewall allows inbound port 3000).
4. Body (JSON): `{ "sms": "<message text>" }` with `Content-Type: application/json`.

> Get the PC's LAN IP with `ipconfig`. Keep the phone on the same Wi-Fi network.

### 5.5 Manual test
```bash
curl -X POST http://localhost:3000/api/mpesa-webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"sms\":\"NKJ78X9P2Q Confirmed. Ksh550.00 received from JAMES KARANJA on 9/15/2026 at 2:34 PM. New M-PESA balance is Ksh 3,420.00.\"}"
```

---

## 6. Thermal Receipt Printing (58 / 80 mm)

Saving a ticket shows **🖨️ PRINT RECEIPT** / **❌ SKIP PRINTING**. Printing shells out to a
fully-isolated iframe containing only the receipt card — the POS interface never appears on paper.
The layout is 80 mm with a monospace, thermal-friendly design (works down to 58 mm).

If the order was paid by M-Pesa **and** a matched reference exists, **the code prints at the very top**
of the receipt under an `*** M-PESA PAYMENT ***` banner.

---

## 7. Offline Resilience

- Products, customers, and the day's orders are cached in `localStorage` and re-hydrated instantly.
- The ticket and rider queue keep working during a Wi-Fi/Sheets outage.
- Failed `POST` operations are queued locally (`waterpos.pendingOps`) and retried once connectivity
  returns.
- Any 401 anywhere sends the operator back to the PIN lock.

---

## 8. Project Structure

```
src/
├─ app/
│  ├─ api/
│  │  ├─ auth/login/         POST pin → signed session
│  │  ├─ pos/products/       GET products (management)
│  │  ├─ pos/customers/      GET search + POST/PATCH CRUD
│  │  ├─ orders/             GET queue + POST dispatch ticket
│  │  ├─ orders/[id]/        PATCH pay status
│  │  ├─ restock/            POST stock-in
│  │  ├─ staff/              rider list for assignment dropdown
│  │  ├─ dashboard/          daily financials (management) / rider stats
│  │  └─ mpesa-webhook/      SMS ingestion + auto-match
│  ├─ pos/  restock/  customers/  queue/   (role-guarded pages)
│  ├─ layout.tsx · globals.css
├─ components/
│  ├─ PinLogin.tsx · RoleGuard.tsx · ui.tsx
│  ├─ pos/       SalesFloor · SalesTicket · ProductTile grid · CustomerSearch · PrintPrompt
│  └─ riders/    RiderQueue
└─ lib/
   ├─ sheets.ts    Google Sheets adapter (auth, read/write, headers)
   ├─ auth.ts      PIN verify + HMAC-signed tokens
   ├─ mpesa.ts     SMS regex + payload extraction
   ├─ sync.ts      match engine (pending → paid, mpesa_code write)
   ├─ pricing.ts   profit math (Glovo commission), Nairobi date/time
   ├─ print.ts     80 mm receipt builder + iframe print
   └─ client.ts    fetch wrapper, auth store, localStorage cache, offline queue
```

## 9. Autostart on the store PC

`npm run build` once, then:

```bat
REM start-pos.bat
cd /d C:\path\to\POS
npm start
```

Run it via Task Scheduler ("At startup") so the webhook listener is always on.