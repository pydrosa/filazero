import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getFirestore, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'southamerica-east1');
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export const createCheckout = httpsCallable(functions, 'createCheckout');

const callCreateCompany = httpsCallable(functions, 'createCompany');
const callCreateOrder = httpsCallable(functions, 'createOrder');
const callUpdateOrderStatus = httpsCallable(functions, 'updateOrderStatus');
const TRIAL_DAYS = 7;

function currentUserId() {
  if (!auth.currentUser) throw new Error('Faca login novamente.');
  return auth.currentUser.uid;
}

async function createDemoCompany({ nome, cnpj }) {
  const ownerUid = currentUserId();
  const companyName = String(nome || '').trim().slice(0, 120);
  if (!companyName) throw new Error('Informe o nome do estabelecimento.');
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, 'companies', ownerUid);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) throw new Error('Voce ja possui um estabelecimento.');
    transaction.set(ref, {
      ownerUid,
      nome: companyName,
      cnpj: String(cnpj || '').replace(/\D/g, '').slice(0, 14),
      plan: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      createdAt: serverTimestamp(),
      trialEndsAt: Timestamp.fromMillis(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      subscriptionValidUntil: null,
      nextOrderNumber: 0
    });
  });
  return { data: { companyId: ownerUid } };
}

async function createDemoOrder({ companyId, cliente }) {
  const ownerUid = currentUserId();
  const companyRef = doc(db, 'companies', companyId);
  const orderRef = doc(collection(db, 'orders'));
  let numeroPedido;
  await runTransaction(db, async (transaction) => {
    const companySnapshot = await transaction.get(companyRef);
    const company = companySnapshot.data();
    if (!companySnapshot.exists() || company.ownerUid !== ownerUid) throw new Error('Sem permissao.');
    if (company.trialEndsAt?.toMillis?.() <= Date.now()) throw new Error('Periodo de teste encerrado.');
    numeroPedido = Number(company.nextOrderNumber || 0) + 1;
    const order = {
      companyId,
      companyName: company.nome,
      numeroPedido,
      cliente: String(cliente || '').trim().slice(0, 80) || 'Cliente',
      status: 'EM_PREPARO',
      createdAt: serverTimestamp(),
      readyAt: null,
      deliveredAt: null
    };
    transaction.update(companyRef, { nextOrderNumber: numeroPedido });
    transaction.set(orderRef, order);
    transaction.set(doc(db, 'publicOrders', orderRef.id), {
      companyName: order.companyName,
      numeroPedido,
      status: order.status,
      createdAt: order.createdAt,
      readyAt: null,
      deliveredAt: null
    });
  });
  return { data: { orderId: orderRef.id, numeroPedido } };
}

async function updateDemoOrderStatus({ orderId, status }) {
  const transitions = { EM_PREPARO: ['PRONTO', 'CANCELADO'], PRONTO: ['ENTREGUE', 'CANCELADO'] };
  await runTransaction(db, async (transaction) => {
    const orderRef = doc(db, 'orders', orderId);
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists()) throw new Error('Pedido nao encontrado.');
    const order = snapshot.data();
    if (!transitions[order.status]?.includes(status)) throw new Error('Alteracao de status invalida.');
    const changes = { status };
    if (status === 'PRONTO') changes.readyAt = serverTimestamp();
    if (status === 'ENTREGUE') changes.deliveredAt = serverTimestamp();
    transaction.update(orderRef, changes);
    transaction.update(doc(db, 'publicOrders', orderId), changes);
  });
  return { data: { status } };
}

export const createCompany = DEMO_MODE ? createDemoCompany : callCreateCompany;
export const createOrder = DEMO_MODE ? createDemoOrder : callCreateOrder;
export const updateOrderStatus = DEMO_MODE ? updateDemoOrderStatus : callUpdateOrderStatus;

export async function requestPushToken() {
  const supported = await isSupported();
  if (!supported) throw new Error('Este navegador não suporta notificações push via FCM.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão de notificação negada.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration
  });
  return token;
}

export async function listenForegroundMessages(callback) {
  const supported = await isSupported();
  if (!supported) return () => {};
  return onMessage(getMessaging(app), callback);
}
