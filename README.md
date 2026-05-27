# FilaZero MVP

MVP web/PWA para avisar clientes quando pedidos ficam prontos.

## Fluxo

- O estabelecimento cria uma conta e recebe 7 dias de teste.
- O numero de cada pedido e criado automaticamente pelo backend.
- O painel destaca ha quanto tempo cada pedido em aberto esta aguardando.
- O cliente le o QR Code e ativa um aviso de pedido pronto.
- O pedido publico nao expoe o nome do cliente.
- A assinatura e liberada somente pelo webhook autenticado do Asaas.

## Stack

- React + Vite
- Firebase Auth, Firestore, Hosting e Cloud Functions Node 20
- Firebase Cloud Messaging Web Push
- Asaas para cobranca

## Configuracao rapida

1. Crie um projeto Firebase e ative Authentication por email/senha, Firestore e Cloud Messaging.
2. Gere uma Web Push certificate key / VAPID key.
3. Copie `web/.env.example` para `web/.env` e preencha os valores Firebase.
4. Configure os mesmos dados Firebase em `web/public/firebase-messaging-sw.js`.
5. Copie `.firebaserc.example` para `.firebaserc` e informe o project id.
6. Instale as dependencias:

```bash
npm install
npm run install:all
```

7. Configure os segredos obrigatorios:

```bash
npx firebase functions:secrets:set ASAAS_API_KEY
npx firebase functions:secrets:set ASAAS_WEBHOOK_TOKEN
```

8. No primeiro deploy, informe os parametros solicitados pelas Functions:

```text
APP_BASE_URL=https://seu-projeto.web.app
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3
```

`APP_BASE_URL` deve ser uma URL HTTPS publica, pois e usada no clique da notificacao push. Troque `ASAAS_BASE_URL` pela URL de producao apenas quando a conta Asaas estiver pronta.

9. Faca o deploy:

```bash
npm --prefix web run build
npx firebase deploy
```

## Teste local com emuladores

Para testar cadastro, criacao e acompanhamento de pedidos sem acessar dados de producao:

1. Copie `web/.env.example` para `web/.env` e defina `VITE_USE_FIREBASE_EMULATORS=true`.
2. Em um terminal, inicie os servicos locais:

```bash
npx firebase emulators:start --project demo-filazero
```

3. Em outro terminal, inicie o frontend:

```bash
npm run dev:web
```

4. Abra `http://localhost:5173`, crie uma conta e teste o QR Code em outra aba.

O pagamento Asaas e a entrega real de notificacoes push exigem credenciais e configuracao HTTPS reais; os demais fluxos podem ser verificados localmente.

## Seguranca implementada

- O navegador nao grava empresas, pedidos, pagamentos ou status de assinatura diretamente.
- `createCompany`, `createOrder` e `updateOrderStatus` validam usuario e assinatura no backend.
- `orders` e privado para o dono do estabelecimento; `publicOrders` contem apenas os dados necessarios para o cliente acompanhar o pedido.
- O webhook exige `ASAAS_WEBHOOK_TOKEN` e so processa cobrancas que foram criadas pela aplicacao.
- A assinatura e o contador sequencial de pedidos so sao alterados pelo Admin SDK.

## Teste do fluxo

1. Acesse a URL do Hosting e crie uma conta.
2. Cadastre o estabelecimento; o teste gratuito sera iniciado.
3. Crie um pedido e abra o QR Code em outro navegador ou celular.
4. Ative o aviso na pagina do cliente.
5. No painel, marque o pedido como pronto.
6. Confirme que a notificacao abre a URL publica correta.
7. Teste uma cobranca Asaas e confirme que apenas o webhook atualiza a assinatura.

## Atualizacao de uma versao anterior

Esta versao troca o acompanhamento publico de `orders` para `publicOrders` para retirar dados pessoais da leitura publica. Pedidos criados depois do deploy ja usam a nova estrutura. Caso existam pedidos abertos antes do deploy, finalize-os antes da atualizacao ou publique uma migracao administrativa que copie somente `companyName`, `numeroPedido`, `status` e timestamps para `publicOrders`.

## Observacao sobre iPhone

Push Notification em PWA no iOS pode exigir que o usuario adicione o site a tela inicial. Em Android/Chrome o fluxo costuma ser mais direto.
