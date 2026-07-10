# VBE खर्चा ट्रैकर — Cloud Function (AI Bill Extract)

Anthropic API key को client से बाहर रखने के लिए proxy। bill photo → Claude vision → items/rates/total JSON.

## Deploy (एक बार)

```bash
# 1. firebase.json में functions source जोड़ें (अगर पहले से नहीं है):
#    "functions": [{ "source": "kharcha-functions", "codebase": "kharcha" }]

cd kharcha-functions
npm install

# 2. API key को Secret Manager में डालें (client में कभी नहीं!)
firebase functions:secrets:set ANTHROPIC_API_KEY
# prompt पर अपनी sk-ant-... key paste करें

# 3. Deploy
firebase deploy --only functions:aiBillExtract
```

Deploy के बाद मिला URL (जैसे `https://aibillextract-xxxxx-el.a.run.app`) को
**kharcha-entry.html → ⚙️ AI Settings → Cloud Function Proxy URL** में paste करके Save करें।

## Security

- Firebase ID token verify होता है — सिर्फ logged-in users
- Role check — `vbe_admins` या `vbe_users` (role=staff) में होना जरूरी
- API key Secret Manager में, code/client में कहीं नहीं

## Test

```bash
# Browser console में (login के बाद, kharcha-entry.html पर):
# bill photo चुनें और "🤖 AI से Bill पढ़ें" दबाएं — form auto-fill होगा
```
