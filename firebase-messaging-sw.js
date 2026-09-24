/* ══════════════════════════════════════════════════════════
   VBE Order Tracker — FCM Background Service Worker
   ──────────────────────────────────────────────────────────
   यह फाइल GitHub repo के ROOT में index.html के साथ रखो
   (नाम बिल्कुल यही: firebase-messaging-sw.js)

   यह तभी काम करता है जब:
   1) index.html में VAPID_KEY भरा हो
   2) कोई server/Cloud Function token पर push भेजे
   App बंद/background होने पर notification यहीं से दिखती है।
   ══════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBCe5DKNKcthOl4umprfRm2QBfbVaFORg8",
  authDomain:        "vbe-order-tracker-60324.firebaseapp.com",
  projectId:         "vbe-order-tracker-60324",
  storageBucket:     "vbe-order-tracker-60324.firebasestorage.app",
  messagingSenderId: "894023456122",
  appId:             "1:894023456122:web:6ee548f0913c887c67f2c3"
});

const messaging = firebase.messaging();

// Background में message आने पर notification दिखाओ
messaging.onBackgroundMessage(function(payload){
  const title = (payload.notification && payload.notification.title) || '🔔 VBE Tracker';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag:  (payload.data && payload.data.orderId) ? 'vbe-' + payload.data.orderId : 'vbe-notif',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// Notification पर tap करने से app खुले (data.link हो तो वही page)
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (const c of list) {
        if (c.url && c.url.indexOf(new URL(link, self.location.origin).pathname) !== -1 && 'focus' in c) return c.focus();
      }
      for (const c of list) { if (c.url && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});

/* ══════════════════════════════════════════════════════════
   📶 Offline app-shell cache — नेट कमज़ोर/बंद हो तब भी app खुले
   ──────────────────────────────────────────────────────────
   पूरे repo की हर page यही एक SW (root scope) register करती है, इसलिए यहाँ
   सिर्फ़ रन-टाइम caching (जो असल में खुला उसे save करो) — कोई fixed file-list
   precache नहीं, ताकि हर page (call-tracker/kharcha/index...) अपने-आप cover हो।
   Firestore/Auth को कभी नहीं छूते — सिर्फ़ अपने origin + fonts/gstatic जैसे
   जाने-पहचाने static hosts। version बदलते ही पुराना cache अपने-आप साफ़।
   ══════════════════════════════════════════════════════════ */
const SHELL_CACHE = 'vbe-shell-v1';
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes/Firestore streaming को कभी मत छुओ
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  const sameOrigin = url.origin === self.location.origin;
  const isRuntimeHost = RUNTIME_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isRuntimeHost) return; // बाक़ी सब browser पर छोड़ो

  // पेज (HTML navigation) — network-first ताकि deploy के बाद हमेशा latest मिले;
  // नेट न हो तभी आख़िरी बार का cached page दिखे (कुछ न मिले तो साफ़ हिंदी संदेश)
  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(SHELL_CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response(
          '<meta charset="utf-8"><body style="background:#050a14;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:60px 20px">📶 ऑफ़लाइन — नेट कमज़ोर है।<br>नेट वापस आते ही अपने-आप खुल जाएगा।</body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // बाक़ी static (CSS/JS/font/icon/manifest/SDK) — पहले cache से तुरंत दो, पीछे से ताज़ा भी कर लो
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
