importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBEiUU61hM3hDVCNnuHkJwVKrKAxmLKf1E',
  authDomain: 'filazero-1996.firebaseapp.com',
  projectId: 'filazero-1996',
  storageBucket: 'filazero-1996.firebasestorage.app',
  messagingSenderId: '725795730741',
  appId: '1:725795730741:web:fe61d28ce6ba2e62a7c87c'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Pedido pronto';
  const options = {
    body: payload.notification?.body || 'Seu pedido está disponível para retirada.',
    icon: '/icon.svg',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});
