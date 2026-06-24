# [Hermes] Diagnóstico de mensageria — 2026-06-23

Agente: Zeus. Tipo: investigação de incidente (read-only, sem alteração de código/infra).
Ambiente analisado: produção Supabase `bxgukywoxgivlrhjkwjx` + código `apps/hub`.

> ⚠️ **CORREÇÃO (mesma data) — leia antes.** A análise de código abaixo foi feita sobre a
> branch baseada em `main-ops` (18/jun), **não** sobre a produção (`main`, 23/jun, com o lote
> de bugs de 22/jun). A produção é **mais avançada** e **já implementa** os mecanismos que a
> seção "plano de correção" propõe: `postgres_changes` global e por-canal, broadcast como
> redundância, poll do canal ativo já em 8s, snapshot de notificações de 120s, refresh de 5min
> e um sistema de notificações in-app (unread/floating/popup). Portanto **a arquitetura NÃO é
> o gap** — o sistema já é redundante. Como o problema persiste mesmo com toda essa redundância,
> o suspeito real passa a ser o **transporte realtime não entregar em produção** (bate com os
> logs `MissingAPIKey` + "no connected users"), a confirmar com **evidência ao vivo** (reprodução
> em homolog + status das assinaturas realtime), não por leitura estática. Esta correção
> invalida o "TL;DR" e o "Plano de correção" originais; eles ficam preservados apenas como
> histórico do raciocínio sobre o código antigo. Re-diagnóstico em produção pendente.

## Sintomas reportados (Lucas / time)
- Mensagens não chegam (não aparecem para os outros em tempo real).
- Notificação de respostas não chega.
- Sensação geral de mensageria não-assertiva; time inseguro.

## TL;DR (causa-raiz)
O Hermes **não tem entrega de mensagem dirigida pelo servidor**. Quem entrega a mensagem
em tempo real é o **navegador do remetente**, via **Supabase Broadcast** (efêmero, sem
replay). Se o destinatário não estiver conectado e inscrito **no exato instante do envio**
(aba fechada, reconexão de websocket, canal em segundo plano), a mensagem **simplesmente
não chega** — e a notificação também não, porque a notificação só dispara quando o broadcast
chega. O único "remendo" de confiabilidade é um **polling de 4s no canal aberto** (caro, é a
origem da fatura alta), que não cobre os canais em segundo plano, justamente onde caem as
respostas. Ironia: **o mecanismo confiável (Postgres Changes) JÁ está habilitado em
`pulsex_messages`, mas o app não o utiliza.**

## Como o Hermes funciona hoje (arquitetura real)

Envio:
1. Cliente chama `createHermesMessage` → `POST /api/hermes/messages` (reexporta
   `app/api/pulsex/messages/route.ts`).
2. A rota `POST` **apenas insere** em `pulsex_messages` com service role e retorna a linha
   (`route.ts:302-331`). **Não faz broadcast, não notifica, não grava notificação.**
3. De volta no cliente, o remetente faz o broadcast manual
   (`pulsex-workspace.tsx:1014-1016`) no canal realtime do **canal ativo**
   (`messageRealtimeChannelRef.current`). `broadcastHermesMessage` **aborta silenciosamente
   se esse canal não estiver conectado** (`pulsex-workspace.tsx:1728-1748`).

Recepção em tempo real:
- Tópico de broadcast `pulsex:messages:<channelId>`, evento `message-created`
  (`lib/pulsex/realtime.ts`).
- Canal aberto: assinatura broadcast (`pulsex-workspace.tsx:584-645`) **+ polling a cada 4s**
  (`pulsex-workspace.tsx:555-567`, `PULSEX_MESSAGE_REFRESH_MS = 4_000` em `:124`).
- Canais em segundo plano: o `HermesNotificationProvider`
  (`providers/pulsex-notification-provider.tsx:55-119`) assina **um canal realtime por
  canal não-direto do usuário** e, ao receber o broadcast, toca som + dispara
  `showBrowserHermesNotification`.

Notificações:
- 100% **client-side e foreground**: `new Notification(...)` em
  `lib/pulsex/notification-effects.ts:250`. Só funciona com **aba aberta** e só se o broadcast
  chegar. Não há Web Push (o único service worker é o de PWA, `panteon-pwa-runtime.tsx`,
  para instalação/cache — não para push).
