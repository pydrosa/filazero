# FilaZero MVP

MVP web/PWA para notificação de pedidos concluídos.

## O que vem pronto

- Login/cadastro de estabelecimento
- Cadastro individual de empresa
- Criação de pedidos
- Link e QR Code por pedido
- Tela pública do cliente em `/p/:orderId`
- Solicitação de permissão de notificação
- Registro de token FCM por pedido
- Cloud Function que dispara push quando o pedido muda para `PRONTO`
- Cloud Function para gerar cobrança Asaas
- Webhook Asaas para liberar/bloquear assinatura

## Stack

- React + Vite
- Firebase Auth
- Firestore
- Firebase Hosting
- Cloud Functions Node 20
- Firebase Cloud Messaging Web Push
- Asaas para cobrança

## Configuração rápida

1. Crie projeto no Firebase.
2. Ative Auth com email/senha.
3. Ative Firestore.
4. Ative Cloud Messaging e gere uma Web Push certificate key / VAPID key.
5. Copie `web/.env.example` para `web/.env` e preencha.
6. Edite `web/public/firebase-messaging-sw.js` com a mesma configuração Firebase.
7. Copie `.firebaserc.example` para `.firebaserc` e coloque seu project id.
8. Instale:

```bash
npm run install:all
```

9. Configure segredos das functions:

```bash
firebase functions:secrets:set ASAAS_API_KEY
firebase functions:secrets:set ASAAS_WEBHOOK_TOKEN
```

Também é possível usar variáveis de ambiente em deploys próprios:

```bash
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3
ASAAS_API_KEY=sua_chave_sandbox
ASAAS_WEBHOOK_TOKEN=um_token_forte
```

10. Deploy:

```bash
npm --prefix web run build
firebase deploy
```

## Como testar o fluxo

1. Acesse a URL do Hosting.
2. Crie uma conta de estabelecimento.
3. Cadastre nome e CNPJ.
4. Clique em Assinatura para gerar pagamento teste no Asaas.
5. Crie um pedido.
6. Abra o link `/p/:orderId` em outro navegador/celular.
7. Clique em receber notificação.
8. No painel, marque o pedido como pronto.
9. O cliente recebe a notificação.

## Observação importante sobre iPhone

Push Notification em PWA no iOS pode exigir que o usuário adicione o site à tela inicial. Em Android/Chrome o fluxo costuma ser mais direto.

## Modelo de pagamento

- O app cria uma cobrança Asaas vinculada ao `companyId` em `externalReference`.
- O Asaas chama o webhook `asaasWebhook` quando o pagamento muda de status.
- Se o status for `RECEIVED` ou `CONFIRMED`, a empresa fica `ACTIVE`.
- Se ficar vencido/cancelado, a empresa fica `INACTIVE`.
- O painel bloqueia criação de pedidos quando a assinatura está inativa.

Para produção, recomendo trocar cobrança avulsa por assinatura recorrente nativa no Asaas ou criar automaticamente a próxima cobrança mensal após confirmação.
