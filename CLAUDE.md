# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**VBE Order Tracker** — A mobile-first progressive web app for Vande Bharat Enterprises (Jalipa Cantt, Barmer) to track orders, challans, clients, bank statements, and staff tasks. The entire frontend is pure static HTML/CSS/JS — no build tools, no npm, no framework.

## Architecture

### No Build System
There is no `package.json`, no bundler, no transpilation. Each `.html` file is a **fully self-contained page** with embedded `<style>` and `<script>` blocks. To "run" the app, simply open the HTML files in a browser or serve them from any static host (GitHub Pages, Firebase Hosting).

### Firebase as the Sole Backend
All data, auth, and push notifications go through Firebase (v10.12.0 modular SDK loaded via CDN):
- **Firestore** — all persistent data
- **Firebase Auth** — Email/Password (supplier) + Anonymous (customer read-only)
- **FCM** — push notifications via `firebase-messaging-sw.js` service worker

The same Firebase config object is duplicated in every HTML file:
```js
{ apiKey: "AIzaSyBCe5DKNKcthOl4umprfRm2QBfbVaFORg8",
  authDomain: "vbe-order-tracker-60324.firebaseapp.com",
  projectId: "vbe-order-tracker-60324", ... }
```

### Auth Model
- **Supplier (owner)** — `signInWithEmailAndPassword` using `mobile + "@vbe-tracker.local"` as email. The single approved UID is hardcoded: `APPROVED_UID = "tjkS5tg2vMflpndGHSQRjFYgRv03"`.
- **Customer (read-only)** — `signInAnonymously`, can only view their own order via tracking link.
- All sub-pages (`challan.html`, `contacts.html`, etc.) independently check auth on load and redirect to `./` if the UID doesn't match `APPROVED_UID`.
- Session state: `sessionStorage.getItem('vbe_auth')`, lockout: `localStorage.getItem('vbe_lockout_until')`.

### index.html — The Hub
`index.html` is the main app (~600 KB). It:
1. Initializes Firebase via `<script type="module">` and exposes everything to `window.*` (`window._db`, `window._collection`, `window._setDoc`, etc.)
2. Dispatches a `fbReady` event once Firebase auth state resolves
3. Contains the full supplier dashboard, customer tracking view, and login screen in a single file
4. Defines `window.STAGES` and `window.CATEGORIES` used by other pages

## Firestore Collections

| Collection | Purpose |
|---|---|
| `vbe_orders` | Main orders (supplier dashboard) |
| `vbe_challans` | Challans / delivery notes |
| `vbe_clients_meta` | Client records, keyed by phone number |
| `vbe_bank_accounts` | Bank accounts |
| `vbe_bank_entries` | Bank transactions |
| `vbe_fcm_tokens` | FCM device tokens for push notifications |
| `vbe_projects` | Projects tracker |
| `vbe_staff` | Staff list |
| `vbe_tasks` | Tasks (Time Master — cross-linked with orders via `tmTaskId`) |
| `vbe_rituals` | Morning/evening reflections (Time Master) |
| `vbe_checkins` | 5-minute check-ins (Time Master) |
| `mrk_bills` | Udhari bills (Marwad Rasoi — separate business) |
| `mrk_cash` | Cash ledger (Marwad Rasoi) |
| `mrk_staff` | Staff (Marwad Rasoi) |
| `vbe_expenses` | खर्चा ट्रैकर — expense entries (staff + admin quick entry) |
| `vbe_pricebook` | खर्चा ट्रैकर — per-item price history (auto-populated from expenses) |
| `vbe_payment_accounts` | खर्चा ट्रैकर — editable payment-source master (GPay/BharatPe/Cash) |
| `vbe_users` | खर्चा ट्रैकर — staff role accounts (`role: 'staff'`; admins live in `vbe_admins`) |
| `vbe_kharcha_units` | खर्चा ट्रैकर — army unit master (Jalipa/Jaisalmer, editable) |
| `unit_receivables` | खर्चा ट्रैकर — unit purchases: खरीदा → चालान → बिल → paid, with aging |
| `mr_daily` / `mr_udhari` / `mr_staff_ledger` | Marwar Rasoi daily management (marwar-rasoi.html — separate from legacy `mrk_*`) |
| `notification_queue` | खर्चा ट्रैकर — WhatsApp reminder queue consumed by n8n (`n8n-kharcha-workflow.json`) |
| `_audit_logs` | Delete/edit audit trail (create-only) |

