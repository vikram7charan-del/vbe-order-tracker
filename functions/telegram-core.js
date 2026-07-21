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
    if(c){ const tp=topics(c); const tt=tp[f.i]; if(tt){ if(tt.done||tt.rvw) done=true; cat=tt.cat||''; pri=tt.pri||''; } }
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
/* 💬 सुंदर WhatsApp message — नमस्ते + सारे काम + धन्यवाद */
function waMessage(name, taskTexts){
  let m='नमस्ते '+(name||'')+'! 🙏\n\nआपके यहाँ ये काम बाक़ी हैं — कृपया करवा दीजिए:\n\n';
  m+=(taskTexts||[]).slice(0,10).map((t,i)=>(i+1)+'. '+String(t).slice(0,90)).join('\n');
  m+='\n\nआपके सहयोग और तत्परता के लिए हमेशा आभारी हैं। 🙏\nजय श्री कृष्ण 🙏\n— विक्रम, Vande Bharat Enterprises';
  return m;
}
function waUrl(dig, name, taskTexts){ return 'https://wa.me/'+dig+((taskTexts&&taskTexts.length)?'?text='+encodeURIComponent(waMessage(name,taskTexts)):''); }
function telLink(phone, dig){ return dig?`📞 [${phone} — दबाकर कॉल करें](tel:+${dig})`:('📱 '+phone); }
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
    if(f.cphone) txt+=telLink(f.cphone,dig)+`\n`;
    txt+=`⏱ ${fmtDur(now-(f.start||now))} से चालू · ${late?'🔴 '+fmtDur(now-f.until)+' लेट':'⏳ '+fmtDur(f.until-now)+' बाकी'}\n🎯 ${OWN_SHORT[own]}${CATS[f.cat]?' · '+CATS[f.cat].logo+CATS[f.cat].label:''}`;
    const rows=[];
    if(dig) rows.push([{text:'💬 WhatsApp पर भेजो',url:waUrl(dig,f.cname,[f.t])}]);
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
    const c=o.c, dig=_phoneDigits(c.phone||c.waPhone), ph=c.phone||c.waPhone||'';
    let txt=`👤 *${c.name||'?'}*\n`;
    if(ph) txt+=telLink(ph,dig)+`\n`;
    if(o.pend.length){
      txt+=`\nपेंडिंग काम (${o.pend.length}):\n`+o.pend.slice(0,5).map(x=>{
        const late=x.at&&new Date(x.at).getTime()<now;
        return `• ${CATS[x.cat]?CATS[x.cat].logo+' ':''}${x.t}${late?' — 🔴 '+fmtDur(now-new Date(x.at).getTime())+' लेट':''}`;
      }).join('\n')+(o.pend.length>5?`\n…और ${o.pend.length-5}`:'');
    } else txt+='\n(कोई pending काम नहीं)';
    const rows=[];
    if(dig) rows.push([{text:'💬 सारे काम WhatsApp पर भेजो',url:waUrl(dig,c.name,o.pend.map(x=>x.t))}]);
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
    if(d.id.indexOf('mem_')===0 || d.id[0]==='_' || d.id.indexOf('ev_')===0) return;
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

👥 *टीम (staff Telegram पर):*
 • "link" — staff को QR से जोड़ो (उनके काम उन तक अपने-आप)
 • "टीम" — किसने कितने किए, कौन अटका (scoreboard)
 • "unlink मनोज" — staff को हटाओ

