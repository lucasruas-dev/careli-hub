# Iris Meta WhatsApp - preparacao operacional

Atualizado em: 2026-05-24

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
- permitir envio ativo somente por template aprovado ou por mensagem livre dentro
  da janela WhatsApp de atendimento ao cliente.

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
- `POST /api/iris/meta/messages`: envio livre protegido por sessao Hub, com
  validacao obrigatoria da janela WhatsApp de 24h antes de chamar a Meta e
  registro em `caredesk_whatsapp_message_refs` quando a Meta aceitar a mensagem.
- Processamento inbound: mensagens `message:*` recebidas pela Meta criam ou
  reutilizam contato, abrem ticket real `AT-*` quando nao houver conversa aberta,
  registram a mensagem em `caredesk_messages` e atualizam o evento bruto para
  `processed`, `ignored` ou `failed`.

## Templates Meta

- A criacao e a consulta de templates oficiais usam a WABA como node canonico:
  `/{WABA-ID}/message_templates`.
- O telefone operacional continua necessario para resolver a WABA correta e
  para envio ativo em `/{PHONE_NUMBER_ID}/messages`.
- Para o telefone padrao da Iris, o par configurado `PHONE_NUMBER_ID` + WABA
  so pode ser usado quando a Iris comprovar que o telefone esta listado nessa
  WABA. Fallback silencioso para WABA configurada e bloqueado para evitar
  template criado em outra conta do Meta Business Suite.
- `display_phone_number` e dado exibivel/operacional. Se a Meta omitir esse
  campo, a Iris deve alertar o operador, mas nao deve bloquear a criacao do
  template quando houver `PHONE_NUMBER_ID` e WABA validaveis no servidor.
- Bloqueios obrigatorios permanecem para telefone ausente, WABA nao resolvida,
  permissao/token recusado, template sem aprovacao ou template aprovado em WABA
  diferente do telefone usado no envio.
- Sucesso visual de criacao de template exige confirmacao pos-POST: a Iris deve
  reencontrar o template em `/{WABA-ID}/message_templates` e exibir/logar apenas
  rastreio sanitizado de telefone/WABA.

## Janela WhatsApp de 24h

Regra operacional canonica:

- Template aprovado pode ser enviado fora da janela de atendimento.
- Mensagem livre (`text`, audio e demais mensagens nao-template) so pode ser
  enviada quando houver mensagem inbound do cliente nas ultimas 24 horas.
- Cada mensagem inbound do cliente inicia ou renova a janela.
- Quando a janela esta fechada ou o cliente ainda nao respondeu ao template,
  a Iris deve bloquear o composer e orientar envio de template aprovado.
- A API tambem deve bloquear o envio livre fora da janela; a trava visual nao e
  suficiente para conformidade.

Implementacao atual:

- `meta-inbound-processor.ts` grava em `caredesk_tickets.metadata` os campos
  `activeContactConsent`, `lastCustomerMessageAt`,
  `customerServiceWindowOpenedAt` e `customerServiceWindowExpiresAt`.
- `POST /api/iris/meta/messages` consulta a ultima mensagem inbound do ticket e
  retorna `409` quando a janela nao esta aberta.
- `IrisPage.tsx` mostra o estado da janela no atendimento e desabilita texto e
  audio fora da janela; edicao local de mensagem ja registrada continua permitida.

Fluxos ainda nao liberados:

- disparo em massa;
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
- Outbound WhatsApp esta liberado para envio autenticado via Iris, respeitando
  template aprovado fora da janela e mensagem livre apenas dentro da janela de
  24h. Disparo em massa, automacao e respostas automaticas continuam bloqueados
  ate recorte proprio.

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
- Meta WhatsApp - sending messages/customer service windows:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- Meta WhatsApp - templates:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates
- Referencia GitHub avaliada para inbox e trava de 24h:
  https://github.com/gokapso/whatsapp-cloud-inbox
- WhatsApp Business Platform Node.js SDK webhook reference:
  https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

## Runbook de diagnostico - template criado no Panteon nao aparece na Meta

Resolucao validada em homologacao em 2026-05-25:

