/* 🌅 सुबह का AI दिन-प्लान — रोज़ ~7:15 IST पर Claude से आज का प्लान बनाकर
   _settings.aiDayPlan में रखता है (app के 'मेरा दिन' का golden panel यही दिखाता है)
   + phone पर push। Secrets: FIREBASE_SA + ANTHROPIC_KEY */
const admin = require('firebase-admin');
const https = require('https');
const KEY = process.env.ANTHROPIC_KEY || '';

function ask(prompt){
  return new Promise((res,rej)=>{
    const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1300,messages:[{role:'user',content:prompt}]});
    const r=https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':KEY,'anthropic-version':'2023-06-01','content-type':'application/json','content-length':Buffer.byteLength(body)}},
      (rs)=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{try{const j=JSON.parse(d);
        if(j.content&&j.content[0])res(j.content[0].text.trim());else rej(new Error(j.error?j.error.message:'no text'));}catch(e){rej(e)}})});
    r.on('error',rej); r.write(body); r.end();
  });
}
function topics(c){ return Array.isArray(c.topics)?c.topics.filter(x=>x&&typeof x==='object'):(c.note?[{t:c.note}]:[]); }

async function main(){
  if(!KEY){ console.log('no ANTHROPIC_KEY — skip'); return; }
  admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SA))});
  const db=admin.firestore();
  const parts={}; new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date()).forEach(x=>parts[x.type]=x.value);
  const istMin=Number(parts.hour)*60+Number(parts.minute);
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  if(istMin<420||istMin>=480){ console.log('window नहीं (7:00-8:00 IST) — skip'); return; }
  const snap=await db.collection('vbe_call_tracker').get();
  let settings={}; const items=[];
  snap.forEach(d=>{
    if(d.id==='_settings'){ settings=d.data()||{}; return; }
    if(d.id==='_focus') return;
    const c=d.data(); if(c.active===false) return;
    const pend=topics(c).filter(x=>!x.done);
    if(!pend.length) return;
    const t=c.nextCallAt?new Date(c.nextCallAt).getTime():0;
    items.push({id:d.id,name:c.name||'',time:t?new Date(t+330*60000).toISOString().slice(11,16):null,late:!!(t&&t<Date.now()),tasks:pend.slice(0,3).map(x=>x.t)});
  });
  if(settings.lastAiPlan===today){ console.log('आज बन चुका — skip'); return; }
  if(!items.length){ console.log('कोई काम नहीं'); return; }
  items.sort((a,b)=>(b.late?1:0)-(a.late?1:0));
  const txt=await ask(`विक्रम भाई (army-supply व्यापारी, बाड़मेर) का आज (${today}) का काम-प्लान। दिन के हिस्से: 6-9 योजना, 9-14 जालीपा, 14-18 मार्केटिंग, 18-20 हिसाब।\nजवाब सिर्फ़ JSON: {"lines":[{"id":"contactId","txt":"छोटी पंक्ति — समय/देर + नाम + मुख्य काम (शब्द हूबहू)"}]}\nनियम: देर वाले पहले, फिर समय-क्रम, max 14 पंक्तियाँ, हर txt ~12 शब्द।\nDATA:\n${JSON.stringify(items.slice(0,40))}`);
  const m=txt.match(/\{[\s\S]*\}/); const j=JSON.parse(m?m[0]:txt);
  if(!Array.isArray(j.lines)) throw new Error('bad lines');
  await db.collection('vbe_call_tracker').doc('_settings').set(
    {aiDayPlan:{at:new Date().toISOString(),lines:j.lines.slice(0,16)},lastAiPlan:today},{merge:true});
  // 📩 Telegram — पूरा प्लान (token+chat _settings से)
  if(settings.tgBotToken && settings.tgChatId){
    try{
      const text='🌅 *आज का प्लान — '+today+'*\n\n'+j.lines.slice(0,16).map((l,i)=>`${i+1}. ${String(l.txt).replace(/[*_`\[]/g,'')}`).join('\n')+'\n\n👉 https://vbe-order-tracker-60324.web.app/call-tracker.html';
      await fetch('https://api.telegram.org/bot'+settings.tgBotToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:settings.tgChatId,text,parse_mode:'Markdown',disable_web_page_preview:true})});
      console.log('📩 day-plan Telegram भेजा');
    }catch(e){ console.log('📩 Telegram err:',e.message); }
  }
  // push
  const toks=[]; (await db.collection('vbe_fcm_tokens').get()).forEach(d=>{const t=(d.data()||{}).token;if(t)toks.push(t);});
  if(toks.length){
    await admin.messaging().sendEachForMulticast({tokens:[...new Set(toks)],
      notification:{title:'🌅 आज का AI प्लान तैयार!',body:j.lines.slice(0,4).map(l=>'• '+l.txt).join('\n')},
      data:{link:'https://vbe-order-tracker-60324.web.app/call-tracker.html'},
      webpush:{fcmOptions:{link:'https://vbe-order-tracker-60324.web.app/call-tracker.html'},notification:{icon:'/ct-icon.svg',tag:'vbe-aiplan'}}});
  }
  console.log('✅ AI plan:',j.lines.length,'lines');
}
main().then(()=>process.exit(0)).catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
