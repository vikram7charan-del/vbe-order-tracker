/* ══════════════════════════════════════════════════════════
   📩 VBE Telegram Bot — two-way दिमाग़ (GitHub Actions, मुफ़्त)
   ──────────────────────────────────────────────────────────
   हर 5 min cron पर जागता है और ~3.5 min लगातार long-poll करता है
   → जवाब लगभग तुरंत। Token/chat _settings (tgBotToken/tgChatId) से।
   सिर्फ़ मालिक की chat को जवाब — बाक़ी सबको विनम्र मना।

   समझता है (app वाला ही local rule-engine, 0 token):
   आज/कल के काम · लेट · बाकी · ज़रूरी · call · market/computer/
   golden/jalipa के काम · <नाम> के काम (हिंदी⇄English phonetic) ·
   खोजो <शब्द> · रिपोर्ट · "X को <काम>" लिखो → काम जुड़ जाए ·
   सूची के नीचे ✅ बटन → वहीं से काम पूरा।
   कुछ और पूछा और Claude key हो → grounded AI जवाब (no-guess)।

   Secret: FIREBASE_SA
   ══════════════════════════════════════════════════════════ */
const APP_LINK = 'https://vbe-order-tracker-60324.web.app/call-tracker.html';
const LOOP_MS = Number(process.env.TG_LOOP_MS || 210000); // ~3.5 min

/* ── हिंदी⇄English आवाज़-कुंजी (app से ported) ── */
const DEV2LAT={'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n','च':'c','छ':'c','ज':'j','झ':'j','ञ':'n','ट':'t','ठ':'t','ड':'d','ढ':'d','ण':'n','त':'t','थ':'t','द':'d','ध':'d','न':'n','प':'p','फ':'f','ब':'b','भ':'b','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'s','ष':'s','स':'s','ह':'h','क़':'k','ख़':'k','ग़':'g','ज़':'j','ड़':'r','ढ़':'r','फ़':'f','अ':'a','आ':'a','इ':'i','ई':'i','उ':'u','ऊ':'u','ए':'e','ऐ':'e','ओ':'o','औ':'o','ऋ':'r','ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','े':'e','ै':'e','ो':'o','ौ':'o','ृ':'r','ं':'n','ँ':'n','ः':'','्':'','़':''};
function translit(s){ let o=''; for(const ch of String(s||'')) o+=(DEV2LAT[ch]!==undefined?DEV2LAT[ch]:ch); return o; }
function phonKey(s){
  let x=translit(s).toLowerCase();
  x=x.replace(/chh/g,'c').replace(/ph/g,'f').replace(/kh/g,'k').replace(/gh/g,'g').replace(/ch/g,'c').replace(/jh/g,'j').replace(/th/g,'t').replace(/dh/g,'d').replace(/bh/g,'b').replace(/sh/g,'s').replace(/w/g,'v').replace(/z/g,'j').replace(/q/g,'k');
  return x.replace(/[aeiou]/g,'').replace(/[^a-z0-9]/g,'').replace(/(.)\1+/g,'$1');
}
const NAME_STOP=['भाई','भाईसाहब','जी','जीजी','साहब','साब','सर','मैडम','श्री','श्रीमान','वाले','वाला','bhai','ji','sahab','sahib','sir','madam','shri','wale','wala','kumar'];

function topics(c){ return Array.isArray(c.topics)?c.topics.filter(x=>x&&typeof x==='object'):(c.note?[{t:c.note}]:[]); }
function istParts(t){
  const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(t)).forEach(x=>{p[x.type]=x.value;});
  return p.year+'-'+p.month+'-'+p.day;
}
function istHM(t){ return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)); }
const CATS={golden:{logo:'🏆',label:'गोल्डन',words:['golden','गोल्डन','गोल्डेन']},
  computer:{logo:'💻',label:'कंप्यूटर',words:['computer','कंप्यूटर','कम्प्यूटर','कंप्युटर']},
  market:{logo:'🛒',label:'मार्केट',words:['market','मार्केट','बाजार','बाज़ार']},
  jalipa:{logo:'🏪',label:'जालीपा',words:['jalipa','जालीपा','जालिपा','जलिपा']}};

