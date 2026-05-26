import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import { Bell, CheckCircle2, Clock, LogOut, Plus, QrCode, Store, CreditCard } from 'lucide-react';
import { auth, db, requestPushToken, createCheckout, listenForegroundMessages } from './firebase';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { addDoc, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import './styles.css';

const STATUS = { PREPARO: 'EM_PREPARO', PRONTO: 'PRONTO', ENTREGUE: 'ENTREGUE', CANCELADO: 'CANCELADO' };
const statusLabel = s => s === STATUS.PRONTO ? 'Pronto' : s === STATUS.ENTREGUE ? 'Entregue' : s === STATUS.CANCELADO ? 'Cancelado' : 'Em preparo';
const statusClass = s => s === STATUS.PRONTO ? 'pronto' : s === STATUS.ENTREGUE ? 'entregue' : 'preparo';

function App(){
  const path = location.pathname;
  if(path.startsWith('/p/')) return <CustomerPage orderId={path.split('/p/')[1]} />;
  return <MerchantApp />;
}

function MerchantApp(){
  const [user,setUser]=useState(null);
  const [company,setCompany]=useState(null);
  useEffect(()=>onAuthStateChanged(auth,setUser),[]);
  useEffect(()=>{
    if(!user){setCompany(null);return;}
    const q=query(collection(db,'companies'),where('ownerUid','==',user.uid),limit(1));
    return onSnapshot(q,s=>setCompany(s.docs[0]?{id:s.docs[0].id,...s.docs[0].data()}:null));
  },[user]);
  if(!user) return <AuthPage />;
  if(!company) return <CompanyOnboarding user={user} />;
  return <Dashboard user={user} company={company} />;
}

function AuthPage(){
  const [mode,setMode]=useState('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [err,setErr]=useState('');
  async function submit(e){e.preventDefault(); setErr(''); try{ mode==='login'? await signInWithEmailAndPassword(auth,email,password): await createUserWithEmailAndPassword(auth,email,password);}catch(ex){setErr(ex.message);} }
  return <main className="hero"><section className="card" style={{maxWidth:430,width:'100%'}}><div className="row"><Store/><h1 className="title">FilaZero</h1></div><p className="muted">Sistema simples para avisar clientes quando o pedido estiver pronto.</p><form onSubmit={submit} className="grid"><div><label>E-mail</label><input className="input" value={email} onChange={e=>setEmail(e.target.value)} /></div><div><label>Senha</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>{err&&<p style={{color:'#dc2626'}}>{err}</p>}<button className="btn">{mode==='login'?'Entrar':'Criar conta'}</button></form><button className="btn secondary" style={{marginTop:12,width:'100%'}} onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Criar uma conta de estabelecimento':'Já tenho conta'}</button></section></main>
}

function CompanyOnboarding({user}){
  const [nome,setNome]=useState(''); const [cnpj,setCnpj]=useState('');
  async function save(e){e.preventDefault(); await addDoc(collection(db,'companies'),{ownerUid:user.uid,nome,cnpj,plan:'TRIAL',subscriptionStatus:'TRIAL',createdAt:serverTimestamp(),trialEndsAt:null});}
  return <main className="hero"><section className="card" style={{maxWidth:520,width:'100%'}}><h1 className="title">Cadastre seu estabelecimento</h1><p className="muted">Essa conta será individual para sua loja.</p><form onSubmit={save} className="grid"><div><label>Nome do estabelecimento</label><input className="input" value={nome} onChange={e=>setNome(e.target.value)} required /></div><div><label>CNPJ</label><input className="input" value={cnpj} onChange={e=>setCnpj(e.target.value)} /></div><button className="btn">Começar</button></form></section></main>
}

function Dashboard({user,company}){
  const [orders,setOrders]=useState([]); const [numero,setNumero]=useState(''); const [cliente,setCliente]=useState(''); const [last,setLast]=useState(null);
  const active = ['ACTIVE','TRIAL','CONFIRMED','RECEIVED'].includes(company.subscriptionStatus);
  useEffect(()=>{ const q=query(collection(db,'orders'),where('companyId','==',company.id),orderBy('createdAt','desc')); return onSnapshot(q,s=>setOrders(s.docs.map(d=>({id:d.id,...d.data()}))));},[company.id]);
  const stats=useMemo(()=>({preparo:orders.filter(o=>o.status===STATUS.PREPARO).length,pronto:orders.filter(o=>o.status===STATUS.PRONTO).length,entregue:orders.filter(o=>o.status===STATUS.ENTREGUE).length,total:orders.length}),[orders]);
  async function newOrder(e){e.preventDefault(); if(!active) return alert('Assinatura inativa. Regularize para criar pedidos.'); const ref=await addDoc(collection(db,'orders'),{companyId:company.id,companyName:company.nome,numeroPedido:numero,cliente:cliente||'Cliente',status:STATUS.PREPARO,createdAt:serverTimestamp(),readyAt:null,deliveredAt:null}); setLast(ref.id); setNumero(''); setCliente('');}
  async function markReady(o){await updateDoc(doc(db,'orders',o.id),{status:STATUS.PRONTO,readyAt:serverTimestamp()});}
  async function markDelivered(o){await updateDoc(doc(db,'orders',o.id),{status:STATUS.ENTREGUE,deliveredAt:serverTimestamp()});}
  async function pay(){ const res=await createCheckout({companyId:company.id,plan:'PRO'}); if(res.data.invoiceUrl) location.href=res.data.invoiceUrl; else alert('Cobrança criada, mas sem link de pagamento.'); }
  const orderUrl=id=>`${location.origin}/p/${id}`;
  return <main className="container grid"><div className="between"><div><h1 className="title">{company.nome}</h1><p className="muted">Painel de pedidos e notificações</p></div><div className="row"><button className="btn secondary" onClick={pay}><CreditCard size={18}/> Assinatura</button><button className="btn secondary" onClick={()=>signOut(auth)}><LogOut size={18}/> Sair</button></div></div>{!active&&<div className="card" style={{borderColor:'#f59e0b'}}><b>Assinatura inativa.</b> Regularize para liberar criação de pedidos. <button className="btn warn" onClick={pay}>Pagar agora</button></div>}<section className="grid grid-4"><Stat title="Em preparo" value={stats.preparo}/><Stat title="Prontos" value={stats.pronto}/><Stat title="Entregues" value={stats.entregue}/><Stat title="Total" value={stats.total}/></section><section className="grid grid-2"><div className="card"><h2><Plus size={18}/> Novo pedido</h2><form onSubmit={newOrder} className="grid"><div><label>Número do pedido</label><input className="input" value={numero} onChange={e=>setNumero(e.target.value)} placeholder="154" required /></div><div><label>Nome do cliente</label><input className="input" value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="José" /></div><button disabled={!active} className="btn">Criar pedido</button></form></div><div className="card"><h2><QrCode size={18}/> QR Code do último pedido</h2>{last?<><div className="qrbox"><QRCodeCanvas value={orderUrl(last)} size={210}/></div><p className="muted" style={{wordBreak:'break-all'}}>{orderUrl(last)}</p></>:<p className="muted">Crie um pedido para gerar o QR Code.</p>}</div></section><section className="card"><h2>Pedidos</h2><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th>Ações</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><b>#{o.numeroPedido}</b></td><td>{o.cliente}</td><td><span className={`pill ${statusClass(o.status)}`}>{statusLabel(o.status)}</span></td><td className="row">{o.status===STATUS.PREPARO&&<button className="btn success" onClick={()=>markReady(o)}>Pronto</button>}{o.status===STATUS.PRONTO&&<button className="btn secondary" onClick={()=>markDelivered(o)}>Entregue</button>}<button className="btn secondary" onClick={()=>navigator.clipboard.writeText(orderUrl(o.id))}>Copiar link</button></td></tr>)}</tbody></table></section></main>
}
function Stat({title,value}){return <div className="card"><p className="muted">{title}</p><h2 style={{fontSize:36,margin:0}}>{value}</h2></div>}

function CustomerPage({orderId}){
  const [order,setOrder]=useState(null); const [msg,setMsg]=useState('');
  useEffect(()=>onSnapshot(doc(db,'orders',orderId),s=>setOrder(s.exists()?{id:s.id,...s.data()}:null)),[orderId]);
  useEffect(()=>{listenForegroundMessages(payload=>{setMsg(payload.notification?.body||'Pedido pronto!'); try{navigator.vibrate?.([300,120,300]);}catch{}});},[]);
  async function enable(){try{const token=await requestPushToken(); await setDoc(doc(db,'orders',orderId,'tokens',token.replace(/[^a-zA-Z0-9]/g,'_')), {token,createdAt:serverTimestamp(),userAgent:navigator.userAgent}); setMsg('Notificação ativada. Você pode bloquear a tela.');}catch(ex){setMsg(ex.message);}}
  if(!order) return <main className="hero"><section className="card"><h1>Pedido não encontrado</h1></section></main>;
  const ready=order.status===STATUS.PRONTO || order.status===STATUS.ENTREGUE;
  return <main className="hero"><section className="card" style={{maxWidth:520,width:'100%',textAlign:'center'}}><p className="muted">{order.companyName}</p><h1 className="title">Pedido #{order.numeroPedido}</h1><p className="muted">{order.cliente}</p><div className="big-status">{ready?'🎉 Pedido pronto':'⏳ Em preparo'}</div><p className="muted">{ready?'Retire no balcão.':'Você será avisado quando ficar pronto.'}</p><button className="btn" onClick={enable}><Bell size={18}/> Receber notificação</button>{msg&&<p><b>{msg}</b></p>}<p className="muted" style={{fontSize:12}}>Funciona melhor em HTTPS. No iPhone, pode exigir adicionar à tela inicial para receber push web.</p></section></main>
}

createRoot(document.getElementById('root')).render(<App/>);