⌨️ Commands: /today /kal /late /pending /zaroori
   /report /call /focus /link /team /market /search DVR /help`;

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

/* ══════════════════════════════════════════════════════════
   🧠 GEMINI BRAIN — bot का दिमाग़ (key Firestore _settings.gemKey से,
   repo में नहीं)। नई AQ. + पुरानी AIza दोनों format (header auth)।
   Spark plan: कोई Cloud Function नहीं — bot सीधे Gemini से बात करता है।
   ══════════════════════════════════════════════════════════ */
// gemini-2.5-flash — app में यही proven चलता है (owner की free key पर 2.0 पर 404 आता था)
const GEM_URL='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
async function _gemFetch(key, body, ms){
  const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(), ms||30000);
  try{
    const r=await fetch(GEM_URL,{method:'POST',signal:ctl.signal,
      headers:{'content-type':'application/json','x-goog-api-key':key}, body:JSON.stringify(body)});
    const j=await r.json();
    if(j&&j.error) return {err:(j.error.message||'gemini error')};
    const t=j&&j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts&&j.candidates[0].content.parts.map(p=>p.text||'').join('');
    return {text:(t&&t.trim())||''};
  }catch(e){ return {err:e.name==='AbortError'?'timeout':(e.message||'net')}; }
  finally{ clearTimeout(to); }
}
/* {text} या {err} लौटाते हैं — असली Gemini कारण दिखाने के लिए (डीबग आसान) */
async function geminiAsk(settings, prompt, wantJson){
  const key=settings&&settings.gemKey; if(!key) return {err:'no-key'};
  return await _gemFetch(key, {contents:[{parts:[{text:prompt}]}],
    generationConfig:Object.assign({maxOutputTokens:1300,temperature:0.45}, wantJson?{responseMimeType:'application/json'}:{})});
}
/* 🎤 voice note — OGG bytes (base64) सीधे Gemini को (audio native, कोई STT नहीं) */
async function geminiAudio(settings, b64, mime, prompt){
  const key=settings&&settings.gemKey; if(!key) return {err:'no-key'};
  return await _gemFetch(key, {contents:[{parts:[{text:prompt},{inlineData:{mimeType:mime||'audio/ogg',data:b64}}]}],
    generationConfig:{maxOutputTokens:900,temperature:0.3,responseMimeType:'application/json'}}, 45000);
}
/* Gemini error → छोटा हिंदी संकेत (owner को समझने लायक) */
function gemErrHindi(err){
  const e=String(err||'').toLowerCase();
  if(e.includes('no-key')) return 'app के ⚙️ में Gemini key डालें';
  if(e.includes('api key not valid')||e.includes('api_key_invalid')||e.includes('invalid')) return 'key गलत है — app में सही Gemini key डालें';
  if(e.includes('has not been used')||e.includes('disabled')||e.includes('permission')||e.includes('403')) return 'Google में "Generative Language API" चालू करें (AI Studio से key बनाएँ)';
  if(e.includes('quota')||e.includes('429')||e.includes('resource_exhausted')||e.includes('too many')) return 'एक बार में एक — 1 मिनट रुककर फिर बोलिए/दबाइए (मुफ़्त Gemini की per-minute सीमा)';
  if(e.includes('not found')||e.includes('404')||e.includes('is not supported')) return 'model की दिक़्क़त — मुझे बता दें (मैं ठीक कर दूँगा)';
  if(e.includes('timeout')||e.includes('net')||e.includes('fetch')) return 'net धीमा/बंद — दोबारा';
  if(e.includes('not found')||e.includes('404')) return 'model नहीं मिला — मुझे बताएँ';
  return err?String(err).slice(0,80):'अभी जवाब नहीं आया';
}
/* 🧠 business context — compact (सिर्फ़ ज़रूरी, ताकि token कम लगें) */
function brainContext(data, now){
  const tasks=allTasks(data.contacts).filter(x=>!x.done);
  const late=tasks.filter(t=>t.at&&new Date(t.at).getTime()<now);
  const lines=tasks.slice(0,90).map(t=>{
    const isL=t.at&&new Date(t.at).getTime()<now;
    const tm=isL?(' [🔴लेट '+fmtDur(now-new Date(t.at).getTime())+']'):(t.at?(' [समय '+istParts(t.at)+' '+istHM(t.at)+']'):'');
    return '- '+(t.name||'?')+': '+(t.t||'')+(t.assignTo?(' →'+t.assignTo):'')+(t.cat&&CATS[t.cat]?(' #'+CATS[t.cat].label):'')+(t.pri==='high'?' ⚠️ज़रूरी':'')+tm;
  }).join('\n');
  return 'आज: '+istParts(now)+' '+istHM(now)+' (IST)\nकुल बाकी काम: '+tasks.length+' · 🔴 लेट: '+late.length+'\n\nसारे बाकी काम:\n'+(lines||'—');
}
const BRAIN_TONE='तुम विक्रम भाई (Vande Bharat Enterprises, army-supply व्यापारी, बाड़मेर) के भरोसेमंद manager हो। सिर्फ़ नीचे दिए असली data से, गर्मजोशी वाली सीधी हिंदी में (छोटे वाक्य, "भाई" वाला अपनापन) जवाब दो। अनुमान मत लगाओ — data में न हो तो साफ़ कहो। कोई English corporate भाषा नहीं।';
const BRAIN_FEATURES=[
  {k:'pehle', icon:'🎯', label:'अभी सबसे पहले क्या करूँ', ask:'सबसे ज़रूरी 5 काम क्रम से बताओ (लेट + ज़रूरी + बड़ा party पहले)। हर एक: क्यों पहले, और 1 सीधा अगला कदम। आख़िर में 1 line चेतावनी अगर कुछ बहुत बिगड़ रहा हो।'},
  {k:'khatra',icon:'🔮', label:'आगे का ख़तरा — भविष्यवाणी', ask:'कौन-से काम आगे लेट/भूले जाने वाले हैं (पैटर्न से)? 4-6 सबसे जोखिम वाले बताओ, हर एक पर 1 बचाव-कदम।'},
  {k:'staff', icon:'👥', label:'Staff का प्रदर्शन', ask:'किस staff (जिनको काम सौंपे गए →नाम) के पास कितने काम, कौन ज़्यादा लेट, किस पर भरोसा — छोटा हिसाब दो।'},
  {k:'hafta', icon:'📈', label:'इस हफ़्ते का हाल', ask:'इस हफ़्ते का छोटा हाल: कितने काम, कितने लेट, किस श्रेणी में सबसे ज़्यादा, और 2 सुधार-सुझाव।'},
  {k:'aaj',   icon:'📊', label:'आज का पूरा हिसाब', ask:'आज का छोटा सार दो: कितने काम, कितने लेट, सबसे ज़रूरी 3, और अभी 2 घंटे में क्या पहले करें।'},
  {k:'plan',  icon:'📅', label:'दिन का प्लान बनवाओ', ask:'दिन का प्लान बनाओ हिस्सों में — 🔴 बीते छूटे काम पहले, फिर आज के, फिर आगे के। हर पंक्ति में नाम+काम+समय। छोटा रखो।'},
];
function brainMenu(data, now){
  const tasks=allTasks(data.contacts).filter(x=>!x.done);
  const late=tasks.filter(t=>t.at&&new Date(t.at).getTime()<now).length;
  const hasGem=!!(data.settings&&data.settings.gemKey);
  const rows=BRAIN_FEATURES.map(f=>[{text:f.icon+' '+f.label, callback_data:('ai|'+f.k).slice(0,64)}]);
  rows.push([{text:'🔴 लेट काम',callback_data:'ai|late'},{text:'📞 call list',callback_data:'ai|call'}]);
  rows.push([{text:'🎯 Focus',callback_data:'bm|focus'},{text:'📇 Contacts',callback_data:'crs'},{text:'👥 टीम',callback_data:'bm|team'}]);
  const head='🧠 *विक्रम भाई का दिमाग़* — '+istParts(now)+'\n📋 '+tasks.length+' काम बाकी'+(late?(' · 🔴 '+late+' लेट'):'')+'\n\n'+
    (hasGem
      ? 'नीचे कोई भी बटन दबाइए — या सीधे लिखिए/🎤 बोलिए:\n_"आज किसको पहले call करूँ?" · "दिनेश के कितने काम लेट हैं?"_'
      : '⚠️ पहले app के ⚙️ में *Gemini key* डालें (AQ… या AIza…) — तभी AI जवाब देगा।');
  return {text:head, reply_markup:{inline_keyboard:rows}};
}
/* किसी feature/सवाल का Gemini जवाब (context के साथ) — {text}|{err} */
async function brainAnswer(data, now, ask){
  const prompt=BRAIN_TONE+'\n\n'+brainContext(data,now)+'\n\n👉 काम: '+ask;
  return await geminiAsk(data.settings, prompt);
}
/* free-text सवाल → Gemini (context सहित); key न हो या fail → Claude fallback */
async function brainReply(data, q, now){
  if(data.settings&&data.settings.gemKey){
    const r=await brainAnswer(data, now, 'विक्रम भाई का सवाल: "'+q+'"\nछोटा, सीधा जवाब सिर्फ़ ऊपर के data से।');
    if(r&&r.text) return '🧠 '+r.text;
  }
  return await aiFallback(data.settings, data.contacts, q, now); // Claude (अगर key हो)
}
/* 🎤 voice note handle — poller से OGG-b64 आता है; transcribe+समझो+काम करो */
async function handleVoiceNote(col, data, b64, mime, chat){
  const calls=[]; let dirty=false;
  const now=Date.now(), pd=n=>String(n).padStart(2,'0'), d=new Date();
  const nowS=d.getFullYear()+'-'+pd(d.getMonth()+1)+'-'+pd(d.getDate())+' '+pd(d.getHours())+':'+pd(d.getMinutes());
  // 🔑 ताज़ा key पढ़ो (owner ने अभी-अभी डाली हो तो memory में न हो) — 1 doc
  let settings=data.settings;
  try{ const sd=await col.doc('_settings').get(); if(sd.exists){ settings=Object.assign({}, data.settings, sd.data()); data.settings=settings; } }catch(e){}
  const roster=activeC(data.contacts).map(c=>c.name).filter(Boolean).slice(0,150).join(', ');
  const prompt='तुम विक्रम भाई के काम-सहायक हो। यह आवाज़-संदेश (हिंदी) सुनो। पहले हूबहू लिखो, फिर समझो कि यह "सवाल" है या "नया काम"।\n'+
    (roster?('मेरे contacts (नाम इसी सूची से हूबहू): '+roster+'\n'):'')+
    'अभी समय IST: '+nowS+'\nजवाब सिर्फ़ JSON:\n{"heard":"जो सुना हूबहू","type":"task या question","task":"काम (type=task हो तो, समय-शब्द हटाकर)","name":"किसका काम — सूची से या null","when":"YYYY-MM-DD HH:MM या null","cat":"golden|computer|market|jalipa या null","answer":"type=question हो तो छोटा हिंदी जवाब वरना null"}';
  const res=await geminiAudio(settings, b64, mime, prompt);
  if(res&&res.err){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'🎤 आवाज़ में दिक्कत: '+gemErrHindi(res.err)}}); return {calls,dirty}; }
  let j=null;
  try{ const raw=res&&res.text; if(raw) j=JSON.parse((raw.match(/\{[\s\S]*\}/)||[raw])[0]); }catch(e){}
  if(!j){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'🎤 आवाज़ समझ नहीं पाया — थोड़ा साफ़/धीरे फिर बोलिए।'}}); return {calls,dirty}; }
  const heard=j.heard?('🎤 _"'+String(j.heard).slice(0,140)+'"_\n\n'):'';
  if(j.type==='task' && j.task){
    const c=findByName(activeC(data.contacts), j.name||'') || findByName(activeC(data.contacts), j.task);
    let at=null; if(j.when){ const w=new Date(String(j.when).replace(' ','T')); if(!isNaN(w.getTime())&&w.getTime()>now) at=w.toISOString(); }
    if(c){ const r=await applyAdd(col, c.id, String(j.task).slice(0,200), at); if(r.ok){ dirty=true;
        calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:heard+'✅ काम जुड़ गया — *'+mdSafe(c.name||'')+'*\n📝 '+mdSafe(String(j.task).slice(0,80))+(at?('\n🕘 '+istParts(at)+' '+istHM(at)):'')}}); }
      else calls.push({method:'sendMessage',body:{chat_id:chat,text:heard+'⚠️ जोड़ नहीं पाया।'}}); }
    else calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:heard+'🤔 यह काम किसके लिए है, समझ नहीं आया। नाम साफ़ लेकर फिर बोलिए — या app से जोड़ें।'}});
  } else {
    let a=(j.answer&&String(j.answer).trim())||'';
    if(!a){ const br=await brainAnswer(data, now, 'सवाल: "'+(j.heard||'')+'"'); a=(br&&br.text)||'समझ नहीं आया — फिर पूछिए।'; }
    calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:heard+'🧠 '+mdSafe(a)}});
  }
  return {calls,dirty};
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

/* ══════════════════════════════════════════════════════════
   👥 STAFF LAYER (Accountability Engine — Phase 1)
   staff registry _settings.tgStaff में (app पर शून्य असर),
   events append-only vbe_ct_events collection में।
   Hard isolation: staff सिर्फ़ अपने assignTo काम देखता है —
   पहचान हमेशा chatId से, कभी callback data से नहीं।
   ══════════════════════════════════════════════════════════ */
function tgStaff(data){ return Array.isArray(data.settings.tgStaff)?data.settings.tgStaff:[]; }
async function saveTgStaff(col, data, list){
  await col.doc('_settings').set({tgStaff:list},{merge:true}); data.settings.tgStaff=list;
}
function staffByChat(data, chat){ return tgStaff(data).find(s=>s.chatId===String(chat)&&s.active!==false)||null; }
function staffNameOf(data, cid){ const c=data.contacts.find(x=>x.id===cid); return c?(c.name||''):''; }
/* टीम के लोग — settings.tagList में team-flag वाला filter (app का teamKey) */
function teamContacts(data){
  const tl=Array.isArray(data.settings.tagList)?data.settings.tagList:[];
  const marked=tl.find(t=>t.team)||tl.find(t=>/टीम|team/i.test(t.label||''));
  const tk=marked?marked.k:'jalipa';
  let out=activeC(data.contacts).filter(c=>c.tag===tk);
  if(!out.length){ // fallback: जिनको काम सौंपे गए हैं
    const ids=new Set(); activeC(data.contacts).forEach(c=>topics(c).forEach(x=>{ if(!x.done&&x.assignTo) ids.add(x.assignTo); }));
    out=activeC(data.contacts).filter(c=>ids.has(c.id));
  }
  return out;
}
/* 🔒 staff के काम — सिर्फ़ assignTo===staffCid, done नहीं, snooze नहीं */
function staffTasks(data, staffCid, now){
  const out=[];
  activeC(data.contacts).forEach(c=>{
    if(c.id===staffCid) return;
    topics(c).forEach((x,i)=>{
      if(x.done||x.assignTo!==staffCid) return;
      if(x.rvw) return; // 🔍 review-pending — मालिक approve करेंगे, staff को नहीं
      if(x.snoozeUntil&&Number(x.snoozeUntil)>now) return;
      out.push({...x,cid:c.id,ti:i,cname:c.name||'?',cphone:c.phone||''});
    });
  });
  // contact के हिसाब से एक साथ, फिर category-order
  out.sort((a,b)=>a.cid===b.cid?catRank(a.cat)-catRank(b.cat):(a.cid<b.cid?-1:1));
  return out;
}
function istDay(t){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(t)); }
function staffDoneToday(data, staffCid, now){
  let n=0; const day=istDay(now);
  activeC(data.contacts).forEach(c=>topics(c).forEach(x=>{
    if(x.done&&x.assignTo===staffCid&&x.doneAt&&istDay(new Date(x.doneAt).getTime())===day) n++;
  }));
  return n;
}
function greetIST(now){
  const h=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date(now)));
  const part=h<12?'सुबह':h<16?'दोपहर':h<20?'शाम':'रात';
  return part+' '+(h%12||12)+' बजे';
}
/* 📩 staff digest — contact-grouped, ≤5 block, नंबर वाले 4-बटन */
function staffDigest(data, st, now){
  const tasks=staffTasks(data, st.cid, now);
  const nm=(staffNameOf(data,st.cid)||st.name||'').split(/\s+/)[0]||'जी';
  if(!tasks.length) return {text:`🙏 ${nm} जी — ${greetIST(now)}\n\n✨ अभी कोई काम बाकी नहीं। शाबाश!`};
  const byC=[]; const idx={};
  tasks.forEach(t=>{ if(idx[t.cid]===undefined){ idx[t.cid]=byC.length; byC.push({cid:t.cid,cname:t.cname,cphone:t.cphone,list:[]}); } byC[idx[t.cid]].list.push(t); });
  const blocks=byC.slice(0,5); const hidden=byC.length-blocks.length;
  let n=0; const numbered=[];
  let text=`🙏 *${nm} जी — ${greetIST(now)}*\n`;
  blocks.forEach(b=>{
    text+='\n━━━━━━━━━━━━━━━\n👤 *'+mdSafe(b.cname)+'*\n';
    const dig=_phoneDigits(b.cphone);
    if(dig) text+=telLink(b.cphone,dig)+'\n';
    b.list.forEach(t=>{
      n++; numbered.push(t);
      const lateMs=t.at?now-new Date(t.at).getTime():0;
      const mark=(lateMs>0||t.pri==='high')?'🔴':t.st==='blocked'?'🚧':'🟡';
      text+=`${mark} *${n}.* ${mdSafe(t.t)}${lateMs>0?' — '+fmtDur(lateMs)+' लेट':''}\n`;
    });
  });
  if(hidden>0) text+=`\n…और ${hidden} जगह के काम — पहले ये पूरे करें`;
  text+=`\n━━━━━━━━━━━━━━━\nआज: ✅${staffDoneToday(data,st.cid,now)} पूरे · ⏳${tasks.length} बाकी\nनीचे नंबर के बटन दबाइए 👇`;
  const rows=numbered.slice(0,8).map((t,i)=>[
    {text:'✅ '+(i+1),callback_data:('ud|'+t.cid+'|'+t.ti).slice(0,64)},
    {text:'⏳ '+(i+1),callback_data:('up|'+t.cid+'|'+t.ti).slice(0,64)},
    {text:'❌ '+(i+1),callback_data:('ub|'+t.cid+'|'+t.ti).slice(0,64)},
    {text:'🕐 '+(i+1),callback_data:('uz|'+t.cid+'|'+t.ti).slice(0,64)},
  ]);
  return {text, reply_markup:{inline_keyboard:rows}};
}
/* 🔒 audit event — append-only, अलग collection (app नहीं पढ़ता) */
async function logEv(col, o){
  try{
    await col.firestore.collection('vbe_ct_events')
      .doc('ev_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6))
      .set(Object.assign({at:new Date().toISOString(),ch:'telegram'},o));
  }catch(e){}
}
/* 🔒 isolation guard — doc ताज़ा पढ़ो, topic उसी staff का हो तभी दो */
async function staffTopic(col, staffCid, cid, ti){
  const dc=await col.doc(cid).get(); if(!dc.exists) return null;
  const c=dc.data(); const tps=topics(c); const t=tps[Number(ti)];
  if(!t||t.done||t.assignTo!==staffCid) return null;
  return {c, tps, t, i:Number(ti), ref:col.doc(cid)};
}
async function staffPatch(col, staffCid, cid, ti, patch){
  const g=await staffTopic(col, staffCid, cid, ti); if(!g) return null;
  g.tps[g.i]=Object.assign({},g.t,patch);
  await g.ref.set({topics:g.tps, note:g.tps.filter(x=>!x.done).map(x=>x.t).join(' · ')},{merge:true});
  return {task:g.t.t||'', cname:g.c.name||''};
}
const BLOCK_REASONS={1:'सामान नहीं मिला',2:'पैसा चाहिए',3:'बंदा नहीं मिला',4:'गाड़ी नहीं',5:'कल करूँगा'};
function linkCodeFor(name){
  const ini=phonKey(String(name||'').split(/\s+/)[0]).toUpperCase().slice(0,3)||'VBE';
  return ini+'-'+String(Math.floor(1000+Math.random()*9000));
}
/* 👥 owner scoreboard — /team */
function teamScore(data, now){
  const linked=tgStaff(data);
  const seen=new Set(); const rows=[];
  const addRow=(cid,name,isLinked)=>{
    if(seen.has(cid)) return; seen.add(cid);
    const pend=staffTasks(data,cid,now); const dn=staffDoneToday(data,cid,now);
    const blocked=pend.filter(t=>t.st==='blocked').length;
    if(!pend.length&&!dn) return;
    rows.push(`${isLinked?'🔗':'⚪'} *${mdSafe(name||'?')}*  ✅${dn} आज · ⏳${pend.length} बाकी${blocked?' · 🚧'+blocked+' अटके':''}`);
  };
  linked.forEach(s=>addRow(s.cid, staffNameOf(data,s.cid)||s.name, !!s.chatId));
  teamContacts(data).forEach(c=>addRow(c.id, c.name, false));
  let own=0; activeC(data.contacts).forEach(c=>topics(c).forEach(x=>{ if(!x.done&&!x.assignTo) own++; }));
  return `📊 *टीम स्कोर — ${greetIST(now)}*\n\n`+(rows.length?rows.join('\n'):'— किसी staff पर काम नहीं')+
    `\n\n📥 बिना staff के (आपके अपने): ${own} काम`+
    `\n\n🔗 = Telegram से जुड़ा · ⚪ = अभी नहीं जुड़ा\n"link" लिखकर staff को जोड़ें।`;
}
/* 📩 सब linked staff को digest (poller की periodic scan से) — 9-20 IST, per-staff gap */
async function autoPushStaffDigest(col, data){
  const calls=[];
  const istH=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date()));
  if(istH<9||istH>=20) return calls;
  const now=Date.now(); const list=tgStaff(data); let changed=false;
  for(const s of list){
    if(!s.chatId||s.active===false) continue;
    const gap=(Number(s.nudgeMins)||210)*60000;
    if(now-Number(s.lastNudgeAt||0)<gap) continue;
    const tasks=staffTasks(data,s.cid,now);
    if(!tasks.length) continue;
    const d=staffDigest(data,s,now);
    calls.push({method:'sendMessage',body:Object.assign({chat_id:s.chatId,parse_mode:'Markdown',disable_web_page_preview:true,text:d.text},d.reply_markup?{reply_markup:d.reply_markup}:{})});
    s.lastNudgeAt=now; changed=true;
  }
  if(changed) await saveTgStaff(col,data,list);
  return calls;
}
/* ══ 🎯 FOCUS → TELEGRAM DELIVERY (approved format — deviate नहीं) ══ */
/* task/नाम में * _ ` [ हों (जैसे "2.5फीट*6फीट") तो Markdown टूट जाता है — escape करो */
function mdSafe(s){ return String(s||'').replace(/([_*`\[])/g,'\\$1'); }
function lateBadge(lateMs){ return lateMs<=0?'🟢':lateMs<6*3600e3?'🟡':'🔴'; }
function istMinOfDay(now){
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(now)).split(':');
  return Number(p[0])*60+Number(p[1]);
}
/* Focus digest — staff के own-letter (v/d/k) के focus काम, contact-grouped, 4-बटन।
   10-10 के भाग (start से) — ▶️ अगले 10 बटन से staff खुद अगला पन्ना खोले। */
function staffFocusDigest(data, st, now, mode, start){
  const fs=st.own?focusItemsOf(data, st.own):[];
  const nm=(staffNameOf(data,st.cid)||st.name||'').split(/\s+/)[0]||'जी';
  if(!fs.length) return staffDigest(data, st, now);
  const lateN=fs.filter(f=>(f.until||0)<now).length;
  let s0=Number(start)||0; if(s0>=fs.length) s0=0; if(s0<0) s0=0;
  const shown=fs.slice(s0, s0+10);
  const endN=s0+shown.length;
  const page=fs.length>10?` (काम ${s0+1}–${endN} / कुल ${fs.length})`:'';
  let text, rows;
  if(mode==='short'){
    text=`🙏 *${nm} जी — ${fs.length} काम बाकी*${lateN?' 🔴'+lateN+' लेट':''}${page}\n`;
    shown.forEach((f,i)=>{
      const lateMs=now-(f.until||now);
      text+=`${s0+i+1}. ${f.cname?mdSafe(f.cname.split(/\s+/)[0])+' — ':''}${mdSafe((f.t||'').slice(0,45))}${lateMs>0?' 🔴'+fmtDur(lateMs):''}\n`;
    });
    text+='👇 बटन दबाइए';
  } else {
    text=`🙏 *${nm} जी — ${greetIST(now)}*\n🔴 *Focus Mode — सबसे पहले यही काम*${page}\n`;
    // contact के हिसाब से group — first-appearance क्रम में
    const groups=[]; const gi={};
    shown.forEach((f,i)=>{ const k=f.id||'?'; if(gi[k]===undefined){ gi[k]=groups.length; groups.push({cname:f.cname||'?',cphone:f.cphone||'',list:[]}); } groups[gi[k]].list.push({...f,n:s0+i+1}); });
    groups.forEach(g=>{
      text+='\n━━━━━━━━━━━━━━━━━━\n👤 *'+mdSafe(g.cname)+'*\n';
      const dig=_phoneDigits(g.cphone);
      if(dig) text+=telLink(g.cphone,dig)+'\n';
      g.list.forEach(f=>{
        const lateMs=now-(f.until||now);
        text+=`${lateBadge(lateMs)} *${f.n}.* ${mdSafe(f.t)}${lateMs>0?' — '+fmtDur(lateMs)+' लेट':''}\n`;
      });
    });
    text+=`\n━━━━━━━━━━━━━━━━━━\nआज: ✅ ${doneTodayCount(data,now)} पूरे · ⏳ ${fs.length} बाकी${lateN?' · 🔴 '+lateN+' लेट':''}\nनीचे नंबर के बटन दबाइए 👇`;
  }
  rows=shown.map((f,i)=>[
    {text:'✅ '+(s0+i+1),callback_data:('wd|'+f.key).slice(0,64)},
    {text:'⏳ '+(s0+i+1),callback_data:('wp|'+f.key).slice(0,64)},
    {text:'❌ '+(s0+i+1),callback_data:('wb|'+f.key).slice(0,64)},
    {text:'🕐 '+(s0+i+1),callback_data:('wz|'+f.key).slice(0,64)},
  ]);
  const nav=[];
  if(s0>0) nav.push({text:'◀️ पिछले 10',callback_data:'wn|'+Math.max(0,s0-10)});
  nav.push({text:'🔄 ताज़ा करो',callback_data:'wf|'+s0});
  if(endN<fs.length) nav.push({text:`▶️ अगले (${endN+1}–${Math.min(endN+10,fs.length)})`,callback_data:'wn|'+endN});
  rows.push(nav);
  return {text:text.slice(0,4050), reply_markup:{inline_keyboard:rows}};
}
/* 🔒 focus-item guard — ताज़ा _focus पढ़ो, item उसी staff के own का हो */
async function focusItemGuard(col, st, key){
  const fdoc=await col.doc('_focus').get();
  const items=(fdoc.exists&&Array.isArray((fdoc.data()||{}).items))?fdoc.data().items:[];
  const it=items.find(f=>f.key===key);
  if(!it||(it.own||'v')!==st.own) return null;
  return it;
}
/* ⏰ hourly Focus push — dedupe hash, quiet 22:30–6:30, escalation 24h+ */
async function autoPushFocusHourly(col, data){
  const calls=[]; const now=Date.now();
  const mins=istMinOfDay(now);
  if(mins>=1350||mins<390) return calls;                 // रात 10:30 – सुबह 6:30 शांति
  const ownerChat=data.settings.tgChatId?String(data.settings.tgChatId):'';
  const list=tgStaff(data); let changed=false;
  for(const s of list){
    if(!s.chatId||s.active===false) continue;
    if(!s.own){ const o=focusOwnerIn(staffNameOf(data,s.cid)||s.name||''); if(o){ s.own=o; changed=true; } }
    if(!s.own) continue;
    const fs=focusItemsOf(data, s.own);
    if(!fs.length) continue;
    if(now-Number(s.lastFocusAt||0)<55*60000) continue;   // ~हर घंटे
    const hash=fs.map(f=>f.key+':'+lateBadge(now-(f.until||now))).join('|');
    if(hash===s.lastFocusHash && now-Number(s.lastFocusAt||0)<6*3600e3) continue; // कुछ नया नहीं → चुप
    const dg=staffFocusDigest(data, s, now, s.pref||'detailed');
    calls.push({method:'sendMessage',body:Object.assign({chat_id:s.chatId,parse_mode:'Markdown',disable_web_page_preview:true,text:dg.text},dg.reply_markup?{reply_markup:dg.reply_markup}:{})});
    s.lastFocusAt=now; s.lastFocusHash=hash; changed=true;
    await logEv(col,{action:'focus_push',staff:s.cid,staffName:staffNameOf(data,s.cid)||s.name,n:fs.length,trigger:'hourly'});
    // ⚠️ 24h+ लेट → owner escalation (हर 4 घंटे में एक बार)
    const esc=fs.filter(f=>f.until&&now-f.until>24*3600e3);
    if(esc.length&&ownerChat&&now-Number(s.lastEscAt||0)>4*3600e3){
      calls.push({method:'sendMessage',body:{chat_id:ownerChat,parse_mode:'Markdown',disable_web_page_preview:true,
        text:`⚠️ *${mdSafe(staffNameOf(data,s.cid)||s.name)} के ${esc.length} काम 24 घंटे+ से अटके:*\n`+esc.slice(0,5).map((f,i)=>`${i+1}. ${mdSafe((f.t||'').slice(0,60))} — 🔴 ${fmtDur(now-f.until)}`).join('\n')+(esc.length>5?`\n…और ${esc.length-5}`:'')}});
      s.lastEscAt=now; changed=true;
    }
  }
  if(changed) await saveTgStaff(col, data, list);
  return calls;
}
/* 📬 app का 📤 बटन fail (net/CORS) हो तो queue से भेजो — _settings.tgPushQueue */
async function autoPushQueued(col, data){
  const calls=[];
  const q=Array.isArray(data.settings.tgPushQueue)?data.settings.tgPushQueue:[];
  if(!q.length) return calls;
  const now=Date.now();
  const list=tgStaff(data); let changed=false;
  const ownerChat=data.settings.tgChatId?String(data.settings.tgChatId):'';
  for(const req of q.slice(0,6)){
    if(!req||!req.cid) continue;
    if(req.at&&now-Number(req.at)>2*3600e3) continue;      // 2 घंटे पुराना — छोड़ो
    const s=list.find(x=>x.cid===req.cid);
    if(!s||!s.chatId) continue;
    // 👤 app से assign हुआ → staff को काम + owner को पुष्टि (app भेज चुका हो तो सिर्फ़ record)
    if(req.kind==='assign'){
      const src=data.contacts.find(x=>x.id===req.srcId);
      const t=src?topics(src)[Number(req.ti)]:null;
      if(!t||t.done) continue;
      const sName=staffNameOf(data,s.cid)||s.name||'';
      if(!req.sent){
        const nm=(sName||'').split(/\s+/)[0]||'जी';
        let text=`🙏 *${mdSafe(nm)} जी*, आपको एक नई ज़िम्मेदारी सौंपी गई है:\n━━━━━━━━━━━\n📌 *काम:* ${mdSafe(t.t||'')}\n`;
        if(src.name) text+=`👤 *सम्बंधित:* ${mdSafe(src.name)}\n`;
        const dig=_phoneDigits(src.phone||'');
        if(dig) text+=telLink(src.phone,dig)+'\n';
        text+='━━━━━━━━━━━\nहो जाए तो नीचे ✅ दबाइए। — विक्रम चारण, VBE';
        calls.push({method:'sendMessage',body:{chat_id:s.chatId,parse_mode:'Markdown',disable_web_page_preview:true,text,
          reply_markup:{inline_keyboard:[[
            {text:'✅ काम हो गया',callback_data:('ud|'+req.srcId+'|'+req.ti).slice(0,64)},
            {text:'⏳ कर रहा हूँ',callback_data:('up|'+req.srcId+'|'+req.ti).slice(0,64)}]]}}});
        if(ownerChat) calls.push({method:'sendMessage',body:{chat_id:ownerChat,disable_web_page_preview:true,
          text:`✅ ${sName} को Telegram पर सूचित कर दिया गया — "${(t.t||'').slice(0,50)}" (${istHM(now)})`}});
      }
      await logEv(col,{action:'assigned',staff:s.cid,staffName:sName,cid:req.srcId,ti:Number(req.ti),task:(t.t||'').slice(0,80),via:req.sent?'app':'bot'});
      continue;
    }
    const dg=(req.kind!=='tasks'&&s.own&&focusItemsOf(data,s.own).length)
      ?staffFocusDigest(data,s,now,req.mode||s.pref||'detailed',Number(req.start)||0)
      :staffDigest(data,s,now);
    calls.push({method:'sendMessage',body:Object.assign({chat_id:s.chatId,parse_mode:'Markdown',disable_web_page_preview:true,text:dg.text},dg.reply_markup?{reply_markup:dg.reply_markup}:{})});
    s.lastPushAt=now; s.lastFocusAt=now; changed=true;
    await logEv(col,{action:'focus_push',staff:s.cid,staffName:staffNameOf(data,s.cid)||s.name,trigger:'app-queue'});
  }
  await col.doc('_settings').set({tgPushQueue:[]},{merge:true}); data.settings.tgPushQueue=[];
  if(changed) await saveTgStaff(col,data,list);
  return calls;
}
/* ⏰ सौंपे काम की random याद-दहानी — हर staff को 15-26 min के random अंतर पर,
   एक बार में एक ही काम, वही काम लगातार दो बार नहीं (rotation), रात 21:00–08:00 शांति।
   हर भेजा reminder vbe_ct_events में record → owner की हलचल feed में दिखता है। */
function _remGap(){ return (15+Math.floor(Math.random()*12))*60000; } // 15-26 min
async function autoPushStaffReminder(col, data, now){
  const calls=[]; now=now||Date.now();
  const istH=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false}).format(new Date(now)));
  if(istH<8||istH>=21) return calls; // 🌙 quiet hours
  const list=tgStaff(data); let changed=false;
  for(const s of list){
    if(!s.chatId||s.active===false) continue;
    const tasks=staffTasks(data,s.cid,now); // हर pending सौंपा काम reminder के दायरे में
    if(!tasks.length){ if(s.nextRemAt){ s.nextRemAt=0; changed=true; } continue; }
    if(!s.nextRemAt||Number(s.nextRemAt)<now-3*3600e3){ s.nextRemAt=now+_remGap(); changed=true; continue; }
    if(now<Number(s.nextRemAt)) continue;
    // 🔁 rotation — पिछली बार वाला काम फिर नहीं (एक से ज़्यादा हों तो)
    let pool=tasks;
    if(tasks.length>1&&s.lastRemKey) pool=tasks.filter(t=>(t.cid+'|'+t.ti)!==s.lastRemKey);
    const t=pool[Math.floor(Math.random()*pool.length)];
    const sName=staffNameOf(data,s.cid)||s.name||'';
    const nm=(sName||'').split(/\s+/)[0]||'जी';
    const asg=t.assignAt?new Date(t.assignAt).getTime():(t.dg&&t.dg.at?new Date(t.dg.at).getTime():0);
    const ago=asg&&asg<now?(now-asg<3600e3?Math.max(1,Math.round((now-asg)/60000))+' मिनट':fmtDur(now-asg))+' पहले ':'';
    const text=`⏰ *${mdSafe(nm)} जी*, ${ago}आपको यह ज़िम्मेदारी सौंपी गई थी:\n📌 "${mdSafe((t.t||'').slice(0,90))}"${t.cname?'\n👤 '+mdSafe(t.cname):''}\n\nआपने इस पर क्या कार्रवाई की?`;
    calls.push({method:'sendMessage',body:{chat_id:s.chatId,parse_mode:'Markdown',disable_web_page_preview:true,text,
      reply_markup:{inline_keyboard:[[
        {text:'✅ काम हो गया',callback_data:('ud|'+t.cid+'|'+t.ti).slice(0,64)},
        {text:'⏳ कर रहा हूँ',callback_data:('up|'+t.cid+'|'+t.ti).slice(0,64)},
        {text:'❌ दिक्कत',callback_data:('ub|'+t.cid+'|'+t.ti).slice(0,64)}]]}}});
    s.lastRemKey=t.cid+'|'+t.ti; s.nextRemAt=now+_remGap(); changed=true;
    await logEv(col,{action:'reminder',staff:s.cid,staffName:sName,cid:t.cid,ti:t.ti,task:(t.t||'').slice(0,80)});
  }
  if(changed) await saveTgStaff(col,data,list);
  return calls;
}
/* staff के callback (ud/up/uq/ub/ur/uz + focus wd/wp/wq/wb/wr/wz/wy/wf) — isolation हर कदम पर */
async function handleStaffCallback(col, data, cq, st, ownerChat){
  const calls=[]; let dirty=false;
  const chat=String(cq.message.chat.id); const cd=cq.data||'';
  const sName=staffNameOf(data,st.cid)||st.name||'';
  const ack=(t)=>calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:t}});
  const say=(t,kb)=>calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,text:t,parse_mode:'Markdown',disable_web_page_preview:true},kb?{reply_markup:kb}:{})});
  // 🔔 owner mirror — हर staff-हलचल की तुरंत खबर
  const mir=(emoji,task,extra)=>{ if(ownerChat) calls.push({method:'sendMessage',body:{chat_id:ownerChat,disable_web_page_preview:true,
    text:`🔔 ${sName} → ${emoji} "${(task||'').slice(0,60)}"${extra?' — '+extra:''} (${istHM(Date.now())})`}}); };
  // ✏️ action के बाद वही digest message ताज़ा करो (नया spam नहीं); pageStart = 10-10 भाग।
  // 💰 quota बचाओ: पूरी collection नहीं — focus में सिर्फ़ _focus doc (1 read),
  // general में सिर्फ़ बदला हुआ contact (1 read); बाक़ी data मेमोरी से।
  const refresh=async(kind, pageStart, cid)=>{ try{
    if(!cq.message||!cq.message.message_id) return;
    let d3;
    if(kind==='focus'){
      const fdoc=await col.doc('_focus').get();
      d3=Object.assign({}, data, {focus: fdoc.exists?fdoc.data():{items:[]}});
    } else {
      const contacts=data.contacts.slice();
      if(cid){ const dc=await col.doc(cid).get(); if(dc.exists){ const c=dc.data(); c.id=cid; const ix=contacts.findIndex(x=>x.id===cid); if(ix>=0) contacts[ix]=c; else contacts.push(c); } }
      d3=Object.assign({}, data, {contacts});
    }
    const st3=tgStaff(d3).find(x=>x.cid===st.cid)||st;
    const dg=(kind==='focus')?staffFocusDigest(d3,st3,Date.now(),st3.pref||'detailed',pageStart||0):staffDigest(d3,st3,Date.now());
    const body={chat_id:chat,message_id:cq.message.message_id,text:dg.text,parse_mode:'Markdown',disable_web_page_preview:true};
    if(dg.reply_markup) body.reply_markup=dg.reply_markup;
    calls.push({method:'editMessageText',body});
  }catch(e){} };
  let m;
  /* ── 🎯 Focus काम के बटन (wd/wp/wq/wb/wr/wz/wy/wf) — own-guard से ── */
  if((m=cd.match(/^wd\|(.+)$/))){
    const it=await focusItemGuard(col,st,m[1]);
    if(!it){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    const r=await applyFocusComplete(col,m[1]); dirty=true;
    await logEv(col,{action:'done',staff:st.cid,staffName:sName,task:(r.task||'').slice(0,80),focus:true});
    ack('✅ शाबाश!'); mir('✅',r.task);
    say(`✅ *हो गया:* ${mdSafe((r.task||'').slice(0,60))}\n\nबहुत बढ़िया ${sName.split(/\s+/)[0]} जी! 🙌`);
    await refresh('focus');
    return {calls,dirty};
  }
  if((m=cd.match(/^wp\|(.+)$/))){
    const it=await focusItemGuard(col,st,m[1]);
    if(!it){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    ack('⏳');
    say(`⏳ *${mdSafe((it.t||'').slice(0,60))}*\nकितनी देर में हो जाएगा?`,{inline_keyboard:[[
      {text:'1 घंटा',callback_data:('wq|'+m[1]+'|60').slice(0,64)},
      {text:'3 घंटे',callback_data:('wq|'+m[1]+'|180').slice(0,64)},
      {text:'कल सुबह',callback_data:('wq|'+m[1]+'|t').slice(0,64)}]]});
    return {calls,dirty};
  }
  if((m=cd.match(/^w([qy])\|(.+)\|(\d+|t)$/))){
    const isSnooze=m[1]==='y';
    const it=await focusItemGuard(col,st,m[2]);
    if(!it){ ack('नहीं मिला'); return {calls,dirty}; }
    let addMin;
    if(m[3]==='t'){ const nowMin=istMinOfDay(Date.now()); addMin=(24*60-nowMin)+10*60; } // कल सुबह 10 बजे
    else addMin=Number(m[3]);
    const r=await applyFocusExtend(col,m[2],addMin); dirty=true;
    await logEv(col,{action:isSnooze?'snooze':'in_progress',staff:st.cid,staffName:sName,task:(it.t||'').slice(0,80),mins:addMin,focus:true});
    ack(isSnooze?'🕐 ठीक':'⏳ ठीक');
    mir(isSnooze?'🕐 बाद में':'⏳ कर रहा हूँ',it.t,istHM(r.until)+' तक');
    say(`${isSnooze?'🕐':'⏳'} ठीक है — *${istHM(r.until)}* तक।\n📝 ${mdSafe((it.t||'').slice(0,60))}\nसमय पर फिर याद दिला दूँगा।`);
    await refresh('focus');
    return {calls,dirty};
  }
  if((m=cd.match(/^wb\|(.+)$/))){
    const it=await focusItemGuard(col,st,m[1]);
    if(!it){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    ack('❌');
    const kb=[[1,2],[3,4],[5]].map(row=>row.map(k=>({text:BLOCK_REASONS[k],callback_data:('wr|'+m[1]+'|'+k).slice(0,64)})));
    say(`❌ *${mdSafe((it.t||'').slice(0,60))}*\nक्या दिक्कत है?`,{inline_keyboard:kb});
    return {calls,dirty};
  }
  if((m=cd.match(/^wr\|(.+)\|([1-5])$/))){
    const it=await focusItemGuard(col,st,m[1]);
    if(!it){ ack('नहीं मिला'); return {calls,dirty}; }
    const reason=BLOCK_REASONS[m[2]];
    try{ // उस topic पर st:'blocked' भी लगाओ (app में दिखे)
      const dc=await col.doc(it.id).get();
      if(dc.exists){ const c=dc.data(); const tps=topics(c);
        if(tps[it.i]&&!tps[it.i].done){ tps[it.i]={...tps[it.i],st:'blocked',blockedReason:reason,blockedAt:new Date().toISOString()};
          await col.doc(it.id).set({topics:tps},{merge:true}); } }
    }catch(e){}
    dirty=true;
    await logEv(col,{action:'blocked',staff:st.cid,staffName:sName,task:(it.t||'').slice(0,80),reason,focus:true});
    ack('👍 विक्रम जी को बता दिया');
    say(`🚧 ठीक है — विक्रम जी को तुरंत बता दिया।\n📝 ${mdSafe((it.t||'').slice(0,60))}\nकारण: ${reason}`);
    if(ownerChat) calls.push({method:'sendMessage',body:{chat_id:ownerChat,parse_mode:'Markdown',disable_web_page_preview:true,
      text:`🚧 *Focus काम अटका!*\n👤 ${mdSafe(sName)}: ${mdSafe((it.t||'').slice(0,70))}\n❌ कारण: *${reason}*\n\n2 घंटे में हल करें — वरना staff बताना बंद कर देंगे।`}});
    await refresh('focus');
    return {calls,dirty};
  }
  if((m=cd.match(/^wz\|(.+)$/))){
    const it=await focusItemGuard(col,st,m[1]);
    if(!it){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    ack('🕐');
    say(`🕐 *${mdSafe((it.t||'').slice(0,60))}*\nकब याद दिलाऊँ?`,{inline_keyboard:[[
      {text:'1 घंटा',callback_data:('wy|'+m[1]+'|60').slice(0,64)},
      {text:'3 घंटे',callback_data:('wy|'+m[1]+'|180').slice(0,64)},
      {text:'कल सुबह',callback_data:('wy|'+m[1]+'|t').slice(0,64)}]]});
    return {calls,dirty};
  }
  if((m=cd.match(/^wf\|(\d+)$/))){
    ack('🔄');
    await refresh('focus', Number(m[1]));
    return {calls,dirty};
  }
  if((m=cd.match(/^wn\|(\d+)$/))){
    // ▶️/◀️ — अगला/पिछला 10 का भाग (वही message बदलता है)
    ack('📄');
    await refresh('focus', Number(m[1]));
    return {calls,dirty};
  }
  if((m=cd.match(/^ud\|(.+)\|(\d+)$/))){
    const g=await staffTopic(col,st.cid,m[1],m[2]);
    if(!g){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    const r=await applyDone(col,m[1],m[2]); dirty=true;
    await logEv(col,{action:'done',staff:st.cid,staffName:sName,cid:m[1],ti:Number(m[2]),task:(r.task||'').slice(0,80)});
    ack('✅ शाबाश!'); mir('✅',r.task);
    say(`✅ *हो गया:* ${mdSafe((r.task||'').slice(0,60))}\n👤 ${mdSafe(r.name||'')}\n\nबहुत बढ़िया ${sName.split(/\s+/)[0]} जी! 🙌`);
    await refresh('general',0,m[1]);
  } else if((m=cd.match(/^up\|(.+)\|(\d+)$/))){
    const g=await staffTopic(col,st.cid,m[1],m[2]);
    if(!g){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    ack('⏳');
    say(`⏳ *${mdSafe((g.t.t||'').slice(0,60))}*\nकितनी देर में हो जाएगा?`,{inline_keyboard:[[
      {text:'1 घंटा',callback_data:('uq|'+m[1]+'|'+m[2]+'|1').slice(0,64)},
      {text:'आज शाम',callback_data:('uq|'+m[1]+'|'+m[2]+'|e').slice(0,64)},
      {text:'कल सुबह',callback_data:('uq|'+m[1]+'|'+m[2]+'|t').slice(0,64)}]]});
  } else if((m=cd.match(/^uq\|(.+)\|(\d+)\|(1|e|t)$/))){
    const now=Date.now(); let at;
    if(m[3]==='1') at=new Date(now+3600e3);
    else { const p=new Date(now); // IST शाम 18:00 / कल सुबह 10:00
      const istNow=new Date(p.toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
      const target=new Date(istNow); if(m[3]==='e'){ target.setHours(18,0,0,0); if(target<=istNow) target.setDate(target.getDate()+1); } else { target.setDate(target.getDate()+1); target.setHours(10,0,0,0); }
      at=new Date(now+(target-istNow)); }
    const r=await staffPatch(col,st.cid,m[1],m[2],{st:'prog',at:at.toISOString()});
    if(!r){ ack('नहीं मिला'); return {calls,dirty}; }
    dirty=true;
    await logEv(col,{action:'in_progress',staff:st.cid,staffName:sName,cid:m[1],ti:Number(m[2]),task:r.task.slice(0,80),dueAt:at.toISOString()});
    ack('⏳ ठीक'); mir('⏳ कर रहा हूँ',r.task,istHM(at.toISOString())+' तक');
    say(`⏳ ठीक है — *${istParts(at.toISOString())} ${istHM(at.toISOString())}* तक।\n📝 ${mdSafe(r.task.slice(0,60))}\nसमय पर याद दिला दूँगा।`);
    await refresh('general',0,m[1]);
  } else if((m=cd.match(/^ub\|(.+)\|(\d+)$/))){
    const g=await staffTopic(col,st.cid,m[1],m[2]);
    if(!g){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    ack('❌');
    const kb=[[1,2],[3,4],[5]].map(row=>row.map(k=>({text:BLOCK_REASONS[k],callback_data:('ur|'+m[1]+'|'+m[2]+'|'+k).slice(0,64)})));
    say(`❌ *${mdSafe((g.t.t||'').slice(0,60))}*\nक्या दिक्कत है?`,{inline_keyboard:kb});
  } else if((m=cd.match(/^ur\|(.+)\|(\d+)\|([1-5])$/))){
    const reason=BLOCK_REASONS[m[3]];
    const r=await staffPatch(col,st.cid,m[1],m[2],{st:'blocked',blockedReason:reason,blockedAt:new Date().toISOString()});
    if(!r){ ack('नहीं मिला'); return {calls,dirty}; }
    dirty=true;
    await logEv(col,{action:'blocked',staff:st.cid,staffName:sName,cid:m[1],ti:Number(m[2]),task:r.task.slice(0,80),reason});
    ack('👍 विक्रम जी को बता दिया');
    say(`🚧 ठीक है — विक्रम जी को तुरंत बता दिया।\n📝 ${r.task.slice(0,60)}\nकारण: ${reason}`);
    if(ownerChat) calls.push({method:'sendMessage',body:{chat_id:ownerChat,parse_mode:'Markdown',disable_web_page_preview:true,
      text:`🚧 *काम अटका!*\n👤 ${mdSafe(sName)} का काम: ${mdSafe(r.task.slice(0,70))}\n(${mdSafe(r.cname)})\n❌ कारण: *${reason}*\n\n2 घंटे में हल करें — वरना staff बताना बंद कर देंगे।`}});
  } else if((m=cd.match(/^uz\|(.+)\|(\d+)$/))){
    const g=await staffTopic(col,st.cid,m[1],m[2]);
    if(!g){ ack('यह काम आपका नहीं / मिला नहीं'); return {calls,dirty}; }
    const zn=Number(g.t.snoozeN||0);
    if(zn>=3){
      ack('🚫 3 बार टल चुका');
      say(`🚫 यह काम 3 बार टल चुका — अब करना ही है:\n📝 ${mdSafe((g.t.t||'').slice(0,60))}\n\nनहीं हो पा रहा तो ❌ दबाकर दिक्कत बताइए।`);
      await logEv(col,{action:'snooze_limit',staff:st.cid,staffName:sName,cid:m[1],ti:Number(m[2]),task:(g.t.t||'').slice(0,80)});
      if(ownerChat) calls.push({method:'sendMessage',body:{chat_id:ownerChat,text:`🕐 ${sName} ने "${(g.t.t||'').slice(0,50)}" को 3 बार टाला — एक बार पूछ लीजिए।`}});
    } else {
      const r=await staffPatch(col,st.cid,m[1],m[2],{snoozeUntil:Date.now()+2*3600e3,snoozeN:zn+1});
      dirty=true;
      await logEv(col,{action:'snooze',staff:st.cid,staffName:sName,cid:m[1],ti:Number(m[2]),task:r?r.task.slice(0,80):'',n:zn+1});
      ack('🕐 2 घंटे बाद'); mir('🕐 बाद में',r?r.task:'',(zn+1)+'/3 बार');
      say(`🕐 ठीक — 2 घंटे बाद फिर याद दिलाऊँगा। (${zn+1}/3 बार टला)`);
      await refresh('general',0,m[1]);
    }
  } else ack('ok');
  return {calls,dirty};
}
/* /start CODE — staff जुड़ने की कोशिश */
async function staffLinkAttempt(col, data, chat, code, from){
  const calls=[]; const list=tgStaff(data);
  const s=list.find(x=>x.code&&x.code.toUpperCase()===String(code).toUpperCase());
  if(!s||!s.codeExp||s.codeExp<Date.now()){
    calls.push({method:'sendMessage',body:{chat_id:chat,text:'⚠️ यह code गलत है या समय निकल गया (15 min)।\nविक्रम जी से नया link/QR लीजिए।'}});
    return {calls,ok:false};
  }
  const other=list.find(x=>x!==s&&x.chatId===String(chat));
  if(other){
    calls.push({method:'sendMessage',body:{chat_id:chat,text:'⚠️ यह Telegram पहले से '+(staffNameOf(data,other.cid)||other.name||'किसी और')+' से जुड़ा है। विक्रम जी से बात करें।'}});
    return {calls,ok:false,alertOwner:'⚠️ Link गड़बड़: एक ही Telegram ('+chat+') दो staff से जुड़ने की कोशिश।'};
  }
  s.chatId=String(chat); s.code=''; s.codeExp=0; s.linkedAt=Date.now();
  s.tgUser=(from&&from.username)||''; s.lastNudgeAt=0;
  s.own=s.own||focusOwnerIn(staffNameOf(data,s.cid)||s.name||'')||'';
  await saveTgStaff(col,data,list);
  await logEv(col,{action:'linked',staff:s.cid,staffName:staffNameOf(data,s.cid)||s.name,chatId:String(chat)});
  const nm=(staffNameOf(data,s.cid)||s.name||'').split(/\s+/)[0];
  calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',
    text:`✅ *${nm} जी, आप जुड़ गए हैं!*\n\nअब आपके काम यहीं आते रहेंगे।\nApp खोलने की ज़रूरत नहीं।\nसिर्फ़ बटन दबाना है — कुछ टाइप नहीं करना।\n\n✅ हो गया · ⏳ कर रहा हूँ · ❌ अटका · 🕐 बाद में`}});
  const d=(s.own&&focusItemsOf(data,s.own).length)?staffFocusDigest(data,s,Date.now(),s.pref||'detailed'):staffDigest(data,s,Date.now());
  calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:d.text},d.reply_markup?{reply_markup:d.reply_markup}:{})});
  return {calls,ok:true,name:staffNameOf(data,s.cid)||s.name};
}
/* owner: "link" → staff चुनो के बटन */
function linkPickMsg(data){
  const team=teamContacts(data);
  if(!team.length) return {text:'⚠️ कोई टीम-staff contact नहीं मिला। पहले app में staff को टीम filter दें।'};
  const rows=[]; team.slice(0,12).forEach(c=>rows.push([{text:'🔗 '+(c.name||'?'),callback_data:('lk|'+c.id).slice(0,64)}]));
  return {text:'👥 *किस staff को Telegram से जोड़ना है?*\n(staff का फ़ोन हाथ में रखें — QR मिलेगा)',reply_markup:{inline_keyboard:rows}};
}
/* owner: staff चुना → code + deep link + QR */
async function makeLinkCode(col, data, cid){
  const calls=[]; const name=staffNameOf(data,cid);
  const list=tgStaff(data);
  let s=list.find(x=>x.cid===cid);
  if(!s){ s={cid,name,chatId:'',nudgeMins:210,active:true}; list.push(s); }
  s.code=linkCodeFor(name); s.codeExp=Date.now()+15*60000;
  await saveTgStaff(col,data,list);
  const bot=data.settings.tgBotUser||'';
  const deep=bot?`https://t.me/${bot}?start=${s.code}`:'';
  let text=`🔗 *${name}* के लिए link तैयार (15 min):\n\ncode: \`${s.code}\``;
  if(deep) text+=`\n\n1️⃣ Staff के फ़ोन पर यह link खोलें:\n${deep}\n2️⃣ Telegram खुलेगा → *START* दबाएँ\n3️⃣ बस — जुड़ गए!`;
  else text+=`\n\nStaff अपने Telegram में इस bot को खोलकर यह code भेजे।`;
  return {calls, text, qr: deep?('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='+encodeURIComponent(deep)):''};
}

/* एक update → Telegram API calls की सूची। data ताज़ा दो; dirty true हो तो caller reload करे। */
async function handleUpdate(col, data, update, ownerChat){
  const calls=[]; let dirty=false, newOwner=ownerChat;
  const now=Date.now();

  if(update.callback_query){
    const cq=update.callback_query;
    const chat=cq.message&&cq.message.chat&&String(cq.message.chat.id);
    if(ownerChat&&chat!==ownerChat){
      // 👥 staff chat? — पहचान chatId से ही (isolation)
      const st=staffByChat(data, chat);
      if(st){ const r=await handleStaffCallback(col, data, cq, st, ownerChat); return {calls:r.calls, dirty:r.dirty, ownerChat:newOwner}; }
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'अनुमति नहीं'}}); return {calls,dirty,ownerChat:newOwner};
    }
    const cd=cq.data||'';
    let m;
    if((m=cd.match(/^ai\|(\w+)$/))){
      // 🧠 दिमाग़ menu का बटन — Gemini feature या local list
      const feat=m[1];
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🧠 सोच रहा हूँ…'}});
      if(feat==='late'||feat==='call'){
        const ans=answer(data, feat==='late'?'लेट काम':'call किसको', now);
        calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,text:(ans&&ans.text)||'—'},ans&&ans.reply_markup?{reply_markup:ans.reply_markup}:{})});
      } else {
        const f=BRAIN_FEATURES.find(x=>x.k===feat);
        if(!f){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'—'}}); }
        else if(!(data.settings&&data.settings.gemKey)){
          calls.push({method:'sendMessage',body:{chat_id:chat,text:'⚠️ पहले app के ⚙️ में Gemini key डालें — तभी AI यह बना पाएगा।'}});
        } else {
          const r=await brainAnswer(data, now, f.ask);
          calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:(r&&r.text)?('*'+f.icon+' '+f.label+'*\n\n'+mdSafe(r.text)):('⚠️ अभी नहीं बना — '+gemErrHindi(r&&r.err))}});
        }
      }
    } else if(cd==='bm|focus'){
      const mn=focusMenuMsg(data);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🎯'}});
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',text:mn.text},mn.reply_markup?{reply_markup:mn.reply_markup}:{})});
    } else if(cd==='bm|team'){
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'👥'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:teamScore(data,now)}});
    } else if((m=cd.match(/^pgc\|(\d+)$/))){
      // 📞 calls digest — अगला/पिछला page (वही message बदलता है)
      const dgst=callsDigest(data, Date.now(), Number(m[1]));
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'📞'}});
      const body={chat_id:chat,message_id:cq.message.message_id,text:dgst.text,parse_mode:'Markdown',disable_web_page_preview:true};
      if(dgst.reply_markup) body.reply_markup=dgst.reply_markup;
      calls.push({method:'editMessageText',body});
    } else if((m=cd.match(/^pgt\|(\d+)$/))){
      // ⏰ tasks digest — pagination
      const dgst=dueTasksDigest(data, Date.now(), Number(m[1]));
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'⏰'}});
      const body={chat_id:chat,message_id:cq.message.message_id,text:dgst.text,parse_mode:'Markdown',disable_web_page_preview:true};
      if(dgst.reply_markup) body.reply_markup=dgst.reply_markup;
      calls.push({method:'editMessageText',body});
    } else if((m=cd.match(/^cdn\|(.+)\|(\d+)$/))){
      // ✅ call निपटी → nextCallAt साफ़ + उसी page पर digest ताज़ा
      const r=await applyCallDone(col, m[1]); dirty=true;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:r.ok?'✅ call निपटी':'नहीं मिला'}});
      if(r.ok){
        const c2=data.contacts.find(z=>z.id===m[1]); if(c2) c2.nextCallAt=null; // memory भी
        const dgst=callsDigest(data, Date.now(), Number(m[2]));
        const body={chat_id:chat,message_id:cq.message.message_id,text:dgst.text,parse_mode:'Markdown',disable_web_page_preview:true};
        if(dgst.reply_markup) body.reply_markup=dgst.reply_markup;
        calls.push({method:'editMessageText',body});
      }
    } else if((m=cd.match(/^lk\|(.+)$/))){
      // 👥 owner ने staff चुना → code + deep link + QR (memory data)
      const r=await makeLinkCode(col, data, m[1]);
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🔗'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:r.text}});
      if(r.qr) calls.push({method:'sendPhoto',body:{chat_id:chat,photo:r.qr,caption:'📱 Staff के फ़ोन के camera/Telegram से यह QR scan करवाएँ'}});
    } else if((m=cd.match(/^d\|(.+)\|(\d+)$/))){
      const r=await applyDone(col,m[1],m[2]);
      if(r.ok){ dirty=true; calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'✅ काम पूरा!'}});
        calls.push({method:'sendMessage',body:{chat_id:chat,text:`✅ पूरा हुआ: ${(r.task||'').slice(0,60)}\n👤 ${r.name||''}`}}); }
      else calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:r.already?'यह पहले ही पूरा है':'नहीं मिला'}});
    } else if((m=cd.match(/^fm\|([vdk])$/))){
      // 🎯 staff चुना → Short / विस्तृत विकल्प (memory data — read बचाओ)
      const d2=data;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🎯'}});
      const ch=focusChoiceMsg(d2,m[1]);
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,text:ch.text},ch.reply_markup?{reply_markup:ch.reply_markup}:{})});
    } else if((m=cd.match(/^fdt\|([vdk])\|(\d+)$/))){
      // 🔍 विस्तृत — हर काम का card (10-10) (memory data)
      const d2=data;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🔍'}});
      focusDetailCards(d2,m[1],Number(m[2]),chat).forEach(c=>calls.push(c));
    } else if(cd==='crs' || (m=cd.match(/^cr\|(\d+)$/))){
      // 📞 Contact Review — resume (crs) या batch (cr|N) (memory data)
      const d2=data;
      let start = cd==='crs' ? Number((d2.settings||{}).tgReviewIdx||0) : Number(m[1]);
      const total=contactReviewList(d2).length; if(start>=total) start=0;
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'📇'}});
      contactReviewCards(d2,start,chat).forEach(c=>calls.push(c));
      await col.doc('_settings').set({tgReviewIdx:start+10},{merge:true});
      data.settings.tgReviewIdx=start+10; // memory भी (अब dirty-reload नहीं)
    } else if(cd==='crx'){
      calls.push({method:'answerCallbackQuery',body:{callback_query_id:cq.id,text:'🏁'}});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:'🏁 Contact Review बंद — अगली बार यहीं से।'}});
    } else if((m=cd.match(/^cf\|(.+)$/))){
      // 🎯 contact से focus में डालो — काम/owner पूछो (memory data)
      const d2=data;
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
      const c=activeC(data.contacts).find(x=>x.id===m[1]);
      await col.doc('_settings').set({tgAddFor:m[1], tgAddForAt:Date.now()},{merge:true});
      data.settings.tgAddFor=m[1]; data.settings.tgAddForAt=Date.now(); // memory भी (अब dirty-reload नहीं)
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
  if(chat!==newOwner){
    // 👥 non-owner chat: पहले link-code, फिर linked staff, वरना विनम्र मना
    const rawT=(msg.text||'').trim();
    const cm=rawT.match(/^\/start[ _]+([A-Za-z]{2,5}-?\d{3,5})$/i)||rawT.match(/^([A-Za-z]{2,5}-\d{3,5})$/);
    if(cm){
      const r=await staffLinkAttempt(col, data, chat, cm[1], msg.from);
      r.calls.forEach(c=>calls.push(c));
      if(r.ok&&newOwner) calls.push({method:'sendMessage',body:{chat_id:newOwner,text:'✅ '+r.name+' Telegram से जुड़ गए! अब उनके काम अपने-आप उन तक पहुँचेंगे।'}});
      if(r.alertOwner&&newOwner) calls.push({method:'sendMessage',body:{chat_id:newOwner,text:r.alertOwner}});
      return {calls,dirty:true,ownerChat:newOwner};
    }
    const st=staffByChat(data, chat);
    if(st){
      if(msg.voice||msg.audio){ calls.push({method:'sendMessage',body:{chat_id:chat,text:'🎙️ अभी बटन ही चलते हैं — नीचे ✅/⏳/❌/🕐 दबाइए।'}}); return {calls,dirty,ownerChat:newOwner}; }
      if(!st.own){ const o=focusOwnerIn(staffNameOf(data,st.cid)||st.name||''); if(o){ const l2=tgStaff(data); const e2=l2.find(x=>x.cid===st.cid); if(e2){ e2.own=o; await saveTgStaff(col,data,l2); st.own=o; } } }
      const d=(st.own&&focusItemsOf(data,st.own).length)?staffFocusDigest(data,st,now,st.pref||'detailed'):staffDigest(data,st,now);
      calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:d.text},d.reply_markup?{reply_markup:d.reply_markup}:{})});
      return {calls,dirty,ownerChat:newOwner};
    }
    calls.push({method:'sendMessage',body:{chat_id:chat,text:'🙏 यह विक्रम जी का निजी bot है।\nअगर आप VBE staff हैं तो विक्रम जी से link/QR लेकर जुड़ें।'}});
    return {calls,dirty,ownerChat:newOwner};
  }
  // 🎤 owner voice note → poller download करके geminiAudio से समझेगा (VOICE signal)
  if(msg.voice||msg.audio){
    if(!(data.settings&&data.settings.gemKey)) return {calls:[{method:'sendMessage',body:{chat_id:chat,text:'🎤 आवाज़ समझने के लिए पहले app के ⚙️ में Gemini key डालें (मुफ़्त)। तब बोलकर काम/सवाल दोनों कर सकेंगे।'}}],dirty,ownerChat:newOwner};
    const v=msg.voice||msg.audio;
    return {calls:[], dirty, ownerChat:newOwner, voice:{file_id:v.file_id, mime:v.mime_type||'audio/ogg', chat}};
  }
  const textIn=msg.text||msg.caption||'';
  if(!textIn) return {calls,dirty,ownerChat:newOwner};

  // 👥 owner के टीम-commands (Accountability Phase 1)
  const tlow=textIn.trim().toLowerCase();
  if(tlow==='/link'||tlow==='link'||tlow==='लिंक'||/^staff\s*(link|jodo|जोड़ो)$/.test(tlow)||/^telegram\s*link/.test(tlow)){
    const pm=linkPickMsg(data);
    calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',text:pm.text},pm.reply_markup?{reply_markup:pm.reply_markup}:{})});
    return {calls,dirty,ownerChat:newOwner};
  }
  let um;
  if((um=textIn.trim().match(/^(?:\/unlink|unlink|अनलिंक)\s+(.+)$/i))){
    const list=tgStaff(data);
    const tgt=list.find(s=>{ const nm=(staffNameOf(data,s.cid)||s.name||''); return nameScore({name:nm},um[1].toLowerCase().split(/\s+/))>=2; });
    if(tgt&&tgt.chatId){ tgt.chatId=''; tgt.code=''; await saveTgStaff(col,data,list);
      await logEv(col,{action:'unlinked',staff:tgt.cid,staffName:staffNameOf(data,tgt.cid)||tgt.name});
      calls.push({method:'sendMessage',body:{chat_id:chat,text:'🔌 '+(staffNameOf(data,tgt.cid)||tgt.name)+' का Telegram हटा दिया — अब उन्हें कुछ नहीं जाएगा। History सुरक्षित है।'}});
    } else calls.push({method:'sendMessage',body:{chat_id:chat,text:'⚠️ यह staff जुड़ा हुआ नहीं मिला। "टीम" लिखकर देखें कौन-कौन जुड़ा है।'}});
    return {calls,dirty,ownerChat:newOwner};
  }
  if(tlow==='/team'||tlow==='टीम'||tlow==='team'||tlow==='स्कोर'||tlow==='score'||tlow==='scoreboard'||tlow==='टीम स्कोर'){
    calls.push({method:'sendMessage',body:{chat_id:chat,parse_mode:'Markdown',text:teamScore(data,now)}});
    return {calls,dirty,ownerChat:newOwner};
  }

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

  // 🧠 "है/menu/दिमाग/मदद/start" → सारे feature बटन बनकर आएँ (owner को कुछ याद रखना न पड़े)
  const tl2=textIn.trim().toLowerCase().replace(/[!।.?]/g,'');
  if(['है','हैं','hai','menu','मेनू','मेन्यू','दिमाग','दिमाग़','brain','ai','एआई','start','/start','मदद','help','/menu','/help','/ai','/brain','सब','सब कुछ','क्या करूँ','क्या करुं'].includes(tl2)){
    const bm=brainMenu(data, now);
    calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:bm.text},bm.reply_markup?{reply_markup:bm.reply_markup}:{})});
    return {calls,dirty,ownerChat:newOwner};
  }

  let ans=answer(data,textIn,now);
  if(ans&&ans.addTask){ const r=await applyAdd(col,ans.addTask.cid,ans.addTask.text,ans.addTask.at); if(r.ok) dirty=true; else ans={text:'⚠️ जोड़ नहीं पाया — app से जोड़ लें'}; }
  // 🧠 पहचान में न आए → Gemini दिमाग़ से जवाब (context सहित); वो भी न दे → menu (dead-end नहीं)
  if(!ans){ const a=await brainReply(data,textIn,now); if(a) ans={text:a}; }
  if(!ans){
    const bm=brainMenu(data, now);
    calls.push({method:'sendMessage',body:Object.assign({chat_id:chat,parse_mode:'Markdown',disable_web_page_preview:true,text:'🤔 पक्का समझ नहीं आया — ये देखिए, बटन दबाइए या साफ़ लिखिए:\n\n'+bm.text},bm.reply_markup?{reply_markup:bm.reply_markup}:{})});
    return {calls,dirty,ownerChat:newOwner};
  }
  const body={chat_id:chat,text:(ans.text||'').slice(0,3900)};
  if(ans.reply_markup) body.reply_markup=ans.reply_markup;
  calls.push({method:'sendMessage',body});
  return {calls,dirty,ownerChat:newOwner};
}

