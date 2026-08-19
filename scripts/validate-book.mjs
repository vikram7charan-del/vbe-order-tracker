#!/usr/bin/env node
/* ============================================================
   validate-book.mjs — नई किताब डालने से पहले जाँच

   चलाइए:
     node scripts/validate-book.mjs                 (सारी किताबें)
     node scripts/validate-book.mjs compound-effect (एक किताब)

   क्या जाँचता है
     · books/index.json सही है, हर किताब की फ़ाइल मौजूद है
     · .json और उसका .js रूप एक ही हैं (कहीं पुराना न रह जाए)
     · schema — id, meta, chapters, blocks, हर block का type सही
     · खाली पाठ, टूटा अध्याय, दोहरी id, गुम चित्र
     · पृष्ठ-अंक पीछे तो नहीं जा रहे
   कुछ गड़बड़ मिली तो exit code 1 — यानी CI में भी लगाया जा सकता है।
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];
const say = (...a) => console.log(...a);

let errs = 0, warns = 0;
const bad  = (m) => { errs++;  say('  ✗ ' + m); };
const warn = (m) => { warns++; say('  ⚠ ' + m); };

const OK_TYPES = new Set(['page', 'p', 'h2', 'h3', 'quote', 'calc', 'figure', 'actions']);

const idxPath = path.join(ROOT, 'books/index.json');
if (!fs.existsSync(idxPath)) { say('\n  ✗ books/index.json नहीं मिली — पहले कोई किताब चढ़ाइए।\n'); process.exit(1); }

let list;
try { list = JSON.parse(fs.readFileSync(idxPath, 'utf8')); }
catch (e) { say('\n  ✗ books/index.json पढ़ी नहीं जा सकी — ' + e.message + '\n'); process.exit(1); }
if (!Array.isArray(list)) { say('\n  ✗ books/index.json एक सूची (array) होनी चाहिए\n'); process.exit(1); }

const ids = new Set();
list.forEach(e => {
  if (ids.has(e.id)) bad('सूची में दो बार वही पहचान — ' + e.id);
  ids.add(e.id);
});

const targets = only ? list.filter(e => e.id === only) : list;
if (!targets.length) { say('\n  ✗ "' + only + '" नाम की कोई किताब सूची में नहीं\n'); process.exit(1); }

say('');
targets.forEach(function (e) {
  say('  ── ' + (e.title || e.id) + '  [' + e.id + ']');
  const jp = path.join(ROOT, e.file || '');
  if (!e.file || !fs.existsSync(jp)) { bad('किताब की फ़ाइल नहीं मिली — ' + e.file); return; }

  let B;
  try { B = JSON.parse(fs.readFileSync(jp, 'utf8')); }
  catch (err) { bad(e.file + ' पढ़ी नहीं जा सकी — ' + err.message); return; }

  if (B.id !== e.id) bad('फ़ाइल के अंदर की पहचान अलग है — ' + B.id + ' बनाम ' + e.id);
  if (!B.meta || !B.meta.title) warn('meta.title खाली है');
  if (!Array.isArray(B.chapters) || !B.chapters.length) { bad('कोई अध्याय नहीं'); return; }

  /* .js रूप वही है? */
  if (e.js) {
    const sp = path.join(ROOT, e.js);
    if (!fs.existsSync(sp)) bad('बिना-server वाला रूप नहीं मिला — ' + e.js);
    else {
      const src = fs.readFileSync(sp, 'utf8');
      const w = {}; try { new Function('window', src)(w); } catch (err) { bad(e.js + ' चली नहीं — ' + err.message); }
      const mirror = w.ADHYAYAN_DATA && w.ADHYAYAN_DATA[e.id];
      if (!mirror) bad(e.js + ' में किताब नहीं मिली');
      else if (JSON.stringify(mirror) !== JSON.stringify(B))
        bad('.js और .json अलग-अलग हैं — आयातक दोबारा चलाइए');
    }
  }

  const seen = new Map();
  let blocks = 0, texts = 0, figs = 0, acts = 0, lastPage = null, chNums = new Set();

  B.chapters.forEach(function (c, ci) {
    const where = 'अध्याय ' + (c.number != null ? c.number : ci + 1);
    if (!c.id)    bad(where + ' — id नहीं');
    if (!c.title) warn(where + ' — शीर्षक नहीं');
    if (c.number != null) {
      if (chNums.has(c.number)) bad('दो अध्यायों का क्रमांक एक ही — ' + c.number);
      chNums.add(c.number);
    }
    if (!Array.isArray(c.blocks) || !c.blocks.length) { bad(where + ' — एक भी हिस्सा नहीं'); return; }

    c.blocks.forEach(function (b, bi) {
      blocks++;
      const at = where + ', हिस्सा ' + (bi + 1);
      if (!b.type || !OK_TYPES.has(b.type)) { bad(at + ' — अनजान type "' + b.type + '"'); return; }

      if (b.type === 'page') {
        if (typeof b.n !== 'number' || !isFinite(b.n)) bad(at + ' — पृष्ठ-अंक ठीक नहीं');
        else {
          if (lastPage != null && b.n < lastPage) warn(at + ' — पृष्ठ पीछे चला गया (' + lastPage + ' → ' + b.n + ')');
          lastPage = b.n;
        }
        return;
      }

      if (!b.id) { bad(at + ' — id नहीं (निशान इसी से जुड़ते हैं)'); return; }
      if (seen.has(b.id)) warn(at + ' — इसी पाठ का हिस्सा पहले भी है, निशान दोनों पर लगेंगे: "' +
          String(b.text || b.caption || '').slice(0, 34) + '…"');
      seen.set(b.id, at);

      if (b.type === 'figure') {
        figs++;
        if (!b.src) bad(at + ' — चित्र का पता नहीं');
        else if (!fs.existsSync(path.join(ROOT, b.src))) bad(at + ' — चित्र नहीं मिला: ' + b.src);
        if (!b.caption) warn(at + ' — चित्र का कैप्शन खाली');
        else texts++;
        return;
      }

      if (b.type === 'actions') {
        if (!String(b.heading || b.text || '').trim()) warn(at + ' — कार्य क़दम का शीर्षक खाली');
        else texts++;
        if (!Array.isArray(b.items) || !b.items.length) { bad(at + ' — कार्य क़दम खाली'); return; }
        b.items.forEach(function (it, ii) {
          acts++;
          if (!it || !it.id) bad(at + ', क़दम ' + (ii + 1) + ' — id नहीं');
          if (!it || !String(it.text || '').trim()) bad(at + ', क़दम ' + (ii + 1) + ' — पाठ खाली');
          else texts++;
        });
        return;
      }

      if (!String(b.text || '').trim()) bad(at + ' — पाठ खाली');
      else texts++;
      if (String(b.text || '').length > 6000) warn(at + ' — बहुत लंबा हिस्सा (' + b.text.length + ' अक्षर), शायद टूटना चाहिए');
    });
  });

  const mw = B.meta && B.meta.blocks;
  if (mw != null && mw !== texts) warn('meta.blocks (' + mw + ') और असली गिनती (' + texts + ') अलग — आयातक दोबारा चलाइए');

  say('     अध्याय ' + B.chapters.length + ' · हिस्से ' + blocks + ' (पाठ ' + texts + ') · चित्र ' + figs + ' · कार्य क़दम ' + acts +
      (B.meta && B.meta.pageFrom ? ' · पृष्ठ ' + B.meta.pageFrom + '–' + B.meta.pageTo : ''));
});

say('');
if (errs)      say('  ✗ ' + errs + ' गड़बड़' + (warns ? ' और ' + warns + ' चेतावनी' : '') + ' — ठीक करके फिर जाँचिए।\n');
else if (warns) say('  ✓ कोई गड़बड़ नहीं। ' + warns + ' चेतावनी — देख लीजिए, चलेगा फिर भी।\n');
else            say('  ✓ सब ठीक है।\n');
process.exit(errs ? 1 : 0);
