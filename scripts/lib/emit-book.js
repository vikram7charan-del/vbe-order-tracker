/* ============================================================
   emit-book.js — किताब लिखने की साझा जगह

   दोनों आयातक (book-json-banao.js और adhyayan-banao.js) यहीं आकर
   किताब लिखते हैं, ताकि रूप एक ही रहे।

   जो-जो लिखा जाता है:
     books/index.json          ← सारी किताबों की सूची (manifest)
     books/<id>.json           ← किताब — यही सच है
     data/adhyayan-<id>.js     ← वही किताब, script-tag वाला पतला रूप
     data/adhyayan-registry.js ← वही सूची, script-tag वाला पतला रूप

   .json क्यों : साफ़, जाँचने लायक़, ऐप lazy-fetch करता है
   .js  क्यों : बिना server, फ़ोन में फ़ाइल खोलकर भी किताब खुल जाए
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/* अनुच्छेद की पक्की पहचान — उसके अपने पाठ से।
   इसी से आपके निशान और नोट किताब दोबारा चढ़ाने पर भी बचे रहते हैं। */
function pid(text) {
  let h = 0x811c9dc5;
  const s = String(text).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36);
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/* ------------------------------------------------------------
   emit({ id, meta, chapters, warn })
     chapters: [{ id, number, title, sourcePages, blocks: [...] }]
     blocks  : { type, ... }  — नीचे देखें
   ------------------------------------------------------------ */
function emit(book) {
  const id = book.id;
  const chapters = book.chapters;
  const meta = book.meta || {};
  const warn = book.warn || [];

  /* गिनती */
  let words = 0, figs = 0, acts = 0, texts = 0;
  const pages = [];
  chapters.forEach(c => c.blocks.forEach(b => {
    if (b.type === 'page') { if (b.n != null) pages.push(b.n); return; }
    if (b.type === 'figure') { figs++; if (b.n != null) pages.push(b.n); }
    if (b.type === 'actions') { acts += (b.items || []).length; }
    const t = b.text || b.caption || '';
    if (t) { words += t.split(/\s+/).length; texts++; }
    (b.items || []).forEach(it => { words += String(it.text).split(/\s+/).length; texts++; });
  }));
  const readMins = Math.max(1, Math.round(words / 180));

  meta.words = words;
  meta.readMins = readMins;
  if (pages.length) { meta.pageFrom = Math.min(...pages); meta.pageTo = Math.max(...pages); }
  meta.blocks = texts;
  meta.builtAt = new Date().toISOString().slice(0, 10);

  const doc = { id: id, meta: meta, chapters: chapters };

  /* ---------- books/<id>.json ---------- */
  ensureDir(path.join(ROOT, 'books'));
  const jsonRel = 'books/' + id + '.json';
  fs.writeFileSync(path.join(ROOT, jsonRel), JSON.stringify(doc, null, 1) + '\n', 'utf8');

  /* ---------- data/adhyayan-<id>.js (वही, script-tag रूप) ---------- */
  const jsRel = 'data/adhyayan-' + id + '.js';
  const head = [
    '/* ============================================================',
    '   ' + (meta.title || id) + (meta.author ? ' — ' + meta.author : '') + '   [अध्ययन-पुस्तक]',
    '   ------------------------------------------------------------',
    '   ⚠ यह फ़ाइल अपने आप बनी है — हाथ से मत बदलिए।',
    '     सच books/' + id + '.json में है; यह उसी का script-tag रूप है,',
    '     ताकि बिना server (फ़ाइल सीधे खोलकर) भी किताब खुल जाए।',
    '',
    '   बना: ' + meta.builtAt + ' · अध्याय ' + chapters.length +
      ' · हिस्से ' + texts + ' · लगभग ' + words + ' शब्द',
    '   ============================================================ */',
    'window.ADHYAYAN_DATA = window.ADHYAYAN_DATA || {};',
    'window.ADHYAYAN_DATA[' + JSON.stringify(id) + '] = '
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, jsRel), head + JSON.stringify(doc) + ';\n', 'utf8');
  try { new Function('window', fs.readFileSync(path.join(ROOT, jsRel), 'utf8'))({}); }
  catch (e) { throw new Error('बनी हुई .js फ़ाइल चली नहीं — ' + e.message); }

  /* ---------- books/index.json + data/adhyayan-registry.js ---------- */
  const idxPath = path.join(ROOT, 'books/index.json');
  let list = [];
  if (fs.existsSync(idxPath)) {
    try { list = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch (e) { list = []; }
  }
  const entry = {
    id: id,
    title: meta.title || id,
    author: meta.author || '',
    category: 'study',
    language: meta.language || 'hi',
    cover: meta.cover || null,
    accent: meta.accent || '#C89545',
    file: jsonRel,
    js: jsRel,
    chapters: chapters.length,
    blocks: texts,
    words: words,
    readMins: readMins,
    source: meta.source || '',
    addedAt: (list.filter(x => x.id === id)[0] || {}).addedAt || meta.builtAt,
    updatedAt: meta.builtAt
  };
  const at = list.findIndex(x => x.id === id);
  let mode;
  if (at >= 0) { list[at] = entry; mode = 'सुधार दी'; }
  else { list.push(entry); mode = 'जोड़ दी'; }
  list.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)) || String(a.id).localeCompare(String(b.id)));
  fs.writeFileSync(idxPath, JSON.stringify(list, null, 1) + '\n', 'utf8');

  fs.writeFileSync(path.join(ROOT, 'data/adhyayan-registry.js'),
    '/* अध्ययन-पुस्तकालय — सूची। सच books/index.json में है;\n' +
    '   यह उसी का script-tag रूप है (बिना server चलने के लिए)।\n' +
    '   ⚠ हाथ से मत बदलिए। */\n' +
    'window.ADHYAYAN_REGISTRY = ' + JSON.stringify(list) + ';\n', 'utf8');

  /* ---------- चित्र सचमुच हैं? ---------- */
  chapters.forEach(c => c.blocks.forEach(b => {
    if (b.type === 'figure' && b.src && !fs.existsSync(path.join(ROOT, b.src)))
      warn.push('चित्र नहीं मिला — ' + b.src);
  }));

  return {
    id, jsonRel, jsRel, mode, words, readMins, figs, acts, texts,
    chapters: chapters.length, pages, warn, total: list.length
  };
}

