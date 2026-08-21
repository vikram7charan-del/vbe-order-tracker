#!/usr/bin/env node
/* ============================================================
   pustak-banao.js — nayi-pustak/pustak.md  →  ग्रंथ पुस्तकालय

   चलाइए:
     node scripts/pustak-banao.js
     node scripts/pustak-banao.js nayi-pustak/pustak-2.md

   यह क्या करता है
     1. आपकी हिंदी वाली .md फ़ाइल पढ़ता है
     2. data/<पहचान>.js बना देता है
     3. data/registry.js में पुस्तक की पंक्ति जोड़/सुधार देता है
     4. गिनती और गड़बड़ियाँ हिंदी में बता देता है

   granth.html को यह कभी नहीं छूता।
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = process.argv[2] || 'nayi-pustak/pustak.md';
const SRC_ABS = path.resolve(ROOT, SRC);

const say  = (...a) => console.log(...a);
const die  = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };
const warn = [];

if (!fs.existsSync(SRC_ABS)) die('फ़ाइल नहीं मिली — ' + SRC);

const raw = fs.readFileSync(SRC_ABS, 'utf8').replace(/\r\n/g, '\n');

/* ---------- टिप्पणियाँ (<!-- … -->) हटा दें ---------- */
const body0 = raw.replace(/<!--[\s\S]*?-->/g, '');

/* ---------- ऊपर का परिचय-खाना ---------- */
const fm = {};
let body = body0;
const m = body0.match(/^\s*---\n([\s\S]*?)\n---\n?/);
if (m) {
  m[1].split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i < 0) return;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  body = body0.slice(m[0].length);
} else {
  die('ऊपर का परिचय-खाना नहीं मिला।\n    फ़ाइल की शुरुआत में --- वाली पाँच पंक्तियाँ ज़रूरी हैं (नमूना pustak.md में है)।');
}

const need = (k) => {
  const v = (fm[k] || '').trim();
  if (!v) die('परिचय-खाने में "' + k + '" खाली है — उसे भर दीजिए।');
  return v;
};

const id = need('पहचान');
if (!/^[a-z][a-z0-9-]*$/.test(id))
  die('"पहचान" सिर्फ़ अंग्रेज़ी के छोटे अक्षरों में हो (जैसे nayi, sagat, veervinod)। अभी लिखा है — ' + id);
if (/यहाँ|नाम लिखिए/.test(fm['पुस्तक'] || ''))
  die('"पुस्तक" में अभी नमूने वाला पाठ ही पड़ा है — उसकी जगह असली नाम लिख दीजिए।');

