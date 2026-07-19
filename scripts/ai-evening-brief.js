/* 🔮 शाम की तैयारी-push — रोज़ 19:30-21:00 IST में एक बार (0 token, कोई AI नहीं)
   खुद-ब-खुद बताता है: कल/24 घंटे में कौन से काम समय पर हैं (लेट होने का ख़तरा),
   कितने लेट चल रहे, कितने भूले पड़े। ABLE का proactive-alert हिस्सा।
   Secret: FIREBASE_SA */
const admin = require('firebase-admin');

const APP_LINK = 'https://manoj-business-os.web.app/call-tracker.html';
function topics(c){ return Array.isArray(c.topics) ? c.topics.filter(x=>x&&typeof x==='object') : (c.note?[{t:c.note}]:[]); }

async function main(){
  if(!process.env.FIREBASE_SA){ console.error('FIREBASE_SA missing'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db = admin.firestore();

  const parts={}; new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date()).forEach(x=>{ parts[x.type]=x.value; });
  const istMin=Number(parts.hour)*60+Number(parts.minute);
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  if(istMin<1170 || istMin>=1260){ console.log('शाम की विंडो नहीं (19:30-21:00 IST) — skip'); return; }

  const snap=await db.collection('vbe_call_tracker').get();
  let settings={};
  snap.forEach(d=>{ if(d.id==='_settings') settings=d.data()||{}; });
  if(settings.lastEveningBrief===today){ console.log('आज भेजा जा चुका — skip'); return; }

  const now=Date.now(), day24=now+24*3600e3;
  const dueSoon=[], lateNames=new Set(); let forgot=0;
  snap.forEach(d=>{
    if(d.id==='_settings'||d.id==='_focus'||d.id.indexOf('mem_')===0) return;
    const c=d.data(); if(c.active===false) return;
    const nca=c.nextCallAt?new Date(c.nextCallAt).getTime():null;
    topics(c).forEach(x=>{
      if(x.done) return;
      const at=x.at?new Date(x.at).getTime():null;
      if((at&&at<now)||(nca&&nca<now)) lateNames.add(c.name||'?');
      if(at&&at>=now&&at<day24) dueSoon.push({name:c.name||'?',t:x.t||'',at});
      if(!at&&x.addedAt&&(now-new Date(x.addedAt).getTime())/864e5>=5) forgot++;
    });
  });
  dueSoon.sort((a,b)=>a.at-b.at);

  if(!dueSoon.length && !lateNames.size && !forgot){
    await db.collection('vbe_call_tracker').doc('_settings').set({lastEveningBrief:today},{merge:true});
    console.log('कुछ ख़ास नहीं — push नहीं भेजा'); return;
  }

  const fmt=t=>new Date(t+330*60000).toISOString().slice(11,16);
  const lines=[];
  dueSoon.slice(0,5).forEach(x=>lines.push(`⏳ ${fmt(x.at)} — ${x.name}: ${x.t.slice(0,30)}`));
  if(dueSoon.length>5) lines.push(`…और ${dueSoon.length-5} काम समय पर`);
  if(lateNames.size) lines.push(`🔴 ${lateNames.size} लोगों के काम लेट चल रहे`);
  if(forgot) lines.push(`🕳️ ${forgot} काम भूले पड़े (5+ दिन, बिना समय)`);

  // 📩 Telegram — शाम की तैयारी (token+chat _settings से)
  if(settings.tgBotToken && settings.tgChatId){
    try{
      const text='🔮 *कल की तैयारी — '+dueSoon.length+' काम समय पर*\n\n'+lines.join('\n')+'\n\n👉 '+APP_LINK;
      await fetch('https://api.telegram.org/bot'+settings.tgBotToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:settings.tgChatId,text,parse_mode:'Markdown',disable_web_page_preview:true})});
      console.log('📩 evening-brief Telegram भेजा');
    }catch(e){ console.log('📩 Telegram err:',e.message); }
  }

  const toks=[]; (await db.collection('vbe_fcm_tokens').get()).forEach(d=>{ const t=(d.data()||{}).token; if(t) toks.push(t); });
  if(toks.length){
    await admin.messaging().sendEachForMulticast({
      tokens:[...new Set(toks)],
      notification:{ title:`🔮 कल की तैयारी — ${dueSoon.length} काम समय पर हैं`, body:lines.join('\n') },
      data:{ link:APP_LINK },
      webpush:{ fcmOptions:{link:APP_LINK}, notification:{ icon:'/ct-icon.svg', tag:'vbe-evening-brief' } }
    });
  }
  await db.collection('vbe_call_tracker').doc('_settings').set({lastEveningBrief:today},{merge:true});
  console.log('✅ evening brief:', dueSoon.length, 'due,', lateNames.size, 'late,', forgot, 'forgotten');
}

main().then(()=>process.exit(0)).catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
