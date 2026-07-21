/* ══════════════════════════════════════════════════════════
   VBE Call Tracker — Reminder Push Sender (GitHub Actions)
   ──────────────────────────────────────────────────────────
   GitHub Actions से हर कुछ मिनट में चलता है:
   1. vbe_call_tracker में देखता है किसकी call due/late है
   2. vbe_fcm_tokens के सभी devices पर push भेजता है
   App बंद होने पर भी notification आती है।

   Auth: FIREBASE_SA env var (service account JSON) — GitHub
   repo secret से आता है। Repo में कभी commit मत करो!
   ══════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const APP_LINK = 'https://vbe-order-tracker-60324.web.app/call-tracker.html';
const REMIND_GAP_MS = 30 * 60 * 1000; // दोबारा remind का gap — 30 min

function initAdmin() {
  if (process.env.FIREBASE_SA) {
    const sa = JSON.parse(process.env.FIREBASE_SA);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error(
      'FIREBASE_SA secret नहीं मिला! GitHub repo → Settings → Secrets and variables → Actions → New repository secret → Name: FIREBASE_SA, Value: service account JSON'
    );
    process.exit(1);
  }
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const now = Date.now();

  // रात में disturb नहीं — सिर्फ़ सुबह 7 से रात 10 बजे तक (IST)
  const istHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );
  if (istHour < 7 || istHour >= 22) {
    console.log('quiet hours (IST hour=' + istHour + ') — skip');
    return;
  }

  const snap = await db.collection('vbe_call_tracker').get();
  const due = [];
  const dueTasks = []; // हर काम का अपना समय (topic.at) — schedule पेज से लगाया हुआ
  const batch = db.batch();
  let settingsData = null;

  snap.forEach((d) => {
    if (d.id === '_settings') { settingsData = d.data() || {}; return; }
    const c = d.data();
    if (c.active === false) return;
    let patch = null;

    // 1) मुख्य समय (nextCallAt)
    if (c.nextCallAt) {
      const t = new Date(c.nextCallAt).getTime();
      if (!isNaN(t) && t <= now) {
        // Dedupe — इसी due के लिए पिछले 30 min में remind किया हो तो skip
        const lastN = c.lastNotifiedAt ? new Date(c.lastNotifiedAt).getTime() : 0;
        if (!(lastN >= t && now - lastN < REMIND_GAP_MS)) {
          due.push({ name: c.name || '?', phone: c.phone || '' });
          patch = patch || {}; patch.lastNotifiedAt = new Date().toISOString();
        }
      }
    }

    // 2) हर काम का अपना समय (topics[].at)
    if (Array.isArray(c.topics)) {
      let changed = false;
      c.topics.forEach((x) => {
        if (!x || typeof x !== 'object' || x.done || !x.at) return;
        const tt = new Date(x.at).getTime();
        if (isNaN(tt) || tt > now) return;
        const lastN = x.notifAt ? new Date(x.notifAt).getTime() : 0;
        if (lastN >= tt && now - lastN < REMIND_GAP_MS) return;
        dueTasks.push({ task: x.t || 'काम', name: c.name || '' });
        x.notifAt = new Date().toISOString();
        changed = true;
      });
      if (changed) { patch = patch || {}; patch.topics = c.topics; }
    }

    if (patch) batch.update(d.ref, patch);
  });

  // 🌅 सुबह का digest — रोज़ 7:30-8:00 IST के बीच एक बार, आज की पूरी list
  let digest = null;
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).forEach((x) => { parts[x.type] = x.value; });
  const istMin = Number(parts.hour) * 60 + Number(parts.minute);
  const todayKey = parts.year + '-' + parts.month + '-' + parts.day;
  const lastDigest = settingsData ? settingsData.lastDigestDate : null;
  if (istMin >= 450 && istMin < 510 && lastDigest !== todayKey) {
    const allDue = [];
    snap.forEach((d) => {
      if (d.id === '_settings') return;
      const c = d.data();
      if (c.active === false || !c.nextCallAt) return;
      if (new Date(c.nextCallAt).getTime() <= now) allDue.push(c.name || '?');
    });
    if (allDue.length) {
      digest = { count: allDue.length, names: allDue };
      batch.set(
        db.collection('vbe_call_tracker').doc('_settings'),
        { lastDigestDate: todayKey },
        { merge: true }
      );
    }
  }

  // 📤 भेजो-time ping — तय समय पर "message भेजो" push (default 9:00, 9:30, 11:00 IST)
  // समय बदलने हों तो _settings doc में sendTimes: ['09:00','13:30',...] रखो
  let sendPing = null;
  const SEND_TIMES = (settingsData && Array.isArray(settingsData.sendTimes) && settingsData.sendTimes.length)
    ? settingsData.sendTimes : ['09:00', '09:30', '11:00'];
  for (const t of SEND_TIMES) {
    const p = String(t).split(':');
    const tm = Number(p[0]) * 60 + Number(p[1] || 0);
    if (isNaN(tm)) continue;
    if (istMin >= tm && istMin < tm + 8) { // 8-min window (cron हर 5 min)
      const key = todayKey + '_' + t;
      if ((settingsData && settingsData.lastSendPing) !== key) {
        let ready = 0;
        snap.forEach((d) => {
          if (d.id === '_settings') return;
          const c = d.data();
          if (c.active === false) return;
          if (c.waMsg && c.waMsgAt) ready++;
        });
        if (ready) {
          sendPing = { key, ready, time: t };
          batch.set(
            db.collection('vbe_call_tracker').doc('_settings'),
            { lastSendPing: key },
            { merge: true }
          );
        }
      }
      break;
    }
  }

  if (!due.length && !dueTasks.length && !digest && !sendPing) {
    console.log('कोई call/काम due नहीं ✓');
    await batch.commit();
    return;
  }

  const msgs = [];
  if (sendPing) {
    msgs.push({
      title: `📤 ${sendPing.ready} लोगों के message तैयार हैं!`,
      body: `विक्रम भाई, बस tap करके भेजते जाओ — सबको आज के काम की याद चली जाएगी 🙏`,
      tag: 'vbe-sendtime',
      link: APP_LINK + '?action=send',
    });
  }
  if (digest) {
    msgs.push({
      title: `🌅 आज ${digest.count} calls करनी हैं`,
      body:
        digest.names.slice(0, 8).map((n) => `• ${n}`).join('\n') +
        (digest.count > 8 ? `\n…और ${digest.count - 8}` : ''),
      tag: 'vbe-digest',
    });
  }
  if (dueTasks.length) {
    msgs.push({
      title:
        dueTasks.length === 1
          ? `⏰ काम का समय: ${String(dueTasks[0].task).slice(0, 42)}`
          : `⏰ ${dueTasks.length} कामों का समय हो गया!`,
      body:
        dueTasks
          .slice(0, 6)
          .map((x) => `• ${x.task}${x.name && x.name !== x.task.slice(0, x.name.length) ? ' (' + x.name + ')' : ''}`)
          .join('\n') + (dueTasks.length > 6 ? `\n…और ${dueTasks.length - 6}` : ''),
      tag: 'vbe-task-due',
    });
  }
  if (due.length) {
    msgs.push({
      title:
        due.length === 1
          ? `📞 Call करो: ${due[0].name}`
          : `📞 ${due.length} calls बाकी हैं!`,
      body:
        due
          .slice(0, 6)
          .map((c) => `• ${c.name}${c.phone ? ' — ' + c.phone : ''}`)
          .join('\n') + (due.length > 6 ? `\n…और ${due.length - 6}` : ''),
      tag: 'vbe-call-due',
    });
  }

  // 📩 Telegram भी — token+chat _settings से (FCM हो या न हो, यह चले; मुफ़्त, भरोसेमंद)
  const tgTok = settingsData && settingsData.tgBotToken;
  let tgChat = settingsData && settingsData.tgChatId;
  let tgSent = 0;
  if (tgTok) {
    try {
      if (!tgChat) {
        const gu = await fetch('https://api.telegram.org/bot' + tgTok + '/getUpdates').then((r) => r.json());
        const ups = (gu.ok && gu.result || []).filter((u) => u.message && u.message.chat);
        if (ups.length) {
          tgChat = String(ups[ups.length - 1].message.chat.id);
          batch.set(db.collection('vbe_call_tracker').doc('_settings'), { tgChatId: tgChat }, { merge: true });
        }
      }
      if (tgChat) {
        // 📞⏰ rich digests — नाम+tap-call नंबर+काम+कितना लेट, pagination-बटन के साथ
        // ('…और 23' वाला मरा हुआ digest ख़त्म — PROMPT 8)
        const tgCore = require('../functions/telegram-core');
        const dataAll = tgCore.collectAll(snap); dataAll.settings = settingsData || {};
        for (const m of msgs) {
          let payload = null;
          if (m.tag === 'vbe-call-due') {
            const d0 = tgCore.callsDigest(dataAll, Date.now(), 0);
            payload = { chat_id: tgChat, text: d0.text, parse_mode: 'Markdown', disable_web_page_preview: true };
            if (d0.reply_markup) payload.reply_markup = d0.reply_markup;
          } else if (m.tag === 'vbe-task-due') {
            const d0 = tgCore.dueTasksDigest(dataAll, Date.now(), 0);
            payload = { chat_id: tgChat, text: d0.text, parse_mode: 'Markdown', disable_web_page_preview: true };
            if (d0.reply_markup) payload.reply_markup = d0.reply_markup;
          } else {
            const link = m.link || APP_LINK;
            payload = { chat_id: tgChat, text: '*' + m.title.replace(/[*_`\[]/g, '') + '*\n' + m.body + '\n\n👉 ' + link, parse_mode: 'Markdown', disable_web_page_preview: true };
          }
          const rs = await fetch('https://api.telegram.org/bot' + tgTok + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then((r) => r.json());
          if (rs.ok) tgSent++;
        }
      }
    } catch (e) { console.log('📩 Telegram error:', e.message); }
  }

  // 🔔 FCM push — devices registered हों तभी
  const tokSnap = await db.collection('vbe_fcm_tokens').get();
  const tokenDocs = [];
  tokSnap.forEach((d) => {
    const t = (d.data() || {}).token;
    if (t) tokenDocs.push({ id: d.id, token: t });
  });
  const tokens = [...new Set(tokenDocs.map((x) => x.token))];
  if (!tokens.length) {
    await batch.commit();
    console.log(`भेजा: FCM 0 device · Telegram ${tgSent} msg`);
    return;
  }

  let resp = null;
  for (const m of msgs) {
    const link = m.link || APP_LINK;
    resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: m.title, body: m.body },
      data: { link },
      webpush: {
        fcmOptions: { link },
        notification: {
          icon: '/ct-icon.svg',
          badge: '/ct-icon.svg',
          tag: m.tag,
          renotify: true,
          requireInteraction: true,
        },
        headers: { Urgency: 'high' },
      },
    });
  }

  // मरे हुए tokens साफ़ करो
  const dead = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        dead.push(tokens[i]);
      }
    }
  });
  for (const t of dead) {
    tokenDocs
      .filter((x) => x.token === t)
      .forEach((x) => batch.delete(db.collection('vbe_fcm_tokens').doc(x.id)));
  }

  await batch.commit();
  console.log(
    `भेजा: ${due.length} due, ${resp.successCount}/${tokens.length} devices ok, ${dead.length} dead tokens हटाए`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
