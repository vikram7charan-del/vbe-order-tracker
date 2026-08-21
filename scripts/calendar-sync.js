/* ══════════════════════════════════════════════════════════
   VBE Call Tracker — Google Calendar Auto-Sync
   ──────────────────────────────────────────────────────────
   GitHub Actions पर चलता है: हर contact जिसकी अगली call का समय
   (nextCallAt) तय है, उसका एक Google Calendar event बना/अपडेट देता है।
   Google खुद उस समय reminder देगा — app बंद हो तब भी।

   Auth: FIREBASE_SA (service account) — इसी email से Calendar भी लिखेगा।
   ज़रूरी (एक बार): अपना Google Calendar इस service account email के साथ
   "Make changes to events" permission से share करना होगा।

   calendarId: _settings doc में calendarId रखो (आपका gmail), वरना
   CALENDAR_ID env, वरना default नीचे।
   ══════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { google } = require('googleapis');

const DEFAULT_CALENDAR = 'vikram7charan@gmail.com';
const TASK_CATS = { golden: '🏆', computer: '💻', market: '🛒', jalipa: '🏪' };

// Calendar API नई-नई enable हुई है → quota कम। हर call के बीच थोड़ा रुको
// ताकि "Rate Limit Exceeded" न आए। साथ ही rate-limit पर 2 बार दोबारा कोशिश।
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 600;
function isRateLimit(e) {
  return e && (e.code === 403 || e.code === 429 ||
    (e.errors && e.errors[0] && /rate limit|quota|userRateLimit/i.test(e.errors[0].reason || e.errors[0].message || '')) ||
    /rate limit/i.test(e.message || ''));
}
async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (e.code === 409) throw e; // duplicate → caller खुद patch करेगा
      if (!isRateLimit(e)) throw e;
      await sleep(1500 * (attempt + 1)); // 1.5s, 3s
    }
  }
  throw lastErr;
}

function normTopics(c) {
  if (Array.isArray(c.topics) && c.topics.length)
    return c.topics.map((x) => (typeof x === 'string' ? { t: x, done: false } : x));
  return c.note ? [{ t: c.note, done: false }] : [];
}
function eventId(id) {
  // Google event id: सिर्फ़ a-v, 0-9 — sha1 hex (0-9a-f) safe है
  return 'vbe' + crypto.createHash('sha1').update(String(id)).digest('hex');
}
const APP_URL = 'https://vbe-order-tracker-60324.web.app/call-tracker.html';
/* event description के नीचे Call/WhatsApp/App के सीधे link —
   Google Calendar में नंबर और URL अपने-आप tap करने लायक बन जाते हैं */
function contactLinks(id, d) {
  const ph = (d.phone || '').replace(/[^0-9]/g, '');
  const wa = ((d.waPhone || d.phone) || '').replace(/[^0-9]/g, '');
  let s = '\n';
  if (ph) s += `\n📞 Call: +91 ${ph}`;
  if (wa) s += `\n💬 WhatsApp: https://wa.me/${wa.length === 10 ? '91' + wa : wa}`;
  s += `\n🔗 App में खोलें: ${APP_URL}?open=${id}`;
  s += '\n— VBE Call Tracker';
  return s;
}

