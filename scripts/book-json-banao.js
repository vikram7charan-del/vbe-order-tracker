#!/usr/bin/env node
/* ============================================================
   book-json-banao.js — book/<book_id>/data/ch*.json → अध्ययन-पुस्तकालय

   चलाइए:
     node scripts/book-json-banao.js compound_effect_hi
     node scripts/book-json-banao.js                 (सारी किताबें)

   यह उस डिजिटाइज़ेशन-प्रक्रिया के लिए है जिसमें हर अध्याय की
   एक JSON फ़ाइल बनती है (paragraphs, sections, pull_quotes,
   action_steps, figures)। नया अध्याय आते ही उसकी ch02.json
   उसी folder में रख दीजिए और यही आदेश दोबारा चला दीजिए।

   ★ हर अनुच्छेद की पक्की पहचान (pid) उसके अपने पाठ से बनती है —
     इसलिए दोबारा चढ़ाने पर भी आपके निशान और नोट बचे रहते हैं।
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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

/* पहचान — जो हिंदी में लिखा है वही रहेगा, बस अंग्रेज़ी की छोटी id चाहिए */
function shortId(bookId) {
  return String(bookId).toLowerCase().replace(/_(hi|hindi|en)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function pid(text) {
  let h = 0x811c9dc5;
  const s = String(text).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36);
}
const q = (s) => JSON.stringify(String(s));
const hex2 = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const rgb2 = (a) => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

dirs.forEach(function (dir) {
  const base = path.join(BOOKS, dir);
  const files = fs.readdirSync(path.join(base, 'data')).filter(f => /\.json$/i.test(f)).sort();
  if (!files.length) { say('  ⚠ ' + dir + ' — कोई .json नहीं, छोड़ दिया'); return; }

  let meta = null;
  const chapters = [];
  const warn = [];
  let words = 0, figCount = 0, actCount = 0;
  const pages = [];

  files.forEach(function (f) {
    let J;
    try { J = JSON.parse(fs.readFileSync(path.join(base, 'data', f), 'utf8')); }
    catch (e) { die(dir + '/data/' + f + ' पढ़ी नहीं जा सकी — ' + e.message); }
    if (!meta) meta = J;

    const secAt = {};
    (J.sections || []).forEach(s => { if (s.heading && s.start_paragraph) secAt[String(s.start_paragraph)] = s.heading; });
    const figAfter = {};
    (J.figures || []).forEach(g => { if (g.after_paragraph) (figAfter[String(g.after_paragraph)] = figAfter[String(g.after_paragraph)] || []).push(g); });
    const pqAtPage = {};
    (J.pull_quotes || []).forEach(x => { if (x.page_no != null) (pqAtPage[String(x.page_no)] = pqAtPage[String(x.page_no)] || []).push(x); });

    const paras = [];
    const push = (o) => { o.pid = pid(o.t); paras.push(o); };
    let pqDone = {};

    (J.paragraphs || []).forEach(function (p) {
      const pageStr = p.page_no == null ? null : String(p.page_no);
      const page = pageStr ? parseInt(pageStr, 10) : null;
      if (page != null && !isNaN(page)) pages.push(page);

      if (secAt[String(p.id)]) push({ t: secAt[String(p.id)], k: 'h', page: page });

      /* इस पृष्ठ का बॉक्स-कथन — पहली बार जब वह पृष्ठ आए */
      if (pageStr && pqAtPage[pageStr] && !pqDone[pageStr]) {
        pqDone[pageStr] = 1;
        pqAtPage[pageStr].forEach(x => push({ t: x.text, k: 'q', page: page }));
      }

      const kind = p.type === 'calculation_box' ? 'box' : null;
      const o = { t: p.text, page: page };
      if (kind) o.k = kind;
      if (p.note) o.note = p.note;
      push(o);
      words += String(p.text || '').split(/\s+/).length;

      (figAfter[String(p.id)] || []).forEach(function (g) {
        figCount++;
        push({
          t: g.caption || g.label || 'चित्र',
          k: 'fig',
          page: g.page_no != null ? parseInt(g.page_no, 10) : page,
          src: 'book/' + dir + '/' + g.file,
          label: g.label || '',
          desc: g.description || ''
        });
      });
    });

    /* बाक़ी बचे बॉक्स-कथन */
    Object.keys(pqAtPage).forEach(pg => {
      if (pqDone[pg]) return;
      pqAtPage[pg].forEach(x => push({ t: x.text, k: 'q', page: parseInt(pg, 10) }));
    });

    /* अंत के कार्य क़दम */
    const A = J.action_steps;
    if (A && A.items && A.items.length) {
      const pg = A.page_no != null ? parseInt(A.page_no, 10) : null;
      push({ t: A.heading || 'संक्षिप्त कार्य क़दम', k: 'acth', page: pg });
      A.items.forEach(it => { actCount++; push({ t: it, k: 'act', page: pg }); });
      if (A.footer_note) push({ t: A.footer_note, k: 'actf', page: pg });
    }

    (J.uncertain_spots || []).forEach(u => warn.push('संदिग्ध स्थान — ' + u.location + ': ' + String(u.issue).slice(0, 70) + '…'));

    chapters.push({
      id: 'ch' + (J.chapter_no != null ? J.chapter_no : chapters.length + 1),
      no: J.chapter_no != null ? String(J.chapter_no) : String(chapters.length + 1),
      title: J.chapter_title || ('अध्याय ' + (chapters.length + 1)),
      titleEn: J.chapter_title_en || '',
      srcPages: J.source_pages || '',
      paras: paras
    });
  });

  const dup = {};
  chapters.forEach(c => c.paras.forEach(p => {
    if (dup[p.pid]) warn.push('दो हिस्सों का पाठ बिलकुल एक जैसा है — निशान दोनों पर लगेंगे: "' + p.t.slice(0, 38) + '…"');
    dup[p.pid] = 1;
  }));

  const id = shortId(meta.book_id || dir);
  const title = meta.book_title || dir;
  const author = meta.author || '';
  const rang = (process.env.RANG && /^#[0-9a-fA-F]{6}$/.test(process.env.RANG)) ? process.env.RANG : '#2E86AB';
  const b3 = hex2(rang);
  const glow = rgb2(b3.map(x => x * 0.78));
  const bg = rgb2(b3.map(x => 8 + x * 0.055));
  const totalP = chapters.reduce((a, c) => a + c.paras.length, 0);
  const mins = Math.max(1, Math.round(words / 180));

  const out = [];
  out.push('/* ============================================================');
  out.push('   ' + title + (author ? ' — ' + author : '') + '   [अध्ययन-पुस्तक]');
  out.push('   ------------------------------------------------------------');
  out.push('   ⚠ यह फ़ाइल अपने आप बनी है — इसे हाथ से मत बदलिए।');
  out.push('     स्रोत: book/' + dir + '/data/*.json');
  out.push('     नया अध्याय जोड़कर फिर चलाइए:');
  out.push('       node scripts/book-json-banao.js ' + dir);
  out.push('');
  out.push('   pid = हर हिस्से की पक्की पहचान। आपके निशान और नोट इसी से');
  out.push('   जुड़े रहते हैं — जिसका पाठ नहीं बदला, उसके निशान बचे रहेंगे।');
  out.push('');
  out.push('   बना: ' + new Date().toISOString().slice(0, 10) +
           ' · अध्याय ' + chapters.length + ' · हिस्से ' + totalP + ' · लगभग ' + words + ' शब्द');
  out.push('   ============================================================ */');
  out.push('');
  out.push('window.ADHYAYAN_DATA = window.ADHYAYAN_DATA || {};');
  out.push('');
  out.push('window.ADHYAYAN_DATA[' + q(id) + '] = {');
  out.push('  id: ' + q(id) + ',');
  out.push('  title: ' + q(title) + ',');
  if (meta.book_title_en) out.push('  titleEn: ' + q(meta.book_title_en) + ',');
  if (author)             out.push('  author: ' + q(author) + ',');
  out.push('  source: ' + q('book/' + dir) + ',');
  out.push('  paraCount: ' + totalP + ',');
  out.push('  words: ' + words + ',');
  out.push('  readMins: ' + mins + ',');
  if (pages.length) out.push('  pageFrom: ' + Math.min(...pages) + ', pageTo: ' + Math.max(...pages) + ',');
  out.push('  theme: { accent: ' + q(rang) + ', glow: ' + q(glow) + ', bg: ' + q(bg) + ' },');
  out.push('');
  out.push('  chapters: [');
  chapters.forEach(function (c, ci) {
    out.push('    {');
    out.push('      id: ' + q(c.id) + ',');
    out.push('      no: ' + q(c.no) + ',');
    out.push('      title: ' + q(c.title) + ',');
    if (c.srcPages) out.push('      srcPages: ' + q(c.srcPages) + ',');
    out.push('      paras: [');
    c.paras.forEach(function (p, pi) {
      const bits = ['pid: ' + q(p.pid)];
      if (p.page != null && !isNaN(p.page)) bits.push('page: ' + p.page);
      if (p.k)     bits.push('k: ' + q(p.k));
      if (p.src)   bits.push('src: ' + q(p.src));
      if (p.label) bits.push('label: ' + q(p.label));
      if (p.desc)  bits.push('desc: ' + q(p.desc));
      if (p.note)  bits.push('note: ' + q(p.note));
      bits.push('t: ' + q(p.t));
      out.push('        { ' + bits.join(', ') + ' }' + (pi < c.paras.length - 1 ? ',' : ''));
    });
    out.push('      ]');
    out.push('    }' + (ci < chapters.length - 1 ? ',' : ''));
  });
  out.push('  ]');
  out.push('};');
  out.push('');

  const dataRel = 'data/adhyayan-' + id + '.js';
  fs.writeFileSync(path.join(ROOT, dataRel), out.join('\n'), 'utf8');
  try { new Function('window', out.join('\n'))({}); }
  catch (e) { die('बनी हुई फ़ाइल में गड़बड़ी — ' + e.message); }

  /* चित्र सचमुच मौजूद हैं? */
  chapters.forEach(c => c.paras.forEach(p => {
    if (p.k === 'fig' && !fs.existsSync(path.join(ROOT, p.src))) warn.push('चित्र नहीं मिला — ' + p.src);
  }));

  /* registry */
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
    (author ? '    author: ' + q(author) + ',\n' : '') +
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
  catch (e) { die('adhyayan-registry.js बिगड़ गई होती — कुछ नहीं बदला। ' + e.message); }
  fs.writeFileSync(regPath, reg, 'utf8');

  say('');
  say('  ✓ ' + title + ' तैयार है   [अध्ययन-पुस्तक]');
  say('  ─────────────────────────────────────────────');
  say('  पहचान      : ' + id + '   (स्रोत — book/' + dir + ')');
  say('  अध्याय      : ' + chapters.length);
  chapters.forEach(c => say('                · ' + c.no + '. ' + c.title +
      ' — ' + c.paras.length + ' हिस्से' + (c.srcPages ? '  (पृष्ठ ' + c.srcPages + ')' : '')));
  say('  शब्द        : लगभग ' + words + '   ·   पढ़ने में ~' + mins + ' मिनट');
  say('  चित्र       : ' + figCount + '   ·   कार्य क़दम : ' + actCount);
  if (pages.length) say('  पृष्ठ        : ' + Math.min(...pages) + '–' + Math.max(...pages));
  say('  फ़ाइल       : ' + dataRel);
  say('  रजिस्ट्री    : पंक्ति ' + mode);
  say('  लिंक        : adhyayan.html#' + id);
  if (warn.length) { say(''); warn.slice(0, 8).forEach(w => say('  ⚠ ' + w)); }
  say('');
});
