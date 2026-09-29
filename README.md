# FlowNewYork Imports

Loja online com checkout transparente do Mercado Pago usando **Orders API**.

## Estrutura para GitHub

- `index.html` — loja
- `style.css` — visual
- `script.js` — catálogo, carrinho e checkout
- `server.js` — backend de pagamento e webhook
- `catalog.json` — preços confiáveis usados pelo servidor
- `catalogo_fallback/` — imagens locais
- `imagensQReLogos/` — logo e ativos
- `.env.example` — nomes das variáveis, sem segredos
- `render.yaml` — configuração de deploy

## Importante

Este projeto **não deve ser publicado somente no GitHub Pages**, porque o pagamento precisa do backend Node (`server.js`) e de variáveis secretas. O GitHub deve guardar o código; uma hospedagem Node/HTTPS (ex.: Render) executa a loja.

Nunca envie para o GitHub:
- Access Token do Mercado Pago
- segredo do Webhook
- arquivo `.env` real
- dados completos de cartão/CVV

## Variáveis na hospedagem

`MP_PUBLIC_KEY`
`MP_ACCESS_TOKEN`
`MP_WEBHOOK_SECRET`

Use as credenciais de **produção** somente depois dos testes e da ativação no Mercado Pago.

## Webhook

Depois do deploy, configure no Mercado Pago o evento **Order (Mercado Pago)** para:

`https://SEU-DOMINIO/api/webhooks/mercadopago`

Copie a assinatura secreta gerada pelo Mercado Pago para `MP_WEBHOOK_SECRET` na hospedagem.

## Local

1. `npm install`
2. Configure as variáveis de ambiente.
3. `npm start`
4. Abra `http://localhost:3000`
