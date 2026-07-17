/* ══════════════════════════════════════════════════════════
   📩 VBE Telegram Bot — thin POLLER (सिर्फ़ fallback / manual)
   ──────────────────────────────────────────────────────────
   असल में अब webhook चलता है (functions/telegramWebhook — हमेशा जागता)।
   webhook set हो तो getUpdates 409 देता है → यह चुपचाप निकल जाता है।
   सारा दिमाग़ साझा है: functions/telegram-core.js (webhook भी वही वापरता है)।
   Secret: FIREBASE_SA
   ══════════════════════════════════════════════════════════ */
const tg = require('../functions/telegram-core');
const LOOP_MS = Number(process.env.TG_LOOP_MS || 210000);

function tgApi(tok, method, body) {
  return fetch(`https://api.telegram.org/bot${tok}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }).then((r) => r.json());
}

async function main() {
  if (!process.env.FIREBASE_SA) { console.error('FIREBASE_SA missing'); process.exit(1); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db = admin.firestore();
  const col = db.collection('vbe_call_tracker');

  let snap = await col.get();
  let data = tg.collectAll(snap);
  const tok = data.settings.tgBotToken;
  if (!tok) { console.log('tgBotToken नहीं — app में 📩 से token डालें'); return; }
  let ownerChat = data.settings.tgChatId ? String(data.settings.tgChatId) : '';
  let offset = Number(data.settings.tgOffset || 0);

  // ⚡ नए काम auto-push (शुरू में + हर ~3 min loop के अंदर)
  try { const pc = await tg.autoPushNew(col, data, ownerChat); for (const c of pc) await tgApi(tok, c.method, c.body); } catch (e) {}

  const t0 = Date.now(); let handled = 0, dirty = false, lastPush = Date.now();
  console.log('📩 poller — loop', Math.round(LOOP_MS / 1000) + 's');
  while (Date.now() - t0 < LOOP_MS) {
    // हर ~3 min: नए काम की जाँच (लंबे run में भी auto-push ताज़ा रहे)
    if (Date.now() - lastPush > 180000) {
      lastPush = Date.now();
      try {
        const s = tg.collectAll(await col.get());
        const pc = await tg.autoPushNew(col, s, ownerChat);
        for (const c of pc) await tgApi(tok, c.method, c.body);
      } catch (e) {}
    }
    let j;
    try { j = await tgApi(tok, 'getUpdates', { offset: offset || undefined, timeout: 40, allowed_updates: ['message', 'edited_message', 'callback_query'] }); }
    catch (e) { await new Promise((r) => setTimeout(r, 4000)); continue; }
    if (!j.ok) {
      if (j.error_code === 409) { console.log('409 — webhook चालू है, poller की ज़रूरत नहीं'); return; }
      await new Promise((r) => setTimeout(r, 5000)); continue;
    }
    const ups = j.result || [];
    if (!ups.length) continue;
    offset = ups[ups.length - 1].update_id + 1;
    await col.doc('_settings').set({ tgOffset: offset }, { merge: true });
    if (dirty) { snap = await col.get(); const s2 = tg.collectAll(snap); s2.settings = data.settings; data = s2; dirty = false; }
    for (const u of ups) {
      try {
        const r = await tg.handleUpdate(col, data, u, ownerChat);
        ownerChat = r.ownerChat; if (r.dirty) dirty = true;
        for (const c of r.calls) await tgApi(tok, c.method, c.body);
        handled++;
      } catch (e) { console.log('handle err:', e.message); }
    }
  }
  console.log('✅ poller done —', handled, 'जवाब');
}

if (require.main === module && !process.env.TG_TEST) {
  main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
