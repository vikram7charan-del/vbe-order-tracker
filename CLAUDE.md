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
| Ujjwal Bharat | AU Small Finance Bank | (pending from owner) | **Most-used** account, pays for all firms |
| Bogra Army Traders | SBI | 7089 | Second most-used, business account |
| Kamla Kanwar Personal | AU Small Finance Bank | 4382 | Family personal a/c, also used for business |
| Sushila Kanwar | AU Small Finance Bank | 0481 | Family personal a/c (also BharatPe) |
| Vikram Charan Personal | SBI | 0499 | Owner's personal a/c, rarely for business |
| Cash (नकद) | — | — | Salaries, home expenses |

### Owner's workflow preferences (explicit)
- **Bills/transactions come from statements, not manual entry**: owner uploads bank/BharatPe/PhonePe statements → `payments.html` statement import creates entries (dedupe by UTR + date|amount). Do NOT bulk-import historical bills from legacy reports — owner declined this; only master data (parties/accounts) was imported.
- **Party master**: `vbe_parties/{party_<normalized>}` docs `{name, phones[], address, source}` — written by dashboard 📥 legacy import; party search in payments.html groups receipts+expenses by `partyKey`.
- Owner is non-technical, Hindi-speaking, wants one-click links and automation-first flows.
