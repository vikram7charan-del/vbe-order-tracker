# VBE Call Tracker — AI System Documentation (Audit Reference)

> मालिक: विक्रम चारण (Vande Bharat Enterprises)। यह दस्तावेज़ हर AI-audit सवाल का
> सबूत-सहित जवाब है: कौन सी file, कौन सा function, कौन सा algorithm, कहाँ data।
> आख़िरी बड़ा update: 2026-07-16

## 0. एक नज़र में Architecture (Command Pipeline)

```
User सवाल (orb में टाइप/🎙️ आवाज़)
   ↓ window.aicAsk() / aicVoice()          [call-tracker.html]
   ↓ _aicRun(q)  ← यही COMMAND ROUTER है
   1) aicRuleAnswer(q)   → लोकल Rule/Intent Engine (0 token) — जवाब मिला तो यहीं ख़त्म
   2) _aicCacheGet(q)    → 12-घंटे cache, data-signature से invalidate (0 token)
   3) askPinAI()         → PIN gate (token सुरक्षा)
   4) aiAsk(_aicGrounded(q)) → Claude Haiku, सिर्फ़ ज़रूरी records + no-guess नियम
   ↓ _aicShow() — जवाब पर टैग: 🧠 local / 💾 cache / 🤖 AI (explainability)
```

## 1. Intent Engine

- **File/Function:** `call-tracker.html` → `function aicRuleAnswer(q)`
- **Algorithm:** Hindi+English **keyword matching** (`has(...)` helper — हर intent के
  पर्यायवाची शब्दों की सूची)। ML नहीं — जान-बूझकर: deterministic, 0 token, 0ms,
  कभी hallucinate नहीं करता।
- **Conflict resolution / confidence:** कोई score नहीं — **क्रम ही प्राथमिकता है**
  (first-match-wins)। ऊपर वाला intent जीतता है। इसीलिए Focus सबसे ऊपर है।
- **Intent क्रम (यही router-priority):**
  1. 🎯 Focus (owner v/d/k + श्रेणी छनाई के साथ)
  2. 🔒 Backup download
  3. 🕸️ श्रेणी-खोज (market/golden/computer/jalipa × व्यक्ति × हालत)
  4. 🎯 सिफ़ारिश (reco) 5. 🔮 भविष्यवाणी (risk) 6. 🧭 आदतें (patterns)
  7. 💚 Health score 8. 👥 Staff-प्रदर्शन 9. 🗂️ Client Memory (नाम-पहचान `_findByName`)
  10. 📊 हफ़्ता/महीना रिपोर्ट 11. सलाह-guard (→ Claude)
  12. 📅 Range ("पिछले N दिन/हफ़्ते/महीने में जोड़े") 13. एक-दिन (कल/परसों/N दिन पहले)
  14. आज के काम 15. लेट 16. Call बाकी 17. व्यक्ति-wise (सौंपे + कार्ड, दो-section)
  18. कुल पेंडिंग 19. संपर्क-गिनती 20. 🔴 ज़रूरी 21. 🕘 गतिविधि-log
- **नया intent जोड़ना:** `aicRuleAnswer` में सही जगह पर एक `if(has(...)) return ...;`
  block — जितना ऊपर, उतनी प्राथमिकता।
- **Fail-backup:** कोई intent न मिले → cache → Claude (grounded) → वो भी fail →
  साफ़ error message। कभी silent fail नहीं।

## 2. Command Router

- **Function:** `_aicRun(q)` (ऊपर diagram)।
- **Local vs Claude का फ़ैसला:** rule-engine जवाब दे सका = local। सिर्फ़
  सलाह/राय/रणनीति वाले शब्द (`कैसे, सुझाव, सलाह, रणनीति...`) guard से Claude जाते हैं।
- **हमेशा local:** focus, गिनती/सूची (लेट/पेंडिंग/call/श्रेणी/staff/client), reports,
  भविष्यवाणी, आदतें, health, backup। **हमेशा Claude:** open-ended reasoning
  ("इनको कैसे निपटाऊँ", business सलाह)।
