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

  // sync की हालत doc में वापस लिखो — app इसी से "📅 Calendar में" badge दिखाता है
  async function markSync(id, patch) {
    try { await db.collection('vbe_call_tracker').doc(id).set(patch, { merge: true }); } catch (e) { /* non-fatal */ }
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
      continue;
    }

    const start = new Date(t);
    const durMin = Number(d.durationMins) > 0 ? Number(d.durationMins) : 15;
    const end = new Date(t + durMin * 60 * 1000);
    const desc = active.map((x, i) =>
      `${i + 1}. ${x.cat && TASK_CATS[x.cat] ? TASK_CATS[x.cat] + ' ' : ''}${x.t}`
    ).join('\n') + `\n\n📱 ${d.phone || ''}\n— VBE Call Tracker`;

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
  }
  console.log(`Calendar: ${made} बने, ${upd} अपडेट, ${del} हटाए, ${err} error (calendar=${calendarId})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
