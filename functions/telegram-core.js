/* ══════════════════════════════════════════════════════════
   📩 VBE Telegram Bot — साझा दिमाग़ (webhook Function + poller दोनों यही वापरें)
   ──────────────────────────────────────────────────────────
   शुद्ध logic (answer/parseWhen/नाम-मिलान) + DB helpers (applyDone/
   applyAdd/handleUpdate/autoPushNew)। कोई transport नहीं — caller
   Telegram को भेजता है। इससे webhook और GitHub-poller एक ही code वापरें।
   ══════════════════════════════════════════════════════════ */
const APP_LINK = 'https://vbe-order-tracker-60324.web.app/call-tracker.html';

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

/* 🎯 Focus Mode — owner: v=विक्रम, d=दिनेश, k=कैलाश (app के _focus doc जैसा) */
const OWNERS={v:'🟣 विक्रम भाई',d:'🔷 दिनेश जी रतकोड़िया',k:'🟢 कैलाश भाई'};
const OWN_SHORT={v:'विक्रम',d:'दिनेश',k:'कैलाश'};
const FOCUS_ACTIVE=5;
/* 📂 श्रेणी-क्रम: पहले गोल्डन, फिर मार्केट, कंप्यूटर, जालीपा — बिना-श्रेणी सबसे नीचे।
   हर श्रेणी में 🔴 ज़रूरी पहले, फिर लेट/जल्दी समय वाले। */
const CAT_ORDER={golden:0, market:1, computer:2, jalipa:3, '':9};
function catRank(cat){ const r=CAT_ORDER[cat||'']; return r===undefined?9:r; }
function sortByCat(arr){
  return arr.slice().sort((a,b)=>{
    const cr=catRank(a.cat)-catRank(b.cat); if(cr) return cr;
    const pr=(a.pri==='high'?0:1)-(b.pri==='high'?0:1); if(pr) return pr;
    const au=a.at?new Date(a.at).getTime():Infinity, bu=b.at?new Date(b.at).getTime():Infinity;
    return au-bu;
  });
}
function fmtDur(ms){ ms=Math.abs(ms); const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return h?(h+'h'+(m?m+'m':'')):(m+'m'); }
function focusOwnerIn(t){
  if(/विक्रम|vikram/i.test(t)) return 'v';
  if(/कैलाश|कैलास|kailash/i.test(t)) return 'k';
  if(/दिनेश|dinesh/i.test(t)) return 'd';
  return null;
}
function focusItemsOf(data, own){
  const items=(data.focus&&Array.isArray(data.focus.items)?data.focus.items:[]).filter(f=>(f.own||'v')===own);
  const byId={}; activeC(data.contacts).forEach(c=>{ byId[c.id]=c; });
  return items.map(f=>{
    const c=byId[f.id]; let done=false, cat='', pri='';
    if(c){ const tp=topics(c); const tt=tp[f.i]; if(tt){ if(tt.done) done=true; cat=tt.cat||''; pri=tt.pri||''; } }
    return {...f, cname:c?c.name:'', cphone:c?(c.phone||c.waPhone||''):'', done, cat, pri};
  }).filter(f=>!f.done).sort((a,b)=>{
    const cr=catRank(a.cat)-catRank(b.cat); if(cr) return cr;              // श्रेणी-क्रम
    const pr=(a.pri==='high'?0:1)-(b.pri==='high'?0:1); if(pr) return pr;  // ज़रूरी पहले
    return (a.until||0)-(b.until||0);                                       // फिर लेट/जल्दी
  });
}
function doneTodayCount(data, now){
  const tk0=new Date(istParts(now)+'T00:00:00+05:30').getTime();
  let n=0; allTasks(data.contacts).forEach(x=>{ if(x.done&&x.doneAt&&new Date(x.doneAt).getTime()>=tk0) n++; });
  return n;
}
function focusDash(data, own, now){
  const list=focusItemsOf(data,own), nm=OWNERS[own];
  if(!list.length) return {text:`🎯 ${nm} — Focus\n\nअभी कोई काम focus में नहीं है।\n"${OWN_SHORT[own]} focus शुरू" लिखकर काम चुनें।`};
  const show=list.slice(0,50);          // पूरे focus काम (50 तक), श्रेणी-क्रम में
  const late=list.filter(f=>(f.until||0)<now).length;
  let out=`🎯 *${nm} — Focus Dashboard*\nआज ✅ ${doneTodayCount(data,now)} पूरे · focus में ${list.length} काम${late?` · 🔴 ${late} लेट`:''}\n`;
  let lastCat=null;
  show.forEach((f,i)=>{
    const ck=f.cat||'';
    if(ck!==lastCat){ lastCat=ck; const ci=CATS[ck]; out+=`\n*${ci?ci.logo+' '+ci.label:'⬜ बिना श्रेणी'}*\n`; }
    const isLate=(f.until||0)<now, run=fmtDur(now-(f.start||now));
    out+=`${i+1}. ${f.pri==='high'?'🔴 ':''}${f.t}${f.cname?' ('+f.cname+')':''} — ⏱${run}${isLate?' 🔴'+fmtDur(now-f.until)+' लेट':' ⏳'+fmtDur(f.until-now)}\n`;
  });
  if(list.length>50) out+=`\n…और ${list.length-50} focus काम — App में।`;
  out+=`\n\n⏱ हर काम की घड़ी focus में डालते ही चालू है। नई गिनती के लिए 🔄 ताज़ा दबाएँ।\n✅ नीचे नंबर दबाकर कोई भी काम पूरा करें।`;
  const btns=show.map((f,i)=>({text:'✅'+(i+1),callback_data:('x|'+f.key).slice(0,64)}));
  const rows=[]; for(let i=0;i<btns.length;i+=5) rows.push(btns.slice(i,i+5));
  rows.push([{text:'🔍 विस्तृत (card)',callback_data:'fdt|'+own+'|0'},{text:'🔄 ताज़ा',callback_data:'fd|'+own}]);
  return {text:out.slice(0,4050), reply_markup:{inline_keyboard:rows}};
}

