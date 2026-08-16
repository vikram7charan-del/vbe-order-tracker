# ग्रंथ पुस्तकालय — नया ग्रंथ कैसे जोड़ें

1. **डेटा फाइल बनाइए** — `data/<id>.js`, और उसमें सिर्फ़ इतना लिखिए:
   `window.GRANTH_DATA["<id>"] = { id, title, invocation, subtitle, author, note, rangeLabel, unitLabel, hasPaathVariants, theme, sections:[…] };`
2. **हर भाग** ऐसा हो: `{ id:"…", title:"…", subtitle:"…", verses:[ { n:1, lines:["…"], artha:"…", shabdarth:null } ] }`
   पंक्तियाँ अलग-अलग रखिए, जोड़िए मत। `॥1॥` जैसी संख्या पाठ में मत डालिए — वह `n` में जाती है।
3. **रजिस्ट्री में एक पंक्ति** जोड़िए — `data/registry.js` में id, title, file, count, unitLabel, order और तीन रंग:
   `theme: { accent:"#…", glow:"#…", bg:"#…" }`. बस — इंजन (`granth.html`) को छूने की ज़रूरत नहीं।
4. **रंग** ही ग्रंथ की पहचान हैं: `accent` (मुख्य), `glow` (आभा), `bg` (रात का पृष्ठ)।
5. जिस पद का `artha` खाली (`""`) होगा, उस पर चुपचाप **अर्थ शेष** लिखा आएगा — कोई गड़बड़ी नहीं दिखेगी।
6. जिस ग्रंथ में `hasPaathVariants: false` होगा, उसमें **क / ख / दोनों** वाली पट्टी अपने आप छिप जाएगी।
7. दूसरा पाठ हो तो पद में `paathB: { meter, title, lines:[…], artha }` जोड़ दीजिए और ग्रंथ में `hasPaathVariants: true` कर दीजिए।
8. **वर्तनी अक्षरशः** रखिए — `ळ`, द्वित्व व्यंजन, अनुस्वार, हळंत, `–` — किसी का "सुधार" नहीं।
9. फाइलें अपने-आप ज़रूरत पर लोड होती हैं, इसलिए ग्रंथ कितने भी हों, फ़ोन धीमा नहीं होगा।
10. सीधा लिंक ऐसे बनता है: `granth.html#hariras` · किसी पद तक `granth.html#hariras/61` · जहाँ नंबर दोहराते हैं वहाँ `granth.html#deviyaan/bhujangi:3`