/* ══ 📞⏰ RICH DIGESTS — नाम+नंबर(tap-call)+काम+कितना लेट, 6-8 प्रति page,
   ➡️ अगले-बटन से pagination (pgc/pgt), per-entry ✅ (cdn / d|) ══ */
function _dueCalls(data, now){
  return activeC(data.contacts)
    .filter(c=>c.nextCallAt&&new Date(c.nextCallAt).getTime()<=now)
    .sort((a,b)=>new Date(a.nextCallAt).getTime()-new Date(b.nextCallAt).getTime());
}
function callsDigest(data, now, start){
  const due=_dueCalls(data, now);
  if(!due.length) return {text:'📞 कोई call बाकी नहीं ✓'};
  let s0=Number(start)||0; if(s0>=due.length) s0=0;
  const page=due.slice(s0,s0+6);
  const lateN=due.filter(c=>now-new Date(c.nextCallAt).getTime()>3600e3).length;
  let text=`📞 *${due.length} calls बाकी* · 🔴 ${lateN} बहुत लेट (${s0+1}–${s0+page.length}/${due.length})\n`;
  page.forEach((c,i)=>{
    const late=now-new Date(c.nextCallAt).getTime();
    const tks=topics(c).filter(x=>!x.done&&!x.rvw).slice(0,2);
    const ph=c.phone||c.waPhone||''; const dig=_phoneDigits(ph);
    text+=`\n*${s0+i+1}. ${mdSafe(c.name||'?')}*${late>0?' — 🔴 '+fmtDur(late)+' लेट':''}\n`;
    if(dig) text+=telLink(ph,dig)+'\n';
    tks.forEach(x=>{ text+='   📋 '+mdSafe((x.t||'').slice(0,64))+'\n'; });
  });
  text+='\nनीचे नंबर दबाकर call निपटाओ 👇';
  const rows=[];
  for(let i=0;i<page.length;i+=3)
    rows.push(page.slice(i,i+3).map((c,j)=>({text:'✅ '+(s0+i+j+1),callback_data:('cdn|'+c.id+'|'+s0).slice(0,64)})));
  const nav=[];
  if(s0>0) nav.push({text:'◀️ पिछले',callback_data:'pgc|'+Math.max(0,s0-6)});
  if(s0+6<due.length) nav.push({text:'➡️ अगले '+Math.min(6,due.length-s0-6)+' देखें',callback_data:'pgc|'+(s0+6)});
  if(nav.length) rows.push(nav);
  return {text:text.slice(0,4050), reply_markup:{inline_keyboard:rows}};
}
function dueTasksDigest(data, now, start){
  const L=allTasks(data.contacts)
    .filter(x=>!x.done&&!x.rvw&&x.at&&new Date(x.at).getTime()<=now)
    .sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
  if(!L.length) return {text:'⏰ किसी काम का समय बाकी नहीं ✓'};
  let s0=Number(start)||0; if(s0>=L.length) s0=0;
  const page=L.slice(s0,s0+8);
  let text=`⏰ *${L.length} कामों का समय हो गया* (${s0+1}–${s0+page.length}/${L.length})\n`;
  page.forEach((x,i)=>{
    const late=now-new Date(x.at).getTime();
    const dig=_phoneDigits(x.phone);
    text+=`\n*${s0+i+1}.* ${mdSafe((x.t||'').slice(0,70))}\n   👤 ${mdSafe(x.name||'?')}${late>0?' · 🔴 '+fmtDur(late)+' लेट':''}${dig?'\n   '+telLink(x.phone,dig):''}\n`;
  });
  text+='\nनीचे नंबर दबाकर पूरा करो 👇';
  const rows=[];
  for(let i=0;i<page.length;i+=4)
    rows.push(page.slice(i,i+4).map((x,j)=>({text:'✅ '+(s0+i+j+1),callback_data:('d|'+x.cid+'|'+x.ti).slice(0,64)})));
  const nav=[];
  if(s0>0) nav.push({text:'◀️ पिछले',callback_data:'pgt|'+Math.max(0,s0-8)});
  if(s0+8<L.length) nav.push({text:'➡️ अगले '+Math.min(8,L.length-s0-8)+' काम देखें',callback_data:'pgt|'+(s0+8)});
  if(nav.length) rows.push(nav);
  return {text:text.slice(0,4050), reply_markup:{inline_keyboard:rows}};
}
/* ✅ call निपटी — nextCallAt साफ़ */
async function applyCallDone(col, cid){
  const dc=await col.doc(cid).get(); if(!dc.exists) return {ok:false};
  const c=dc.data();
  await col.doc(cid).set({nextCallAt:null, lastCallAt:new Date().toISOString()},{merge:true});
  return {ok:true, name:c.name||''};
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
  handleUpdate, autoPushNew, autoPushFocus, autoPushNudge, autoPushMenu,
  tgStaff, staffByChat, staffTasks, staffDigest, teamContacts, teamScore,
  staffLinkAttempt, makeLinkCode, linkPickMsg, autoPushStaffDigest, logEv,
  staffFocusDigest, autoPushFocusHourly, lateBadge, focusItemGuard, autoPushQueued, autoPushStaffReminder, mdSafe,
  geminiAsk, geminiAudio, brainContext, brainMenu, brainAnswer, brainReply, handleVoiceNote,
  callsDigest, dueTasksDigest, applyCallDone
};