### खर्चा ट्रैकर (Expense Tracker) Sub-system
Pages: `kharcha-entry.html` (staff form + admin quick entry + AI bill reading), `kharcha-dashboard.html` (admin-only analytics, staff account creation, payment-account master, CSV export), `pricebook.html`, `marwar-rasoi.html`, `unit-receivables.html`. Light blue/white theme (unlike the dark main app). Roles: admin = `vbe_admins` doc exists; staff = `vbe_users` doc with `role:'staff'` (created from dashboard via a secondary Firebase app instance). Bill photos go to Storage `kharcha_bills/{expenseId}.jpg` (client-compressed ≤1MB). AI bill extraction calls Anthropic vision via the `kharcha-functions/` Cloud Function proxy (preferred) or a localStorage API key fallback. Firms/categories are hardcoded consts duplicated in each kharcha page.

## Order Domain Model

### Stages (in order)
Defined in `index.html` as the `STAGES` array — modify only here:
```
received → confirmed → processing → packed → dispatched → delivered
```
`delivered` is the terminal state; active orders are always filtered as `stage !== 'delivered'`.

### Categories
```
market | follow | jalipa | gem | other
```

### Staff Colors (hardcoded in index.html `STAFF_COLORS`)
Vikram = Blue (`#3b82f6`), Manoj = Orange (`#f97316`), Kailash = Yellow (`#eab308`), Koda/Swaroop = Green (`#22c55e`). Name matching is case-insensitive and supports Hindi transliterations.

## Pages & Their Purpose

| File | Purpose |
|---|---|
| `index.html` | Main order tracker — supplier dashboard + customer tracking |
| `bank.html` | Bank Statement Manager — accounts & transactions |
| `challan.html` | Challan tracker |
| `clients.html` | Client directory — reads `vbe_orders` + `vbe_clients_meta` |
| `contacts.html` | Unit contacts & order summary per contact |
| `projects.html` | Project tracker with staff assignment & progress logs |
| `udhari.html` | Marwad Rasoi debt/udhari tracker (separate business, `mrk_*` collections) |
| `vbe-time-master.html` | Personal time/task manager — `vbe_tasks`, `vbe_rituals`, `vbe_checkins` |
| `vbe-exit.html` | Secure logout & session clear page |
| `firebase-messaging-sw.js` | FCM background service worker (must stay at repo root) |

## Key Conventions

### Firebase Access Pattern in Sub-pages
Sub-pages init their own Firebase instance and expose a smaller set of globals (e.g., `window._db`, `window._col`, `window._doc`). They do **not** listen for `fbReady` — they start directly in `onAuthStateChanged`.

### UI Conventions
- **Mobile-first**, max-width `480px`, centered.
- **Dark theme**: background `#050a14`, surface `#0d1526`, borders `#1e3a5f`.
- **Language**: UI text is Hindi (Devanagari). Variable/function names are English.
- **Fonts**: `Noto Sans Devanagari` is the default across all pages. `bank.html` additionally uses `Outfit`. `challan.html` uses `JetBrains Mono` for invoice numbers.
- All pages carry `<meta name="robots" content="noindex, nofollow">` — intentionally unlisted.

### Modifying Order Stages or Categories
Edit only the `STAGES` array and `CATEGORIES` object at the top of `index.html` (around line 1704). These are exposed via `window.STAGES` and `window.CATEGORIES` for other scripts within the same page.

### Cross-Page Linking (Orders ↔ Time Master)
When an order is pushed to Time Master, `vbe_tasks` gets a new document and the order document gets `tmTaskId` + `tmPushedAt` fields written back. This is the only cross-collection write pattern.

