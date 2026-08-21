# ✅ Auto-Calendar — Test Checklist

सेटअप (SETUP-HINDI.md) पूरा होने के बाद ये जाँचें। हर ✅ पूरा होने पर feature तैयार।

## मुख्य flow
- [ ] नया काम बनाया → ~15 मिनट बाद Google Calendar में `🎯 …` event दिखा
- [ ] Event पर ठीक समय पर popup reminder बजा (0-min)
- [ ] follow-up समय (default 60 मिनट) बाद `🔁 फॉलो-अप …` event बना
- [ ] काम पर ✅ लगाया → main + follow-up दोनों events Calendar से हट गए
- [ ] app में उस काम पर pill बदला: ⏳ → 📅 कैलेंडर में → (अटके पर) 🔁/⚠️

## Escalation
- [ ] follow-up के बाद काम pending रहा → Telegram पर `⚠️ अटका काम (1/3)` आया
- [ ] 3 बार के बाद card पर लाल `⚠️ अटका हुआ` + glow दिखा
- [ ] रात (शांति समय) में escalation nudge नहीं आया

## समय/quiet
- [ ] रात 11 बजे बनाया काम → event अगली सुबह ~7 बजे का बना (urgent छोड़कर)
- [ ] urgent (🔴 high) काम → तुरंत वाला समय, सुबह पर नहीं खिसका

## भरोसेमंदी
- [ ] worker दो बार चला → वही event दोबारा नहीं बना (कोई duplicate नहीं)
- [ ] पुराने (feature से पहले जुड़े) कामों के events नहीं बने
- [ ] Calendar API बंद/ID गलत → app ⚙️ में last-sync पुराना दिखा, कोई crash नहीं

## UI (मोबाइल)
- [ ] pending काम पर checkbox के पास countdown ring smooth चली
- [ ] pill/ring से कोई layout टूटा नहीं, स्क्रॉल ठीक
- [ ] "🔄 N काम जुड़ने वाले हैं" banner ऊपर दिखा
- [ ] काम पर long-press → "अभी कैलेंडर में डालो" ने तुरंत Calendar खोला
- [ ] long-press वाले काम का auto-event दोबारा नहीं बना (dupe नहीं)
- [ ] ⚙️ सेटिंग: lead/follow-up/quiet/escalation/Calendar ID सेव हुए, अगली sync में लागू
- [ ] "animation कम करो" वाला फ़ोन → ring/slide शांत (reduced-motion)