/* ── data इकट्ठा (हर poll-batch में ताज़ा) ── */
function collectAll(snap){
  const contacts=[]; let settings={}, focus=null;
  snap.forEach(d=>{
    if(d.id==='_settings'){ settings=d.data()||{}; return; }
    if(d.id==='_focus'){ focus=d.data()||{}; return; }
    if(d.id.indexOf('mem_')===0) return;
    const c=d.data(); c.id=d.id; contacts.push(c);
  });
  return {contacts, settings, focus};
}
function activeC(contacts){ return contacts.filter(c=>c.active!==false); }
function allTasks(contacts){
  const out=[];
  activeC(contacts).forEach(c=>topics(c).forEach((x,i)=>out.push({...x,cid:c.id,ti:i,name:c.name||'?',phone:c.phone||''})));
  return out;
}
function findByName(contacts,q){
  const words=String(q||'').toLowerCase().trim().split(/\s+/).filter(w=>w&&NAME_STOP.indexOf(w)<0);
  if(!words.length) return null;
  const qk=phonKey(words.join(''));
  if(qk.length<2) return null;
  let best=null;
  for(const c of contacts){
    const nm=(c.name||'').toLowerCase();
    const nk=phonKey(nm);
    const exact=words.some(w=>nm.includes(w));
    const phon=nk.startsWith(qk)||qk.startsWith(nk)||nm.split(/\s+/).some(w=>phonKey(w).startsWith(qk));
    if(exact||phon){ if(!best||exact) best=c; if(exact) break; }
  }
  return best;
}
/* नाम query के हर शब्द को आज़माओ — "कैलाश भाई के market काम" जैसा */
function personIn(contacts,text){
  const words=String(text).toLowerCase().replace(/[?.,!।]/g,' ').split(/\s+/).filter(Boolean);
  const skip=['के','का','की','काम','कौन','से','क्या','है','हैं','में','को','सब','वाले','list','tasks','work','आज','कल','सारे','बताओ','दिखाओ','बता','दिखा',...NAME_STOP,...Object.values(CATS).flatMap(c=>c.words)];
  for(const w of words){
    if(skip.indexOf(w)>=0||w.length<2) continue;
    const c=findByName(contacts,w);
    if(c) return {c,word:w};
  }
  return null;
}
function catIn(text){
  const t=String(text).toLowerCase();
  for(const k in CATS) if(CATS[k].words.some(w=>t.includes(w))) return k;
  return null;
}

/* ── जवाब-रचना ── */
function taskLine(t,now,n){
  let s=`${n}. ${t.pri==='high'?'🔴 ':''}${CATS[t.cat]?CATS[t.cat].logo+' ':''}${t.t}`;
  s+=`\n   👤 ${t.name}`;
  if(t.assignTo) s+=` → ${t.assignTo}`;
  if(t.at){ const late=new Date(t.at).getTime()<now; s+=` · ⏰ ${istParts(t.at)} ${istHM(t.at)}${late?' — लेट!':''}`; }
  return s;
}
function listMsg(title,items,now,withBtns){
  if(!items.length) return {text:title+'\n— कोई काम नहीं ✓'};
  const lines=items.slice(0,15).map((t,i)=>taskLine(t,now,i+1));
  let text=title+'\n\n'+lines.join('\n')+(items.length>15?`\n…और ${items.length-15} काम`:'');
  const msg={text};
  if(withBtns){
    const btns=items.slice(0,8).map((t,i)=>({text:'✅ '+(i+1),callback_data:('d|'+t.cid+'|'+t.ti).slice(0,64)}));
    const rows=[]; for(let i=0;i<btns.length;i+=4) rows.push(btns.slice(i,i+4));
    rows.push([{text:'📍 App खोलो',url:APP_LINK}]);
    msg.reply_markup={inline_keyboard:rows};
  }
  return msg;
}
const HELP=`🙏 नमस्ते विक्रम भाई! मैं आपका काम-bot हूँ। ऐसे पूछें:

📋 "आज के काम" · "कल के काम"
🔴 "लेट काम" · "ज़रूरी काम" · "बाकी काम"
📞 "call किसको करनी है"
🛒 "market के काम" (computer/golden/jalipa भी)
👤 "कैलाश के काम" — किसी का भी नाम
🔍 "खोजो DVR" — कुछ भी ढूँढो
📊 "रिपोर्ट" — आज का पूरा हिसाब

➕ काम जोड़ना: "नवीन को 2 प्रिंटर मंगवाने बोलो"
✅ किसी list के नीचे ✅1 ✅2 बटन दबाओ = काम पूरा`;

