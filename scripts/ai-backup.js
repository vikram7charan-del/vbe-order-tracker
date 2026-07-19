/* 🔒 Nightly Cloud Backup — रात 23:20+ IST पूरा vbe_call_tracker JSON बनाकर
   Firebase Storage में सहेजता है: vbe_backups/call-tracker-YYYY-MM-DD.json
   हर तारीख़ की अलग फ़ाइल — कभी overwrite नहीं, किसी भी दिन का data वापस मिल सकता है।
   0 token। Secret: FIREBASE_SA */
const admin = require('firebase-admin');

function dayKey(t){
  const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(t)).forEach(x=>{ p[x.type]=x.value; });
  return p.year+'-'+p.month+'-'+p.day;
}

async function main(){
  if(!process.env.FIREBASE_SA){ console.error('FIREBASE_SA missing'); process.exit(1); }
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)),
    storageBucket: 'manoj-business-os.firebasestorage.app'
  });
  const db = admin.firestore();

  const parts={}; new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date()).forEach(x=>{ parts[x.type]=x.value; });
  const istMin = Number(parts.hour)*60 + Number(parts.minute);
  if(istMin < 1400){ console.log('रात की विंडो नहीं (23:20+ IST) — skip'); return; }

  const today = dayKey(Date.now());
  const setRef = db.collection('vbe_call_tracker').doc('_settings');
  const snap = await db.collection('vbe_call_tracker').get();
  let settings={};
  const all={};
  snap.forEach(d=>{ if(d.id==='_settings') settings=d.data()||{}; all[d.id]=d.data(); });
  if(settings.lastBackup===today){ console.log('आज का backup हो चुका — skip'); return; }

  const json = JSON.stringify({ app:'vbe-call-tracker', date:today, docs:Object.keys(all).length, data:all });
  try{
    await admin.storage().bucket().file('vbe_backups/call-tracker-'+today+'.json')
      .save(json, { contentType:'application/json', resumable:false });
    await setRef.set({ lastBackup: today }, { merge:true });
    console.log('✅ backup saved:', Object.keys(all).length, 'docs,', Math.round(json.length/1024)+'KB → vbe_backups/call-tracker-'+today+'.json');
  }catch(e){
    // Storage enable न हो तो Firestore में ही fallback backup doc
    console.error('Storage backup failed:', e.message);
    if(json.length < 900000){
      await db.collection('vbe_backups').doc('call-tracker-'+today).set({ date:today, json });
      await setRef.set({ lastBackup: today }, { merge:true });
      console.log('✅ fallback: Firestore doc backup saved (' + Math.round(json.length/1024) + 'KB)');
    } else {
      throw e;
    }
  }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