/* 🎯 छोटा Review menu — किसका focus देखना है (सिर्फ़ बटन, कम-spam) */
function focusMenuMsg(data){
  const rows=[];
  ['v','d','k'].forEach(o=>{ const n=focusItemsOf(data,o).length; if(n) rows.push([{text:OWNERS[o]+' — '+n,callback_data:'fm|'+o}]); });
  rows.push([{text:'📞 Contact Review',callback_data:'crs'}]);
  return {text:'🎯 *Focus Mode Review*\n\nकिसका काम देखना चाहोगे?', reply_markup:{inline_keyboard:rows}};
}
/* staff दबाने पर — Short / विस्तृत विकल्प */
function focusChoiceMsg(data, own){
  const n=focusItemsOf(data,own).length;
  return {text:`${OWNERS[own]} — ${n} काम focus में\n\nकैसे देखना चाहोगे?`,
    reply_markup:{inline_keyboard:[[{text:'📋 Short',callback_data:'fd|'+own},{text:'🔍 विस्तृत',callback_data:'fdt|'+own+'|0'}]]}};
}
function _phoneDigits(p){ let d=String(p||'').replace(/[^0-9]/g,''); if(d.length===10) d='91'+d; else if(d.length>12) d=d.slice(-12); return d.length>=11?d:''; }
/* 🔍 विस्तृत — हर काम का अलग card (10-10 करके), call/WA/snooze/done/remove */
function focusDetailCards(data, own, start, chat){
  const list=focusItemsOf(data,own), now=Date.now(), nm=OWNERS[own];
  if(!list.length) return [{method:'sendMessage',body:{chat_id:chat,text:`🎯 ${nm} — focus में कोई काम नहीं।`}}];
  const out=[{method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:`🔍 *${nm} — विस्तृत* (${start+1}–${Math.min(start+10,list.length)} / ${list.length})`}}];
  list.slice(start,start+10).forEach((f,idx)=>{
    const n=start+idx+1, late=(f.until||0)<now;
    const dig=_phoneDigits(f.cphone);
    let txt=`📌 *${n}. ${f.t}*\n`;
    if(f.cname) txt+=`👤 ${f.cname}\n`;
    if(f.cphone) txt+=`📱 ${f.cphone}\n`;
    txt+=`⏱ ${fmtDur(now-(f.start||now))} से चालू · ${late?'🔴 '+fmtDur(now-f.until)+' लेट':'⏳ '+fmtDur(f.until-now)+' बाकी'}\n🎯 ${OWN_SHORT[own]}${CATS[f.cat]?' · '+CATS[f.cat].logo+CATS[f.cat].label:''}`;
    if(f.cphone) txt+='\n📞 नंबर पर tap करके कॉल करें ☝️';
    const rows=[];
    if(dig) rows.push([{text:'💬 WhatsApp पर भेजो',url:'https://wa.me/'+dig+'?text='+encodeURIComponent(f.t)}]);
    rows.push([{text:'⏰+10',callback_data:('xt|'+f.key+'|10').slice(0,64)},{text:'⏰+30',callback_data:('xt|'+f.key+'|30').slice(0,64)},{text:'⏰+1घं',callback_data:('xt|'+f.key+'|60').slice(0,64)}]);
    rows.push([{text:'✅ पूरा',callback_data:('x|'+f.key).slice(0,64)},{text:'❌ focus से हटाओ',callback_data:('rf|'+f.key).slice(0,64)}]);
    out.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:txt,reply_markup:{inline_keyboard:rows}}});
  });
  if(start+10<list.length) out.push({method:'sendMessage',body:{chat_id:chat,text:`⬇️ और ${list.length-(start+10)} काम बाकी`,reply_markup:{inline_keyboard:[[{text:'➡️ अगले 10',callback_data:'fdt|'+own+'|'+(start+10)}]]}}});
  return out;
}
/* 📞 Contact Review — pending वाले contacts पहले, ज़्यादा लेट पहले */
function contactReviewList(data){
  const now=Date.now();
  return activeC(data.contacts).map(c=>{
    const pend=topics(c).map((x,i)=>({...x,i})).filter(x=>!x.done);
    let maxLate=0; pend.forEach(x=>{ if(x.at){ const l=now-new Date(x.at).getTime(); if(l>maxLate) maxLate=l; } });
    return {c, pend, maxLate};
  }).sort((a,b)=>{
    const p=(b.pend.length>0?1:0)-(a.pend.length>0?1:0); if(p) return p;
    return b.maxLate-a.maxLate;
  });
}
function _ownerBtns(cid, ti){ return [
  {text:'🟣 विक्रम',callback_data:('cfo|'+cid+'|'+ti+'|v').slice(0,64)},
  {text:'🔷 दिनेश',callback_data:('cfo|'+cid+'|'+ti+'|d').slice(0,64)},
  {text:'🟢 कैलाश',callback_data:('cfo|'+cid+'|'+ti+'|k').slice(0,64)}]; }
function contactReviewCards(data, start, chat){
  const all=contactReviewList(data), now=Date.now(), total=all.length;
  if(!total) return [{method:'sendMessage',body:{chat_id:chat,text:'📇 कोई contact नहीं।'}}];
  if(start>=total) start=0;
  const out=[{method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:`📇 *Contact Review* (${start+1}–${Math.min(start+10,total)} / ${total})`}}];
  all.slice(start,start+10).forEach(o=>{
    const c=o.c, dig=_phoneDigits(c.phone||c.waPhone);
    let txt=`👤 *${c.name||'?'}*\n`;
    if(c.phone) txt+=`📱 ${c.phone}\n`;
    if(o.pend.length){
      txt+=`\nपेंडिंग काम (${o.pend.length}):\n`+o.pend.slice(0,5).map(x=>{
        const late=x.at&&new Date(x.at).getTime()<now;
        return `• ${CATS[x.cat]?CATS[x.cat].logo+' ':''}${x.t}${late?' — 🔴 '+fmtDur(now-new Date(x.at).getTime())+' लेट':''}`;
      }).join('\n')+(o.pend.length>5?`\n…और ${o.pend.length-5}`:'');
    } else txt+='\n(कोई pending काम नहीं)';
    const rows=[];
    if(dig) rows.push([{text:'💬 WhatsApp',url:'https://wa.me/'+dig}]);
    const r2=[]; if(o.pend.length) r2.push({text:'🎯 Focus में डालें',callback_data:('cf|'+c.id).slice(0,64)});
    r2.push({text:'➕ नया काम',callback_data:('ca|'+c.id).slice(0,64)}); rows.push(r2);
    out.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:txt,reply_markup:{inline_keyboard:rows}}});
  });
  if(start+10<total) out.push({method:'sendMessage',body:{chat_id:chat,text:`✅ ${start+1}–${Math.min(start+10,total)} का review पूरा`,reply_markup:{inline_keyboard:[[{text:'➡️ अगले 10',callback_data:'cr|'+(start+10)},{text:'🏁 बंद करो',callback_data:'crx'}]]}}});
  else out.push({method:'sendMessage',body:{chat_id:chat,text:'🏁 सारे contacts का review पूरा! अगली बार शुरू से।'}});
  return out;
}
/* 🎯 contact से focus में डालो — काम चुनो (2+) फिर owner */
function contactFocusStart(data, cid){
  const c=activeC(data.contacts).find(x=>x.id===cid);
  if(!c) return {text:'contact नहीं मिला'};
  const pend=topics(c).map((x,i)=>({...x,i})).filter(x=>!x.done);
  if(!pend.length) return {text:`✓ ${c.name||''} — कोई pending काम नहीं`};
  if(pend.length===1) return {text:`"${pend[0].t}"\nकिसके focus में डालें?`, reply_markup:{inline_keyboard:[_ownerBtns(cid,pend[0].i)]}};
  return {text:`${c.name||''} — कौन सा काम Focus में डालें?`,
    reply_markup:{inline_keyboard:[...pend.slice(0,8).map(x=>[{text:(CATS[x.cat]?CATS[x.cat].logo+' ':'')+x.t.slice(0,40),callback_data:('cft|'+cid+'|'+x.i).slice(0,64)}])]}};
}

