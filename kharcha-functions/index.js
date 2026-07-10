/**
 * VBE खर्चा ट्रैकर — AI Bill Extract proxy
 *
 * Anthropic API key server पर रहती है (Secret Manager), client में कभी नहीं।
 * सिर्फ logged-in VBE users (vbe_admins या vbe_users/role=staff) call कर सकते हैं।
 *
 * Deploy:
 *   cd kharcha-functions
 *   npm install
 *   firebase functions:secrets:set ANTHROPIC_API_KEY   (अपनी sk-ant-... key paste करें)
 *   firebase deploy --only functions:aiBillExtract
 *
 * फिर deployed URL को kharcha-entry.html के "AI Settings → Proxy URL" में डालें।
 */
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.aiBillExtract = onRequest(
  { secrets: [ANTHROPIC_API_KEY], region: "asia-south1", cors: true, memory: "512MiB", timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    try {
      // 1. Firebase ID token verify
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!idToken) {
        res.status(401).json({ error: "Missing Authorization: Bearer <idToken>" });
        return;
      }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      // 2. Role check — admin या staff
      const db = admin.firestore();
      const [adminDoc, userDoc] = await Promise.all([
        db.doc(`vbe_admins/${uid}`).get(),
        db.doc(`vbe_users/${uid}`).get(),
      ]);
      const allowed = adminDoc.exists || (userDoc.exists && userDoc.get("role") === "staff");
      if (!allowed) {
        res.status(403).json({ error: "Not a VBE user" });
        return;
      }

      // 3. Input
      const { imageBase64, mediaType, prompt } = req.body || {};
      if (!imageBase64 || !mediaType) {
        res.status(400).json({ error: "imageBase64 और mediaType जरूरी" });
        return;
      }
      if (imageBase64.length > 6 * 1024 * 1024) {
        res.status(413).json({ error: "Image बहुत बड़ी है (max ~4MB)" });
        return;
      }

      // 4. Anthropic vision call
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: prompt || "Extract vendor, date, items (name/qty/unit/rate/amount) and total from this bill as JSON only." },
            ],
          },
        ],
      });

      const text = (message.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      res.json({ text, usage: message.usage });
    } catch (e) {
      console.error("aiBillExtract error:", e);
      const status = e.status || (String(e.message || "").includes("token") ? 401 : 500);
      res.status(status).json({ error: e.message || "Internal error" });
    }
  }
);
