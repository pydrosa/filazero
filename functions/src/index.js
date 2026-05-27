import admin from 'firebase-admin';
import axios from 'axios';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

admin.initializeApp();
const db = admin.firestore();
const REGION = 'southamerica-east1';
const TRIAL_DAYS = 7;

const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');
const APP_BASE_URL = defineString('APP_BASE_URL');
const ASAAS_BASE_URL = defineString('ASAAS_BASE_URL', {
  default: 'https://sandbox.asaas.com/api/v3'
});

const PLANS = {
  STARTER: { name: 'Starter', value: 39.00 },
  PRO: { name: 'Pro', value: 79.00 },
  MULTI: { name: 'Multiunidade', value: 149.00 }
};

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  return request.auth.uid;
}

function toText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function subscriptionIsActive(company) {
  const now = Date.now();
  if (company.subscriptionStatus === 'TRIAL') {
    return company.trialEndsAt?.toMillis?.() > now;
  }
  if (company.subscriptionStatus === 'ACTIVE') {
    return company.subscriptionValidUntil?.toMillis?.() > now;
  }
  return false;
}

function publicOrderData(order) {
  return {
    companyName: order.companyName,
    numeroPedido: order.numeroPedido,
    status: order.status,
    createdAt: order.createdAt,
    readyAt: order.readyAt || null,
    deliveredAt: order.deliveredAt || null
  };
}

function orderLink(orderId) {
  const baseURL = APP_BASE_URL.value();
  if (!/^https:\/\//i.test(baseURL)) {
    throw new Error('APP_BASE_URL deve ser uma URL HTTPS publica.');
  }
  return new URL(`/p/${encodeURIComponent(orderId)}`, baseURL).toString();
}

export const createCompany = onCall({ region: REGION }, async (request) => {
  const ownerUid = requireAuth(request);
  const nome = toText(request.data?.nome, 120);
  const cnpj = String(request.data?.cnpj || '').replace(/\D/g, '').slice(0, 14);
  if (!nome) throw new HttpsError('invalid-argument', 'Informe o nome do estabelecimento.');

  const existing = await db.collection('companies').where('ownerUid', '==', ownerUid).limit(1).get();
  if (!existing.empty) throw new HttpsError('already-exists', 'Voce ja possui um estabelecimento.');

  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const trialEndsAt = admin.firestore.Timestamp.fromMillis(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const ref = db.collection('companies').doc(ownerUid);
  try {
    await ref.create({
      ownerUid,
      nome,
      cnpj,
      plan: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      createdAt,
      trialEndsAt,
      subscriptionValidUntil: null,
      nextOrderNumber: 0
    });
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') {
      throw new HttpsError('already-exists', 'Voce ja possui um estabelecimento.');
    }
    throw error;
  }
  return { companyId: ref.id };
});

export const createOrder = onCall({ region: REGION }, async (request) => {
  const ownerUid = requireAuth(request);
  const companyId = toText(request.data?.companyId, 200);
  const cliente = toText(request.data?.cliente, 80) || 'Cliente';
  if (!companyId) throw new HttpsError('invalid-argument', 'Empresa invalida.');

  const companyRef = db.collection('companies').doc(companyId);
  const orderRef = db.collection('orders').doc();
  const publicRef = db.collection('publicOrders').doc(orderRef.id);
  let numeroPedido;

  await db.runTransaction(async (transaction) => {
    const companySnap = await transaction.get(companyRef);
    if (!companySnap.exists || companySnap.data().ownerUid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Sem permissao.');
    }
    const company = companySnap.data();
    if (!subscriptionIsActive(company)) {
      throw new HttpsError('failed-precondition', 'Assinatura inativa. Regularize para criar pedidos.');
    }
    numeroPedido = Number(company.nextOrderNumber || 0) + 1;
    const order = {
      companyId,
      companyName: company.nome,
      numeroPedido,
      cliente,
      status: 'EM_PREPARO',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readyAt: null,
      deliveredAt: null
    };
    transaction.update(companyRef, { nextOrderNumber: numeroPedido });
    transaction.set(orderRef, order);
    transaction.set(publicRef, publicOrderData(order));
  });

  return { orderId: orderRef.id, numeroPedido };
});

export const updateOrderStatus = onCall({ region: REGION }, async (request) => {
  const ownerUid = requireAuth(request);
  const orderId = toText(request.data?.orderId, 200);
  const nextStatus = toText(request.data?.status, 30);
  const transitions = {
    EM_PREPARO: ['PRONTO', 'CANCELADO'],
    PRONTO: ['ENTREGUE', 'CANCELADO']
  };
  if (!orderId || !['PRONTO', 'ENTREGUE', 'CANCELADO'].includes(nextStatus)) {
    throw new HttpsError('invalid-argument', 'Pedido ou status invalido.');
  }

  await db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Pedido nao encontrado.');
    const order = orderSnap.data();
    const companySnap = await transaction.get(db.collection('companies').doc(order.companyId));
    if (!companySnap.exists || companySnap.data().ownerUid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Sem permissao.');
    }
    if (order.status !== nextStatus && !transitions[order.status]?.includes(nextStatus)) {
      throw new HttpsError('failed-precondition', 'Alteracao de status invalida.');
    }

    const changes = { status: nextStatus };
    if (nextStatus === 'PRONTO') changes.readyAt = admin.firestore.FieldValue.serverTimestamp();
    if (nextStatus === 'ENTREGUE') changes.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
    transaction.update(orderRef, changes);
    transaction.set(
      db.collection('publicOrders').doc(orderId),
      publicOrderData({ ...order, ...changes }),
      { merge: true }
    );
  });
  return { status: nextStatus };
});

