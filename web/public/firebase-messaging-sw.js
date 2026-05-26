importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'SUBSTITUA_API_KEY',
  authDomain: 'SUBSTITUA_AUTH_DOMAIN',
  projectId: 'SUBSTITUA_PROJECT_ID',
  storageBucket: 'SUBSTITUA_STORAGE_BUCKET',
  messagingSenderId: 'SUBSTITUA_MESSAGING_SENDER_ID',
  appId: 'SUBSTITUA_APP_ID'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Pedido pronto';
  const options = {
    body: payload.notification?.body || 'Seu pedido está disponível para retirada.',
    icon: '/icon-192.png',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});
