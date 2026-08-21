#!/usr/bin/env node
/* ============================================================
   book-json-banao.js — book/<book_id>/data/ch*.json → अध्ययन-पुस्तकालय

   चलाइए:
     node scripts/book-json-banao.js compound_effect_hi
     node scripts/book-json-banao.js                 (सारी किताबें)

   यह उस डिजिटाइज़ेशन-प्रक्रिया के लिए है जिसमें हर अध्याय की एक
   JSON फ़ाइल बनती है। नया अध्याय आते ही उसकी ch02.json उसी folder
   में रख दीजिए और यही आदेश दोबारा चला दीजिए।

   निकलता है — books/<id>.json (सच) + data/adhyayan-<id>.js (बिना-server)
                books/index.json + data/adhyayan-registry.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { pid, emit, report, ROOT } = require('./lib/emit-book.js');

const BOOKS = path.join(ROOT, 'book');
const say = (...a) => console.log(...a);
const die = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };

if (!fs.existsSync(BOOKS)) die('book/ folder नहीं मिला।');
const only = process.argv[2];
const dirs = fs.readdirSync(BOOKS).filter(d => {
  if (only && d !== only) return false;
  return fs.existsSync(path.join(BOOKS, d, 'data'));
});
if (!dirs.length) die(only ? ('book/' + only + '/data नहीं मिला।') : 'book/ में कोई किताब नहीं मिली।');

/* पहचान — book_id से, पर पहले से मौजूद पहचान न बदले (निशान उसी से जुड़े हैं) */
function shortId(bookId) {
  return String(bookId).toLowerCase()
    .replace(/_(hi|hindi|en)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

dirs.forEach(function (dir) {
  const base = path.join(BOOKS, dir);
  const files = fs.readdirSync(path.join(base, 'data')).filter(f => /\.json$/i.test(f)).sort();
  if (!files.length) { say('  ⚠ ' + dir + ' — कोई .json नहीं, छोड़ दिया'); return; }

  let first = null;
  const chapters = [];
  const warn = [];

  files.forEach(function (f) {
    let J;
    try { J = JSON.parse(fs.readFileSync(path.join(base, 'data', f), 'utf8')); }
    catch (e) { die(dir + '/data/' + f + ' पढ़ी नहीं जा सकी — ' + e.message); }
    if (!first) first = J;

    const secAt = {};
    (J.sections || []).forEach(s => { if (s.heading && s.start_paragraph) secAt[String(s.start_paragraph)] = s.heading; });
    const figAfter = {};
    (J.figures || []).forEach(g => {
      const k = String(g.after_paragraph);
      (figAfter[k] = figAfter[k] || []).push(g);
    });
    const pqPage = {};
    (J.pull_quotes || []).forEach(x => { const k = String(x.page_no); (pqPage[k] = pqPage[k] || []).push(x); });

    const blocks = [];
    const add = (b) => { if (b.type !== 'page' && !b.id) b.id = pid(b.text || b.caption || ''); blocks.push(b); };
    let lastPage = null, pqDone = {};

    (J.paragraphs || []).forEach(function (p) {
      const pageStr = p.page_no == null ? null : String(p.page_no);
      const page = pageStr ? parseInt(pageStr, 10) : null;
      if (page != null && !isNaN(page) && page !== lastPage) { add({ type: 'page', n: page }); lastPage = page; }

      if (secAt[String(p.id)]) add({ type: 'h2', text: secAt[String(p.id)] });

      if (pageStr && pqPage[pageStr] && !pqDone[pageStr]) {
        pqDone[pageStr] = 1;
        pqPage[pageStr].forEach(x => add({ type: 'quote', text: x.text }));
      }

      const b = { type: p.type === 'calculation_box' ? 'calc' : 'p', text: p.text };
      if (p.note) b.note = p.note;
      add(b);

      (figAfter[String(p.id)] || []).forEach(function (g) {
        add({
          type: 'figure',
          src: 'book/' + dir + '/' + g.file,
          label: g.label || '',
          n: g.page_no != null ? parseInt(g.page_no, 10) : page,
          caption: g.caption || '',
          description: g.description || ''
        });
      });
    });

    Object.keys(pqPage).forEach(pg => {
      if (pqDone[pg]) return;
      pqPage[pg].forEach(x => add({ type: 'quote', text: x.text }));
    });

    const A = J.action_steps;
    if (A && A.items && A.items.length) {
      if (A.page_no != null && parseInt(A.page_no, 10) !== lastPage) add({ type: 'page', n: parseInt(A.page_no, 10) });
      add({
        type: 'actions',
        heading: A.heading || 'संक्षिप्त कार्य क़दम',
        text: A.heading || 'संक्षिप्त कार्य क़दम',
        items: A.items.map(it => ({ id: pid(it), text: it })),
        footer: A.footer_note || ''
      });
    }

    (J.uncertain_spots || []).forEach(u =>
      warn.push('संदिग्ध स्थान — ' + u.location + ': ' + String(u.issue).slice(0, 64) + '…'));

    chapters.push({
      id: 'ch' + (J.chapter_no != null ? J.chapter_no : chapters.length + 1),
      number: J.chapter_no != null ? Number(J.chapter_no) : chapters.length + 1,
      title: J.chapter_title || ('अध्याय ' + (chapters.length + 1)),
      titleEn: J.chapter_title_en || '',
      sourcePages: J.source_pages || '',
      blocks: blocks
    });
  });

  /* दोहरे हिस्से? */
  const seen = {};
  chapters.forEach(c => c.blocks.forEach(b => {
    if (!b.id) return;
    if (seen[b.id]) warn.push('दो हिस्सों का पाठ बिलकुल एक जैसा है — निशान दोनों पर लगेंगे: "' +
      String(b.text || b.caption).slice(0, 36) + '…"');
    seen[b.id] = 1;
  }));

  const id = shortId(first.book_id || dir);
  let r;
  try {
    r = emit({
      id: id,
      meta: {
        title: first.book_title || dir,
        titleEn: first.book_title_en || '',
        author: first.author || '',
        language: first.language || 'hi',
        accent: process.env.RANG && /^#[0-9a-fA-F]{6}$/.test(process.env.RANG) ? process.env.RANG : '#C89545',
        source: 'book/' + dir,
        sourcePages: first.source_pages || ''
      },
      chapters: chapters,
      warn: warn
    });
  } catch (e) { die(e.message); }
  report(say, r, chapters);
});
