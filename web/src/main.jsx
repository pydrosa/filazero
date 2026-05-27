import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import { Bell, Clock, Copy, CreditCard, LogOut, Plus, QrCode, Store } from 'lucide-react';
import {
  auth,
  createCheckout,
  createCompany,
  createOrder,
  DEMO_MODE,
  db,
  listenForegroundMessages,
  requestPushToken,
  updateOrderStatus
} from './firebase';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import './styles.css';

const STATUS = { PREPARO: 'EM_PREPARO', PRONTO: 'PRONTO', ENTREGUE: 'ENTREGUE', CANCELADO: 'CANCELADO' };
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED === 'true';
const PUSH_ENABLED = !DEMO_MODE && Boolean(import.meta.env.VITE_FIREBASE_VAPID_KEY);
const statusLabel = (status) => ({
  [STATUS.PREPARO]: 'Em preparo',
  [STATUS.PRONTO]: 'Pronto',
  [STATUS.ENTREGUE]: 'Entregue',
  [STATUS.CANCELADO]: 'Cancelado'
}[status] || 'Em preparo');
const statusClass = (status) => ({
  [STATUS.PRONTO]: 'pronto',
  [STATUS.ENTREGUE]: 'entregue',
  [STATUS.CANCELADO]: 'cancelado'
}[status] || 'preparo');
function errorMessage(error) {
  if (error?.code === 'auth/network-request-failed') {
    return 'Nao foi possivel acessar o Firebase Authentication. Verifique sua conexao e ative o login por email/senha no projeto Firebase.';
  }
  if (error?.code === 'auth/operation-not-allowed') {
    return 'Ative o login por email/senha no Firebase Authentication para criar contas.';
  }
  return String(error?.message || 'Algo deu errado. Tente novamente.').replace(/^Firebase:\s*/i, '');
}
const isOpenOrder = (order) => [STATUS.PREPARO, STATUS.PRONTO].includes(order.status);

function elapsedTime(order, now) {
  const createdAt = order.createdAt?.toMillis?.();
  if (!isOpenOrder(order) || !createdAt) return null;
  return Math.max(0, now - createdAt);
}

function elapsedLabel(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function App() {
  const path = location.pathname;
  if (path.startsWith('/p/')) return <CustomerPage orderId={path.split('/p/')[1]} />;
  return <MerchantApp />;
}

function LoadingCard({ text = 'Carregando...' }) {
  return <main className="hero"><section className="card center"><p className="muted">{text}</p></section></main>;
}

function MerchantApp() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);
  useEffect(() => {
    if (!user) {
      setCompany(undefined);
      return undefined;
    }
    return onSnapshot(doc(db, 'companies', user.uid), (snapshot) => {
      setCompany(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    });
  }, [user]);

  if (!authReady) return <LoadingCard />;
  if (!user) return <AuthPage />;
  if (company === undefined) return <LoadingCard text="Abrindo seu estabelecimento..." />;
  if (!company) return <CompanyOnboarding />;
  return <Dashboard company={company} />;
}

function AuthPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return <main className="hero">
    <section className="card auth-card">
      <div className="row"><Store /><h1 className="title">FilaZero</h1></div>
      <p className="muted">Avise clientes quando o pedido estiver pronto, sem fila no balcao.</p>
      <form onSubmit={submit} className="grid">
        <div><label htmlFor="auth-email">E-mail</label><input id="auth-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div><label htmlFor="auth-password">Senha</label><input id="auth-password" className="input" type="password" minLength="6" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        {error && <p className="feedback error">{error}</p>}
        <button disabled={busy} className="btn">{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
      </form>
      <button className="btn secondary full" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Criar conta de estabelecimento' : 'Ja tenho conta'}
      </button>
    </section>
  </main>;
}

function CompanyOnboarding() {
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createCompany({ nome, cnpj });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return <main className="hero">
    <section className="card onboarding-card">
      <p className="eyebrow">Passo final</p>
      <h1 className="title">Cadastre seu estabelecimento</h1>
      <p className="muted">Voce comeca com 7 dias de teste. O numero dos pedidos sera automatico.</p>
      <form onSubmit={save} className="grid">
        <div><label htmlFor="company-name">Nome do estabelecimento</label><input id="company-name" className="input" value={nome} onChange={(event) => setNome(event.target.value)} required /></div>
        <div><label htmlFor="company-cnpj">CNPJ (opcional)</label><input id="company-cnpj" className="input" value={cnpj} onChange={(event) => setCnpj(event.target.value)} inputMode="numeric" /></div>
        {error && <p className="feedback error">{error}</p>}
        <button disabled={busy} className="btn">{busy ? 'Criando...' : 'Comecar teste gratis'}</button>
      </form>
    </section>
  </main>;
}