async function main() {
  const saJson = process.env.FIREBASE_SA;
  if (!saJson) { console.error('FIREBASE_SA missing'); process.exit(1); }
  const sa = JSON.parse(saJson);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  await auth.authorize(); // token पक्का लो — वरना "missing auth credential" आता है
  const cal = google.calendar({ version: 'v3', auth });

  const snap = await db.collection('vbe_call_tracker').get();
  let settings = {};
  const all = [];
  snap.forEach((d) => {
    if (d.id === '_settings') { settings = d.data() || {}; return; }
    all.push({ id: d.id, data: d.data() });
  });
  const calendarId = settings.calendarId || process.env.CALENDAR_ID || DEFAULT_CALENDAR;

  const now = Date.now();
  let made = 0, upd = 0, del = 0, err = 0;
  let autoIns = 0; // इस run में auto-task events की गिनती (rate-limit cap)
  const AUTO_CAP = 40;

  // ── 📅 Auto-Calendar config (app की ⚙️ से बदलने लायक — _settings.cal) ──
  const C = settings.cal || {};
  const CFG = {
    enabled: C.enabled !== false,                 // default चालू
    lead: Number(C.lead) > 0 ? Number(C.lead) : 15,        // add के कितने मिनट बाद event
    followup: Number(C.followup) > 0 ? Number(C.followup) : 60,
    dur: Number(C.dur) > 0 ? Number(C.dur) : 30,
    esc: C.esc !== false,                          // escalation चालू?
    tgRemind: C.tgRemind !== false,                // owner को Telegram पर भी reminder?
    escInts: Array.isArray(C.escInts) && C.escInts.length ? C.escInts : [60, 120, 240],
    maxEsc: Number(C.maxEsc) > 0 ? Number(C.maxEsc) : 3,
    quiet: C.quiet || { start: '22:00', end: '07:00' },
  };
  // पहली बार चालू होने पर cutoff सेट करो — इससे पुराने (backfill) काम events नहीं बनाएँगे
  let AUTO_START = Number(settings.calAutoStart) || 0;
  if (!AUTO_START) {
    AUTO_START = now;
    try { await db.collection('vbe_call_tracker').doc('_settings').set({ calAutoStart: AUTO_START }, { merge: true }); } catch (e) {}
    console.log('calAutoStart सेट — पुराने काम skip, अब से नए काम auto-calendar में');
  }

  // ── 📩 owner को Telegram nudge (escalation) — बॉट वाला ही token/chat ──
  async function tgNudge(text) {
    const tok = settings.tgBotToken, chat = settings.tgChatId;
    if (!tok || !chat) return;
    try {
      await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chat), text, disable_web_page_preview: true }),
      });
    } catch (e) { /* net fail — अगली बार */ }
  }
  // IST घंटा + quiet-hours shift (शांति में पड़े event को अगली सुबह खिसकाओ)
  function istHour(ms) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date(ms))); }
  function quietShift(ms) {
    const qs = Number((CFG.quiet.start || '22:00').split(':')[0]);
    const qe = Number((CFG.quiet.end || '07:00').split(':')[0]);
    const h = istHour(ms);
    const inQuiet = qs > qe ? (h >= qs || h < qe) : (h >= qs && h < qe);
    if (!inQuiet) return ms;
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    const [Y, M, D] = ymd.split('-').map(Number);
    let target = Date.UTC(Y, M - 1, D, qe, 0, 0) - (5.5 * 3600 * 1000); // qe:00 IST → UTC
    if (target <= ms) target += 24 * 3600 * 1000;
    return target;
  }

  // sync की हालत doc में वापस लिखो — app इसी से "📅 Calendar में" badge दिखाता है
  async function markSync(id, patch) {
    try { await db.collection('vbe_call_tracker').doc(id).set(patch, { merge: true }); } catch (e) { /* non-fatal */ }
  }

  /* ══ हर नया काम → auto main-event (add+lead) + follow-up (+followup) + escalation ══
     - key: topic.tid या 'a'+Date.parse(addedAt) (स्थायी); event id उसी से।
     - state doc-level map d.calAuto[key] में; app pill/ring इसी से दिखाता है।
     - done/हटा → दोनों events delete; escalation पर owner Telegram nudge (max 3)। */
  async function autoTaskEvents(c, d) {
    if (!CFG.enabled) return;
    const topics = normTopics(d);
    const map = (d.calAuto && typeof d.calAuto === 'object') ? { ...d.calAuto } : {};
    let touched = false;
    const seen = new Set();
    const durMs = CFG.dur * 60000;

    for (const x of topics) {
      if (!x) continue;
      const addMs = x.addedAt ? Date.parse(x.addedAt) : 0;
      if (!addMs || isNaN(addMs)) continue;               // बिना तारीख़ = skip
      if (x.at && x.tid) continue;                        // ⏰+tid = syncTopicEvents संभालता है (dup न बने)
      const key = x.tid || ('a' + addMs);
      seen.add(key);
      const ent = map[key] || {};
      if (ent.st === 'manual') continue;                  // app से हाथ से डाला — worker छोड़े
      // सिर्फ़ हाल के काम (आख़िरी 48 घंटे) — पुराने ढेरों काम का flood न बने
      const refMs = x.at ? Date.parse(x.at) : addMs;
      if (refMs < now - 48 * 3600000) { if (!ent.st) { map[key] = { st: 'skip' }; touched = true; } continue; }

      const evId = eventId(c.id + '_at_' + key);
      const fuId = eventId(c.id + '_fu_' + key);
      const gone = d.active === false || x.done;

      if (gone) {
        if (ent.ev || ent.fev || (ent.st && ent.st !== 'done' && ent.st !== 'skip')) {
          try { await cal.events.delete({ calendarId, eventId: evId }); del++; } catch (e) {}
          try { await cal.events.delete({ calendarId, eventId: fuId }); del++; } catch (e) {}
          map[key] = { st: 'done' }; touched = true;
          await sleep(THROTTLE_MS);
        }
        continue;
      }

      // समय — काम पर ⏰ लगा हो तो वही; वरना add + lead (quiet-hours shift non-urgent)
      let schedMs = x.at ? Date.parse(x.at) : (addMs + CFG.lead * 60000);
      if (!x.at && x.pri !== 'high') schedMs = quietShift(schedMs);
      const fuMs = schedMs + CFG.followup * 60000;
      const canPing = (t) => now >= t && (now - t) <= 3 * 3600000; // सिर्फ़ ताज़ा trigger पर TG (पुराना burst नहीं)

      // main event — पहली बार दिखते ही बना दो (start भविष्य में हो तब भी reminder पक्का)
      if (!ent.ev) {
        if (autoIns >= AUTO_CAP) continue;                // इस run की सीमा — बाक़ी अगली बार
        const body = {
          id: evId,
          summary: '🎯 ' + String(x.t).slice(0, 90) + (x.assignTo ? ' — ' + x.assignTo : (d.name ? ' — ' + d.name : '')),
          description: `जोड़ा: ${d.name || '?'} · ${x.addedAt}\n${x.assignTo ? 'सौंपा: ' + x.assignTo + '\n' : ''}${x.t}` + contactLinks(c.id, d),
          start: { dateTime: new Date(schedMs).toISOString(), timeZone: 'Asia/Kolkata' },
          end: { dateTime: new Date(schedMs + durMs).toISOString(), timeZone: 'Asia/Kolkata' },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
          colorId: x.pri === 'high' ? '11' : '9', // 11=लाल(urgent), 9=नीला(normal)
        };
        try {
          await withRetry(() => cal.events.insert({ calendarId, requestBody: body }));
          ent.ev = evId; ent.at = new Date(schedMs).toISOString(); ent.st = 'synced'; ent.esc = 0;
          made++; autoIns++; touched = true;
        } catch (e) {
          if (e.code === 409) { ent.ev = evId; ent.st = 'synced'; touched = true; }
          else { ent.st = 'failed'; ent.err = e.message; touched = true; err++; }
        }
        await sleep(THROTTLE_MS);
      }

      // follow-up event — तभी बनाओ जब follow-up समय पास आ गया और काम अब भी बाकी
      if (ent.ev && !ent.fev && now >= fuMs - 5 * 60000 && autoIns < AUTO_CAP) {
        const fb = {
          id: fuId,
          summary: '🔁 फॉलो-अप: ' + String(x.t).slice(0, 80),
          description: 'यह काम अभी तक पूरा नहीं हुआ। पोर्टल में जाकर ✅ लगाएँ।\n\n' + (x.t || '') + contactLinks(c.id, d),
          start: { dateTime: new Date(fuMs).toISOString(), timeZone: 'Asia/Kolkata' },
          end: { dateTime: new Date(fuMs + 15 * 60000).toISOString(), timeZone: 'Asia/Kolkata' },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
          colorId: '5', // पीला
        };
        try {
          await withRetry(() => cal.events.insert({ calendarId, requestBody: fb }));
          ent.fev = fuId; made++; autoIns++; touched = true;
        } catch (e) { if (e.code === 409) { ent.fev = fuId; touched = true; } }
        await sleep(THROTTLE_MS);
      }

      // 🔔 owner को Telegram पर भी reminder — काम का समय (schedMs) + follow-up (fuMs)।
      // सभी नए काम की याद owner (विक्रम जी) को Telegram पर आए (calendar के साथ-साथ)।
      if (CFG.tgRemind && ent.ev) {
        const day = istHour(now) >= 7 && istHour(now) < 22;   // रात में नहीं
        if (!ent.mSent && now >= schedMs) {
          if (day && canPing(schedMs)) await tgNudge(`🔔 काम का समय आ गया\n"${String(x.t).slice(0, 130)}"\n👤 ${x.assignTo || d.name || '—'}\n✅ हो जाए तो पोर्टल में लगाएँ: ${APP_URL}?open=${c.id}`);
          ent.mSent = true; touched = true;   // पुराना हो तो चुपचाप mark (burst नहीं)
        }
        if (!ent.fSent && now >= fuMs) {
          if (day && canPing(fuMs)) await tgNudge(`🔁 फॉलो-अप — यह काम अब तक बाकी है\n"${String(x.t).slice(0, 130)}"\n👤 ${x.assignTo || d.name || '—'}\n✅ पोर्टल में लगाएँ: ${APP_URL}?open=${c.id}`);
          ent.fSent = true; touched = true;
        }
      }

      // escalation — follow-up बीतने पर, हर interval पर owner nudge (max), फिर 'stuck'
      if (CFG.esc && ent.ev && now >= fuMs) {
        const since = now - fuMs;
        let want = 0, acc = 0;
        for (const iv of CFG.escInts) { acc += iv * 60000; if (since >= acc) want++; }
        want = Math.min(want, CFG.maxEsc);
        if (want > (ent.esc || 0)) {
          const first = !ent.esc;                          // पहली बार दिखा (पुराना काम) — चुपचाप state
          ent.esc = want; ent.st = want >= CFG.maxEsc ? 'stuck' : 'esc';
          ent.lastEsc = new Date(now).toISOString(); touched = true;
          // nudge सिर्फ़ ताज़ा escalation पर (7-22), पुराने अटके काम का burst नहीं
          if (istHour(now) >= 7 && istHour(now) < 22 && !(first && since > 6 * 3600000)) {
            await tgNudge(`⚠️ अटका काम (${want}/${CFG.maxEsc}): "${String(x.t).slice(0, 90)}"\n👤 ${x.assignTo || d.name || '—'}\nजोड़ा: ${x.addedAt}\n✅ पोर्टल में पूरा लगाएँ: ${APP_URL}?open=${c.id}`);
          }
        }
      }
      map[key] = ent;
    }

    // topics से हटे keys के events भी साफ़ करो
    for (const k of Object.keys(map)) {
      if (seen.has(k)) continue;
      const e1 = eventId(c.id + '_at_' + k), e2 = eventId(c.id + '_fu_' + k);
      try { await cal.events.delete({ calendarId, eventId: e1 }); del++; } catch (e) {}
      try { await cal.events.delete({ calendarId, eventId: e2 }); del++; } catch (e) {}
      delete map[k]; touched = true;
      await sleep(THROTTLE_MS);
    }
    if (touched) { try { await db.collection('vbe_call_tracker').doc(c.id).set({ calAuto: map }, { merge: true }); } catch (e) {} }
  }

  for (const c of all) {
    const d = c.data;
    const evId = eventId(c.id);
    const active = normTopics(d).filter((x) => !x.done);
    const t = d.nextCallAt ? new Date(d.nextCallAt).getTime() : 0;
    // Event तभी जब: active contact + अगली call का समय हो + काम बाकी हों + समय 2 दिन से ज़्यादा पुराना न हो
    const wantEvent = d.active !== false && t > 0 && active.length &&
      (t > now - 2 * 24 * 60 * 60 * 1000);

    if (!wantEvent) {
      // event था (या पुराने docs में पता नहीं) तो हटाओ; calSynced:false लिखो
      if (d.calSynced !== false) {
        try { await cal.events.delete({ calendarId, eventId: evId }); del++; console.log('- ', d.name); } catch (e) { /* था ही नहीं */ }
        await markSync(c.id, { calSynced: false });
        await sleep(THROTTLE_MS);
      }
      // main event नहीं, पर नीचे per-task events फिर भी sync होंगे
      await syncTopicEvents(c, d);
      await autoTaskEvents(c, d);
      continue;
    }

    const start = new Date(t);
    const durMin = Number(d.durationMins) > 0 ? Number(d.durationMins) : 15;
    const end = new Date(t + durMin * 60 * 1000);
    const desc = active.map((x, i) =>
      `${i + 1}. ${x.cat && TASK_CATS[x.cat] ? TASK_CATS[x.cat] + ' ' : ''}${x.t}`
    ).join('\n') + contactLinks(c.id, d);

    const body = {
      id: evId,
      // खुद के task (aiQuick) पर 📅, contact call पर 📞 Call:
      summary: (d.aiQuick ? ((d.emoji || '📅') + ' ') : '📞 Call: ') + (d.name || '?'),
      description: desc,
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 0 },
          { method: 'popup', minutes: 10 },
        ],
      },
    };

    let synced = false;
    try {
      await withRetry(() => cal.events.insert({ calendarId, requestBody: body }));
      made++; synced = true; console.log('+ ', d.name);
    } catch (e) {
      if (e.code === 409 || (e.errors && e.errors[0] && e.errors[0].reason === 'duplicate')) {
        try {
          await withRetry(() => cal.events.patch({ calendarId, eventId: evId, requestBody: body }));
          upd++; synced = true; console.log('~ ', d.name);
        } catch (e2) { err++; console.error('✗', d.name, e2.message); }
      } else { err++; console.error('✗', d.name, e.message); }
    }
    if (synced) await markSync(c.id, { calSynced: true, calSyncedAt: new Date().toISOString(), calEventFor: d.nextCallAt });
    await sleep(THROTTLE_MS); // अगली call से पहले रुको (rate limit से बचाव)

    await syncTopicEvents(c, d);
    await autoTaskEvents(c, d);
  }

  /* ── हर काम का अपना समय (topic.at + tid) → अलग calendar event ──
     schedule.html से किसी काम पर ⏰ लगाने से topic में {at, tid} आता है।
     tid स्थायी id है — event उसी से बनता/हटता है। doc में calTopicsSynced
     map ({tid: at}) लिखते हैं ताकि app badge दिखा सके और हटे काम का event
     अगले run में साफ़ हो। */
  async function syncTopicEvents(c, d) {
    const topics = normTopics(d);
    const tmap = (d.calTopicsSynced && typeof d.calTopicsSynced === 'object') ? d.calTopicsSynced : {};
    const newMap = {};
    let touched = false;
    for (const x of topics) {
      if (!x || !x.tid) continue;
      const tt = x.at ? new Date(x.at).getTime() : 0;
      const evTid = eventId(c.id + '_' + x.tid);
      const wantT = d.active !== false && !x.done && tt > 0 && tt > now - 2 * 24 * 60 * 60 * 1000;
      if (!wantT) {
        if (tmap[x.tid]) {
          try { await cal.events.delete({ calendarId, eventId: evTid }); del++; console.log('-⏰', String(x.t).slice(0, 30)); } catch (e) { /* था ही नहीं */ }
          touched = true;
          await sleep(THROTTLE_MS);
        }
        continue;
      }
      const tb = {
        id: evTid,
        summary: '⏰ ' + String(x.t).slice(0, 80) + (d.aiQuick ? '' : ' — ' + (d.name || '')),
        description: (x.t || '') + `\n\n📌 ${d.name || ''}` + contactLinks(c.id, d),
        start: { dateTime: new Date(tt).toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: new Date(tt + 15 * 60000).toISOString(), timeZone: 'Asia/Kolkata' },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 0 },
            { method: 'popup', minutes: 10 },
          ],
        },
      };
      let ok = false;
      try {
        await withRetry(() => cal.events.insert({ calendarId, requestBody: tb }));
        made++; ok = true; console.log('+⏰', String(x.t).slice(0, 30));
      } catch (e) {
        if (e.code === 409 || (e.errors && e.errors[0] && e.errors[0].reason === 'duplicate')) {
          try {
            await withRetry(() => cal.events.patch({ calendarId, eventId: evTid, requestBody: tb }));
            upd++; ok = true; console.log('~⏰', String(x.t).slice(0, 30));
          } catch (e2) { err++; console.error('✗⏰', String(x.t).slice(0, 30), e2.message); }
        } else { err++; console.error('✗⏰', String(x.t).slice(0, 30), e.message); }
      }
      if (ok) newMap[x.tid] = x.at;
      if (tmap[x.tid] !== newMap[x.tid]) touched = true;
      await sleep(THROTTLE_MS);
    }
    // topics से हटे tids के events भी साफ़ करो
    for (const tid of Object.keys(tmap)) {
      if (topics.find((x) => x && x.tid === tid)) continue;
      try { await cal.events.delete({ calendarId, eventId: eventId(c.id + '_' + tid) }); del++; } catch (e) { /* था ही नहीं */ }
      touched = true;
      await sleep(THROTTLE_MS);
    }
    if (touched) {
      // पूरा map बदलो (merge नहीं) ताकि हटे tids भी साफ़ हों
      try { await db.collection('vbe_call_tracker').doc(c.id).update({ calTopicsSynced: newMap }); } catch (e) { /* non-fatal */ }
    }
  }

  // app को "आख़िरी sync" + share करने वाला बॉट-ईमेल दिखाने के लिए
  try { await db.collection('vbe_call_tracker').doc('_settings').set({ calLastRun: new Date().toISOString(), calBotEmail: sa.client_email }, { merge: true }); } catch (e) {}

  console.log(`Calendar: ${made} बने, ${upd} अपडेट, ${del} हटाए, ${err} error, auto+${autoIns} (calendar=${calendarId})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
