/* ══════════════════════════════════════════════════════════
   VBE Call Tracker — AI WhatsApp Message Generator
   ──────────────────────────────────────────────────────────
   GitHub Actions पर हर 30 मिनट चलता है:
   1. जिन contacts के बाकी काम हैं (खुद के या सौंपे हुए),
      उनके लिए Claude से एक natural WhatsApp reminder बनवाता है
   2. हर बार अलग भाषा/शब्दों में (ताकि copy-paste न लगे)
   3. message को उसी contact doc में waMsg + waMsgAt में save करता है
   App में "📲 WhatsApp" button यही तैयार message इस्तेमाल करता है।

   Secrets: FIREBASE_SA + ANTHROPIC_KEY (GitHub repo secrets)
   ══════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const https = require('https');

const AI_KEY = process.env.ANTHROPIC_KEY || '';
const MODEL = 'claude-haiku-4-5-20251001';
const REFRESH_MS = 25 * 60 * 1000; // 25 min से पुराना message ही दोबारा बनाओ
const MAX_PER_RUN = 40;            // एक बार में इतने ही (cost/time सीमा)

const TASK_CATS = {
  golden: '🏆', computer: '💻', market: '🛒', jalipa: '🏪',
};

function initAdmin() {
  if (process.env.FIREBASE_SA) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error('FIREBASE_SA missing'); process.exit(1);
  }
}

function normTopics(c) {
  if (Array.isArray(c.topics) && c.topics.length)
    return c.topics.map((x) => (typeof x === 'string' ? { t: x, done: false } : x));
  return c.note ? [{ t: c.note, done: false }] : [];
}

/* Claude API call — एक message लौटाता है */
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': AI_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.content && j.content[0] && j.content[0].text) resolve(j.content[0].text.trim());
            else reject(new Error(j.error ? j.error.message : 'no text'));
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const TONES = [
  'बहुत विनम्र और आदरपूर्ण',
  'आत्मीय और अपनापन भरा',
  'गर्मजोशी और सम्मान भरा',
  'शालीन Hinglish (हिंदी + थोड़ी English)',
  'प्रोत्साहन और प्रशंसा भरा',
  'शुद्ध हिंदी, बहुत शिष्ट',
];

function buildPrompt(name, tasks) {
  const tone = TONES[Math.floor(Math.random() * TONES.length)];
  const taskLines = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return `तुम "Vande Bharat Enterprises" के मालिक विक्रम जी की ओर से एक WhatsApp reminder message लिख रहे हो।

व्यक्ति का नाम: ${name}
इनको याद दिलाने वाले काम (हूबहू, इन्हीं शब्दों में):
${taskLines}

बहुत ज़रूरी नियम:
- हर काम को **ठीक वैसे ही, पूरा का पूरा** लिखो जैसे ऊपर दिया है — एक भी शब्द छोटा मत करो, मतलब मत बदलो, अपने से काट-छाँट मत करो
- ज़रूरत हो तो काम को थोड़ा और साफ़/स्पष्ट कर सकते हो, पर मूल बात और शब्द वैसे ही रहें
- हर काम अलग point (1. 2. 3. ...) में, क्रम वही रखो
- पूरे message में **हमेशा इज्जतदार, सम्मानजनक भाषा** — सामने वाले को खास और महत्वपूर्ण महसूस हो, जैसे उनकी बहुत कद्र है
- नाम के साथ आदरपूर्ण अभिवादन (राम राम / नमस्ते / जय श्री कृष्ण — हर बार अलग)
- शुरुआत में एक छोटी सी आदर/स्नेह वाली पंक्ति, फिर काम, फिर अंत में विनम्र धन्यवाद और "विक्रम — Vande Bharat Enterprises"
- इस बार का अंदाज़: ${tone}
- message छोटा करने की कोई ज़रूरत नहीं — काम पूरे और अच्छे से लिखो; थोड़े emoji ठीक हैं
- सिर्फ़ message लिखो, कोई explanation/heading/quotes नहीं`;
}

async function main() {
  if (!AI_KEY) { console.error('ANTHROPIC_KEY missing — skip'); return; }
  initAdmin();
  const db = admin.firestore();
  const now = Date.now();

  const snap = await db.collection('vbe_call_tracker').get();
  const all = [];
  let settings = {};
  snap.forEach((d) => {
    if (d.id === '_settings') { settings = d.data() || {}; return; }
    all.push({ id: d.id, ref: d.ref, data: d.data() });
  });

  // 💰 खर्च बचाने के लिए: सबके लिए auto-generate DEFAULT बंद।
  // सिर्फ़ जिसको भेजना है उसी के लिए app में "✨ नया message" (n8n) से बनेगा।
  // पूरे-सबके auto messages चाहिए तो _settings doc में autoGenAll: true रखो।
  if (settings.autoGenAll !== true) {
    console.log('autoGenAll off — mass generation skip (on-demand only)');
    return;
  }

  // हर contact के लिए: खुद के active काम + जो इन्हें सौंपे गए
  function tasksFor(id) {
    const out = [];
    const me = all.find((x) => x.id === id);
    if (me) normTopics(me.data).forEach((t) => { if (!t.done) out.push((t.cat && TASK_CATS[t.cat] ? TASK_CATS[t.cat] + ' ' : '') + t.t); });
    all.forEach((c) => {
      if (c.id === id) return;
      normTopics(c.data).forEach((t) => {
        if (!t.done && t.assignTo === id) out.push((t.cat && TASK_CATS[t.cat] ? TASK_CATS[t.cat] + ' ' : '') + t.t + ' (' + (c.data.name || '') + ')');
      });
    });
    return out;
  }

  let done = 0;
  for (const c of all) {
    if (done >= MAX_PER_RUN) break;
    if (c.data.active === false) continue;
    const tasks = tasksFor(c.id);
    if (!tasks.length) continue;
    // हाल ही में बना है तो छोड़ो
    const lastAt = c.data.waMsgAt ? new Date(c.data.waMsgAt).getTime() : 0;
    if (now - lastAt < REFRESH_MS) continue;
    try {
      const msg = await askClaude(buildPrompt(c.data.name || 'जी', tasks));
      await c.ref.update({ waMsg: msg, waMsgAt: new Date().toISOString() });
      done++;
      console.log('✓', c.data.name);
    } catch (e) {
      console.error('✗', c.data.name, '-', e.message);
    }
  }
  console.log(`बने: ${done} messages`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
