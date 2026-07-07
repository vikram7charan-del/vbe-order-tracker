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

const DEFAULT_CALENDAR = '177mhwcanteen@gmail.com';
const TASK_CATS = { golden: '🏆', computer: '💻', market: '🛒', jalipa: '🏪' };

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

  for (const c of all) {
    const d = c.data;
    const evId = eventId(c.id);
    const active = normTopics(d).filter((x) => !x.done);
    const t = d.nextCallAt ? new Date(d.nextCallAt).getTime() : 0;
    // Event तभी जब: active contact + अगली call का समय हो + काम बाकी हों + समय 2 दिन से ज़्यादा पुराना न हो
    const wantEvent = d.active !== false && t > 0 && active.length &&
      (t > now - 2 * 24 * 60 * 60 * 1000);

    if (!wantEvent) {
      // पुराना event हो तो हटा दो
      try { await cal.events.delete({ calendarId, eventId: evId }); del++; } catch (e) { /* था ही नहीं */ }
      continue;
    }

    const start = new Date(t);
    const end = new Date(t + 15 * 60 * 1000);
    const desc = active.map((x, i) =>
      `${i + 1}. ${x.cat && TASK_CATS[x.cat] ? TASK_CATS[x.cat] + ' ' : ''}${x.t}`
    ).join('\n') + `\n\n📱 ${d.phone || ''}\n— VBE Call Tracker`;

    const body = {
      id: evId,
      summary: '📞 Call: ' + (d.name || '?'),
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

    try {
      await cal.events.insert({ calendarId, requestBody: body });
      made++; console.log('+ ', d.name);
    } catch (e) {
      if (e.code === 409 || (e.errors && e.errors[0] && e.errors[0].reason === 'duplicate')) {
        try {
          await cal.events.patch({ calendarId, eventId: evId, requestBody: body });
          upd++; console.log('~ ', d.name);
        } catch (e2) { err++; console.error('✗', d.name, e2.message); }
      } else { err++; console.error('✗', d.name, e.message); }
    }
  }
  console.log(`Calendar: ${made} बने, ${upd} अपडेट, ${del} हटाए, ${err} error (calendar=${calendarId})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