- Sintoma: a Iris exibia `Template enviado` ou `Template confirmado`, mas o Meta Business Suite nao mostrava o template na WABA operacional.
- Causa encontrada: runtime da Iris confirmava o template em uma WABA diferente da WABA `Panteon Teste` usada pelo telefone de envio.
- Regra definitiva: template so pode ser criado/listado/confirmado em `/{waba_id}/message_templates` quando o servidor comprovar que o `phone_number_id` pertence a essa WABA.
- O envio de template/mensagem continua usando `/{phone_number_id}/messages`; criacao, listagem e status continuam no escopo da WABA.
- Nunca usar `display_phone_number` como chave de integracao. Ele e apenas apoio visual. A chave operacional e `phone_number_id` + `waba_id`.
- Quando o Meta Business Suite nao mostrar o template, comparar sempre os sufixos sanitizados:
  - sufixo do `phoneNumberId` usado no runtime;
  - sufixo da WABA onde a Iris confirmou o template;
  - sufixo da WABA aberta no Meta Business Suite.
- Se os sufixos divergem, corrigir `META_WHATSAPP_BUSINESS_ACCOUNT_ID`/escopo do deployment antes de testar UI novamente.
- A Iris deve bloquear `IRIS_TEMPLATE_PHONE_WABA_MISMATCH` quando a WABA configurada nao lista o telefone selecionado.
- Sucesso operacional exige tres provas:
  - `POST` para criacao retornou sem erro;
  - consulta posterior em `/{waba_id}/message_templates` reencontrou o nome e idioma;
  - o operador viu o template no Meta Business Suite da mesma WABA.
- Logs e diario devem registrar somente `operationId` e sufixos sanitizados de telefone/WABA/template. Nunca registrar token, bearer, secret ou IDs completos sensiveis.

## Runbook de diagnostico - template aprovado local nao inicia Novo Atendimento

- Sintoma: Setup lista template como aprovado, mas o modal `Novo atendimento` mostra `Template nao localizado` ou a API retorna `Template Meta <nome> ainda nao possui traducao aprovada para o telefone de envio`.
- Interpretacao: o cache local da Iris pode estar com `metaStatus` aprovado para um template que nao existe mais na WABA/telefone/idioma selecionados.
- Acao esperada do sistema: ao consultar `GET /api/iris/meta/templates?name=<nome>&language=pt_BR&phoneNumberId=<id>`, se a Meta nao retornar o template exato, a Iris deve rebaixar o registro local para `metaStatus=NOT_FOUND` e `status=paused`, removendo-o do fluxo de contato ativo.
- O modal `Novo atendimento` deve listar apenas templates com `metaStatus` aprovado de verdade e recarregar a lista apos a sincronizacao local.
- Se houver outro template aprovado real na mesma fila/assunto, a Iris deve selecionar esse template apos o refresh.
- Se nenhum template real existir, criar novo template na WABA correta, aguardar aprovacao e sincronizar novamente.
## Proxima etapa recomendada

Depois de cadastrar as variaveis Meta por canal seguro e liberar o acesso
publico controlado ao webhook de homologacao, validar:

- handshake `GET` do webhook;
- rejeicao de assinatura invalida;
- recebimento de uma mensagem real de teste;
- persistencia em `caredesk_meta_webhook_events`;
- criacao de contato/ticket/mensagem com protocolo `AT-*`;
- latencia do webhook e idempotencia antes de ampliar automacoes.

## Runbook operacional - janela WhatsApp de 24h por contato

Resolucao homologada em 2026-05-25:

- A validacao da janela de atendimento WhatsApp deve ser feita por contato quando houver contact_id confiavel, nao apenas pelo ticket atual.
- POST /api/iris/meta/messages procura a ultima mensagem inbound do cliente por sender_contact_id; se necessario, resolve o contato pelo ticket ou telefone e usa ticket como fallback legado.
- POST /api/iris/tickets cria/resolve o contato antes de decidir envio: se a janela do contato estiver aberta, inicia atendimento sem novo template; se a janela estiver fechada, exige template aprovado e envia o template Meta.
- A UI do Novo Atendimento tenta iniciar sem template primeiro. Se o backend responder que a janela esta fechada, a UI exige template aprovado/telefone e repete com sendTemplate=true.
- Esse recorte nao altera WABA, phone number ID, token, webhook, banco ou migration. O fluxo de template continua usando phone_number_id e waba_id persistidos no template aprovado.
- Nunca reapontar homo.c2x.app.br para deployment do projeto workspace; homologacao Iris deve sair do projeto Vercel careli-hub-hub-i2bs e passar Safety Gate com expectedDeploymentId atual.
