/* ============================================================
   ग्रंथ पुस्तकालय — रजिस्ट्री
   ------------------------------------------------------------
   नया ग्रंथ जोड़ने के लिए:
     1. data/<id>.js बनाइए  →  window.GRANTH_DATA["<id>"] = { … }
        (दो पाठ वाले ग्रंथ के लिए files: [meta, पाठ-1, पाठ-2])
     2. नीचे एक पंक्ति जोड़िए
     3. theme के तीन रंग चुनिए — बस, इंजन को छूने की ज़रूरत नहीं
   ============================================================ */

window.GRANTH_REGISTRY = [
  {
    id: "hariras",
    title: "हरिरस",
    files: ["data/hariras-meta.js", "data/hariras-k.js", "data/hariras-kh.js"],
    count: 361,
    unitLabel: "दोहा",
    order: 1,
    theme: { accent: "#E8B349", glow: "#D4A017", bg: "#0B1220" }
  },
  {
    id: "deviyaan",
    title: "देवियांण",
    file: "data/deviyaan.js",
    count: 98,
    unitLabel: "छंद",
    order: 2,
    theme: { accent: "#E0574A", glow: "#C0392B", bg: "#160B10" }
  }
];