function isActive(company) {
  const expiresAt = company.subscriptionStatus === 'TRIAL' ? company.trialEndsAt : company.subscriptionValidUntil;
  return ['TRIAL', 'ACTIVE'].includes(company.subscriptionStatus) && expiresAt?.toMillis?.() > Date.now();
}

function Dashboard({ company }) {
  const [orders, setOrders] = useState([]);
  const [cliente, setCliente] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = isActive(company);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(intervalId);
  }, []);
  useEffect(() => {
    const ordersQuery = query(collection(db, 'orders'), where('companyId', '==', company.id), orderBy('createdAt', 'desc'));
    return onSnapshot(ordersQuery, (snapshot) => {
      const nextOrders = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setOrders(nextOrders);
      setSelectedOrder((current) => current || nextOrders[0] || null);
    }, (error) => setFeedback(errorMessage(error)));
  }, [company.id]);

  const stats = useMemo(() => ({
    preparo: orders.filter((order) => order.status === STATUS.PREPARO).length,
    pronto: orders.filter((order) => order.status === STATUS.PRONTO).length,
    entregue: orders.filter((order) => order.status === STATUS.ENTREGUE).length,
    total: orders.length
  }), [orders]);

  async function newOrder(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const result = await createOrder({ companyId: company.id, cliente });
      const newSelection = { id: result.data.orderId, numeroPedido: result.data.numeroPedido };
      setSelectedOrder(newSelection);
      setCliente('');
      setFeedback(`Pedido #${result.data.numeroPedido} criado. Mostre o QR Code ao cliente.`);
    } catch (err) {
      setFeedback(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(order, status) {
    setFeedback('');
    try {
      await updateOrderStatus({ orderId: order.id, status });
      setFeedback(`Pedido #${order.numeroPedido}: ${statusLabel(status)}.`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  }

  async function copyLink(order) {
    try {
      await navigator.clipboard.writeText(orderUrl(order.id));
      setFeedback(`Link do pedido #${order.numeroPedido} copiado.`);
    } catch {
      setFeedback('Nao foi possivel copiar o link neste navegador.');
    }
  }

  async function pay() {
    setFeedback('');
    try {
      const result = await createCheckout({ companyId: company.id, plan: 'PRO' });
      if (result.data.invoiceUrl) location.href = result.data.invoiceUrl;
      else setFeedback('Cobranca criada, mas sem link de pagamento.');
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  }

  const orderUrl = (id) => `${location.origin}/p/${id}`;
  return <main className="container grid">
    <header className="between header">
      <div><p className="eyebrow">{DEMO_MODE ? 'Demonstracao gratuita' : 'Painel'}</p><h1 className="title">{company.nome}</h1><p className="muted">Pedidos e acompanhamento em tempo real</p></div>
      <div className="row">{BILLING_ENABLED && <button className="btn secondary" onClick={pay}><CreditCard size={18} /> Assinatura</button>}<button className="btn secondary" onClick={() => signOut(auth)}><LogOut size={18} /> Sair</button></div>
    </header>
    {!active && <div className="notice"><b>Periodo de teste encerrado.</b> {BILLING_ENABLED ? <>Regularize para criar novos pedidos. <button className="btn warn" onClick={pay}>Pagar agora</button></> : 'Ative a cobranca para continuar criando pedidos.'}</div>}
    {feedback && <p className="feedback" role="status">{feedback}</p>}
    <section className="grid grid-4"><Stat title="Em preparo" value={stats.preparo} /><Stat title="Prontos" value={stats.pronto} /><Stat title="Entregues" value={stats.entregue} /><Stat title="Total" value={stats.total} /></section>
    <section className="grid grid-2">
      <div className="card">
        <h2><Plus size={18} /> Novo pedido</h2>
        <p className="muted compact">O numero e gerado automaticamente.</p>
        <form onSubmit={newOrder} className="grid">
          <div><label htmlFor="customer-name">Nome ou apelido do cliente (opcional)</label><input id="customer-name" className="input" value={cliente} onChange={(event) => setCliente(event.target.value)} placeholder="Ex.: Jose" /></div>
          <button disabled={!active || busy} className="btn">{busy ? 'Criando...' : 'Criar e gerar QR Code'}</button>
        </form>
      </div>
      <div className="card qr-card">
        <h2><QrCode size={18} /> QR Code para acompanhar</h2>
        {selectedOrder ? <>
          <p className="selected-label">Pedido #{selectedOrder.numeroPedido}</p>
          <div className="qrbox"><QRCodeCanvas value={orderUrl(selectedOrder.id)} size={190} /></div>
          <button className="btn secondary full" onClick={() => copyLink(selectedOrder)}><Copy size={17} /> Copiar link</button>
        </> : <p className="muted">Crie um pedido para gerar o primeiro QR Code.</p>}
      </div>
    </section>
    <section className="card">
      <div className="between section-head"><h2>Pedidos</h2><p className="muted compact">{orders.length} registrados</p></div>
      {!orders.length ? <p className="muted empty">Nenhum pedido criado ainda.</p> : <table className="table">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th>Tempo aberto</th><th>Acoes</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id}>
          <td data-label="Pedido"><b>#{order.numeroPedido}</b></td>
          <td data-label="Cliente">{order.cliente}</td>
          <td data-label="Status"><span className={`pill ${statusClass(order.status)}`}>{statusLabel(order.status)}</span></td>
          <td data-label="Tempo aberto"><OpenTime order={order} now={now} /></td>
          <td data-label="Acoes"><div className="row actions">
            {order.status === STATUS.PREPARO && <button className="btn success" onClick={() => changeStatus(order, STATUS.PRONTO)}>Marcar pronto</button>}
            {order.status === STATUS.PRONTO && <button className="btn secondary" onClick={() => changeStatus(order, STATUS.ENTREGUE)}>Entregue</button>}
            <button className="btn secondary" onClick={() => setSelectedOrder(order)}>QR Code</button>
            <button className="btn secondary" onClick={() => copyLink(order)}>Copiar link</button>
          </div></td>
        </tr>)}</tbody>
      </table>}
    </section>
  </main>;
}

function Stat({ title, value }) {
  return <div className="card stat"><p className="muted">{title}</p><h2>{value}</h2></div>;
}

function OpenTime({ order, now }) {
  const elapsed = elapsedTime(order, now);
  if (elapsed === null) return <span className="muted">-</span>;
  const className = elapsed >= 30 * 60000 ? 'late' : elapsed >= 15 * 60000 ? 'waiting' : '';
  return <span className={`open-time ${className}`}><Clock size={14} /> {elapsedLabel(elapsed)}</span>;
}

function CustomerPage({ orderId }) {
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState('');
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'publicOrders', orderId), (snapshot) => {
    setOrder(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    setLoading(false);
  }, () => setLoading(false)), [orderId]);
  useEffect(() => {
    let unsubscribe;
    listenForegroundMessages((payload) => {
      setMessage(payload.notification?.body || 'Pedido pronto!');
      try { navigator.vibrate?.([300, 120, 300]); } catch { /* Optional feedback only. */ }
    }).then((off) => { unsubscribe = off; });
    return () => unsubscribe?.();
  }, []);

  async function enableNotifications() {
    setBusy(true);
    setMessage('');
    try {
      const token = await requestPushToken();
      await setDoc(doc(db, 'publicOrders', orderId, 'tokens', token.replace(/[^a-zA-Z0-9]/g, '_')), {
        token,
        createdAt: serverTimestamp(),
        userAgent: navigator.userAgent.slice(0, 512)
      });
      setNotificationEnabled(true);
      setMessage('Aviso ativado. Voce pode fechar esta tela.');
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingCard text="Consultando seu pedido..." />;
  if (!order) return <main className="hero"><section className="card customer-card center"><h1>Pedido nao encontrado</h1><p className="muted">Confira o QR Code com o estabelecimento.</p></section></main>;
  const ready = order.status === STATUS.PRONTO || order.status === STATUS.ENTREGUE;
  return <main className="hero">
    <section className="card customer-card center">
      <p className="eyebrow">{order.companyName}</p>
      <h1 className="title">Pedido #{order.numeroPedido}</h1>
      <div className={`big-status ${ready ? 'ready' : ''}`}>{ready ? 'Pedido pronto!' : 'Em preparo'}</div>
      <p className="muted">{ready ? 'Retire no balcao.' : PUSH_ENABLED ? 'Ative o aviso e acompanhe sem ficar na fila.' : 'Acompanhe esta tela para verificar quando estiver pronto.'}</p>
      {PUSH_ENABLED && !ready && !notificationEnabled && <button className="btn full" disabled={busy} onClick={enableNotifications}><Bell size={18} /> {busy ? 'Ativando...' : 'Avisar quando estiver pronto'}</button>}
      {notificationEnabled && !ready && <p className="enabled"><Bell size={18} /> Aviso ativado</p>}
      {message && <p className="feedback" role="status">{message}</p>}
      {PUSH_ENABLED && !ready && <p className="hint">No iPhone, adicione o app a tela inicial para permitir notificacoes.</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
