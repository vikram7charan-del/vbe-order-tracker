/* 🧠 Daily Memory — रात ~23:20+ IST हर दिन का सारांश vbe_call_tracker/mem_YYYY-MM-DD
   में पक्का सहेजता है (0 token — सिर्फ़ structured data, कोई AI call नहीं)।
   + घंटा-histogram (कब काम जुड़े/पूरे हुए) — nightly learning
   + रविवार रात: हफ़्ते का स्थायी सार (mem_week_...)
   + महीने की आख़िरी रात: महीने का स्थायी सार (mem_month_YYYY-MM)
   Secret: FIREBASE_SA (service account JSON) */
const admin = require('firebase-admin');

function topics(c){ return Array.isArray(c.topics) ? c.topics.filter(x=>x&&typeof x==='object') : (c.note?[{t:c.note}]:[]); }
function dayKey(t){
  const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(t)).forEach(x=>{ p[x.type]=x.value; });
  return p.year+'-'+p.month+'-'+p.day;
}
function istHour(t){ return Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date(t)))%24; }

async function main(){
  if(!process.env.FIREBASE_SA){ console.error('FIREBASE_SA missing'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db = admin.firestore();

  // रात 23:20-23:59 IST विंडो में ही (cron हर 5 min चलता है)
  const parts={}; new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date()).forEach(x=>{ parts[x.type]=x.value; });
  const istMin = Number(parts.hour)*60 + Number(parts.minute);
  if(istMin < 1400){ console.log('रात की विंडो नहीं (23:20+ IST) — skip (istMin='+istMin+')'); return; }

  const today = dayKey(Date.now());
  const now = Date.now();
  const snap = await db.collection('vbe_call_tracker').get();

  const tasksAdded=[], contactsAdded=[]; const staff={};
  const addH=new Array(24).fill(0), doneH=new Array(24).fill(0);
  let tasksDone=0, lateCount=0, pending=0, callsDue=0;

  snap.forEach(d=>{
    if(d.id==='_settings' || d.id==='_focus' || d.id.indexOf('mem_')===0) return;
    const c=d.data(); if(c.active===false) return;
    if(c.createdAt && dayKey(c.createdAt)===today) contactsAdded.push(c.name||'?');
    if(c.nextCallAt && new Date(c.nextCallAt).getTime()<=now && topics(c).some(x=>!x.done)) callsDue++;
    topics(c).forEach(x=>{
      if(x.addedAt && dayKey(x.addedAt)===today){ tasksAdded.push({name:c.name||'?', t:x.t||''}); addH[istHour(x.addedAt)]++; }
      if(x.done){
        if(x.doneAt && dayKey(x.doneAt)===today){ tasksDone++; doneH[istHour(x.doneAt)]++; const s=(x.assignTo||'').trim(); if(s) staff[s]=(staff[s]||0)+1; }
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
    staffPerf: staff, addH, doneH, text,
    at: new Date().toISOString()
  }, { merge:true });
  console.log('✅ daily memory saved:', text);

  // पुराने daily docs से अवधि का जोड़ (आज का data भी शामिल)
  function aggregate(matchFn){
    let a=tasksAdded.length, dn=tasksDone, ca=contactsAdded.length; const st={...staff};
    const aH=addH.slice(), dH=doneH.slice();
    snap.forEach(d=>{
      if(d.id.indexOf('mem_')!==0 || d.id.indexOf('mem_week')===0 || d.id.indexOf('mem_month')===0) return;
      const m=d.data()||{}; if(!m.date || m.date===today || !matchFn(m.date)) return;
      a+=(m.tasksAdded||[]).length; dn+=(m.tasksDone||0); ca+=(m.contactsAdded||[]).length;
      const sp=m.staffPerf||{}; for(const k in sp) st[k]=(st[k]||0)+sp[k];
      (m.addH||[]).forEach((v,i)=>{ aH[i]+=(v||0); });
      (m.doneH||[]).forEach((v,i)=>{ dH[i]+=(v||0); });
    });
    return {tasksAdded:a, tasksDone:dn, contactsAdded:ca, staffPerf:st, addH:aH, doneH:dH};
  }

  // 📅 रविवार रात — हफ़्ते का स्थायी सार
  const wd=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'short'}).format(new Date());
  if(wd==='Sun'){
    const wk=aggregate(dt=>{ const t=new Date(dt+'T12:00:00').getTime(); return now-t < 7*864e5; });
    await db.collection('vbe_call_tracker').doc('mem_week_'+today).set({
      id:'mem_week_'+today, week:today, ...wk, pending, lateCount, at:new Date().toISOString()
    },{merge:true});
    console.log('✅ weekly memory saved:', JSON.stringify({added:wk.tasksAdded,done:wk.tasksDone}));
  }

  // 🗓️ महीने की आख़िरी रात — महीने का स्थायी सार
  const tomorrow=dayKey(now+864e5);
  if(tomorrow.slice(0,7)!==today.slice(0,7)){
    const mo=today.slice(0,7);
    const mk=aggregate(dt=>dt.slice(0,7)===mo);
    await db.collection('vbe_call_tracker').doc('mem_month_'+mo).set({
      id:'mem_month_'+mo, month:mo, ...mk, pending, lateCount, at:new Date().toISOString()
    },{merge:true});
    console.log('✅ monthly memory saved:', mo);
  }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
