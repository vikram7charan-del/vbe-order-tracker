#!/usr/bin/env node
/* ============================================================
   adhyayan-banao.js — nayi-pustak/adhyayan.md  →  अध्ययन-पुस्तकालय

   चलाइए:
     node scripts/adhyayan-banao.js
     node scripts/adhyayan-banao.js nayi-pustak/adhyayan-2.md

   यह क्या करता है
     1. आपकी हिंदी वाली .md फ़ाइल पढ़ता है
     2. data/adhyayan-<पहचान>.js बना देता है
     3. data/adhyayan-registry.js में पुस्तक की पंक्ति जोड़/सुधार देता है

   ★ हर अनुच्छेद की एक पक्की पहचान (pid) बनती है — उसी के सहारे आपके
     निशान और नोट बचे रहते हैं। इसलिए किताब दोबारा चढ़ाने पर भी जिन
     अनुच्छेदों का पाठ नहीं बदला, उनके निशान वैसे ही रहते हैं।

   adhyayan.html और granth.html — दोनों को यह कभी नहीं छूता।
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = process.argv[2] || 'nayi-pustak/adhyayan.md';
const SRC_ABS = path.resolve(ROOT, SRC);

const say  = (...a) => console.log(...a);
const die  = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };
const warn = [];

if (!fs.existsSync(SRC_ABS)) die('फ़ाइल नहीं मिली — ' + SRC);

const raw = fs.readFileSync(SRC_ABS, 'utf8').replace(/\r\n/g, '\n');
const body0 = raw.replace(/<!--[\s\S]*?-->/g, '');

/* ---------- ऊपर का परिचय-खाना ---------- */
const fm = {};
let body = body0;
const m = body0.match(/^\s*---\n([\s\S]*?)\n---\n?/);
if (!m) die('ऊपर का परिचय-खाना नहीं मिला।\n    फ़ाइल की शुरुआत में --- वाली पंक्तियाँ ज़रूरी हैं (नमूना adhyayan.md में है)।');
m[1].split('\n').forEach(line => {
  const i = line.indexOf(':');
  if (i < 0) return;
  fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
});
body = body0.slice(m[0].length);

const need = (k) => {
  const v = (fm[k] || '').trim();
  if (!v) die('परिचय-खाने में "' + k + '" खाली है — उसे भर दीजिए।');
  return v;
};

const id = need('पहचान');
if (!/^[a-z][a-z0-9-]*$/.test(id))
  die('"पहचान" सिर्फ़ अंग्रेज़ी के छोटे अक्षरों में हो (जैसे compound, atomic, ikigai)। अभी लिखा है — ' + id);
if (/यहाँ|नाम लिखिए/.test(fm['पुस्तक'] || ''))
  die('"पुस्तक" में अभी नमूने वाला पाठ ही पड़ा है — उसकी जगह असली नाम लिख दीजिए।');

const title = need('पुस्तक');
const lekhak = (fm['लेखक'] || '').trim();
const rang = (fm['रंग'] || '#2E86AB').trim();
if (!/^#[0-9a-fA-F]{6}$/.test(rang)) die('"रंग" ऐसा होना चाहिए — #2E86AB (हैश और छह अक्षर)। अभी है — ' + rang);

const hex2 = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const rgb2 = (a) => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const base = hex2(rang);
const glow = rgb2(base.map(x => x * 0.78));
const bg   = rgb2(base.map(x => 8 + x * 0.055));

/* ---------- अनुच्छेद की पक्की पहचान ---------- */
function pid(text) {
  let h = 0x811c9dc5;
  const s = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36);
}

/* ---------- पाठ पढ़ें ---------- */
const lines = body.split('\n');
const chapters = [];
let ch = null, buf = [], page = null, kind = null;

