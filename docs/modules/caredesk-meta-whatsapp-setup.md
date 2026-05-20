# Iris Meta WhatsApp - preparacao operacional

Atualizado em: 2026-05-20

Este documento registra o trilho seguro para conectar o Iris a WhatsApp
Business Platform pela Meta Cloud API. Ele nao deve conter tokens, chaves,
segredos, numeros sensiveis ou payloads reais de cliente.

Nota de compatibilidade: caminhos de arquivo, tabelas e migrations ainda podem
usar o prefixo tecnico legado `caredesk_*` ate migracao autorizada por Lucas.

## Objetivo

Preparar a base para:

- receber webhooks oficiais do WhatsApp via Meta;
- validar o desafio de configuracao do webhook;
- validar assinatura `x-hub-signature-256` nos eventos recebidos;
- persistir eventos brutos verificados como trilha de auditoria;
- deixar o envio ativo bloqueado ate uma etapa especifica de produto,
  seguranca e homologacao.

## Endpoint do Hub

Callback URL esperada:

`/api/iris/meta/webhook`

Callback URL de homologacao:

`https://homo.c2x.app.br/api/iris/meta/webhook`

Status atual de homologacao:

- migration `0024` aplicada no banco de homolog;
- canal `whatsapp-careli` apontado para `/api/iris/meta/webhook`;
- persistencia server-side validada via acesso autenticado da Vercel;
- variaveis `META_WHATSAPP_*` cadastradas em Vercel Preview/homolog;
- protecao SSO da Vercel desabilitada no projeto para permitir validacao
  publica do webhook pela Meta;
- acesso publico sem parametros retorna `403` da propria Iris, comportamento
  esperado ate a Meta enviar `hub.verify_token` e `hub.challenge`.

Callback legado mantido como ponte tecnica:

`/api/caredesk/meta/webhook`

Status operacional protegido:

`/api/iris/meta/status`

Status legado mantido como ponte tecnica:

`/api/caredesk/meta/status`

Fluxos suportados nesta etapa:

- `GET`: validacao do webhook pela Meta usando `hub.verify_token` e
  `hub.challenge`.
- `POST`: recebimento de eventos, validacao de assinatura HMAC SHA-256 e
  gravacao em `caredesk_meta_webhook_events`.
- `GET /api/iris/meta/status`: leitura protegida por sessao `admin` ou
  `leader`, retornando somente nomes de env faltantes, prontidao inbound,
  bloqueio outbound e status da persistencia. Nunca retorna valores de secrets.

Fluxos ainda nao liberados:

- envio ativo de mensagens;
- disparo em massa;
- templates oficiais;
- criacao automatica de ticket;
- resposta automatica da Athena.

## Variaveis server-side esperadas

Todas devem ficar somente em ambiente seguro server-side. Nenhuma usa prefixo
`NEXT_PUBLIC_`.

- `META_WHATSAPP_APP_ID`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `META_WHATSAPP_GRAPH_VERSION`

Variaveis de persistencia ja existentes:

- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_URL`

## Regras de seguranca

- Nunca registrar valores de token, app secret, access token ou verify token no
  diario, logs, prints, commits ou chat.
- A rota `POST` deve rejeitar eventos sem assinatura Meta valida.
- A rota `GET` deve responder o desafio somente quando o verify token bater com
  a variavel server-side.
- O payload real pode conter dados pessoais de cliente; qualquer exibicao futura
  precisa respeitar permissao e contexto operacional.
- Outbound WhatsApp permanece bloqueado nesta entrega. Envio exige decisao
  propria, confirmacao humana para acoes sensiveis e homologacao.

## Checklist Meta

1. Criar ou selecionar o app Meta com produto WhatsApp.
2. Confirmar Business Portfolio, WABA e phone number oficial.
3. Configurar `META_WHATSAPP_GRAPH_VERSION` de forma explicita, sem depender de
   default de codigo.
4. Configurar URL HTTPS publica do webhook no ambiente alvo.
5. Configurar o verify token no painel da Meta e no ambiente server-side.
6. Assinar eventos `messages` do WABA.
7. Usar system user token com permissoes minimas necessarias:
   `whatsapp_business_messaging` e, quando necessario,
   `whatsapp_business_management`.
8. Testar primeiro em homologacao, com numero/test account da Meta.
9. Validar eventos recebidos em `caredesk_meta_webhook_events`.
10. Liberar processamento para contato/ticket somente depois da ingestao estar
    estavel.

## Referencias oficiais consultadas

- Meta/Postman WhatsApp Cloud API collection:
  https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- Meta Cloud API overview:
  https://developers.facebook.com/docs/whatsapp/cloud-api/overview
- WhatsApp Business Platform Node.js SDK webhook reference:
  https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

## Proxima etapa recomendada

Depois de cadastrar as variaveis Meta por canal seguro e liberar o acesso
publico controlado ao webhook de homologacao, validar:

- handshake `GET` do webhook;
- rejeicao de assinatura invalida;
- recebimento de uma mensagem real de teste;
- persistencia em `caredesk_meta_webhook_events`;
- latencia do webhook antes de processar ticket automaticamente.