### Notification Architecture
- **Foreground**: `onMessage()` in `index.html` → calls `window.notif()` (in-app toast) + `new Notification()`.
- **Background**: `firebase-messaging-sw.js` handles `onBackgroundMessage` and shows system notifications.
- **Local reminders**: `window._localReminderWatch()` polls every 30s when the tab is open — no server required.
- FCM tokens are saved to `vbe_fcm_tokens/{uid}_{deviceId}`.

## Deployment

No build step — push HTML files to GitHub. The site is hosted via GitHub Pages (or Firebase Hosting). `firebase-messaging-sw.js` must remain at the repository root for the FCM service worker scope to work.

## VBE खर्चा ट्रैकर — Business Structure (owner's working model)

Learned from the owner's legacy "My Business Cloud Systems" report (Jan–Feb 2026) and his own description. Use this as ground truth when improving kharcha pages.

### Firms / business units (money is tracked per-firm)
- **Vande Bharat Enterprises** — main army-supply business (most expenses)
- **मारवाड़ रसोई (Marwar Rasoi)** — restaurant; has its own module (`marwar-rasoi.html`, `mr_*` collections)
- **Sabji Express** — vegetable-supply unit operating under Marwar Rasoi
- **177 Wet Canteen / MES Canteen / MH Vet Canteen** — army canteen units (customers/receivables)
- Best Choice Traders, Bright India Enterprises, Ujjwal Bharat Infratech, Shri Hinglaj Infratech — other firms in `FIRMS` list (kharcha-entry.html)

### Payment accounts (`vbe_payment_accounts`, `last4` drives auto-detect in payments.html)
| Account | Bank | last4 | Usage pattern |
|---|---|---|---|
| Ujjwal Bharat (Infratech) | AU Small Finance Bank | 0628 | **Most-used**, pays for all firms; owner also does direct-bank RTGS to parties from it (only in bank statement, not PhonePe) |
| Bogra Army Traders | SBI | 7089 | Second most-used, business account |
| Kamla Kanwar Personal | AU Small Finance Bank | 4382 | Family personal a/c, also used for business |
| Sushila Kanwar (wife) | AU Small Finance Bank | 0481 | **Marwar Rasoi income lands here via BharatPe**; also pays expenses sometimes |
| Vikram Charan Personal | SBI | 0499 | Owner's personal a/c — money in & out regularly |
| Cash (नकद) | — | — | Salaries, home expenses |

### Money flows (owner's own description, July 2026)
- Marwar Rasoi restaurant income → BharatPe → **Sushila Kanwar AU-0481**.
- Owner gives BOTH bank statements AND PhonePe/GPay statements for the same account/period — they overlap. **UTR is the cross-source dedupe key** (bank statement UTR == UPI statement UTR); statement import must never create the same transaction twice even from two different documents.
- RTGS payments to parties go straight from the bank (visible only in bank statement).
- After statement entries exist, owner fills in "what was it for" + attaches bill photo per entry.

### Owner's 2-month goals (drive feature decisions toward these)
1. Ask "आलू क्या रेट आ रहे हैं?" → app answers last purchase rates instantly (pricebook history).
2. Anomaly alert when paying a party: if today's payment pattern differs from that party's history, warn the owner (चूना/fraud protection).
3. Money-flow analysis: every rupee out should be traceable to what it earns back ("₹1 जाए तो 10-20 पैसे वापस लाए").
4. Owner must be able to answer any हिसाब question about his firms on the spot.

### Owner's workflow preferences (explicit)
- **Bills/transactions come from statements, not manual entry**: owner uploads bank/BharatPe/PhonePe statements → `payments.html` statement import creates entries — debits → `vbe_expenses`, credits → `vbe_receipts` with `direction:'in'` (dedupe by UTR across both collections + date|amount per direction). Do NOT bulk-import historical bills from legacy reports — owner declined this; only master data (parties/accounts) was imported.
- **Party master**: `vbe_parties/{party_<normalized>}` docs `{name, phones[], address, gstin, source}` — written by dashboard 📥 legacy import AND auto-enriched from every AI-read bill (`savePartyFromBill`). Party search in payments.html groups receipts+expenses by `partyKey`.
- Owner is non-technical, Hindi-speaking, wants one-click links and automation-first flows. Overwhelmed by complexity — keep it simple, add features one at a time.

