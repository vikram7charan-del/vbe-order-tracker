// ╔══════════════════════════════════════════════════════╗
// ║  Firebase Messaging Service Worker                  ║
// ║  Background notifications के लिए — Browser बंद होने ║
// ║  के बाद भी notifications मिलेंगे                      ║
// ╚══════════════════════════════════════════════════════╝
//
// ⚠️ इस file को website के root पर रखना है (index.html के साथ)
// GitHub Pages पर: https://vikram7charan-del.github.io/vbe-order-tracker/firebase-messaging-sw.js
// इस URL को browser में खोलकर check करो — file load होनी चाहिए

// Firebase v10 compat scripts (service worker में module imports नहीं चलते)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config — same as index.html
firebase.initializeApp({
  apiKey:            "AIzaSyBCe5DKNKcthOl4umprfRm2QBfbVaFORg8",
  authDomain:        "vbe-order-tracker-60324.firebaseapp.com",
  projectId:         "vbe-order-tracker-60324",
  storageBucket:     "vbe-order-tracker-60324.firebasestorage.app",
  messagingSenderId: "894023456122",
  appId:             "1:894023456122:web:6ee548f0913c887c67f2c3"
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage((payload)=>{
  console.log('[FCM-SW] Background message:', payload);
  const title = payload.notification?.title || 'VBE Order Tracker';
  const options = {
    body: payload.notification?.body || 'नया update',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.data?.orderId || 'vbe-notif',
    requireInteraction: payload.data?.priority === 'urgent',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// On notification click — open the app
self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  const orderId = event.notification.data?.orderId;
  const url = orderId
    ? `/vbe-order-tracker/#track=${orderId}`
    : '/vbe-order-tracker/';
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then((clientList)=>{
      // If app already open — focus it
      for(const client of clientList){
        if(client.url.includes('vbe-order-tracker') && 'focus' in client){
          client.focus();
          return;
        }
      }
      // Otherwise open new window
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