const flushPara = () => {
  const t = buf.join(' ').replace(/\s+/g, ' ').trim();
  buf = [];
  if (!t) { kind = null; return; }
  if (!ch) newChapter(title);
  const p = { pid: pid(t), t: t };
  if (page != null) p.page = page;
  if (kind) p.k = kind;
  ch.paras.push(p);
  kind = null;
};
const newChapter = (t) => {
  flushPara();
  ch = { id: 'ch' + (chapters.length + 1), title: t, paras: [] };
  chapters.push(ch);
};

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  let mm;

  if ((mm = t.match(/^##\s*(?:अध्याय|भाग|खंड)\s*[:：]?\s*(.+)$/))) { newChapter(mm[1].trim()); continue; }
  if ((mm = t.match(/^###\s+(.+)$/)))       { flushPara(); buf = [mm[1].trim()]; kind = 'h'; flushPara(); continue; }
  if ((mm = t.match(/^\[\s*(\d+)\s*\]$/)))  { flushPara(); page = parseInt(mm[1], 10); continue; }
  if ((mm = t.match(/^>\s?(.*)$/)))         { if (kind !== 'q') flushPara(); kind = 'q'; if (mm[1].trim()) buf.push(mm[1].trim()); continue; }

  if (!t) { flushPara(); continue; }
  if (kind === 'q') { flushPara(); }
  buf.push(t);
}
flushPara();

const live = chapters.filter(c => c.paras.length);
if (!live.length) die('एक भी अनुच्छेद नहीं मिला।\n    पाठ को खाली पंक्ति से अलग-अलग अनुच्छेदों में रखिए।');

/* ---------- दोहरे अनुच्छेद? ---------- */
const seen = new Map();
live.forEach(c => c.paras.forEach(p => {
  if (seen.has(p.pid)) warn.push('दो अनुच्छेद बिलकुल एक जैसे हैं — निशान दोनों पर एक साथ लगेंगे: "' + p.t.slice(0, 40) + '…"');
  seen.set(p.pid, true);
}));

const totalP = live.reduce((a, c) => a + c.paras.length, 0);
const words = live.reduce((a, c) => a + c.paras.reduce((b, p) => b + p.t.split(/\s+/).length, 0), 0);
const pages = live.flatMap(c => c.paras.map(p => p.page)).filter(x => x != null);
const mins = Math.max(1, Math.round(words / 180));

/* ---------- data/adhyayan-<id>.js ---------- */
const q = (s) => JSON.stringify(String(s));
const out = [];
out.push('/* ============================================================');
out.push('   ' + title + (lekhak ? ' — ' + lekhak : '') + '   [अध्ययन-पुस्तक]');
out.push('   ------------------------------------------------------------');
out.push('   ⚠ यह फ़ाइल अपने आप बनी है — इसे हाथ से मत बदलिए।');
out.push('     बदलाव ' + SRC + ' में कीजिए, फिर चलाइए:');
out.push('       node scripts/adhyayan-banao.js ' + SRC);
out.push('');
out.push('   pid = हर अनुच्छेद की पक्की पहचान। आपके निशान और नोट इसी से');
out.push('   जुड़े रहते हैं — जिस अनुच्छेद का पाठ नहीं बदला, उसके निशान');
out.push('   किताब दोबारा चढ़ाने पर भी बचे रहेंगे।');
out.push('');
out.push('   बना: ' + new Date().toISOString().slice(0, 10) +
         ' · अध्याय ' + live.length + ' · अनुच्छेद ' + totalP + ' · लगभग ' + words + ' शब्द');
out.push('   ============================================================ */');
out.push('');
out.push('window.ADHYAYAN_DATA = window.ADHYAYAN_DATA || {};');
out.push('');
out.push('window.ADHYAYAN_DATA[' + q(id) + '] = {');
out.push('  id: ' + q(id) + ',');
out.push('  title: ' + q(title) + ',');
if (lekhak)          out.push('  author: ' + q(lekhak) + ',');
if (fm['अनुवाद'])    out.push('  translator: ' + q(fm['अनुवाद']) + ',');
if (fm['विषय'])      out.push('  subject: ' + q(fm['विषय']) + ',');
if (fm['परिचय'])     out.push('  subtitle: ' + q(fm['परिचय']) + ',');
out.push('  paraCount: ' + totalP + ',');
out.push('  words: ' + words + ',');
out.push('  readMins: ' + mins + ',');
if (pages.length) out.push('  pageFrom: ' + Math.min(...pages) + ', pageTo: ' + Math.max(...pages) + ',');
out.push('  theme: { accent: ' + q(rang) + ', glow: ' + q(glow) + ', bg: ' + q(bg) + ' },');
out.push('');
out.push('  chapters: [');
live.forEach((c, ci) => {
  out.push('    {');
  out.push('      id: ' + q(c.id) + ',');
  out.push('      title: ' + q(c.title) + ',');
  out.push('      paras: [');
  c.paras.forEach((p, pi) => {
    const bits = ['pid: ' + q(p.pid)];
    if (p.page != null) bits.push('page: ' + p.page);
    if (p.k) bits.push('k: ' + q(p.k));
    bits.push('t: ' + q(p.t));
    out.push('        { ' + bits.join(', ') + ' }' + (pi < c.paras.length - 1 ? ',' : ''));
  });
  out.push('      ]');
  out.push('    }' + (ci < live.length - 1 ? ',' : ''));
});
out.push('  ]');
out.push('};');
out.push('');

const dataRel = 'data/adhyayan-' + id + '.js';
fs.writeFileSync(path.join(ROOT, dataRel), out.join('\n'), 'utf8');
try { new Function('window', out.join('\n'))({}); }
catch (e) { die('बनी हुई फ़ाइल में गड़बड़ी रह गई — ' + e.message); }

/* ---------- registry ---------- */
const regPath = path.join(ROOT, 'data/adhyayan-registry.js');
if (!fs.existsSync(regPath)) fs.writeFileSync(regPath,
  '/* अध्ययन-पुस्तकालय — रजिस्ट्री (अपने आप बनती है) */\nwindow.ADHYAYAN_REGISTRY = [\n];\n', 'utf8');
let reg = fs.readFileSync(regPath, 'utf8');
const already = new RegExp('\\n\\s*\\{[^{}]*id:\\s*"' + id + '"[\\s\\S]*?\\n\\s*\\}(,?)', 'm');
const orders = [...reg.matchAll(/order:\s*(\d+)/g)].map(x => +x[1]);
const mk = (ord) =>
  '  {\n' +
  '    id: "' + id + '",\n' +
  '    title: ' + q(title) + ',\n' +
  (lekhak ? '    author: ' + q(lekhak) + ',\n' : '') +
  '    file: "' + dataRel + '",\n' +
  '    paraCount: ' + totalP + ',\n' +
  '    readMins: ' + mins + ',\n' +
  '    order: ' + ord + ',\n' +
  '    theme: { accent: "' + rang + '", glow: "' + glow + '", bg: "' + bg + '" }\n' +
  '  }';

let mode;
if (already.test(reg)) {
  const old = reg.match(already);
  const ord = (old[0].match(/order:\s*(\d+)/) || [, String(Math.max(0, ...orders) + 1)])[1];
  reg = reg.replace(already, '\n' + mk(ord) + (old[1] || ''));
  mode = 'सुधार दी';
} else {
  const i = reg.lastIndexOf(']');
  const head = reg.slice(0, i).replace(/\s*$/, '');
  reg = head + (/\}$/.test(head) ? ',\n' : '\n') + mk(Math.max(0, ...orders) + 1) + '\n' + reg.slice(i);
  mode = 'जोड़ दी';
}
try { new Function('window', reg)({}); }
catch (e) { die('adhyayan-registry.js बिगड़ गई होती — कुछ नहीं बदला। कारण: ' + e.message); }
fs.writeFileSync(regPath, reg, 'utf8');

/* ---------- रिपोर्ट ---------- */
say('');
say('  ✓ ' + title + ' तैयार है   [अध्ययन-पुस्तक]');
say('  ─────────────────────────────────────────────');
say('  पहचान      : ' + id);
say('  अध्याय      : ' + live.length);
live.forEach(c => say('                · ' + c.title + ' — ' + c.paras.length + ' अनुच्छेद'));
say('  शब्द        : लगभग ' + words + '   ·   पढ़ने में ~' + mins + ' मिनट');
if (pages.length) say('  पृष्ठ        : ' + Math.min(...pages) + '–' + Math.max(...pages));
say('  रंग         : ' + rang + '  →  आभा ' + glow + '  ·  रात ' + bg);
say('  फ़ाइल       : ' + dataRel);
say('  रजिस्ट्री    : पंक्ति ' + mode);
say('  लिंक        : adhyayan.html#' + id);
if (warn.length) { say(''); warn.forEach(w => say('  ⚠ ' + w)); }
say('');
say('  आपके निशान और नोट pid से जुड़े हैं — दोबारा चढ़ाने पर भी बचे रहेंगे।');
say('');