function report(say, r, chapters) {
  say('');
  say('  ✓ तैयार है   [अध्ययन-पुस्तक]');
  say('  ─────────────────────────────────────────────');
  say('  पहचान      : ' + r.id);
  say('  अध्याय      : ' + r.chapters);
  (chapters || []).forEach(c => say('                · ' + (c.number != null ? c.number + '. ' : '') + c.title +
      ' — ' + c.blocks.filter(b => b.type !== 'page').length + ' हिस्से' +
      (c.sourcePages ? '  (पृष्ठ ' + c.sourcePages + ')' : '')));
  say('  शब्द        : लगभग ' + r.words + '   ·   पढ़ने में ~' + r.readMins + ' मिनट');
  if (r.figs || r.acts) say('  चित्र       : ' + r.figs + '   ·   कार्य क़दम : ' + r.acts);
  if (r.pages.length) say('  पृष्ठ        : ' + Math.min(...r.pages) + '–' + Math.max(...r.pages));
  say('  लिखा       : ' + r.jsonRel + '   (सच)');
  say('               ' + r.jsRel + '   (बिना-server रूप)');
  say('               books/index.json  ·  data/adhyayan-registry.js');
  say('  सूची        : पंक्ति ' + r.mode + '  ·  कुल ' + r.total + ' किताबें');
  say('  लिंक        : adhyayan.html#' + r.id);
  if (r.warn.length) { say(''); r.warn.slice(0, 8).forEach(w => say('  ⚠ ' + w)); }
  say('');
  say('  आपके निशान और नोट हर हिस्से की pid से जुड़े हैं — दोबारा चढ़ाने पर भी बचे रहेंगे।');
  say('');
}

module.exports = { pid, emit, report, ROOT };
