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

// Notification पर tap करने से app खुले
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (const c of list) { if (c.url && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