/* ── मुख्य router — app के rule-engine का छोटा भाई ── */
function answer(data,textRaw,now){
  const contacts=activeC(data.contacts);
  const text=String(textRaw||'').trim();
  const t=text.toLowerCase();
  const has=(...ws)=>ws.some(w=>t.includes(w));
  const today=istParts(now), tomorrow=istParts(now+864e5);
  const tasks=allTasks(data.contacts).filter(x=>!x.done);

  if(!text||t==='/start'||has('help','मदद','हेल्प','namaste','नमस्ते','hi','hello','हैलो','हेलो')&&t.length<12) return {text:HELP};

  /* ➕ काम जोड़ना — "X को ..." (क्रिया के साथ) */
  const addM=text.match(/^(.{2,25}?)\s*(?:को|ko)\s+(.+)$/i);
  if(addM && /(बोल|बता|कह|मंगवा|मँगवा|खरीद|भेज|लाना|लाने|देना|दिलवा|करवा|बनवा|पूछ|याद|दे दो|दो|करना|कर दे)/.test(addM[2])){
    const p=findByName(contacts,addM[1]);
    if(p){
      return {addTask:{cid:p.id,text:addM[2].trim(),pname:p.name},
        text:`✅ काम जुड़ गया!\n👤 ${p.name}\n📝 ${addM[2].trim()}\n\n(app में भी अभी दिखेगा)`};
    }
    return {text:`🤔 "${addM[1].trim()}" नाम का contact नहीं मिला।\nनाम थोड़ा और साफ़ लिखें — जैसे contact में जो नाम है।`};
  }

  /* 🔍 खोज */
  const sM=text.match(/(?:खोजो|खोज|ढूंढो|ढूँढो|ढूंढ|search)\s+(.+)/i);
  if(sM){
    const q=sM[1].toLowerCase(), qk=phonKey(q);
    const hits=tasks.filter(x=>(x.t||'').toLowerCase().includes(q)||x.name.toLowerCase().includes(q)||(qk.length>=2&&phonKey(x.name).startsWith(qk)));
    const cHits=contacts.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.phone||'').includes(q)||(qk.length>=2&&phonKey(c.name||'').startsWith(qk)));
    let out=`🔍 "${sM[1]}" की खोज:\n`;
    if(hits.length){ out+='\n📋 काम ('+hits.length+'):\n'+hits.slice(0,10).map((x,i)=>taskLine(x,now,i+1)).join('\n'); }
    if(cHits.length){ out+='\n\n👤 Contact: '+cHits.slice(0,6).map(c=>c.name+(c.phone?' ('+c.phone+')':'')).join(', '); }
    if(!hits.length&&!cHits.length) out+='— कुछ नहीं मिला';
    return {text:out};
  }

  /* 🎯 Focus */
  if(has('focus','फोकस','फ़ोकस','फॉक्स')){
    const items=(data.focus&&Array.isArray(data.focus.items)?data.focus.items:[]);
    if(!items.length) return {text:'🎯 अभी कोई काम focus में नहीं है।'};
    return {text:'🎯 Focus में ('+items.length+'):\n'+items.slice(0,10).map((f,i)=>`${i+1}. ${f.t||'?'}${f.own?' — '+({v:'विक्रम',d:'दिनेश',k:'कैलाश'}[f.own]||f.own):''}`).join('\n')};
  }

  /* 📊 रिपोर्ट */
  if(has('रिपोर्ट','report','हिसाब','summary','सारांश')){
    const all=allTasks(data.contacts);
    const addedT=all.filter(x=>x.addedAt&&istParts(x.addedAt)===today);
    const doneT=all.filter(x=>x.done&&x.doneAt&&istParts(x.doneAt)===today);
    const late=tasks.filter(x=>x.at&&new Date(x.at).getTime()<now);
    const st={}; doneT.forEach(x=>{ const s=(x.assignTo||'').trim(); if(s) st[s]=(st[s]||0)+1; });
    let out=`📊 आज (${today}) का हिसाब:\n\n➕ नए काम: ${addedT.length}\n✅ पूरे हुए: ${doneT.length}\n🔴 लेट: ${late.length}\n📋 कुल बाकी: ${tasks.length}`;
    const sk=Object.keys(st); if(sk.length) out+='\n\n👥 आज किसने कितने पूरे किए:\n'+sk.map(k=>`• ${k}: ${st[k]}`).join('\n');
    return {text:out};
  }

  const qCat=catIn(t);
  const who=personIn(contacts,text);

  /* 👤 व्यक्ति (± श्रेणी) — सौंपे + उसके कार्ड के काम */
  if(who&&(has('काम','कम','tasks','work','kaam')||qCat)){
    const nk=phonKey(who.c.name||'');
    const asg=tasks.filter(x=>{ if(!x.assignTo) return false; const ak=phonKey(x.assignTo); return ak.startsWith(nk.slice(0,4))||String(x.assignTo).toLowerCase().includes(who.word); });
    const card=tasks.filter(x=>x.cid===who.c.id);
    const f=x=>!qCat||x.cat===qCat;
    const a2=asg.filter(f), c2=card.filter(x=>f(x)&&!a2.some(y=>y.cid===x.cid&&y.ti===x.ti));
    const cl=qCat?CATS[qCat].logo+' '+CATS[qCat].label+' ':'';
    if(!a2.length&&!c2.length) return {text:`👤 ${who.c.name} — ${cl}कोई बाकी काम नहीं ✓`};
    let out=`👤 ${who.c.name} के ${cl}काम:\n`;
    if(a2.length) out+='\n🤝 सौंपे गए ('+a2.length+'):\n'+a2.slice(0,10).map((x,i)=>taskLine(x,now,i+1)).join('\n');
    if(c2.length) out+='\n\n📇 इनके कार्ड पर ('+c2.length+'):\n'+c2.slice(0,10).map((x,i)=>taskLine(x,now,i+1)).join('\n');
    const m=listMsg('',[...a2,...c2],now,true); // buttons के लिए
    return {text:out,reply_markup:m.reply_markup};
  }

  /* 🗂️ श्रेणी अकेली */
  if(qCat) return listMsg(`${CATS[qCat].logo} ${CATS[qCat].label} के काम (${tasks.filter(x=>x.cat===qCat).length}):`,tasks.filter(x=>x.cat===qCat),now,true);

  /* 🔴 लेट */
  if(has('लेट','late','देरी','overdue')){
    const late=tasks.filter(x=>x.at&&new Date(x.at).getTime()<now);
    return listMsg(`🔴 लेट काम (${late.length}):`,late,now,true);
  }
  /* 🔴 ज़रूरी */
  if(has('ज़रूरी','जरूरी','priority','urgent','अर्जेंट'))
    return listMsg('🔴 ज़रूरी काम:',tasks.filter(x=>x.pri==='high'),now,true);
  /* 📞 calls */
  if(has('call','कॉल','फोन','phone')){
    const due=activeC(data.contacts).filter(c=>c.nextCallAt&&new Date(c.nextCallAt).getTime()<=now&&topics(c).some(x=>!x.done));
    if(!due.length) return {text:'📞 अभी कोई call due नहीं ✓'};
    return {text:`📞 Call करनी है (${due.length}):\n`+due.slice(0,12).map((c,i)=>`${i+1}. ${c.name}${c.phone?' — '+c.phone:''}`).join('\n')};
  }
  /* 📅 आज / कल */
  if(has('आज','today','aaj')){
    const td=tasks.filter(x=>x.at&&istParts(x.at)===today);
    const late=tasks.filter(x=>x.at&&new Date(x.at).getTime()<now&&istParts(x.at)!==today);
    const m=listMsg(`📅 आज के काम (${td.length}):`,td,now,true);
    if(late.length) m.text+=`\n\n⚠️ साथ में ${late.length} पुराने लेट काम भी हैं — "लेट काम" लिखकर देखें`;
    return m;
  }
  if(has('कल','tomorrow'))
    return listMsg(`📅 कल के काम:`,tasks.filter(x=>x.at&&istParts(x.at)===tomorrow),now,true);
  /* 📋 बाकी सब */
  if(has('बाकी','pending','सारे','सब काम','कितने काम'))
    return listMsg(`📋 कुल बाकी काम (${tasks.length}):`,tasks,now,true);

  return null; // समझ नहीं आया → AI fallback (हो तो)
}

