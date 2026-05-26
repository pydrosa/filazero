import admin from 'firebase-admin';
import axios from 'axios';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

admin.initializeApp();
const db = admin.firestore();
const REGION = 'southamerica-east1';

const PLANS = {
  STARTER: { name: 'Starter', value: 39.00 },
  PRO: { name: 'Pro', value: 79.00 },
  MULTI: { name: 'Multiunidade', value: 149.00 }
};

export const notifyOrderReady = onDocumentUpdated({ region: REGION, document: 'orders/{orderId}' }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status === after.status || after.status !== 'PRONTO') return;

  const tokensSnap = await db.collection('orders').doc(event.params.orderId).collection('tokens').get();
  const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
  if (!tokens.length) return;

  const message = {
    notification: {
      title: 'Pedido pronto 🎉',
      body: `Seu pedido #${after.numeroPedido} está disponível para retirada.`
    },
    data: {
      orderId: event.params.orderId,
      status: 'PRONTO',
      url: `/p/${event.params.orderId}`
    },
    webpush: {
      fcmOptions: { link: `/p/${event.params.orderId}` },
      notification: { vibrate: [300, 120, 300] }
    },
    tokens
  };

  const result = await admin.messaging().sendEachForMulticast(message);
  logger.info('Push enviado', { orderId: event.params.orderId, success: result.successCount, failure: result.failureCount });
});

export const createCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login.');
  const { companyId, plan = 'PRO' } = request.data || {};
  if (!companyId || !PLANS[plan]) throw new HttpsError('invalid-argument', 'Plano ou empresa inválidos.');

  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) throw new HttpsError('not-found', 'Empresa não encontrada.');
  const company = companySnap.data();
  if (company.ownerUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Sem permissão.');

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new HttpsError('failed-precondition', 'Configure ASAAS_API_KEY nas Functions.');
  const baseURL = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';

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

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
  const payment = await axios.post(`${baseURL}/payments`, {
    customer: customerId,
    billingType: 'UNDEFINED',
    value: PLANS[plan].value,
    dueDate,
    description: `FilaZero - Plano ${PLANS[plan].name}`,
    externalReference: companyId
  }, { headers: { access_token: apiKey } });

  await db.collection('payments').doc(payment.data.id).set({
    ownerUid: request.auth.uid,
    companyId,
    plan,
    status: payment.data.status,
    value: PLANS[plan].value,
    invoiceUrl: payment.data.invoiceUrl || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { paymentId: payment.data.id, invoiceUrl: payment.data.invoiceUrl, status: payment.data.status };
});

export const asaasWebhook = onRequest({ region: REGION }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (expected && req.get('asaas-access-token') !== expected) return res.status(401).send('Unauthorized');

    const event = req.body?.event;
    const payment = req.body?.payment;
    if (!payment?.id) return res.status(400).send('Missing payment');

    const companyId = payment.externalReference;
    await db.collection('payments').doc(payment.id).set({
      companyId,
      event,
      status: payment.status,
      value: payment.value,
      invoiceUrl: payment.invoiceUrl || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: payment
    }, { merge: true });

    if (companyId) {
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
    }
    return res.status(200).send('ok');
  } catch (err) {
    logger.error(err);
    return res.status(500).send('error');
  }
});