export const notifyOrderReady = onDocumentUpdated({ region: REGION, document: 'orders/{orderId}' }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status === after.status || after.status !== 'PRONTO') return;

  const tokensSnap = await db.collection('publicOrders').doc(event.params.orderId).collection('tokens').get();
  const tokens = tokensSnap.docs.map((doc) => doc.data().token).filter(Boolean);
  if (!tokens.length) return;

  const url = orderLink(event.params.orderId);
  const message = {
    notification: {
      title: 'Pedido pronto!',
      body: `Seu pedido #${after.numeroPedido} esta disponivel para retirada.`
    },
    data: {
      orderId: event.params.orderId,
      status: 'PRONTO',
      url
    },
    webpush: {
      fcmOptions: { link: url },
      notification: { vibrate: [300, 120, 300] }
    },
    tokens
  };

  const result = await admin.messaging().sendEachForMulticast(message);
  logger.info('Push enviado', {
    orderId: event.params.orderId,
    success: result.successCount,
    failure: result.failureCount
  });
});

export const createCheckout = onCall({ region: REGION, secrets: [ASAAS_API_KEY] }, async (request) => {
  const ownerUid = requireAuth(request);
  const { companyId, plan = 'PRO' } = request.data || {};
  if (!companyId || !PLANS[plan]) throw new HttpsError('invalid-argument', 'Plano ou empresa invalidos.');

  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) throw new HttpsError('not-found', 'Empresa nao encontrada.');
  const company = companySnap.data();
  if (company.ownerUid !== ownerUid) throw new HttpsError('permission-denied', 'Sem permissao.');

  const apiKey = ASAAS_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Configure ASAAS_API_KEY nas Functions.');
  const baseURL = ASAAS_BASE_URL.value();

  let customerId = company.asaasCustomerId;
  if (!customerId) {
    const customer = await axios.post(`${baseURL}/customers`, {
      name: company.nome,
      cpfCnpj: (company.cnpj || '').replace(/\D/g, ''),
      email: request.auth.token.email
    }, { headers: { access_token: apiKey } });
    customerId = customer.data.id;
    await companyRef.update({ asaasCustomerId: customerId });
  }

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const payment = await axios.post(`${baseURL}/payments`, {
    customer: customerId,
    billingType: 'UNDEFINED',
    value: PLANS[plan].value,
    dueDate,
    description: `FilaZero - Plano ${PLANS[plan].name}`,
    externalReference: companyId
  }, { headers: { access_token: apiKey } });

  await db.collection('payments').doc(payment.data.id).set({
    ownerUid,
    companyId,
    plan,
    status: payment.data.status,
    value: PLANS[plan].value,
    invoiceUrl: payment.data.invoiceUrl || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { paymentId: payment.data.id, invoiceUrl: payment.data.invoiceUrl, status: payment.data.status };
});

export const asaasWebhook = onRequest({ region: REGION, secrets: [ASAAS_WEBHOOK_TOKEN] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    const expected = ASAAS_WEBHOOK_TOKEN.value();
    if (!expected) return res.status(503).send('Webhook token not configured');
    if (req.get('asaas-access-token') !== expected) return res.status(401).send('Unauthorized');

    const event = req.body?.event;
    const payment = req.body?.payment;
    if (!payment?.id) return res.status(400).send('Missing payment');
    const paymentRef = db.collection('payments').doc(payment.id);
    const storedPayment = await paymentRef.get();
    if (!storedPayment.exists) return res.status(202).send('Unknown payment ignored');
    const companyId = storedPayment.data().companyId;
    if (!companyId || payment.externalReference !== companyId) {
      return res.status(400).send('Payment reference mismatch');
    }

    await paymentRef.set({
      event,
      status: payment.status,
      value: payment.value,
      invoiceUrl: payment.invoiceUrl || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const activeStatuses = ['RECEIVED', 'CONFIRMED'];
    const overdueStatuses = ['OVERDUE', 'REFUNDED', 'CANCELED', 'DELETED'];
    if (activeStatuses.includes(payment.status)) {
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + 31);
      await db.collection('companies').doc(companyId).update({
        subscriptionStatus: 'ACTIVE',
        lastPaymentStatus: payment.status,
        subscriptionValidUntil: admin.firestore.Timestamp.fromDate(nextDue)
      });
    } else if (overdueStatuses.includes(payment.status)) {
      await db.collection('companies').doc(companyId).update({
        subscriptionStatus: 'INACTIVE',
        lastPaymentStatus: payment.status
      });
    }
    return res.status(200).send('ok');
  } catch (err) {
    logger.error(err);
    return res.status(500).send('error');
  }
});
