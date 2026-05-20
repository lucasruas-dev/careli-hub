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

Eventos recentes protegidos:

`/api/iris/meta/events`

Envio manual protegido:

`/api/iris/meta/messages`

Status legado mantido como ponte tecnica:

`/api/caredesk/meta/status`

Eventos e envio legados mantidos como ponte tecnica:

`/api/caredesk/meta/events`

`/api/caredesk/meta/messages`

Fluxos suportados nesta etapa:

- `GET`: validacao do webhook pela Meta usando `hub.verify_token` e
  `hub.challenge`.
- `POST`: recebimento de eventos, validacao de assinatura HMAC SHA-256 e
  gravacao em `caredesk_meta_webhook_events`.
- `GET /api/iris/meta/status`: leitura protegida por sessao `admin` ou
  `leader`, retornando somente nomes de env faltantes, prontidao inbound,
  bloqueio outbound e status da persistencia. Nunca retorna valores de secrets.
- `GET /api/iris/meta/events`: leitura protegida dos ultimos eventos Meta,
  retornando resumo operacional sem expor o payload bruto.
- `POST /api/iris/meta/messages`: envio manual protegido por sessao Hub para
  teste operacional em homologacao, registrando a referencia em
  `caredesk_whatsapp_message_refs` quando a Meta aceitar a mensagem.
- Processamento inbound: mensagens `message:*` recebidas pela Meta criam ou
  reutilizam contato, abrem ticket real `AT-*` quando nao houver conversa aberta,
  registram a mensagem em `caredesk_messages` e atualizam o evento bruto para
  `processed`, `ignored` ou `failed`.

Fluxos ainda nao liberados:

- disparo em massa;
- templates oficiais;
- resposta automatica da Athena.
- envio automatico sem acao humana.

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
- Outbound WhatsApp esta liberado somente para envio manual autenticado em
  homologacao. Disparo em massa, automacao, templates oficiais e respostas
  automaticas continuam bloqueados ate recorte proprio.

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
10. Aplicar a migration `0025_iris_inbound_ticket_protocols.sql` para ativar a
    sequencia `AT-*` e remover o mockup `CARE-DEMO-*`.
11. Enviar mensagem inbound real e confirmar ticket `AT-*` no board da Iris.

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
- criacao de contato/ticket/mensagem com protocolo `AT-*`;
- latencia do webhook e idempotencia antes de ampliar automacoes.
