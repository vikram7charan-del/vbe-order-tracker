/* ══════════════════════════════════════════════════════════
   VBE — Google Sheet Backup / Mirror  (GitHub Actions)
   ──────────────────────────────────────────────────────────
   मालिक का पूरा हिसाब (Firestore) अपने-आप एक Google Sheet में
   copy हो जाता है — भरोसा + backup दोनों। कोई पैसा/AI नहीं।

   कैसे चलता है:
   1. Firestore doc  vbe_settings/backup  से Sheet ID पढ़ता है।
   2. अगर Sheet ID नहीं है → service-account का email Firestore में
      लिख देता है (app उसे दिखाता है) और रुक जाता है — कुछ बिगड़ता नहीं।
   3. Sheet ID हो तो हर ज़रूरी collection को एक-एक tab में लिख देता है।

   मालिक का सिर्फ़ एक step (एक बार):
   - एक नई Google Sheet बनाओ।
   - उसे service-account वाले email से "Editor" share करो।
   - Sheet का link app के Dashboard → "Google Sheet Backup" में paste करो।

   Auth: FIREBASE_SA env (service account JSON) — GitHub repo secret.
   ज़रूरी: project पर Google Sheets API enabled हो।
   ══════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { google } = require('googleapis');

const PROJECT = 'vbe-order-tracker-60324';

function loadSA() {
  if (!process.env.FIREBASE_SA) {
    console.error('❌ FIREBASE_SA secret नहीं मिला।');
    process.exit(1);
  }
  return JSON.parse(process.env.FIREBASE_SA);
}

function fmtItems(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((it) => `${it.name || ''}${it.qty ? ' ' + it.qty + (it.unit || '') : ''}${it.rate ? ' @₹' + it.rate : ''}`.trim())
    .join(' | ');
}
function phones(p) { return Array.isArray(p) ? p.join(', ') : (p || ''); }

// ── हर tab की परिभाषा: title, header row, और doc→row बनाने वाला function ──
function buildTabs(data) {
  const T = [];

  T.push({
    title: 'खर्च (Expenses)',
    header: ['तारीख', 'Firm', 'दुकान/Party', 'Category', 'कुल ₹', 'Grand ₹', 'कैसे दिया', 'Pay Mode', 'स्थिति', 'UTR', 'GSTIN', 'सामान', 'नोट', 'Bill', 'ID'],
    rows: data.expenses
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map((e) => [
        e.date || '', e.firm || '', e.vendor || '', e.category || '',
        Math.round(+e.total || 0), Math.round(+e.grandTotal || +e.total || 0),
        e.paymentSource || '', e.payMode || '', e.payStatus || '',
        e.utr || '', e.partyGstin || '', fmtItems(e.items), e.notes || '',
        e.billStatus || '', e._id,
      ]),
  });

  T.push({
    title: 'आमदनी (Income)',
    header: ['तारीख', 'Party/Unit', 'रकम ₹', 'किस खाते में', 'UTR', 'Firm', 'नोट', 'ID'],
    rows: data.receipts
      .filter((r) => r.direction === 'in')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map((r) => [r.date || '', r.party || '', Math.round(+r.amount || 0), r.paymentSource || '', r.utr || '', r.firm || '', r.notes || '', r._id]),
  });

  T.push({
    title: 'पार्टी (Parties)',
    header: ['नाम', 'मोबाइल', 'GSTIN', 'पता', 'स्रोत', 'ID'],
    rows: data.parties
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map((p) => [p.name || '', phones(p.phones), p.gstin || '', p.address || '', p.source || '', p._id]),
  });

  T.push({
    title: 'खाते (Accounts)',
    header: ['नाम', 'बैंक', 'last4', 'Mode', 'Active', 'ID'],
    rows: data.accounts.map((a) => [a.name || '', a.bank || '', a.last4 || '', a.mode || '', a.active === false ? 'नहीं' : 'हाँ', a._id]),
  });

  T.push({
    title: 'प्राइसबुक (Prices)',
    header: ['सामान', 'तारीख', 'रेट ₹', 'Qty', 'Unit', 'दुकान', 'Firm', 'ID'],
    rows: data.pricebook
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map((p) => [p.item_name || '', p.date || '', Math.round(+p.rate || 0), p.qty || '', p.unit || '', p.vendor || '', p.firm || '', p._id]),
  });

  T.push({
    title: 'Unit पैसा (Receivables)',
    header: ['Unit', 'सामान', 'रकम ₹', 'Firm', 'स्थिति', 'Challan', 'खरीद तारीख', 'ID'],
    rows: data.receivables.map((u) => [u.unit || '', u.item || '', Math.round(+u.amount || 0), u.firm || '', u.status || '', u.challanNo || '', u.purchaseDate || '', u._id]),
  });

  return T;
}

async function readCollection(db, name) {
  const snap = await db.collection(name).get();
  const out = [];
  snap.forEach((d) => out.push({ _id: d.id, ...d.data() }));
  return out;
}

async function main() {
  const sa = loadSA();
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();

  // service-account email हमेशा Firestore में लिख दो ताकि app उसे दिखा सके
  const settingsRef = db.doc('vbe_settings/backup');
  await settingsRef.set({ serviceAccountEmail: sa.client_email }, { merge: true });

  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const rawId = String(settings.sheetId || '').trim();
  // पूरा URL डाल दिया हो तो भी ID निकाल लो
  const m = rawId.match(/[-\w]{25,}/);
  const sheetId = m ? m[0] : '';

  if (!sheetId) {
    console.log('ℹ️ अभी Sheet ID सेट नहीं है।');
    console.log('👉 इस email से अपनी Google Sheet को Editor share करो:');
    console.log('   ' + sa.client_email);
    console.log('   फिर app → Dashboard → "Google Sheet Backup" में Sheet का link डालो।');
    return;
  }

  // सारा ज़रूरी डेटा पढ़ो
  const [expenses, receipts, parties, accounts, pricebook, receivables] = await Promise.all([
    readCollection(db, 'vbe_expenses'),
    readCollection(db, 'vbe_receipts'),
    readCollection(db, 'vbe_parties'),
    readCollection(db, 'vbe_payment_accounts'),
    readCollection(db, 'vbe_pricebook'),
    readCollection(db, 'unit_receivables'),
  ]);
  const data = { expenses, receipts, parties, accounts, pricebook, receivables };
  const tabs = buildTabs(data);

  // Sheets API auth (उसी service account से)
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // मौजूद tabs पढ़ो
  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  } catch (e) {
    const msg = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message || String(e);
    console.error('❌ Sheet नहीं खुली — शायद अभी तक इस email से share नहीं हुई:');
    console.error('   ' + sa.client_email);
    console.error('   Google बोला: ' + msg);
    await settingsRef.set({ lastError: msg, lastErrorAt: new Date().toISOString() }, { merge: true });
    process.exit(1);
  }
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));

  // गायब tabs जोड़ो
  const toAdd = tabs.filter((t) => !existing.has(t.title));
  if (toAdd.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: toAdd.map((t) => ({ addSheet: { properties: { title: t.title } } })) },
    });
  }

  const stamp = new Intl.DateTimeFormat('hi-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());

  // हर tab: पहले खाली करो, फिर header + rows लिखो
  for (const t of tabs) {
    const title = t.title;
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `'${title}'` });
    const values = [
      [`अपडेट: ${stamp} · कुल ${t.rows.length}`],
      t.header,
      ...t.rows,
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${title}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
    console.log(`✅ ${title}: ${t.rows.length} rows`);
  }

  await settingsRef.set(
    { lastBackupAt: new Date().toISOString(), lastBackupStamp: stamp, lastError: '', lastErrorAt: '' },
    { merge: true }
  );
  console.log(`🎉 Google Sheet backup पूरा — ${stamp}`);
}

main().catch((e) => {
  console.error('❌ Backup fail:', e && (e.stack || e.message || e));
  process.exit(1);
});