/* ── Claude fallback (grounded, no-guess) — key हो तभी ── */
async function aiFallback(data,q,now){
  const key=data.settings&&data.settings.aiKey;
  if(!key) return null;
  const tasks=allTasks(data.contacts).filter(x=>!x.done).slice(0,60);
  const ctx=tasks.map(t=>`- ${t.name}: ${t.t}${t.assignTo?' (→'+t.assignTo+')':''}${t.at?' [समय '+istParts(t.at)+']':''}`).join('\n');
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,
        messages:[{role:'user',content:`तुम विक्रम भाई (Vande Bharat Enterprises) के business सहायक हो। नीचे उनके इस समय के असली बाकी काम हैं। सिर्फ़ इसी data से हिंदी में छोटा, सीधा जवाब दो — अनुमान मत लगाओ; data में न हो तो साफ़ कहो "मेरे रिकॉर्ड में नहीं है"।\n\nआज: ${istParts(now)}\n\nकाम:\n${ctx}\n\nसवाल: ${q}`}]})
    });
    const j=await r.json();
    const txt=j&&j.content&&j.content[0]&&j.content[0].text;
    return txt?{text:'🤖 '+txt}:null;
  }catch(e){ return null; }
}

/* ── Telegram API ── */
function tgApi(tok,method,body){
  return fetch(`https://api.telegram.org/bot${tok}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})
  }).then(r=>r.json());
}

async function main(){
  if(!process.env.FIREBASE_SA){ console.error('FIREBASE_SA missing'); process.exit(1); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
  const db=admin.firestore();
  const col=db.collection('vbe_call_tracker');

  let snap=await col.get();
  let data=collectAll(snap);
  const tok=data.settings.tgBotToken;
  if(!tok){ console.log('tgBotToken नहीं — app में 📩 से token डालें'); return; }
  let ownerChat=data.settings.tgChatId?String(data.settings.tgChatId):'';
  let offset=Number(data.settings.tgOffset||0);
  const t0=Date.now();
  let handled=0, dirty=false;

  console.log('📩 bot चालू — loop', Math.round(LOOP_MS/1000)+'s');
  while(Date.now()-t0<LOOP_MS){
    let j;
    try{ j=await tgApi(tok,'getUpdates',{offset:offset||undefined,timeout:40,allowed_updates:['message','callback_query']}); }
    catch(e){ console.log('getUpdates err:',e.message); await new Promise(r=>setTimeout(r,4000)); continue; }
    if(!j.ok){
      if(j.error_code===409){ console.log('409 — दूसरा poller चालू, रुक जाते हैं'); return; }
      console.log('tg error:',j.description); await new Promise(r=>setTimeout(r,5000)); continue;
    }
    const ups=j.result||[];
    if(!ups.length) continue;
    offset=ups[ups.length-1].update_id+1;
    await col.doc('_settings').set({tgOffset:offset},{merge:true});

    if(dirty){ snap=await col.get(); const s2=collectAll(snap); s2.settings=data.settings; data=s2; dirty=false; }
    const now=Date.now();

    for(const u of ups){
      /* ✅ बटन दबा — काम पूरा */
      if(u.callback_query){
        const cq=u.callback_query;
        const chat=cq.message&&cq.message.chat&&String(cq.message.chat.id);
        if(ownerChat&&chat!==ownerChat){ await tgApi(tok,'answerCallbackQuery',{callback_query_id:cq.id,text:'अनुमति नहीं'}); continue; }
        const m=(cq.data||'').match(/^d\|(.+)\|(\d+)$/);
        if(m){
          try{
            const ref=col.doc(m[1]);
            const dc=await ref.get();
            if(dc.exists){
              const c=dc.data(); const tps=topics(c);
              const ti=Number(m[2]);
              if(tps[ti]&&!tps[ti].done){
                tps[ti].done=true; tps[ti].doneAt=new Date().toISOString();
                const hist=Array.isArray(c.hist)?c.hist:[];
                hist.push({a:'done',txt:(tps[ti].t||'').slice(0,60),at:new Date().toISOString()});
                await ref.set({topics:tps,note:tps.filter(x=>!x.done).map(x=>x.t).join(' · '),hist:hist.slice(-40)},{merge:true});
                dirty=true;
                await tgApi(tok,'answerCallbackQuery',{callback_query_id:cq.id,text:'✅ काम पूरा!'});
                await tgApi(tok,'sendMessage',{chat_id:chat,text:`✅ पूरा हुआ: ${(tps[ti].t||'').slice(0,60)}\n👤 ${c.name||''}`});
                handled++;
              } else await tgApi(tok,'answerCallbackQuery',{callback_query_id:cq.id,text:'यह पहले ही पूरा है'});
            }
          }catch(e){ console.log('done err:',e.message); }
        }
        continue;
      }
      const msg=u.message;
      if(!msg||!msg.chat) continue;
      const chat=String(msg.chat.id);
      /* पहला लिखने वाला = मालिक (अगर set नहीं) */
      if(!ownerChat){ ownerChat=chat; data.settings.tgChatId=chat; await col.doc('_settings').set({tgChatId:chat},{merge:true}); }
      if(chat!==ownerChat){ await tgApi(tok,'sendMessage',{chat_id:chat,text:'🙏 यह विक्रम जी का निजी bot है।'}); continue; }
      if(msg.voice||msg.audio){ await tgApi(tok,'sendMessage',{chat_id:chat,text:'🎙️ आवाज़ अभी नहीं समझता — Telegram के mic बटन के पास keyboard का 🎤 (बोलकर text) इस्तेमाल करें।'}); continue; }
      const textIn=msg.text||msg.caption||'';
      if(!textIn) continue;

      let ans=answer(data,textIn,now);
      if(ans&&ans.addTask){
        try{
          const ref=col.doc(ans.addTask.cid);
          const dc=await ref.get();
          if(dc.exists){
            const c=dc.data(); const tps=topics(c);
            tps.push({t:ans.addTask.text,done:false,doneAt:null,addedAt:new Date().toISOString(),src:'tg'});
            const hist=Array.isArray(c.hist)?c.hist:[];
            hist.push({a:'add',txt:ans.addTask.text.slice(0,60),at:new Date().toISOString()});
            await ref.set({topics:tps,note:tps.filter(x=>!x.done).map(x=>x.t).join(' · '),hist:hist.slice(-40)},{merge:true});
            dirty=true;
          }
        }catch(e){ ans={text:'⚠️ जोड़ नहीं पाया — app से जोड़ लें: '+e.message.slice(0,60)}; }
      }
      if(!ans) ans=await aiFallback(data,textIn,now);
      if(!ans) ans={text:'🤔 समझ नहीं आया। "मदद" लिखें — सब तरीक़े दिखा दूँगा।'};
      const body={chat_id:chat,text:(ans.text||'').slice(0,3900)};
      if(ans.reply_markup) body.reply_markup=ans.reply_markup;
      try{ const rs=await tgApi(tok,'sendMessage',body); if(!rs.ok){ delete body.reply_markup; await tgApi(tok,'sendMessage',body); } }
      catch(e){ console.log('send err:',e.message); }
      handled++;
    }
  }
  console.log('✅ loop पूरा —',handled,'जवाब');
}

if(require.main===module&&!process.env.TG_TEST){
  main().then(()=>process.exit(0)).catch(e=>{ console.error('ERROR:',e.message); process.exit(1); });
}
module.exports={answer,collectAll,phonKey,findByName,personIn,catIn,istParts,allTasks};
