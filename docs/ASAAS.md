# Recebimento mensal com Asaas

## Estratégia recomendada para o MVP

Comece com cobrança mensal via link Asaas:

1. Cliente clica em Assinatura.
2. Backend cria cliente no Asaas, se ainda não existir.
3. Backend cria cobrança com `externalReference = companyId`.
4. Cliente paga por PIX, cartão ou boleto.
5. Asaas chama o webhook.
6. Backend atualiza `companies/{companyId}.subscriptionStatus`.

## Por que webhook?

Nunca confie somente no retorno visual do pagamento. O webhook é a confirmação servidor-servidor.

## Campos usados

- `payment.id`: id da cobrança
- `payment.status`: status do pagamento
- `payment.externalReference`: id da empresa no Firestore
- `payment.invoiceUrl`: link de pagamento

## Status simplificados

Ativos:

- RECEIVED
- CONFIRMED

Inativos:

- OVERDUE
- CANCELED
- DELETED
- REFUNDED

## Como você recebe o dinheiro

Você cria uma conta Asaas PJ, configura sua conta bancária e recebe os valores no saldo/conta conforme as regras de liquidação do Asaas para PIX, cartão ou boleto.