- **API cost जागरूकता:** Claude call PIN-gated + `max_tokens` cap (700) +
  cache-first। खर्च-गिनती dashboard मालिक ने मना किया।

## 3. Knowledge Graph (रिश्ते)

- **कहाँ:** अलग collection **नहीं** — रिश्ते हर contact-doc के अंदर ही हैं और
  query के समय **live जोड़े** जाते हैं (सैकड़ों records पर यही सबसे तेज़/सस्ता है):
  - contact → topics[] (काम) → `cat` (श्रेणी), `assignTo` (staff), `at` (समय),
    `pri`, `addedAt/doneAt` → callLog, hist (गतिविधि), createdAt
  - `_focus` items → `f.id`(contact) + `f.i`(topic-index) से topic तक link
- **Combined query:** `aicRuleAnswer` में `qCat` (श्रेणी-detector) × व्यक्ति
  (assignTo **और** contact-name दोनों) × हालत (done/late/pending) × focus।
- **व्यक्ति हटे तो:** काम उसी doc में हैं, साथ जाते हैं; archive (`active:false`)
  पर data सुरक्षित रहता है (soft-delete)।
- **Update कब:** Firestore `onSnapshot` — हर बदलाव पर तुरंत (real-time)।

## 4. Memory Engine

| परत | कहाँ | कब बनती | कब मिटती |
|---|---|---|---|
| Working | in-app `contacts[]`, `_focus`, `_memory` | onSnapshot live | session |
| Daily | `vbe_call_tracker/mem_YYYY-MM-DD` | रात 23:20 IST (`scripts/ai-daily-memory.js`) | **कभी नहीं** |
| Weekly | `mem_week_YYYY-MM-DD` | रविवार रात | कभी नहीं |
| Monthly | `mem_month_YYYY-MM` | माह की आख़िरी रात | कभी नहीं |
| Client | live गणना `ableClientText()` + contact.hist(आख़िरी 40) | हर query | — |
| Staff | live गणना `ableStaff()` + nightly `staffPerf` | हर query/रात | — |
| Behaviour | `addH[24]`,`doneH[24]` histograms daily/weekly/monthly docs में | हर रात | कभी नहीं |

- **Claude क्या पढ़ता है:** सिर्फ़ `_aicGrounded()` का बनाया context (active काम,
  max 60, नाम+काम+तारीख़ — **फ़ोन नंबर नहीं**)। Memory docs local intents पढ़ते हैं।
- **Compression:** daily→weekly→monthly aggregation ही compression है।

## 5. Search Engine

- **कैसे:** पूरा working-set (`contacts[]`) memory में है (Firestore offline cache) —
  scan in-RAM, सैकड़ों records पर **<5ms**। अलग index की ज़रूरत इस scale पर नहीं;
  ~5,000+ contacts पर Firestore composite-index वाला upgrade करना होगा (सीमा नोट)।
- **छनाई-index (logical):** focus / श्रेणी / व्यक्ति / हालत / तारीख़ / VIP — सब
  `aicRuleAnswer` की dimension-filters से।

## 6. Prediction Engine

- **Function:** `ableRiskText()` — **rule-based** (ML नहीं; data अभी छोटा है, rules
  ज़्यादा भरोसेमंद): (a) 24h में due + उस व्यक्ति की late-history का ⚠️ flag,
  (b) भूले काम = बिना समय, addedAt ≥5 दिन, (c) reminder-भारी = ≥5 call फिर भी pending।
- **इतिहास:** पूरा उपलब्ध data + memory docs। गलत निकले तो rule tune होता है
  (मालिक feedback → code fix — यही self-improvement का व्यावहारिक रास्ता)।

## 7. Staff Intelligence

- **Function:** `ableStaff()` / `ableStaffText()`
- **Formulas:** Reliability = `done/(done+late)×100` · Avg completion =
  `mean(doneAt−addedAt)` (0–90 दिन की सीमा में) · Late = pending जिनका `at` बीत गया।