/* ⏰ periodic छोटा menu (हर ~2 घंटे, रात नहीं) */
async function autoPushMenu(col, data, ownerChat){
  const calls=[]; if(!ownerChat) return calls;
  const istH=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date()));
  if(istH<8||istH>=22) return calls;
  const now=Date.now();
  const interval=(Number(data.settings.tgMenuHours)||2)*3600e3;
  if(now-Number(data.settings.tgLastMenu||0) < interval) return calls;
  await col.doc('_settings').set({tgLastMenu:now},{merge:true}); data.settings.tgLastMenu=now;
  const anyFocus=['v','d','k'].some(o=>focusItemsOf(data,o).length);
  if(!anyFocus) return calls;
  const m=focusMenuMsg(data);
  calls.push({method:'sendMessage',body:Object.assign({chat_id:ownerChat,parse_mode:'Markdown',text:m.text},m.reply_markup?{reply_markup:m.reply_markup}:{})});
  return calls;
}

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

/* 🎯 नाम-मिलान score: query के जितने शब्द contact के नाम में मिलें उतने अंक।
   exact substring = +2, phonetic = +1 → surname वाला सही contact जीतता है
   ("दिनेश रतकोडिया" → "Dinesh Ratkodia" (2) > "Dinesh Aluminiyam" (1))। */
function nameScore(c, words){
  const nmL=String(c.name||'').toLowerCase();
  const nkeys=nmL.split(/\s+/).map(phonKey).filter(Boolean);
  let score=0;
  for(const w of words){
    if(!w||w.length<2) continue;
    if(nmL.includes(w)){ score+=2; continue; }              // नाम में शब्द ज्यों-का-त्यों = पक्का
    const qk=phonKey(w); if(qk.length<2) continue;
    if(nkeys.some(nk=>nk===qk)){ score+=2; continue; }       // पूरी आवाज़-कुंजी बराबर = पक्का (नवीन==naveen)
    if(qk.length>=3 && nkeys.some(nk=>nk.length>=3&&(nk.startsWith(qk)||qk.startsWith(nk)))) score+=1; // सिर्फ़ शुरुआत मिली = कमज़ोर
  }
  return score;
}
// कम-से-कम 2 अंक चाहिए (एक पक्का मिलान) — "ऐड किए थे" जैसे शब्द गलती से नाम न बनें
function findByName(contacts,q){
  const words=String(q||'').toLowerCase().replace(/[?.,!।]/g,' ').split(/\s+/).filter(w=>w&&NAME_STOP.indexOf(w)<0);
  if(!words.length) return null;
  let best=null,bs=0;
  for(const c of contacts){ const s=nameScore(c,words); if(s>bs){ bs=s; best=c; } }
  return bs>=2?best:null;
}
const PERSON_SKIP=['के','का','की','काम','कौन','से','क्या','है','हैं','में','को','सब','वाले','list','tasks','work','आज','कल','परसों','सारे','बताओ','दिखाओ','बता','दिखा','क्या-क्या','कौन-कौन','मेरे','मेरा','मैंने','मैने','ऐड','add','जोड़े','जोड़ा','डाले','डाला','किए','किया','कर','थे','थी','था','रहे','हुए','कब','कहाँ','कहां','यह','वह','ये','वे']
  .concat(NAME_STOP).concat(Object.values(CATS).flatMap(c=>c.words));
function personIn(contacts,text){
  const words=String(text).toLowerCase().replace(/[?.,!।]/g,' ').split(/\s+/).filter(w=>w.length>=2&&PERSON_SKIP.indexOf(w)<0);
  if(!words.length) return null;
  let best=null,bs=0;
  for(const c of contacts){ const s=nameScore(c,words); if(s>bs){ bs=s; best=c; } }
  return bs>=2?{c:best,word:words.join(' ')}:null;
}
function catIn(text){
  const t=String(text).toLowerCase();
  for(const k in CATS) if(CATS[k].words.some(w=>t.includes(w))) return k;
  return null;
}

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
👤 "कैलाश के काम" — किसी का भी नाम (पूरा नाम/surname से सही मिलेगा)
🔍 "खोजो DVR" — कुछ भी ढूँढो
📊 "रिपोर्ट" — आज का पूरा हिसाब

➕ काम जोड़ना: "नवीन को 2 प्रिंटर मंगवाने बोलो"
🕘 समय के साथ: "कल सुबह 9 बजे मनोज को तार लाने भेजो"
✅ किसी list के नीचे ✅1 ✅2 बटन दबाओ = काम पूरा

🎯 *Focus Mode:*
 • "review" या "menu" — छोटा menu (किसका focus?)
 • "विक्रम का focus" — पूरा dashboard + timer + ✅
 • विस्तृत card (📞💬⏰✅) — dashboard में "🔍 विस्तृत"
 • "विक्रम focus शुरू" — काम चुनकर focus में डालो
 • "contacts" — सारे contacts 10-10 (काम + 🎯 + ➕)

