#!/usr/bin/env node
/* ============================================================
   adhyayan-banao.js — nayi-pustak/adhyayan.md → अध्ययन-पुस्तकालय

   चलाइए:
     node scripts/adhyayan-banao.js
     node scripts/adhyayan-banao.js nayi-pustak/adhyayan-2.md

   यह आसान रास्ता है — सीधा हिंदी में लिखिए। जब किताब को ठीक से
   डिजिटाइज़ किया जा रहा हो (चित्र, कार्य क़दम आदि सहित) तो
   scripts/book-json-banao.js वाला रास्ता लीजिए।

   निकलता है — books/<id>.json (सच) + data/adhyayan-<id>.js (बिना-server)
                books/index.json + data/adhyayan-registry.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { pid, emit, report, ROOT } = require('./lib/emit-book.js');

const SRC = process.argv[2] || 'nayi-pustak/adhyayan.md';
const SRC_ABS = path.resolve(ROOT, SRC);
const say = (...a) => console.log(...a);
const die = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };
const warn = [];

if (!fs.existsSync(SRC_ABS)) die('फ़ाइल नहीं मिली — ' + SRC);
const raw = fs.readFileSync(SRC_ABS, 'utf8').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');

const fm = {};
const m = raw.match(/^\s*---\n([\s\S]*?)\n---\n?/);
if (!m) die('ऊपर का परिचय-खाना नहीं मिला।\n    फ़ाइल की शुरुआत में --- वाली पंक्तियाँ ज़रूरी हैं (नमूना adhyayan.md में है)।');
m[1].split('\n').forEach(line => {
  const i = line.indexOf(':');
  if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
});
const body = raw.slice(m[0].length);

const need = (k) => { const v = (fm[k] || '').trim(); if (!v) die('परिचय-खाने में "' + k + '" खाली है।'); return v; };
const id = need('पहचान');
if (!/^[a-z][a-z0-9-]*$/.test(id))
  die('"पहचान" सिर्फ़ अंग्रेज़ी के छोटे अक्षरों में हो (जैसे compound, atomic)। अभी है — ' + id);
if (/यहाँ|नाम लिखिए/.test(fm['पुस्तक'] || ''))
  die('"पुस्तक" में अभी नमूने वाला पाठ पड़ा है — असली नाम लिख दीजिए।');
const title = need('पुस्तक');
const rang = (fm['रंग'] || '#C89545').trim();
if (!/^#[0-9a-fA-F]{6}$/.test(rang)) die('"रंग" ऐसा हो — #C89545 (हैश और छह अक्षर)। अभी है — ' + rang);

/* ---------- पढ़ना ---------- */
const lines = body.split('\n');
const chapters = [];
let ch = null, buf = [], kind = null, lastPage = null;

const addBlock = (b) => {
  if (!ch) newChapter(title);
  if (b.type !== 'page' && !b.id) b.id = pid(b.text || '');
  ch.blocks.push(b);
};
const flush = () => {
  const t = buf.join(' ').replace(/\s+/g, ' ').trim();
  buf = [];
  if (!t) { kind = null; return; }
  addBlock({ type: kind === 'q' ? 'quote' : kind === 'h' ? 'h2' : 'p', text: t });
  kind = null;
};
function newChapter(t) {
  flush();
  ch = { id: 'ch' + (chapters.length + 1), number: chapters.length + 1, title: t, sourcePages: '', blocks: [] };
  chapters.push(ch);
  if (lastPage != null) ch.blocks.push({ type: 'page', n: lastPage });
}

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  let mm;
  if ((mm = t.match(/^##\s*(?:अध्याय|भाग|खंड)\s*[:：]?\s*(.+)$/))) { newChapter(mm[1].trim()); continue; }
  if ((mm = t.match(/^###\s+(.+)$/)))      { flush(); buf = [mm[1].trim()]; kind = 'h'; flush(); continue; }
  if ((mm = t.match(/^\[\s*(\d+)\s*\]$/))) { flush(); lastPage = parseInt(mm[1], 10); addBlock({ type: 'page', n: lastPage }); continue; }
  if ((mm = t.match(/^>\s?(.*)$/)))        { if (kind !== 'q') flush(); kind = 'q'; if (mm[1].trim()) buf.push(mm[1].trim()); continue; }
  if (!t) { flush(); continue; }
  if (kind === 'q') flush();
  buf.push(t);
}
flush();

const live = chapters.filter(c => c.blocks.some(b => b.type !== 'page'));
if (!live.length) die('एक भी अनुच्छेद नहीं मिला।\n    पाठ को खाली पंक्ति से अलग-अलग अनुच्छेदों में रखिए।');
live.forEach((c, i) => { c.id = 'ch' + (i + 1); c.number = i + 1; });

/* अध्याय के पृष्ठ */
live.forEach(c => {
  const pg = c.blocks.filter(b => b.type === 'page').map(b => b.n);
  if (pg.length) c.sourcePages = Math.min(...pg) === Math.max(...pg) ? String(pg[0]) : Math.min(...pg) + '-' + Math.max(...pg);
});

const seen = {};
live.forEach(c => c.blocks.forEach(b => {
  if (!b.id) return;
  if (seen[b.id]) warn.push('दो अनुच्छेद बिलकुल एक जैसे हैं — निशान दोनों पर लगेंगे: "' + String(b.text).slice(0, 36) + '…"');
  seen[b.id] = 1;
}));
if (live.some(c => c.blocks.some(b => /यहाँ लिखिए|नमूने/.test(b.text || ''))))
  warn.push('नमूने वाली पंक्तियाँ अब भी पड़ी हैं — उन्हें मिटाना न भूलिएगा');

let r;
try {
  r = emit({
    id: id,
    meta: {
      title: title,
      author: (fm['लेखक'] || '').trim(),
      translator: (fm['अनुवाद'] || '').trim(),
      subject: (fm['विषय'] || '').trim(),
      subtitle: (fm['परिचय'] || '').trim(),
      language: 'hi',
      accent: rang,
      source: SRC
    },
    chapters: live,
    warn: warn
  });
} catch (e) { die(e.message); }
report(say, r, live);