- **Ranking:** हर query पर live; रात को `staffPerf` स्थायी docs में।
- **Trust/Reminder-weight:** reliability ही trust है; reminder-count client-side
  `callLog` से (predictions में ≥5 का threshold)।

## 8. API Optimization

- **Model:** `claude-haiku-4-5-20251001` (सबसे सस्ता); `aiAsk()` में 25s timeout।
- **Caps:** voice-parse 240 tokens, orb-जवाब 700, WA message 1400, day-plan 1500।
- **परतें:** local-first → 12h cache (`_aicCacheGet/Set`, data-signature `_aicSig`)
  → PIN (`askPinAI`) → Claude। आम इस्तेमाल में **~95%+ सवाल 0 token**।
- **Counter/dashboard:** नहीं है — मालिक ने साफ़ मना किया (2026-07-16)।

## 9. Focus Mode (first-class)

- **Data:** `_focus[]` (localStorage `vbe_focus`) ⟷ Firestore doc
  `vbe_call_tracker/_focus` (सब device sync)। Item: `{key,id,i,t,own(v/d/k),start,until,mins}`।
- **Intent:** rule-engine की **पहली** जाँच — focus सवाल कभी लेट/पेंडिंग सूची से
  जवाब नहीं पाते; खाली हो तो साफ़ "कोई काम focus में नहीं"।
- **Ranking:** लेट पहले (सबसे पुराना ऊपर), फिर जिनका समय जल्दी ख़त्म। Top-N चुनना
  हो तो `ableRecommend()` का weighted score: late-hours(≤50) + 🔴pri(+30) +
  call-due(+15) + VIP(≤10)।

## 10. Self-Learning

- **कैसे सीखता है:** हर काम जुड़ते ही `addedAt` stamp → patterns तुरंत बदलते हैं
  (live गणना) → रात 23:20 histograms स्थायी docs में। "रोज़ 11 बजे task" वाला
  pattern **उसी दिन** दिखना शुरू, स्थायी 1 रात में।
- **Save कहाँ:** `mem_*` docs (Firestore)। **Export:** orb में "backup लो" → पूरा
  JSON; रात को cloud backup (`scripts/ai-backup.js` → Storage `vbe_backups/`)।
- **Reset:** `mem_*` docs मिटाना + localStorage साफ़ = learning reset।

## Background Jobs (सब `.github/workflows/call-reminders.yml`, हर 5 min cron)

| समय (IST) | Script | काम | Token |
|---|---|---|---|
| हर 5 min | call-reminders.js | due call push + FCM | 0 |
| हर 5 min | calendar-sync.js | Google Calendar sync | 0 |
| 7:00–8:00 | ai-day-plan.js | सुबह का AI प्लान push | ~1500 (दिन में 1) |
| 19:30–21:00 | ai-evening-brief.js | 🔮 कल की तैयारी push | 0 |
| 23:20+ | ai-daily-memory.js | daily/weekly/monthly memory + histograms | 0 |
| 23:20+ | ai-backup.js | cloud backup (per-date, कभी overwrite नहीं) | 0 |

## सीमाएँ (ईमानदार)

1. Keyword-intent है — बिल्कुल नए ढंग का वाक्य miss हो सकता है → वो Claude पर
   जाता है (grounded, no-guess) — गलत नहीं बताएगा, पर token लगेगा।
2. पुराने कामों पर `addedAt` नहीं था — तारीख़-सवाल उन पर खाली रहेंगे (अनुमान नहीं)।
3. In-RAM scan ~5,000 contacts तक ठीक; उससे बड़े पर index-रणनीति बदलनी होगी।
4. API cost-counter नहीं (मालिक का निर्णय)।

## नया audit कैसे करें (उदाहरण)

- "focus में क्या है" → 🧠 टैग + focus-list ही आए (लेट-सूची नहीं) ✅
- "कैलाश भाई के market काम" → सौंपे + कार्ड दोनों के market काम ✅
- वही सवाल दोबारा → 💾 cache टैग, 0 token ✅
- "आज मौसम" → रिकॉर्ड में नहीं / Claude साफ़ मना करे ✅
