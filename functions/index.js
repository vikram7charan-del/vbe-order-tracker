/* ══════════════════════════════════════════════════════════
   VBE Call Tracker — Background Push Reminders
   ──────────────────────────────────────────────────────────
   हर 5 मिनट में चलता है (Cloud Scheduler):
   1. vbe_call_tracker में देखता है किसकी call due/late है
   2. vbe_fcm_tokens के सभी devices पर push notification भेजता है
   3. App बंद होने पर भी notification आती है (FCM)

   Dedupe: एक ही due-time के लिए हर 30 min में एक बार ही
   remind करता है (lastNotifiedAt field से)
   ══════════════════════════════════════════════════════════ */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

const APP_LINK = 'https://vbe-order-tracker-60324.web.app/call-tracker.html';
const REMIND_GAP_MS = 30 * 60 * 1000; // दोबारा याद दिलाने का gap — 30 min

exports.callReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    retryCount: 0,
    memory: '256MiB',
  },
  async () => {
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
    const batch = db.batch();

    snap.forEach((d) => {
      if (d.id === '_settings') return;
      const c = d.data();
      if (c.active === false) return;
      if (!c.nextCallAt) return;
      const t = new Date(c.nextCallAt).getTime();
      if (isNaN(t) || t > now) return; // अभी due नहीं

      // Dedupe — इसी due के लिए पिछले 30 min में remind किया हो तो skip
      const lastN = c.lastNotifiedAt ? new Date(c.lastNotifiedAt).getTime() : 0;
      if (lastN >= t && now - lastN < REMIND_GAP_MS) return;

      due.push({ name: c.name || '?', phone: c.phone || '' });
      batch.update(d.ref, { lastNotifiedAt: new Date().toISOString() });
    });

    if (!due.length) {
      console.log('कोई call due नहीं');
      return;
    }

    // सारे registered devices के tokens
    const tokSnap = await db.collection('vbe_fcm_tokens').get();
    const tokenDocs = [];
    tokSnap.forEach((d) => {
      const t = (d.data() || {}).token;
      if (t) tokenDocs.push({ id: d.id, token: t });
    });
    const tokens = [...new Set(tokenDocs.map((x) => x.token))];

    if (!tokens.length) {
      console.log('कोई FCM token नहीं — app में notification allow करो');
      await batch.commit();
      return;
    }

    const title =
      due.length === 1
        ? `📞 Call करो: ${due[0].name}`
        : `📞 ${due.length} calls बाकी हैं!`;
    const body = due
      .slice(0, 6)
      .map((c) => `• ${c.name}${c.phone ? ' — ' + c.phone : ''}`)
      .join('\n') + (due.length > 6 ? `\n…और ${due.length - 6}` : '');

    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { link: APP_LINK },
      webpush: {
        fcmOptions: { link: APP_LINK },
        notification: {
          icon: '/ct-icon.svg',
          badge: '/ct-icon.svg',
          tag: 'vbe-call-due',
          renotify: true,
          requireInteraction: true,
        },
        headers: { Urgency: 'high' },
      },
    });

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
        .forEach((x) =>
          batch.delete(db.collection('vbe_fcm_tokens').doc(x.id))
        );
    }

    await batch.commit();
    console.log(
      `भेजा: ${due.length} due, ${resp.successCount}/${tokens.length} devices ok, ${dead.length} dead tokens हटाए`
    );
  }
);
