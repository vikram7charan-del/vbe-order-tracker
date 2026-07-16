# VBE Business OS — UI/UX Design System (v2)

यह guide पूरे app में **एक जैसा दिखने और चलने** के लिए है। कोई भी नई screen या बदलाव इसी के हिसाब से हो। लक्ष्य: Apple / Linear / Stripe जैसा साफ़, तेज़, premium — भड़कीलापन नहीं।

## 1. मूल सिद्धांत
- **Consistency पहले**: हर screen का header, menu, filter, button एक ही जगह, एक ही तरीके से।
- **One-hand, 3-tap**: कोई भी काम अंगूठे से, ज़्यादा-से-ज़्यादा 3 tap में।
- **कम सोचना पड़े**: गैर-ज़रूरी बटन/रंग/popup नहीं। हर चीज़ का साफ़ मकसद।
- **मोबाइल-only**: `max-width:480px`, centered। कभी desktop layout नहीं।

## 2. Color System (CSS variables — हर page में एक जैसे)
```
--blue:#2563eb  --blue-d:#1d4ed8   (Primary — royal blue)
--emerald:#059669 / #10b981        (आमदनी / positive)
--amber:#d97706                     (चेतावनी / bill बाकी)
--red:#e11d48                       (खर्च / danger)
--ink:#0f172a  --ink2:#475569  --ink3:#94a3b8   (text: गहरा→हल्का)
--bg:#f5f6f8   --card:#ffffff   --line:#eef1f5
```
नियम: rainbow UI नहीं। ज़्यादा gradient नहीं (सिर्फ hero/FAB पर)। पैसा आया = emerald, गया = red, बाकी सब blue/ink।

## 3. Typography
- Font: `'Inter','Noto Sans Devanagari',system-ui` (Latin+Devanagari दोनों साफ़)।
- headings बड़े-bold (`font-weight:800`, `letter-spacing:-.02em`), body साफ़ readable।
- कभी crowd न करें — spacing खुला रखें।

## 4. Icons
- **सिर्फ outline (Lucide-style) SVG icons** — production में emoji icon नहीं (`stroke-width:2`, `24×24 viewBox`)।
- एक ही size/stroke हर जगह। रंग `currentColor` से।
- (emoji सिर्फ decorative micro-जगहों पर ठीक, navigation/stat/action में नहीं।)

## 5. Cards & Radius & Shadow
- Card: `background:#fff; border:1px solid var(--line); border-radius:16-22px;`
- Shadow (subtle, layered): `0 4px 16px -6px rgba(16,24,40,.12), 0 1px 3px rgba(16,24,40,.04)`
- Hero/FAB बड़ा radius (20-24px) + रंगीन shadow।

## 6. Navigation (हर page में समान — `.v2nav` block)
- **नीचे fixed bottom nav**: होम · बही · ➕(बीच में raised FAB → खर्चा एंट्री) · पेमेंट · और
- active item blue। `और` → नीचे से **bottom-sheet menu** (9 clean tiles) खुलता है।
- ऊपर-दाएँ `.vbe-menu-btn` (☰) भी वही sheet खोलता है।
- **body में `padding-bottom:94px`** ताकि content nav के पीछे न छिपे।
- कभी पुराना emoji-grid menu या बिखरे हुए top links नहीं।

## 7. Filters (एक जैसा हर जगह)
- **Horizontal scroll chips** (`.chip`): पहला "सभी", फिर विकल्प। active chip भरा हुआ (blue/teal gradient)।
- Filter हमेशा content के ऊपर, sticky। account/firm/तारीख — सब इसी pattern में।

## 8. Animation
- 150–250ms, subtle। fade / slide-up / scale(.95 on :active)। कभी over-animate नहीं।
- bottom-sheet: `translateY(30px)→0` 220ms ease।

## 9. Buttons
- Primary: भरा हुआ blue gradient, `border-radius:12px`, `:active{scale(.99)}`।
- Ghost: हल्का tint background + border।
- हर page में एक ही button style। "मुख्य क्रिया" हमेशा साफ़ दिखे।

## 10. Screen ढांचा (हर page यही क्रम)
1. **Header** (title + बाएँ context, दाएँ menu) — छोटा, साफ़।
2. **Filter chips** (अगर list है)।
3. **Summary / hero** (अगर आँकड़े हैं) — 3D card।
4. **Content** (cards / list rows — एक जैसा row design)।
5. **Bottom nav** (fixed, हर page)।

## संदर्भ implementation
`home.html` = इस design का सबसे शुद्ध रूप (reference)। नई/बदली screens इसी की नकल करें। `.v2nav`+`.v2sheet` block हर page में identical है — उसे कभी अलग न करें।