## Kharcha ट्रैकर — pages & flows (current)

| Page | Role |
|---|---|
| `home.html` | **Simple landing** (owner's main page) — 3 big buttons: Statement डालो / फोटो से खर्चा / बही देखो; today's spend/income; rest hidden behind ☰ |
| `kharcha-entry.html` | Expense entry — Quick Entry (admin, typed-or-select staff), 📸 AI Auto Entry, manual form |
| `payments.html` | Receipts + **bank-statement PDF import** (pdf.js, no AI) + party search |
| `statement.html` | **बही** — date-grouped ledger, account-filter chips (auto from `vbe_payment_accounts`), 3D; row tap → detail popup with items + bill photo |
| `kharcha-dashboard.html` | Admin analytics + staff accounts (with `whatsapp` field) + payment-account manage + 📥 one-click embedded data import |
| `search.html` | **खोज / Universal search** — one box across parties/items/vendor/UTR/GSTIN/phone/amount (client-side, no AI). Party result → profile popup (totals, tel/WhatsApp, recent हिसाब); txn result → same detail popup as बही. Reached from ☰ menu tile + home header 🔍 |
| `hisab.html` | **महीने का हिसाब** — monthly money-flow: आमदनी + खर्च + बचत (net) with prev-month comparison, firm-wise in/out net, category-wise खर्च, top-6 biggest expenses (tap → detail). Month switcher (‹ ›, up to 13 months, one query). Reached from ☰ menu + home cash-flow hero tap. Complements `kharcha-dashboard.html` (which is expense-only admin analytics) |

### AI bill reading (`kharcha-entry.html`)
- Only for **photo bills** (statements need no AI). Model `claude-sonnet-4-6`, image ≤1568px, 60s timeout.
- **Never auto-saves**: `autoEntry`/`aiReadBill` → `applyBillData()` fills the *editable* form (item names/rates fixable) + shows GST-inclusive breakdown (`#gst-breakup`) reconciled against bill `grand_total`. Owner reviews then Saves.
- **Rate = GST-inclusive per-unit** (owner gets no GST input credit, so incl-GST is his real cost). Wages/freight → `other_charges` (added as item rows). Expense stores `grandTotal`, `partyGstin/phone/address`.
- AI config resolution: `localStorage vbe_ai_proxy_url` → `vbe_settings/kharcha_ai.proxyUrl` → `localStorage vbe_ai_key`. Claude Pro subscription CANNOT power the app (API ≠ Pro; told owner).

### Payment mode (2-step) in entry form
`f-paymode` (विक्रम मोबाइल / सुशीला मोबाइल / बैंक RTGS / Cash / अन्य) → `fillPayAccounts()` shows that mode's accounts from `vbe_payment_accounts.mode`. "अन्य" = free-text. Cash sources include जेब/गल्ला/घर. `payValue()` resolves final `paymentSource`; `payMode` stored. 🟠 उधार checkbox → `payStatus:'udhaar'`.

### Photo upload safety
`safeUpload()` — 20s timeout; if Firebase Storage not set up / slow, entry still saves (`billStatus:'pending'`), never hangs. **Storage must be enabled once** in Firebase Console for bill photos to persist.

### Connectors roadmap (owner picked all 4; do ONE at a time to avoid overwhelm)
1. ✅ Simple home. 2. 📊 Google Sheet mirror (= trust + backup; needs owner to share a Sheet with the FIREBASE_SA email). 3. 🔒 nightly backup (Sheet doubles as this). 4. 📱 WhatsApp via owner's n8n subscription (staff bill-reminders from `notification_queue`; staff `whatsapp` field). Owner also has Anthropic API credits + n8n; open to free connectors (Gemini etc.) if cost stays low.