const title = need('पुस्तक');
const unit  = need('इकाई');
const kavi  = (fm['कवि'] || '').trim();
const rang  = (fm['रंग'] || '#7FB3D5').trim();
if (!/^#[0-9a-fA-F]{6}$/.test(rang)) die('"रंग" ऐसा होना चाहिए — #7FB3D5 (हैश और छह अक्षर)। अभी है — ' + rang);

/* ---------- रंग से बाक़ी दो रंग बना लें ---------- */
const hex2 = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const rgb2 = (a) => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const base = hex2(rang);
const glow = rgb2(base.map(x => x * 0.78));                       /* थोड़ा गहरा — आभा */
const bg   = rgb2(base.map(x => 8 + x * 0.055));                  /* रात का पृष्ठ */

/* ---------- पाठ पढ़ें ---------- */
const lines = body.split('\n');
const sections = [];
let sec = null, verse = null, field = null;
const nSeen = new Map();

const flushVerse = () => {
  if (!verse) return;
  verse.lines = verse.lines.map(s => s.trim()).filter(Boolean);
  verse.artha = (verse.artha || '').replace(/\s*\n\s*/g, ' ').trim();
  if (!verse.lines.length) warn.push(unit + ' ' + verse.n + ' — मूल पंक्तियाँ नहीं मिलीं, छोड़ दिया');
  else sec.verses.push(verse);
  verse = null; field = null;
};
const newSection = (t, subtitle) => {
  flushVerse();
  sec = { id: 'bhaag' + (sections.length + 1), title: t, subtitle: subtitle || '', verses: [] };
  sections.push(sec);
};

for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  const t = L.trim();

  let mm;
  if ((mm = t.match(/^##\s*भाग\s*[:：]\s*(.+)$/))) { newSection(mm[1].trim(), ''); continue; }
  if ((mm = t.match(/^उपशीर्षक\s*[:：]\s*(.+)$/)) && sec && !sec.verses.length) { sec.subtitle = mm[1].trim(); continue; }
  if ((mm = t.match(/^भाग-पहचान\s*[:：]\s*(.+)$/)) && sec) { sec.id = mm[1].trim(); continue; }

  if ((mm = t.match(/^###\s*(\d+)\s*$/))) {
    flushVerse();
    if (!sec) newSection(title, '');
    const n = parseInt(mm[1], 10);
    const key = sec.id + ':' + n;
    if (nSeen.has(key)) warn.push(unit + ' ' + n + ' दो बार आया है (' + sec.title + ') — बाद वाला ही रहेगा');
    nSeen.set(key, true);
    verse = { n: n, lines: [], artha: '', shabdarth: null, tippani: null };
    field = 'lines';
    continue;
  }

  if (!verse) continue;

  if ((mm = t.match(/^अर्थ\s*[:：]\s*([\s\S]*)$/)))      { verse.artha = mm[1]; field = 'artha'; continue; }
  if ((mm = t.match(/^शब्दार्थ\s*[:：]\s*(.+)$/)))       {
    verse.shabdarth = mm[1].split(/[;।]/).map(s => s.trim()).filter(Boolean).map(pair => {
      const p = pair.split(/\s*=\s*/);
      return { shabd: (p[0] || '').trim(), arth: (p[1] || '').trim() };
    }).filter(x => x.shabd && x.arth);
    if (!verse.shabdarth.length) verse.shabdarth = null;
    field = null; continue;
  }
  if ((mm = t.match(/^टिप्पणी\s*[:：]\s*(.+)$/)))        { verse.tippani = mm[1].trim(); field = null; continue; }

  if (!t) { if (field === 'lines') field = null; continue; }
  if (field === 'lines') verse.lines.push(t);
  else if (field === 'artha') verse.artha += ' ' + t;
}
flushVerse();

if (!sections.length || !sections.some(s => s.verses.length))
  die('एक भी ' + unit + ' नहीं मिला।\n    हर ' + unit + ' ऐसे शुरू होना चाहिए —  ### 1  (तीन हैश, जगह, अंक)');

/* ---------- नमूने वाला पाठ रह गया? ---------- */
const sample = sections.some(s => s.verses.some(v => /यहाँ लिखिए|नमूने/.test(v.lines.join(' '))));
if (sample) warn.push('नमूने वाली पंक्तियाँ अब भी पड़ी हैं — उन्हें मिटाना न भूलिएगा');

const total = sections.reduce((a, s) => a + s.verses.length, 0);
const noArth = sections.reduce((a, s) => a + s.verses.filter(v => !v.artha).length, 0);

/* ---------- data/<id>.js लिखें ---------- */
const q = (s) => JSON.stringify(String(s));
const out = [];
out.push('/* ============================================================');
out.push('   ' + title + (kavi ? ' — ' + kavi : ''));
out.push('   ------------------------------------------------------------');
out.push('   ⚠ यह फ़ाइल अपने आप बनी है — इसे हाथ से मत बदलिए।');
out.push('     बदलाव ' + SRC + ' में कीजिए, फिर चलाइए:');
out.push('       node scripts/pustak-banao.js ' + SRC);
out.push('');
out.push('   वर्तनी अक्षरशः यथावत् — ळ / द्वित्व / अनुस्वार / हलंत में कोई सुधार नहीं।');
out.push('   बना: ' + new Date().toISOString().slice(0, 10) + ' · कुल ' + total + ' ' + unit);
out.push('   ============================================================ */');
out.push('');
out.push('window.GRANTH_DATA = window.GRANTH_DATA || {};');
out.push('');
out.push('window.GRANTH_DATA[' + q(id) + '] = {');
out.push('  id: ' + q(id) + ',');
out.push('  title: ' + q(title) + ',');
if (fm['आमुख'])  out.push('  invocation: ' + q(fm['आमुख']) + ',');
if (fm['परिचय']) out.push('  subtitle: ' + q(fm['परिचय']) + ',');
if (kavi)        out.push('  author: ' + q(kavi) + ',');
out.push('  unitLabel: ' + q(unit) + ',');
out.push('  count: ' + total + ',');
out.push('  hasPaathVariants: false,');
if (fm['समापन']) out.push('  closing: { line1: ' + q(fm['समापन']) + ' },');
out.push('  theme: { accent: ' + q(rang) + ', glow: ' + q(glow) + ', bg: ' + q(bg) + ' },');
out.push('');
out.push('  sections: [');
sections.filter(s => s.verses.length).forEach((s, si, arr) => {
  out.push('    {');
  out.push('      id: ' + q(s.id) + ',');
  out.push('      title: ' + q(s.title) + ',');
  out.push('      subtitle: ' + q(s.subtitle) + ',');
  out.push('      verses: [');
  s.verses.forEach((v, vi) => {
    const parts = [];
    parts.push('n: ' + v.n);
    parts.push('lines: [' + v.lines.map(q).join(', ') + ']');
    parts.push('artha: ' + q(v.artha));
    parts.push('shabdarth: ' + (v.shabdarth ? '[' + v.shabdarth.map(x => '{ shabd: ' + q(x.shabd) + ', arth: ' + q(x.arth) + ' }').join(', ') + ']' : 'null'));
    if (v.tippani) parts.push('tippani: ' + q(v.tippani));
    out.push('        { ' + parts.join(',\n          ') + ' }' + (vi < s.verses.length - 1 ? ',' : ''));
  });
  out.push('      ]');
  out.push('    }' + (si < arr.length - 1 ? ',' : ''));
});
out.push('  ]');
out.push('};');
out.push('');

const dataRel = 'data/' + id + '.js';
fs.writeFileSync(path.join(ROOT, dataRel), out.join('\n'), 'utf8');

/* बनी हुई फ़ाइल सचमुच चलती है? */
try { new Function('window', out.join('\n'))({}); }
catch (e) { die('बनी हुई फ़ाइल में गड़बड़ी रह गई — ' + e.message + '\n    मुझे बता दीजिए, ठीक कर देंगे।'); }

/* ---------- registry.js में पंक्ति ---------- */
const regPath = path.join(ROOT, 'data/registry.js');
let reg = fs.readFileSync(regPath, 'utf8');
const already = new RegExp('\\n\\s*\\{[^{}]*id:\\s*"' + id + '"[\\s\\S]*?\\n\\s*\\}(,?)', 'm');
const orders = [...reg.matchAll(/order:\s*(\d+)/g)].map(x => +x[1]);
const entry =
  '  {\n' +
  '    id: "' + id + '",\n' +
  '    title: ' + q(title) + ',\n' +
  '    files: ["' + dataRel + '"],\n' +
  '    count: ' + total + ',\n' +
  '    unitLabel: ' + q(unit) + ',\n' +
  '    order: %ORDER%,\n' +
  '    theme: { accent: "' + rang + '", glow: "' + glow + '", bg: "' + bg + '" }\n' +
  '  }';

let mode;
if (already.test(reg)) {
  const old = reg.match(already)[0];
  const ord = (old.match(/order:\s*(\d+)/) || [, String(Math.max(0, ...orders) + 1)])[1];
  reg = reg.replace(already, '\n' + entry.replace('%ORDER%', ord) + (reg.match(already)[1] || ''));
  mode = 'सुधार दी';
} else {
  const ord = Math.max(0, ...orders) + 1;
  const i = reg.lastIndexOf(']');
  reg = reg.slice(0, i).replace(/\s*$/, '') + ',\n' + entry.replace('%ORDER%', ord) + '\n' + reg.slice(i);
  mode = 'जोड़ दी';
}
try { new Function('window', reg)({}); }
catch (e) { die('registry.js बिगड़ गई होती — कुछ नहीं बदला। कारण: ' + e.message); }
fs.writeFileSync(regPath, reg, 'utf8');

/* ---------- रिपोर्ट ---------- */
say('');
say('  ✓ ' + title + ' तैयार है');
say('  ─────────────────────────────────────────────');
say('  पहचान      : ' + id);
say('  कुल         : ' + total + ' ' + unit + '  ·  भाग ' + sections.filter(s => s.verses.length).length);
sections.filter(s => s.verses.length).forEach(s => say('                · ' + s.title + ' — ' + s.verses.length));
say('  अर्थ शेष    : ' + noArth + (noArth ? '   (इन पर ऐप "अर्थ शेष" लिख देगा)' : ''));
say('  रंग         : ' + rang + '  →  आभा ' + glow + '  ·  रात ' + bg);
say('  फ़ाइल       : ' + dataRel);
say('  रजिस्ट्री    : पंक्ति ' + mode);
say('  लिंक        : granth.html#' + id + '        (किसी ' + unit + ' तक — #' + id + '/12)');
if (warn.length) { say(''); warn.forEach(w => say('  ⚠ ' + w)); }
say('');
