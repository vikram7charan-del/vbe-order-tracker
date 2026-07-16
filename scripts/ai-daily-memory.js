/* 🧠 Daily Memory — रात ~23:20+ IST हर दिन का सारांश vbe_call_tracker/mem_YYYY-MM-DD
   में पक्का सहेजता है (0 token — सिर्य structured data, कोई AI call नहीं)।
   इससे "पिछले मंगलवार / 3 दिन पहले क्या हुआ / कौन से काम-संपर्क जुड़े" जैसे सवाल
   हमेशा सटीक जवाब देते हैं — भले ही live docs से पुराना data हट जाए।
   Secret: FIREBASE_SA (service account JSON) */
const admin = require('firebase-admin');

function topics(c){ return Array.isArray(c.topics) ? c.topics.filter(x=>x&&typeof x==='object') : (c.note?[{t:c.note}]:[]); }
function dayKey(t){
  const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(t)).forEach(x=>{ p[x.type]=x.value; });
  return p.year+'-'+p.month+'-'+p.day;
}

async function main(){
  if(!process.env.FIREBASE_SA){ console.error('FIREBASE_SA missing'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db = admin.firestore();

  // सिर्य़ रात 23:20-23:59 IST विंडो में आज का सारांश (cron हर 5 min चलता है)
  const parts={}; new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date()).forEach(x=>{ parts[x.type]=x.value; });
  const istMin = Number(parts.hour)*60 + Number(parts.minute);
  if(istMin < 1400){ console.log('रात की विंडो नहीं (23:20+ IST) — skip (istMin='+istMin+')'); return; }

  const today = dayKey(Date.now());
  const now = Date.now();
  const snap = await db.collection('vbe_call_tracker').get();

  const tasksAdded=[], contactsAdded=[]; const staff={};
  let tasksDone=0, lateCount=0, pending=0, callsDue=0;

  snap.forEach(d=>{
    if(d.id==='_settings' || d.id==='_focus' || d.id.indexOf('mem_')===0) return;
    const c=d.data(); if(c.active===false) return;
    if(c.createdAt && dayKey(c.createdAt)===today) contactsAdded.push(c.name||'?');
    if(c.nextCallAt && new Date(c.nextCallAt).getTime()<=now && topics(c).some(x=>!x.done)) callsDue++;
    topics(c).forEach(x=>{
      if(x.addedAt && dayKey(x.addedAt)===today) tasksAdded.push({name:c.name||'?', t:x.t||''});
      if(x.done){
        if(x.doneAt && dayKey(x.doneAt)===today){ tasksDone++; const s=(x.assignTo||'').trim(); if(s) staff[s]=(staff[s]||0)+1; }
      } else {
        pending++;
        let late=false;
        if(x.at && new Date(x.at).getTime()<now) late=true;
        if(c.nextCallAt && new Date(c.nextCallAt).getTime()<now) late=true;
        if(late) lateCount++;
      }
    });
  });

  const text = `${today}: ${tasksAdded.length} नए काम, ${tasksDone} पूरे, ${contactsAdded.length} नए संपर्क, ${lateCount} लेट, ${pending} बाकी।`;
  await db.collection('vbe_call_tracker').doc('mem_'+today).set({
    id:'mem_'+today, date:today,
    tasksAdded: tasksAdded.slice(0,80),
    contactsAdded: contactsAdded.slice(0,80),
    tasksDone, lateCount, pending, callsDue,
    staffPerf: staff, text,
    at: new Date().toISOString()
  }, { merge:true });

  console.log('✅ daily memory saved:', text);
}

main().then(()=>process.exit(0)).catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