- Não há fan-out no servidor: a tabela `hub_notifications` **existe**, mas o Hermes **não
  grava** nada nela. Uma resposta não gera nenhum registro durável.

## Causas-raiz (confirmadas no código + infra)

1. **Entrega efêmera, sem durabilidade (broadcast cliente→cliente).** O servidor não entrega
   nada; depende do navegador do remetente broadcastar e do destinatário estar inscrito
   naquele instante. Reconexão / aba fechada / canal em segundo plano = mensagem perdida até
   um refetch manual. → "mensagens não chegando".
2. **Notificação só foreground + disparada pelo broadcast.** Sem Web Push e sem registro
   durável, quem está com a aba fechada (ou cujo realtime caiu) **nunca** é notificado de uma
   resposta. → "notificação das respostas não chega".
3. **Fallback de confiabilidade só no canal aberto.** O polling de 4s cobre apenas o canal
   ativo; os canais de segundo plano (onde caem respostas) dependem só do broadcast frágil.
4. **Pior dos dois mundos (custo × confiabilidade).** O polling de 4s é o que gera a fatura
   alta, mas não resolve a entrega em segundo plano. Paga-se caro e ainda se perde mensagem.
5. **Mecanismo confiável já provisionado, porém não usado.** `pulsex_messages` já está na
   publicação `supabase_realtime` (Postgres Changes/CDC habilitado). O app ignora isso e usa
   broadcast manual.
6. **Sinais de fragilidade do Realtime em produção.** Logs do serviço Realtime (últimas 24h)
   inundados de `MissingAPIKey: API key is missing or not a valid string` (a cada ~60s) e
   `Stop tenant bxgukywoxgivlrhjkwjx because of no connected users`. Indica realtime sem
   tráfego de usuário bem-sucedido e/ou conexões falhando autenticação. (Fonte exata do
   `MissingAPIKey` a confirmar em validação ao vivo.)
7. **Escala de subscriptions.** O provider abre **uma subscription realtime por canal
   não-direto por usuário**; muitos canais × muitos usuários se aproxima dos limites de
   Realtime do Supabase → subscriptions caindo em silêncio.

## O que NÃO é o problema (evitar caça errada)
- Não é a persistência: a `POST` grava a mensagem normalmente em `pulsex_messages` (a
  mensagem existe no banco; some é a **entrega em tempo real**).
- Não é RLS na API: a rota usa service role e valida acesso por código (`ensureChannelAccess`).
- Não é falta de CDC no banco: o Postgres Changes já está publicado — está **inerte**.

## Plano de correção proposto (priorizado, consciente de custo)

R1 — Entrega confiável dirigida pelo servidor (corrige #1, #3, #4 e o custo):
- Trocar a recepção de **broadcast** para **`postgres_changes`** (INSERT em `pulsex_messages`),
  que já está habilitado. A entrega passa a ocorrer em todo insert, independente do cliente
  remetente broadcastar. Remove a dependência do broadcast manual.
- **Reduzir/eliminar o polling de 4s** (corta a fatura) deixando o realtime como fonte
  primária, com um refetch leve só na (re)entrada do canal e no reconnect do socket.

R2 — Notificação durável (corrige #2):
- Gravar `hub_notifications` no insert (trigger no banco ou na própria rota POST) para
  respostas/menções, com contador de não-lidas server-side (badge real).
- Adicionar **Web Push** (já há service worker de PWA) para notificar com a aba fechada.

R3 — Robustez/observabilidade:
- Investigar a origem do `MissingAPIKey` e confirmar auth do websocket realtime em produção.
- Revisar nº de subscriptions por usuário (consolidar em menos canais se possível).
- Garantir reconciliação no reconnect (refetch + dedupe) para não perder a janela de eventos.

## Status
- Diagnóstico fechado e registrado. **Nenhuma alteração de código/infra feita.**
- Pendente: autorização do Lucas para o caminho de correção (R1 primeiro é o de maior impacto
  e ainda corta custo). Toda mudança de realtime/migration/trigger começa BLOQUEADA até OK.