⌨️ Commands: /today /kal /late /pending /zaroori
   /report /call /focus /market /computer /search DVR /help`;

const SLASH={'/today':'आज के काम','/aaj':'आज के काम','/kal':'कल के काम','/tomorrow':'कल के काम',
  '/late':'लेट काम','/pending':'बाकी काम','/report':'रिपोर्ट','/hisab':'रिपोर्ट','/call':'call किसको',
  '/priority':'ज़रूरी काम','/zaroori':'ज़रूरी काम','/market':'market के काम','/computer':'computer के काम',
  '/golden':'golden के काम','/jalipa':'jalipa के काम','/focus':'focus','/review':'review','/menu':'review','/contacts':'contacts','/help':'मदद','/start':'मदद'};

/* 🕘 हिंदी समय-समझ (token-आधारित) */
function parseWhen(textRaw, now){
  const toks=String(textRaw||'').split(/\s+/).filter(Boolean);
  let dayOff=0, period=null, hour=null, min=0, has=false;
  const keep=[];
  for(let i=0;i<toks.length;i++){
    const w=toks[i], wl=w.toLowerCase();
    if(wl==='आज'||wl==='today'){ dayOff=0; has=true; continue; }
    if(wl==='कल'||wl==='tomorrow'){ dayOff=1; has=true; continue; }
    if(wl==='परसों'){ dayOff=2; has=true; continue; }
    if(wl==='सुबह'||wl==='morning'){ period='am'; has=true; continue; }
    if(wl==='दोपहर'||wl==='afternoon'){ period='noon'; has=true; continue; }
    if(wl==='शाम'||wl==='evening'){ period='eve'; has=true; continue; }
    if(wl==='रात'||wl==='night'){ period='night'; has=true; continue; }
    if(wl==='बजे'){ has=true; continue; }
    let m=w.match(/^(\d{1,2})(?::(\d{2}))?बजे$/) || w.match(/^(\d{1,2}):(\d{2})$/);
    if(m){ hour=Number(m[1]); if(m[2])min=Number(m[2]); has=true; continue; }
    if(/^\d{1,2}$/.test(w) && toks[i+1] && toks[i+1].toLowerCase()==='बजे'){ hour=Number(w); has=true; continue; }
    keep.push(w);
  }
  if(!has) return null;
  if(hour===null){ hour = period==='noon'?14 : period==='eve'?18 : period==='night'?20 : 9; }
  else {
    if((period==='eve'||period==='night'||period==='noon') && hour<12) hour+=12;
    else if(period==='am' && hour===12) hour=0;
  }
  if(hour>23) hour=23; if(min>59) min=0;
  const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(now+dayOff*864e5)).forEach(x=>{p[x.type]=x.value;});
  const hh=String(hour).padStart(2,'0'), mm=String(min).padStart(2,'0');
  const iso=new Date(`${p.year}-${p.month}-${p.day}T${hh}:${mm}:00+05:30`).toISOString();
  return { at: iso, text: keep.join(' ').trim() };
}

/* ── मुख्य router — जवाब या {addTask} लौटाता है ── */
function answer(data,textRaw,now){
  const contacts=activeC(data.contacts);
  const text=String(textRaw||'').trim();
  const t=text.toLowerCase();
  const has=(...ws)=>ws.some(w=>t.includes(w));
  const today=istParts(now), tomorrow=istParts(now+864e5);
  const tasks=allTasks(data.contacts).filter(x=>!x.done);

  if(text[0]==='/'){
    const parts=text.split(/\s+/), cmd=parts[0].toLowerCase(), arg=parts.slice(1).join(' ');
    if(cmd==='/search') return answer(data,'खोजो '+arg,now);
    if(SLASH[cmd]) return answer(data,SLASH[cmd],now);
    return {text:HELP};
  }
  if(!text||has('help','मदद','हेल्प','namaste','नमस्ते','hi','hello','हैलो','हेलो')&&t.length<12) return {text:HELP};

  /* 📅 "कल/आज/परसों/N दिन पहले कौन से काम जोड़े/ऐड किए" — जोड़े गए काम की तारीख़-खोज
     (व्यक्ति-खोज से पहले, ताकि 'ऐड किए थे' गलती से नाम न बने; 'कल' = बीता हुआ कल) */
  if(/(जोड़े|जोड़ा|ऐड|\badd\b|डाले|डाला|बनाए|बनाया)/.test(t) && has('काम','कम','task')){
    let dayOff=0, lbl='आज';
    if(/परसों/.test(t)){ dayOff=-2; lbl='परसों'; }
    else if(/कल|yesterday|बीते/.test(t)){ dayOff=-1; lbl='कल'; }
    else if(/आज|today/.test(t)){ dayOff=0; lbl='आज'; }
    else { const m=t.match(/(\d+)\s*दिन/); if(m){ dayOff=-Number(m[1]); lbl=m[1]+' दिन पहले'; } }
    const day=istParts(now+dayOff*864e5);
    const added=allTasks(data.contacts).filter(x=>x.addedAt&&istParts(x.addedAt)===day);
    if(!added.length) return {text:`📅 ${lbl} (${day}) कोई नया काम जोड़ा हुआ रिकॉर्ड में नहीं मिला।\n(बहुत पुराने कामों पर तारीख़ दर्ज नहीं थी — उन पर यह खाली रहेगा।)`};
    return {text:`📅 ${lbl} जोड़े गए काम (${added.length}):\n\n`+added.slice(0,20).map((x,i)=>`${i+1}. ${CATS[x.cat]?CATS[x.cat].logo+' ':''}${x.t}\n   👤 ${x.name}`).join('\n')+(added.length>20?`\n…और ${added.length-20}`:'')};
  }

  const when=parseWhen(text,now);
  const forMatch=when?when.text:text;
  const addM=forMatch.match(/^(.{2,25}?)\s*(?:को|ko)\s+(.+)$/i);
  if(addM && /(बोल|बता|कह|मंगवा|मँगवा|खरीद|भेज|लाना|लाने|देना|दिलवा|करवा|बनवा|पूछ|याद|दे दो|दो|करना|कर दे)/.test(addM[2])){
    const p=findByName(contacts,addM[1]);
    if(p){
      const taskT=addM[2].trim();
      const whenLbl=when?`\n🕘 समय: ${istParts(when.at)} ${istHM(when.at)} — reminder लगेगा`:'';
      return {addTask:{cid:p.id,text:taskT,pname:p.name,at:when?when.at:null},
        text:`✅ काम जुड़ गया!\n👤 ${p.name}\n📝 ${taskT}${whenLbl}\n\n(app में भी अभी दिखेगा)`};
    }
    return {text:`🤔 "${addM[1].trim()}" नाम का contact नहीं मिला।\nनाम थोड़ा और साफ़ लिखें — जैसे contact में जो नाम है।`};
  }

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

  // 🎯 Review menu — छोटा (सिर्फ़ बटन)
  if(has('review','रिव्यू','रिव्यु','menu','मेनू','मेन्यू')) return focusMenuMsg(data);
  // 📞 Contact Review — बटन से शुरू
  if(has('contact','contacts','संपर्क','कांटेक्ट','कॉन्टैक्ट'))
    return {text:'📞 *Contact Review* — 10-10 करके सारे contacts (जहाँ छोड़ा था वहीं से)।', reply_markup:{inline_keyboard:[[{text:'📇 शुरू करो',callback_data:'crs'}]]}};

  if(has('focus','फोकस','फ़ोकस','फॉक्स')){
    const own=focusOwnerIn(t);
    // 🎯 Start Focus — 50 तक काम श्रेणी-क्रम में दिखाओ, कोई भी चुनकर focus में डालो
    if(/शुरू|start|चुन|जोड़|\badd\b|डाल/.test(t)){
      const pend=sortByCat(allTasks(data.contacts).filter(x=>!x.done)).slice(0,50);
      if(!pend.length) return {text:'✓ कोई बाकी काम नहीं — focus में डालने को कुछ नहीं।'};
      let out=`🎯 *Focus में नए काम जोड़ें* — ${OWNERS[own||'v']}\n(ये अभी focus में नहीं हैं — जोड़ने के लिए 🎯 नंबर दबाएँ)\nपहले से focus में जो है वो देखने: "${OWN_SHORT[own||'v']} का focus"\n`;
      let lastCat=null;
      pend.forEach((x,i)=>{
        const ck=x.cat||'';
        if(ck!==lastCat){ lastCat=ck; const ci=CATS[ck]; out+=`\n*${ci?ci.logo+' '+ci.label:'⬜ बिना श्रेणी'}*\n`; }
        out+=`${i+1}. ${x.pri==='high'?'🔴 ':''}${x.t} (${x.name})\n`;
      });
      const total=allTasks(data.contacts).filter(x=>!x.done).length;
      if(total>50) out+=`\n…कुल ${total} बाकी — ऊपर के 50 दिखाए (बाक़ी App में)।`;
      const btns=pend.map((x,i)=>({text:'🎯'+(i+1),callback_data:('f|'+(own||'v')+'|'+x.cid+'|'+x.ti).slice(0,64)}));
      const rows=[]; for(let i=0;i<btns.length;i+=5) rows.push(btns.slice(i,i+5));
      rows.push([{text:'📋 '+OWN_SHORT[own||'v']+' का focus',callback_data:'fd|'+(own||'v')}]);
      return {text:out.slice(0,4050), reply_markup:{inline_keyboard:rows}};
    }
    // किसी एक owner का dashboard
    if(own) return focusDash(data,own,now);
    // सबका हाल + drill-in buttons
    let out='🎯 *Focus — सबका हाल*\n\n';
    ['v','d','k'].forEach(o=>{ const l=focusItemsOf(data,o); const late=l.filter(f=>(f.until||0)<now).length; out+=`${OWNERS[o]}: ${l.length} focus${late?` · 🔴 ${late} लेट`:''}\n`; });
    out+='\nकिसका देखना है? नीचे दबाएँ (या "विक्रम का focus" लिखें)।\nनया focus: "विक्रम focus शुरू"।';
    return {text:out, reply_markup:{inline_keyboard:[[
      {text:'🟣 विक्रम',callback_data:'fd|v'},{text:'🔷 दिनेश',callback_data:'fd|d'},{text:'🟢 कैलाश',callback_data:'fd|k'}
    ]]}};
  }

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

  if(who&&(has('काम','कम','tasks','work','kaam')||qCat)){
    const nk=phonKey(who.c.name||'');
    const asg=tasks.filter(x=>{ if(!x.assignTo) return false; const ak=phonKey(x.assignTo); return ak.startsWith(nk.slice(0,4))||String(x.assignTo).toLowerCase().includes((who.c.name||'').toLowerCase().split(/\s+/)[0]); });
    const card=tasks.filter(x=>x.cid===who.c.id);
    const f=x=>!qCat||x.cat===qCat;
    const a2=asg.filter(f), c2=card.filter(x=>f(x)&&!a2.some(y=>y.cid===x.cid&&y.ti===x.ti));
    const cl=qCat?CATS[qCat].logo+' '+CATS[qCat].label+' ':'';
    if(!a2.length&&!c2.length) return {text:`👤 ${who.c.name} — ${cl}कोई बाकी काम नहीं ✓`};
    let out=`👤 ${who.c.name} के ${cl}काम:\n`;
    if(a2.length) out+='\n🤝 सौंपे गए ('+a2.length+'):\n'+a2.slice(0,10).map((x,i)=>taskLine(x,now,i+1)).join('\n');
    if(c2.length) out+='\n\n📇 इनके कार्ड पर ('+c2.length+'):\n'+c2.slice(0,10).map((x,i)=>taskLine(x,now,i+1)).join('\n');
    const m=listMsg('',[...a2,...c2],now,true);
    return {text:out,reply_markup:m.reply_markup};
  }

  if(qCat) return listMsg(`${CATS[qCat].logo} ${CATS[qCat].label} के काम (${tasks.filter(x=>x.cat===qCat).length}):`,tasks.filter(x=>x.cat===qCat),now,true);

  if(has('लेट','late','देरी','overdue')){
    const late=tasks.filter(x=>x.at&&new Date(x.at).getTime()<now);
    return listMsg(`🔴 लेट काम (${late.length}):`,late,now,true);
  }
  if(has('ज़रूरी','जरूरी','priority','urgent','अर्जेंट'))
    return listMsg('🔴 ज़रूरी काम:',tasks.filter(x=>x.pri==='high'),now,true);
  if(has('call','कॉल','फोन','phone')){
    const due=activeC(data.contacts).filter(c=>c.nextCallAt&&new Date(c.nextCallAt).getTime()<=now&&topics(c).some(x=>!x.done));
    if(!due.length) return {text:'📞 अभी कोई call due नहीं ✓'};
    return {text:`📞 Call करनी है (${due.length}):\n`+due.slice(0,12).map((c,i)=>`${i+1}. ${c.name}${c.phone?' — '+c.phone:''}`).join('\n')};
  }
  if(has('आज','today','aaj')){
    const td=tasks.filter(x=>x.at&&istParts(x.at)===today);
    const late=tasks.filter(x=>x.at&&new Date(x.at).getTime()<now&&istParts(x.at)!==today);
    const m=listMsg(`📅 आज के काम (${td.length}):`,td,now,true);
    if(late.length) m.text+=`\n\n⚠️ साथ में ${late.length} पुराने लेट काम भी हैं — "लेट काम" लिखकर देखें`;
    return m;
  }
  if(has('कल','tomorrow'))
    return listMsg(`📅 कल के काम:`,tasks.filter(x=>x.at&&istParts(x.at)===tomorrow),now,true);
  if(has('बाकी','pending','सारे','सब काम','कितने काम'))
    return listMsg(`📋 कुल बाकी काम (${tasks.length}):`,tasks,now,true);

  return null;
}

/* ── Claude fallback (grounded, no-guess) — key हो तभी ── */
async function aiFallback(settings, contacts, q, now){
  const key=settings&&settings.aiKey;
  if(!key) return null;
  const tk=allTasks(contacts).filter(x=>!x.done).slice(0,60);
  const ctx=tk.map(t=>`- ${t.name}: ${t.t}${t.assignTo?' (→'+t.assignTo+')':''}${t.at?' [समय '+istParts(t.at)+']':''}`).join('\n');
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,
        messages:[{role:'user',content:`तुम विक्रम भाई (Vande Bharat Enterprises) के business सहायक हो। नीचे उनके इस समय के असली बाकी काम हैं। सिर्फ़ इसी data से हिंदी में छोटा, सीधा जवाब दो — अनुमान मत लगाओ; data में न हो तो साफ़ कहो "मेरे रिकॉर्ड में नहीं है"।\n\nआज: ${istParts(now)}\n\nकाम:\n${ctx}\n\nसवाल: ${q}`}]})
    });
    const j=await r.json();
    const txt=j&&j.content&&j.content[0]&&j.content[0].text;
    return txt?'🤖 '+txt:null;
  }catch(e){ return null; }
}

/* ── DB helpers (admin firestore col) ── */
async function applyDone(col, cid, ti){
  const ref=col.doc(cid); const dc=await ref.get();
  if(!dc.exists) return {ok:false};
  const c=dc.data(); const tps=topics(c); const i=Number(ti);
  if(!tps[i]||tps[i].done) return {ok:false, already:!!(tps[i]&&tps[i].done), name:c.name||''};
  tps[i].done=true; tps[i].doneAt=new Date().toISOString();
  const hist=Array.isArray(c.hist)?c.hist:[]; hist.push({a:'done',txt:(tps[i].t||'').slice(0,60),at:new Date().toISOString()});
  await ref.set({topics:tps,note:tps.filter(x=>!x.done).map(x=>x.t).join(' · '),hist:hist.slice(-40)},{merge:true});
  return {ok:true, task:tps[i].t||'', name:c.name||''};
}
async function applyAdd(col, cid, text, at){
  const ref=col.doc(cid); const dc=await ref.get();
  if(!dc.exists) return {ok:false};
  const c=dc.data(); const tps=topics(c);
  const nt={t:text,done:false,doneAt:null,addedAt:new Date().toISOString(),src:'tg'};
  if(at) nt.at=at;
  tps.push(nt);
  const hist=Array.isArray(c.hist)?c.hist:[]; hist.push({a:'add',txt:text.slice(0,60),at:new Date().toISOString()});
  await ref.set({topics:tps,note:tps.filter(x=>!x.done).map(x=>x.t).join(' · '),hist:hist.slice(-40)},{merge:true});
  return {ok:true};
}

/* 🎯 काम को focus में डालो (own, 15 min) — app के startFocus जैसा */
async function applyFocusAdd(col, own, cid, ti){
  const c=await col.doc(cid).get(); if(!c.exists) return {ok:false};
  const cd=c.data(); const tp=topics(cd); const t=tp[Number(ti)]; if(!t||t.done) return {ok:false};
  const fdoc=await col.doc('_focus').get();
  const items=(fdoc.exists&&Array.isArray((fdoc.data()||{}).items))?fdoc.data().items:[];
  if(items.some(f=>f.id===cid&&f.i===Number(ti)&&(f.own||'v')===(own||'v'))) return {ok:true, already:true, task:t.t};
  const now=Date.now();
  items.push({key:cid+'_'+ti+'_'+now, id:cid, i:Number(ti), t:t.t, own:own||'v', start:now, until:now+15*60000, mins:15, src:'tg'});
  await col.doc('_focus').set({id:'_focus', items},{merge:true});
  return {ok:true, task:t.t};
}
/* 🎯 focus का काम पूरा — task done + focus से हटाओ */
async function applyFocusComplete(col, key){
  const fdoc=await col.doc('_focus').get();
  const items=(fdoc.exists&&Array.isArray((fdoc.data()||{}).items))?fdoc.data().items:[];
  const it=items.find(f=>f.key===key);
  let dn={ok:false};
  if(it) dn=await applyDone(col, it.id, it.i);
  await col.doc('_focus').set({id:'_focus', items:items.filter(f=>f.key!==key)},{merge:true});
  return {ok:true, task:it?it.t:'', name:dn.name||'', done:dn.ok};
}
/* 🎯 focus का समय आगे बढ़ाओ (+N min) — app के topic.at भी align */
async function applyFocusExtend(col, key, addMin){
  const fdoc=await col.doc('_focus').get();
  const items=(fdoc.exists&&Array.isArray((fdoc.data()||{}).items))?fdoc.data().items:[];
  const it=items.find(f=>f.key===key); if(!it) return {ok:false};
  const now=Date.now();
  it.start=it.start||now; it.until=now+addMin*60000; it.mins=addMin; it.nudgedAt=now;
  await col.doc('_focus').set({id:'_focus', items},{merge:true});
  try{
    const c=await col.doc(it.id).get();
    if(c.exists){ const cd=c.data(); const tp=topics(cd);
      if(tp[it.i]&&!tp[it.i].done){ tp[it.i]={...tp[it.i], at:new Date(it.until).toISOString()}; await col.doc(it.id).set({topics:tp},{merge:true}); }
    }
  }catch(e){}
  return {ok:true, task:it.t, until:it.until, own:it.own||'v'};
}
/* 🔕 focus से हटाओ (पूरा किए बिना) */
async function applyFocusRemove(col, key){
  const fdoc=await col.doc('_focus').get();
  const items=(fdoc.exists&&Array.isArray((fdoc.data()||{}).items))?fdoc.data().items:[];
  const it=items.find(f=>f.key===key);
  await col.doc('_focus').set({id:'_focus', items:items.filter(f=>f.key!==key)},{merge:true});
  return {ok:true, task:it?it.t:''};
}
/* 🔔 चल रहे focus काम पर बार-बार नज़र — एक-एक करके, ~20 min अंतराल, रात नहीं।
   overdue focus काम चुनकर "क्या स्थिति? कितनी देर और?" पूछे — जवाब से timer बढ़े। */
async function autoPushNudge(col, data, ownerChat){
  const calls=[]; if(!ownerChat) return calls;
  const istH=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date()));
  if(istH<8||istH>=22) return calls;                       // रात disturb नहीं
  const now=Date.now();
  if(now-Number(data.settings.tgLastNudge||0) < 20*60000) return calls;  // ~20 min gap
  const items=(data.focus&&Array.isArray(data.focus.items)?data.focus.items:[]);
  const byId={}; activeC(data.contacts).forEach(c=>{ byId[c.id]=c; });
  const cand=[];
  items.forEach(f=>{
    const c=byId[f.id]; if(!c) return; const tt=topics(c)[f.i]; if(!tt||tt.done) return;
    if(!f.until || f.until>now) return;                    // सिर्फ़ जिनका समय बीत चुका
    if(f.nudgedAt && now-f.nudgedAt < 40*60000) return;    // इसी काम को 40 min में दोबारा नहीं
    cand.push({...f, cname:c.name||''});
  });
  if(!cand.length) return calls;
  cand.sort((a,b)=>(a.until||0)-(b.until||0));              // सबसे पुराना/लेट पहले
  const f=cand[0];
  await col.doc('_focus').set({id:'_focus', items:items.map(x=>x.key===f.key?{...x,nudgedAt:now}:x)},{merge:true});
  await col.doc('_settings').set({tgLastNudge:now, tgLastNudgeKey:f.key},{merge:true});
  data.settings.tgLastNudge=now; data.settings.tgLastNudgeKey=f.key;
  const nm=OWNERS[f.own||'v'], run=fmtDur(now-(f.start||now)), late=fmtDur(now-f.until);
  calls.push({method:'sendMessage',body:{chat_id:ownerChat, parse_mode:'Markdown', disable_web_page_preview:true,
    text:`🎯 *${nm} का यह काम focus में चल रहा है:*\n📝 ${f.t}${f.cname?' ('+f.cname+')':''}\n⏱ ${run} से चालू · 🔴 ${late} लेट\n\nविक्रम जी, इसकी क्या स्थिति है? कितनी देर और लगेगी? नीचे दबाएँ (या "15 मिनट" लिखें) — उतने मिनट का focus आगे बढ़ जाएगा (app में भी):`,
    reply_markup:{inline_keyboard:[
      [{text:'⏱ +10',callback_data:('xt|'+f.key+'|10').slice(0,64)},{text:'⏱ +15',callback_data:('xt|'+f.key+'|15').slice(0,64)},{text:'⏱ +30',callback_data:('xt|'+f.key+'|30').slice(0,64)},{text:'⏱ +60',callback_data:('xt|'+f.key+'|60').slice(0,64)}],
      [{text:'✅ हो गया',callback_data:('x|'+f.key).slice(0,64)},{text:'🔕 focus से हटाओ',callback_data:('rf|'+f.key).slice(0,64)}]
    ]}
  }});
  return calls;
}

/* 🎯 app में focus चालू हुआ → Telegram पर बताओ (timer के साथ) */
async function autoPushFocus(col, data, ownerChat){
  const calls=[]; if(!ownerChat) return calls;
  const items=(data.focus&&Array.isArray(data.focus.items)?data.focus.items:[]);
  const last=Number(data.settings.tgLastFocusScan||0), now=Date.now();
  if(last===0){ try{ await col.doc('_settings').set({tgLastFocusScan:now},{merge:true}); }catch(e){} data.settings.tgLastFocusScan=now; return calls; }
  const fresh=items.filter(f=>f.start&&f.start>last && now-f.start<6*3600e3 && f.src!=='tg');
  try{ await col.doc('_settings').set({tgLastFocusScan:now},{merge:true}); }catch(e){} data.settings.tgLastFocusScan=now;
  fresh.forEach(f=>{
    const nm=OWNERS[f.own||'v'], dl=f.until?istHM(f.until):'';
    calls.push({method:'sendMessage',body:{chat_id:ownerChat,
      text:`🎯 *Focus चालू* — ${nm}\n📝 ${f.t}\n⏱ timer शुरू${dl?` · deadline ${dl}`:''}\n\n"${OWN_SHORT[f.own||'v']} का focus" लिखकर पूरा dashboard + ✅ देखें।`,
      parse_mode:'Markdown', disable_web_page_preview:true}});
  });
  return calls;
}

/* एक update → Telegram API calls की सूची। data ताज़ा दो; dirty true हो तो caller reload करे। */
async function handleUpdate(col, data, update, ownerChat){
  const calls=[]; let dirty=false, newOwner=ownerChat;
  const now=Date.now();

  if(update.callback_query){
    const cq=update.callback_query;
    const chat=cq.message&&cq.message.chat&&String(cq.message.chat.id);
    if(ownerChat&&chat!==ownerChat){ calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'अनुमति नहीं'}}); return {calls,dirty,ownerChat:newOwner}; }
    const cd=cq.data||'';
    let m;
    if((m=cd.match(/^d\|(.+)\|(\d+)$/))){
      const r=await applyDone(col,m[1],m[2]);
      if(r.ok){ dirty=true; calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'✅ काम पूरा!'}});
        calls.push({method:'sendMessage',body:{chat_id:chat,text:`✅ पूरा हुआ: ${(r.task||'').slice(0,60)}\n👤 ${r.name||''}`}}); }
      else calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:r.already?'यह पहले ही पूरा है':'नहीं मिला'}});
    } else if((m=cd.match(/^fm\|([vdk])$/))){
      // 🎯 staff चुना → Short / विस्तृत विकल्प
      const snap=await col.get(); const d2=collectAll(snap);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🎯'}});
      const ch=focusChoiceMsg(d2,m[1]);
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,text:ch.text},ch.reply_markup?{reply_markup:ch.reply_markup}:{})});
    } else if((m=cd.match(/^fdt\|([vdk])\|(\d+)$/))){
      // 🔍 विस्तृत — हर काम का card (10-10)
      const snap=await col.get(); const d2=collectAll(snap);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🔍'}});
      focusDetailCards(d2,m[1],Number(m[2]),chat).forEach(c=>calls.push(c));
    } else if(cd==='crs' || (m=cd.match(/^cr\|(\d+)$/))){
      // 📞 Contact Review — resume (crs) या batch (cr|N)
      const snap=await col.get(); const d2=collectAll(snap);
      let start = cd==='crs' ? Number((d2.settings||{}).tgReviewIdx||0) : Number(m[1]);
      const total=contactReviewList(d2).length; if(start>=total) start=0;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'📇'}});
      contactReviewCards(d2,start,chat).forEach(c=>calls.push(c));
      await col.doc('_settings').set({tgReviewIdx:start+10},{merge:true});
    } else if(cd==='crx'){
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🏁'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:'🏁 Contact Review बंद — अगली बार यहीं से।'}});
    } else if((m=cd.match(/^cf\|(.+)$/))){
      // 🎯 contact से focus में डालो — काम/owner पूछो
      const snap=await col.get(); const d2=collectAll(snap);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🎯'}});
      const ask=contactFocusStart(d2,m[1]);
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,text:ask.text},ask.reply_markup?{reply_markup:ask.reply_markup}:{})});
    } else if((m=cd.match(/^cft\|(.+)\|(\d+)$/))){
      // काम चुना → owner पूछो
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'👤'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:'किसके focus में डालें?',reply_markup:{inline_keyboard:[_ownerBtns(m[1],m[2])]}}});
    } else if((m=cd.match(/^cfo\|(.+)\|(\d+)\|([vdk])$/))){
      // owner चुना → focus में डालो
      const r=await applyFocusAdd(col,m[3],m[1],m[2]); dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:r.ok?'🎯 डाला':'नहीं'}});
      if(r.ok) calls.push({method:'sendMessage',body:{chat_id:chat,text:`🎯 ${OWN_SHORT[m[3]]} के focus में डाला${r.already?' (पहले से था)':''}: ${(r.task||'').slice(0,50)}\n⏱ 15 min timer चालू।`}});
    } else if((m=cd.match(/^ca\|(.+)$/))){
      // ➕ नया काम — अगला text इसी contact के लिए
      const c=activeC(collectAll(await col.get()).contacts).find(x=>x.id===m[1]);
      await col.doc('_settings').set({tgAddFor:m[1], tgAddForAt:Date.now()},{merge:true});
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'✍️'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:`✍️ *${c?c.name:'इस व्यक्ति'}* के लिए नया काम लिखकर भेजो:`,parse_mode:'Markdown'}});
    } else if((m=cd.match(/^fd\|([vdk])$/))){
      // 🎯 focus dashboard (ताज़ा data चाहिए)
      const snap=await col.get(); const d2=collectAll(snap);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🎯'}});
      const dash=focusDash(d2,m[1],Date.now());
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:dash.text},dash.reply_markup?{reply_markup:dash.reply_markup}:{})});
    } else if((m=cd.match(/^f\|([vdk])\|(.+)\|(\d+)$/))){
      // 🎯 focus में डालो
      const r=await applyFocusAdd(col,m[1],m[2],m[3]);
      dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:r.ok?(r.already?'पहले से focus में':'🎯 focus में डाला'):'नहीं जुड़ा'}});
      if(r.ok&&!r.already) calls.push({method:'sendMessage',body:{chat_id:chat,text:`🎯 Focus में जोड़ा (${OWN_SHORT[m[1]]}): ${(r.task||'').slice(0,60)}\n⏱ 15 min timer चालू।`}});
    } else if((m=cd.match(/^xt\|(.+)\|(\d+)$/))){
      // ⏱ focus timer +N min
      const r=await applyFocusExtend(col,m[1],Number(m[2]));
      dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'⏱ +'+m[2]+' min'}});
      if(r.ok) calls.push({method:'sendMessage',body:{chat_id:chat,text:`⏱ +${m[2]} min — अब ${istHM(r.until)} बजे तक focus (${OWN_SHORT[r.own]})।\n📝 ${(r.task||'').slice(0,60)}\n(app में भी आगे बढ़ा दिया)`}});
    } else if((m=cd.match(/^rf\|(.+)$/))){
      // 🔕 focus से हटाओ (पूरा किए बिना)
      const r=await applyFocusRemove(col,m[1]);
      dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🔕 हटाया'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:`🔕 focus से हटा दिया: ${(r.task||'').slice(0,60)}`}});
    } else if((m=cd.match(/^x\|(.+)$/))){
      // 🎯 focus का काम पूरा
      const r=await applyFocusComplete(col,m[1]);
      dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'✅ पूरा!'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:`✅ Focus काम पूरा: ${(r.task||'').slice(0,60)}\n🎯 focus से हटा दिया — अगला काम उठाएँ!`}});
    } else calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'ok'}});
    return {calls,dirty,ownerChat:newOwner};
  }

  const msg=update.message||update.edited_message;
  if(!msg||!msg.chat) return {calls,dirty,ownerChat:newOwner};
  const chat=String(msg.chat.id);
  if(!newOwner){ newOwner=chat; try{ await col.doc('_settings').set({tgChatId:chat},{merge:true}); }catch(e){} data.settings.tgChatId=chat; }
  if(chat!==newOwner){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'🙏 यह विक्रम जी का निजी bot है।'}}); return {calls,dirty,ownerChat:newOwner}; }
  if(msg.voice||msg.audio){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'🎙️ आवाज़ अभी नहीं समझता — keyboard के 🎤 (बोलकर text) से भेजें।'}}); return {calls,dirty,ownerChat:newOwner}; }
  const textIn=msg.text||msg.caption||'';
  if(!textIn) return {calls,dirty,ownerChat:newOwner};

  // ✍️ Contact Review का "➕ नया काम" — अगला text उसी contact के लिए काम बन जाए
  if(data.settings.tgAddFor && (Date.now()-Number(data.settings.tgAddForAt||0) < 10*60000) && textIn[0]!=='/'){
    const cid=data.settings.tgAddFor; const when=parseWhen(textIn,now);
    const r=await applyAdd(col, cid, when?when.text:textIn.trim(), when?when.at:null);
    await col.doc('_settings').set({tgAddFor:'', tgAddForAt:0},{merge:true}); data.settings.tgAddFor='';
    if(r.ok){ dirty=true; const c=activeC(data.contacts).find(x=>x.id===cid);
      calls.push({method:'sendMessage',body:{chat_id:chat,text:`✅ काम जुड़ गया — ${c?c.name:''}\n📝 ${(when?when.text:textIn.trim()).slice(0,60)}${when?`\n🕘 ${istParts(when.at)} ${istHM(when.at)}`:''}`}}); }
    else calls.push({method:'sendMessage',body:{chat_id:chat,text:'⚠️ जोड़ नहीं पाया — contact नहीं मिला'}});
    return {calls,dirty,ownerChat:newOwner};
  }

  // ⏱ nudge का जवाब — "15 मिनट / 10 min" → आख़िरी पूछे काम का focus उतना बढ़ाओ
  const durM=textIn.trim().match(/^(?:अभी\s*)?(\d{1,3})\s*(?:min|mins|minute|minutes|मिनट|मिन|मि|m)\s*(?:और|and|बाद|more)?\s*$/i);
  if(durM && data.settings.tgLastNudgeKey && (Date.now()-Number(data.settings.tgLastNudge||0) < 3*3600e3)){
    const r=await applyFocusExtend(col, data.settings.tgLastNudgeKey, Number(durM[1]));
    if(r.ok){ dirty=true; calls.push({method:'sendMessage',body:{chat_id:chat,text:`⏱ +${durM[1]} min — अब ${istHM(r.until)} बजे तक focus (${OWN_SHORT[r.own]})।\n📝 ${(r.task||'').slice(0,60)}\n(app में भी आगे बढ़ा दिया)`}}); return {calls,dirty,ownerChat:newOwner}; }
  }

  let ans=answer(data,textIn,now);
  if(ans&&ans.addTask){ const r=await applyAdd(col,ans.addTask.cid,ans.addTask.text,ans.addTask.at); if(r.ok) dirty=true; else ans={text:'⚠️ जोड़ नहीं पाया — app से जोड़ लें'}; }
  if(!ans){ const a=await aiFallback(data.settings,data.contacts,textIn,now); if(a) ans={text:a}; }
  if(!ans) ans={text:'🤔 समझ नहीं आया। "मदद" लिखें — सब तरीक़े दिखा दूँगा।'};
  const body={chat_id:chat,text:(ans.text||'').slice(0,3900)};
  if(ans.reply_markup) body.reply_markup=ans.reply_markup;
  calls.push({method:'sendMessage',body});
  return {calls,dirty,ownerChat:newOwner};
}

/* ⚡ app से जुड़े नए काम → push (poller/scheduled के लिए)। calls लौटाता है। */
async function autoPushNew(col, data, ownerChat){
  const calls=[];
  if(!ownerChat) return calls;
  const lastScan=Number(data.settings.tgLastNewScan||0);
  const nowS=Date.now();
  if(lastScan===0){ try{ await col.doc('_settings').set({tgLastNewScan:nowS},{merge:true}); }catch(e){} data.settings.tgLastNewScan=nowS; return calls; }
  const fresh=[];
  allTasks(data.contacts).forEach(x=>{
    if(x.done||x.src==='tg'||!x.addedAt) return;
    const at=new Date(x.addedAt).getTime();
    if(isNaN(at)||at<=lastScan||nowS-at>6*3600e3) return;
    fresh.push(x);
  });
  try{ await col.doc('_settings').set({tgLastNewScan:nowS},{merge:true}); }catch(e){} data.settings.tgLastNewScan=nowS;
  if(fresh.length){
    const text='🆕 *'+fresh.length+' नया काम जुड़ा*\n\n'+fresh.slice(0,12).map((x,i)=>
      `${i+1}. ${CATS[x.cat]?CATS[x.cat].logo+' ':''}${x.t}\n   👤 ${x.name}${x.assignTo?' → '+x.assignTo:''}`
    ).join('\n')+(fresh.length>12?`\n…और ${fresh.length-12}`:'')+'\n\n👉 '+APP_LINK;
    calls.push({method:'sendMessage',body:{chat_id:ownerChat,text,parse_mode:'Markdown',disable_web_page_preview:true}});
  }
  return calls;
}

module.exports={
  APP_LINK, CATS, HELP, SLASH, OWNERS,
  phonKey, findByName, personIn, catIn, istParts, istHM, topics,
  collectAll, activeC, allTasks, answer, parseWhen, listMsg,
  focusOwnerIn, focusItemsOf, focusDash, focusMenuMsg, focusChoiceMsg, focusDetailCards,
  contactReviewList, contactReviewCards, contactFocusStart,
  applyDone, applyAdd, applyFocusAdd, applyFocusComplete, applyFocusExtend, applyFocusRemove,
  handleUpdate, autoPushNew, autoPushFocus, autoPushNudge, autoPushMenu
};
