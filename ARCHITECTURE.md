# VBE Business OS — Database & System Architecture

यह doc बताता है डेटा कहाँ, कैसे, कितना सुरक्षित रहता है — और आगे के फैसलों की दिशा।

## 1. मूल फैसला: Firebase-first (custom SQLite/sync engine नहीं)
- **Primary store: Cloud Firestore** (Google का database)। हर entry Google के server पर सुरक्षित।
- **Offline अपने-आप**: Firestore SDK में offline cache built-in है — net न हो तो entry local cache में save होती है, net आते ही अपने-आप sync। **अलग SQLite + custom sync engine जानबूझकर नहीं बनाया** — वह सबसे ज़्यादा bug और डेटा-खोने का खतरा लाता है, और यहाँ ज़रूरत नहीं।
- **कोई build system नहीं**: हर `.html` self-contained (embedded CSS/JS)। Firebase v10.12.0 modular SDK CDN से। App name हर kharcha page में `'vbe-kharcha'` — ताकि login एक बार, सब pages में चले।

## 2. Firestore Collections (खर्चा ट्रैकर)
| Collection | क्या |
|---|---|
| `vbe_expenses` | खर्च entries (statement debit, photo bill, manual, quick)। fields: date, firm, category, vendor, items[], total, grandTotal, paymentSource, payMode, payStatus, utr, billStatus, entryStatus, partyGstin/phone/address, staffUid |
| `vbe_receipts` | आमदनी / payments। `direction:'in'` = पैसा आया (statement credit / receipt) |
| `vbe_parties` | party master `{name, phones[], address, gstin, source}` — legacy import + हर AI-bill से auto-enrich |
| `vbe_payment_accounts` | खाते `{name, bank, last4, mode, active}` — mode: vikram/sushila/bank/cash |
| `vbe_pricebook` | हर item का rate-history (price intelligence के लिए) |
| `vbe_users` | staff accounts `{role:'staff', name, phone, whatsapp}` |
| `vbe_admins` | admin UIDs |
| `unit_receivables`, `vbe_kharcha_units` | army-unit पैसा/master |
| `mr_daily / mr_udhari / mr_staff_ledger` | मारवाड़ रसोई |
| `notification_queue` | WhatsApp reminders (n8n consume करेगा) |
| `_audit_logs` | delete/edit का record (create-only) |

## 3. Dedupe / Data Integrity (डेटा दोहरा न हो)
- **UTR = master key**: bank statement और PhonePe/GPay statement में एक ही transaction का UTR समान होता है → import कभी दोबारा नहीं बनाता (`vbe_expenses.utr` + `vbe_receipts.utr` + same-statement + date|amount per direction)।
- **Deterministic doc-ids** legacy/embedded import में → दोबारा चलाने पर overwrite, double नहीं।
- **Bank statement reconcile**: pdf.js parser का हर transaction running-balance से जँचता है; totals बैंक की अपनी Total लाइन से मैच (0 error = 100% सही)।

## 4. Security (Firestore Rules — `firestore.rules`)
- role: admin (`vbe_admins` doc या 7 legacy UIDs) / staff (`vbe_users.role=='staff'`)।
- हर collection पर rule: staff सिर्फ अपनी entries (`staffUid==auth.uid`), admin सब।
- `validExpense()` shape-check (गलत type कभी save न हो)। `_audit_logs` create-only।
- Rules अलग deploy होते हैं (`deploy-rules.yml`, सिर्फ firestore:rules — storage optional)।

## 5. Storage (bill photos)
- `kharcha_bills/{expenseId}.jpg` — client-compressed ≤1MB। **Firebase Storage एक बार Console से enable करना ज़रूरी**।
- `safeUpload()` 20s timeout — Storage न हो/धीमा हो तो entry फिर भी बने (`billStatus:'pending'`), कभी न अटके।

## 6. AI (खर्च कम रखते हुए)
- **"Local intelligence" असल में AI नहीं, सिर्फ code है** (dedup, price-compare, search, analytics, statement-parse) — मुफ़्त, तेज़, offline।
- **Cloud AI सिर्फ ज़रूरत पर**: photo-bill OCR (sonnet), receipt/screenshot पढ़ना (haiku)। Statement PDF को **बिना AI** (pdf.js)।
- key: Cloud Function proxy (`kharcha_ai.proxyUrl`) या localStorage `vbe_ai_key` (per-device)। **Claude Pro subscription API नहीं चला सकता** (अलग product)।

## 7. Backup
- Firestore ही primary + Google-managed durability। अलग रोज़-backup connector (Google Sheet mirror) roadmap में — वही trust + backup दोनों देगा।

## 8. Deployment
- Live: `https://vbe-order-tracker-60324.web.app` — branch `claude/vande-bharat-firebase-jo82rc` से `deploy-hosting.yml` (manual dispatch, `FIREBASE_SA` secret)।
- **main कभी deploy नहीं** (सिर्फ workflow-registration के लिए default branch)।

## 9. आगे की दिशा (जब बढ़ाएँ)
- Universal search: एक index (party/item/utr/gst/phone) — client-side (मुफ़्त)।
- Business intelligence: vendor price-rise alert, firm-wise profit — सब मौजूदा data पर queries (AI नहीं)।
- Multi-firm books पहले से `firm` field से; combined + separate दोनों view बन सकते हैं।
- Scale: हज़ारों entries client पर ठीक; ज़्यादा हो तो Firestore query pagination + date-range।
