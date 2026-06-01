# Panteon - arvore completa de trabalho

Assunto: [Zeus] work tree executavel multiagente

Status: `ATIVA / EXECUCAO POR RECORTE`

Base congelada:

- Producao: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`
- Rollback: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`
- Codigo publicado: `e5c7ac3`
- Registro pos-deploy: `a145058`

## Regra de execucao

Cada item abaixo vira recorte com:

- `protocolId`;
- modulo e agente dono;
- arquivos incluidos;
- exclusoes explicitas;
- validacoes;
- rollback;
- status no diario canonico;
- bloqueio automatico se tocar env, secret, banco, migration, alias, dominio, Supabase, Vercel ou producao sem autorizacao expressa do Lucas.

## Raiz

```text
PANTEON-ENG-RESET
  00-governanca
  01-inventario
  02-ownership
  03-zeus-pilot
  04-athena-contracts
  05-module-decomposition
  06-shared-packages
  07-gates-and-ci
  08-zeus-cockpit-vivo
  09-homologation-preview-lane
  10-production-lane-hefesto
```

## 00 - Governanca

Status: `VALIDADO_LOCAL`

Recortes:

| id                                            | owner | status         | saida                                         |
| --------------------------------------------- | ----- | -------------- | --------------------------------------------- |
| `OP-20260530-001-ZEUS-BOUNDARY`               | Zeus  | validado local | manifesto de recorte e boundary gate          |
| `ZEUS-20260530-001-FOTOGRAFIA-REESTRUTURACAO` | Zeus  | validado local | fotografia, mapa modulo-agente e fronteira v1 |

Proximos:

- criar ownership check por bloco;
- criar blocker de root misto;
- integrar gates ao Safety Gate antes de qualquer Preview.

## 01 - Inventario

Status: `VALIDADO_LOCAL`

Recortes:

| id                               | owner | status         | saida                        |
| -------------------------------- | ----- | -------------- | ---------------------------- |
| `OP-20260530-002-ZEUS-INVENTORY` | Zeus  | validado local | scanner e inventario real v1 |

Proximos:

- inventario fino de `app/api` por dominio;
- inventario de imports cross-owner por severidade;
- mapa de arquivos sem owner.

## 02 - Ownership

Status: `INICIADO`

Fila:

| ordem | item                                    | owner          | status   |
| ----: | --------------------------------------- | -------------- | -------- |
|     1 | mapear `hub-support` e `hub-it-tickets` | Zeus           | pendente |
|     2 | mapear `apps/guardian/**` legado        | Hades / Zeus   | pendente |
|     3 | mapear packages shared/database/uix     | Zeus / Hefesto | pendente |
|     4 | declarar contratos Athena por modulo    | Athena / Zeus  | pendente |
|     5 | criar `ownership-check` por bloco       | Zeus           | pendente |

## 03 - Zeus Pilot

Status: `VALIDADO_LOCAL / PILOTO COMPLETO`

Ordem:

| ordem | protocolo                                   | bloco                          | status         | observacao                     |
| ----: | ------------------------------------------- | ------------------------------ | -------------- | ------------------------------ |
|     1 | `OP-20260530-003-ZEUS-SHARED-UI`            | `shared/operations-ui`         | validado local | componentes visuais pequenos   |
|     2 | `OP-20260530-004-ZEUS-MONITORING-UTILS`     | `monitoring/performance-utils` | validado local | helpers puros                  |
|     3 | `OP-20260530-005-ZEUS-MONITORING-SOURCES`   | `monitoring/source-grid`       | validado local | grid/cards de fontes           |
|     4 | `OP-20260530-006-ZEUS-MONITORING-PEAKS`     | `monitoring/peaks`             | validado local | picos e linha de performance   |
|     5 | `OP-20260530-007-ZEUS-MONITORING-ALERTS`    | `monitoring/alerts`            | validado local | alert center e watcher         |
|     6 | `OP-20260530-008-ZEUS-DEPLOY-RELEASE-CARDS` | `deploys/release-cards`        | validado local | cards visuais de release       |
|     7 | `OP-20260530-009-ZEUS-TIMELINE-RECORDS`     | `timeline-records`             | validado local | timeline e tabela de registros |
|     8 | `OP-20260530-010-ZEUS-AUDITS`               | `audits`                       | validado local | rotinas e drawer de detalhe    |
|     9 | `OP-20260530-011-ZEUS-PO-AI`                | `po-ai`                        | validado local | chat, prompts e parser         |
|    10 | `OP-20260530-012-ZEUS-HELPDESK`             | `helpdesk`                     | validado local | board e tickets                |

Regra:

- manter comportamento igual ate o modulo estar dividido;
- cada extracao deve passar `check-types`, `lint`, `build`, manifesto e boundary;
- sem Preview/homologacao/producao ate Lucas autorizar protocolo especifico.

## 04 - Athena Contracts

Status: `VALIDADO_LOCAL / TRILHA FECHADA`

Fila:

| ordem | contrato                           | dono primario    | status         |
| ----: | ---------------------------------- | ---------------- | -------------- |
|     1 | Athena em Zeus PO AI               | Zeus / Athena    | validado local |
|     2 | Athena em Iris Caca                | Iris / Athena    | validado local |
|     3 | Athena em Hades copilot            | Hades / Athena   | validado local |
|     4 | Athena em Chronos atas/agente      | Chronos / Athena | validado local |
|     5 | regra de logs sem payload sensivel | Zeus / Athena    | validado local |

## 05 - Module Decomposition

Status: `INICIADO / IRIS MAPA VALIDADO_LOCAL / CODIGO AINDA BLOQUEADO POR RECORTE`

Fila recomendada:

| ordem | modulo       | motivo                                                |
| ----: | ------------ | ----------------------------------------------------- |
|     1 | Zeus         | centro de controle e menor risco externo              |
|     2 | Iris         | maior pagina e maior risco de atendimento             |
|     3 | Hades        | precisa resolver fronteira Hades/Iris                 |
|     4 | Hermes       | depende de chamadas/media e Athena                    |
|     5 | Apolo        | depende do legado C2X e Hades                         |
|     6 | Ares         | server/data grandes                                   |
|     7 | Atlas        | pagina grande, menor risco imediato                   |
|     8 | Chronos      | congelado no curto prazo por ser baseline de producao |
|     9 | Panteon Core | shell/home/launcher, apenas apos gates maduros        |

Recortes:

| id                                           | owner            | status         | saida                                                                                           |
| -------------------------------------------- | ---------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `MD-20260530-001-IRIS-DECOMPOSITION-MAP`     | Zeus / Iris      | validado local | mapa de decomposicao da Iris antes de mover codigo                                              |
| `MD-20260530-002-IRIS-SHARED-UI`             | Zeus / Iris      | validado local | shared UI da Iris em `blocks/shared/iris-ui.tsx`                                                |
| `MD-20260530-003-IRIS-SHELL`                 | Iris Core / Zeus | validado local | shell interno da Iris em `blocks/shell/iris-shell.tsx`                                          |
| `MD-20260530-004-IRIS-BOARD`                 | Iris Core / Zeus | validado local | composicao do board em `blocks/board/iris-board-view.tsx`                                       |
| `MD-20260530-005-IRIS-BOARD-QUEUE`           | Iris Core / Zeus | validado local | fila e linha de ticket em `blocks/board/iris-ticket-queue.tsx`                                  |
| `MD-20260530-006-IRIS-HISTORY`               | Iris Core / Zeus | validado local | historico, foco e filtros em `blocks/history/iris-history-view.tsx`                             |
| `MD-20260530-007-IRIS-START-ATTENDANCE`      | Iris Core / Zeus | validado local | modal de abertura de atendimento em `blocks/start-attendance/iris-start-attendance-modal.tsx`   |
| `MD-20260530-008-IRIS-CONVERSATION-READONLY` | Iris Core / Zeus | validado local | inbox, timeline e contexto read-only em `blocks/conversation/iris-conversation-readonly.tsx`    |
| `MD-20260530-009-IRIS-COMPOSER-ACTIONS`      | Iris Core / Zeus | validado local | composer, checklist, toolbar e acoes humanas em `blocks/conversation/iris-composer-actions.tsx` |
| `MD-20260530-010-IRIS-CACA-PANEL`            | Iris Core / Zeus | validado local | painel Caca em `blocks/caca/iris-attendant-panel.tsx`                                          |
| `MD-20260530-011-IRIS-META-BROADCASTS`       | Iris Core / Zeus | validado local | Meta engine e disparos em `blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx`                  |
| `MD-20260530-012-IRIS-SETUP-TEMPLATES`       | Iris Core / Zeus | validado local | Setup, filas, assuntos e templates em `blocks/setup/iris-setup-view.tsx`                        |
| `MD-20260530-013-IRIS-REPORTS`               | Iris Core / Zeus | validado local | relatorios em `blocks/reports/iris-reports-view.tsx`                                           |
| `MD-20260530-014-IRIS-DATA-CLIENT`           | Iris Core / Zeus | validado local | data client em `data/iris-data-client.ts`                                                       |
| `MD-20260531-015-IRIS-TYPES-FOUNDATION`      | Iris Core / Zeus | validado local | tipos centrais em `types/iris-types.ts`, usados por data client e relatorios                    |
| `MD-20260531-016-IRIS-START-ATTENDANCE-TYPES` | Iris Core / Zeus | validado local | `start-attendance` usando os tipos compartilhados da Iris                                       |
| `MD-20260531-017-IRIS-META-WHATSAPP-TYPES`   | Iris Core / Zeus | validado local | `meta-whatsapp` usando os tipos compartilhados da Iris para eventos Meta                        |
| `MD-20260531-018-IRIS-SETUP-TYPES`           | Iris Core / Zeus | validado local | `setup` usando contratos compartilhados e helpers religados                                     |
| `MD-20260531-019-IRIS-PAGE-SHARED-TYPES`     | Iris Core / Zeus | validado local | `IrisPage.tsx` usando contratos centrais compartilhados                                         |
| `MD-20260531-020-IRIS-CONTEXT-TYPES`          | Iris Core / Zeus | validado local | `IrisPage.tsx` usando contratos contextuais compartilhados para Apolo, agenda e inbound        |
| `MD-20260531-021-IRIS-APOLO-ANY-GUARDS`       | Iris Core / Zeus | validado local | helpers Apolo/avatar sem `any`, usando `unknown` e guard de record                             |
| `MD-20260531-022-IRIS-SETUP-CONSTANTS-HOTFIX` | Iris Core / Zeus | validado local | Setup extraido recebendo labels/status/prioridades via `constants` e imports de icones         |
| `MD-20260531-023-HADES-IRIS-QUEUE-EMBED`      | Hades Core / Iris | validado local | Hades consumindo contrato publico `IrisCollectionQueueEmbed`, sem importar `IrisPage` direto    |

Status atual:

- Fila tecnica Iris `MD-20260530-001` a `MD-20260530-014` fechada localmente.
- `IrisPage.tsx` ficou com `6.359` linhas aferidas neste checkout.
- Tipagem gradual iniciada por `MD-20260531-015-IRIS-TYPES-FOUNDATION` e continuada por `MD-20260531-016-IRIS-START-ATTENDANCE-TYPES`, `MD-20260531-017-IRIS-META-WHATSAPP-TYPES`, `MD-20260531-018-IRIS-SETUP-TYPES`, `MD-20260531-019-IRIS-PAGE-SHARED-TYPES`, `MD-20260531-020-IRIS-CONTEXT-TYPES`, `MD-20260531-021-IRIS-APOLO-ANY-GUARDS` e hotfix `MD-20260531-022-IRIS-SETUP-CONSTANTS-HOTFIX`.
- Primeiro recorte pos-Iris aberto em Hades: `MD-20260531-023-HADES-IRIS-QUEUE-EMBED`, reduzindo a fronteira critica Hades -> Iris sem mudar comportamento.
- Sem Preview, homologacao, producao, migration, banco, env, secret, alias, Supabase admin ou Meta real.

## 06 - Shared Packages

Status: `PENDENTE`

Fila:

- `packages/uix`: componentes compartilhados e tokens;
- `packages/database`: migrations/schema, sempre bloqueado sem autorizacao;
- `packages/shared`: registry de modulos e permissoes;
- `packages/realtime`: contrato Hermes;
- `packages/auth`: contrato de login/perfil.

## 07 - Gates And CI

Status: `INICIADO`

Fila:

| ordem | gate                                      | status         |
| ----: | ----------------------------------------- | -------------- |
|     1 | `panteon-boundary-check`                  | validado local |
|     2 | `panteon-recorte-manifest-check`          | validado local |
|     3 | `panteon-inventory-scan`                  | validado local |
|     4 | ownership por bloco                       | pendente       |
|     5 | root dirty blocker                        | pendente       |
|     6 | secret/env name scan seguro               | pendente       |
|     7 | import cross-owner severity               | pendente       |
|     8 | integration with homologation safety gate | pendente       |

## 08 - Zeus Cockpit Vivo

Status: `PENDENTE`

Objetivo:

- transformar os artefatos em fonte estruturada visivel no modulo Zeus.

Fila:

- painel de baseline de producao;
- painel de recortes/protocolos;
- painel de worktrees;
- painel de gates;
- painel de riscos cross-owner;
- painel de env names sem valores;
- painel de releases/homologacao/producao.

## 09 - Homologation Preview Lane

Status: `BLOQUEADO SEM AUTORIZACAO`

Entrada obrigatoria:

- manifesto de recorte validado;
- pacote limpo;
- Safety Gate;
- projeto Vercel esperado;
- rollback;
- Lucas autoriza o protocolo.

## 10 - Production Lane Hefesto

Status: `BLOQUEADO SEM AUTORIZACAO`

Entrada obrigatoria:

- recorte homologado;
- diario reconciliado;
- releases-production atualizado;
- healthchecks C2X e OPS;
- rollback testado;
- Lucas autoriza producao pelo protocolo.

## Execucao agora

Ultimos recortes executados:

- `MD-20260530-011-IRIS-META-BROADCASTS`
- `MD-20260530-012-IRIS-SETUP-TEMPLATES`
- `MD-20260530-013-IRIS-REPORTS`
- `MD-20260530-014-IRIS-DATA-CLIENT`
- `MD-20260531-015-IRIS-TYPES-FOUNDATION`
- `MD-20260531-016-IRIS-START-ATTENDANCE-TYPES`
- `MD-20260531-017-IRIS-META-WHATSAPP-TYPES`
- `MD-20260531-018-IRIS-SETUP-TYPES`
- `MD-20260531-019-IRIS-PAGE-SHARED-TYPES`
- `MD-20260531-020-IRIS-CONTEXT-TYPES`
- `MD-20260531-021-IRIS-APOLO-ANY-GUARDS`
- `MD-20260531-022-IRIS-SETUP-CONSTANTS-HOTFIX`
- `MD-20260531-023-HADES-IRIS-QUEUE-EMBED`
- `MD-20260531-024-HADES-ATTENDANCE-NAVIGATION`
- `MD-20260531-025-HADES-PROFILE-SCOPE`
- `MD-20260531-026-HADES-DAILY-QUEUE`
- `MD-20260531-027-HADES-MANUAL-OPERATIONS`
- `MD-20260531-028-HADES-ATTENDANCE-ROUTING`
- `MD-20260531-029-HADES-WHATSAPP-ROUTING`
- `MD-20260531-030-HADES-QUEUE-TYPES`
- `MD-20260531-031-HADES-QUEUE-FILTER-OPTIONS`
- `MD-20260531-032-HADES-QUEUE-WORKFLOW-METRICS`
- `MD-20260531-033-HADES-QUEUE-ACTIVE-FILTERS`
- `MD-20260531-034-HADES-CLIENT-PAYMENT-BEHAVIOR`
- `MD-20260531-035-HADES-CLIENT-DETAIL-NAVIGATION`
- `MD-20260531-036-HADES-CLIENT-COMMITMENT-METRICS`
- `MD-20260531-037-HADES-CLIENT-RISK-METRICS`
- `MD-20260531-038-HADES-CLIENT-PORTFOLIO-SUMMARY`
- `MD-20260531-039-HADES-CLIENT-PROFILE-SUMMARY`
- `MD-20260531-040-HADES-CLIENT-DOCUMENT-SUMMARY`
- `MD-20260531-041-HADES-IRIS-INSTALLMENT-OPTIONS`
- `MD-20260531-042-HADES-IRIS-TEMPLATE-PREVIEW`
- `MD-20260531-043-HADES-IRIS-TICKET-OPTIONS`
- `MD-20260531-044-HADES-WHATSAPP-SERVICE-WINDOW`
- `MD-20260531-045-HADES-WHATSAPP-THREAD-DATA`
- `MD-20260531-046-HADES-WHATSAPP-MESSAGES`
- `MD-20260531-047-HADES-C2X-BOLETOS`
- `MD-20260531-048-HADES-AGREEMENT-CALCULATOR`
- `MD-20260531-049-HADES-WHATSAPP-QUICK-TEMPLATES`
- `MD-20260531-050-HADES-WHATSAPP-FORMATTERS`
- `MD-20260531-051-HADES-WHATSAPP-PROTOCOL`
- `MD-20260531-052-HADES-WHATSAPP-TYPES`
- `MD-20260531-053-HADES-WHATSAPP-TICKET-CHECKLIST`
- `MD-20260531-054-HADES-WHATSAPP-FIELDS`
- `MD-20260531-055-HADES-WHATSAPP-THREAD-VIEW`
- `MD-20260531-056-HADES-WHATSAPP-CLIENT-CONTEXT`
- `MD-20260531-057-HADES-WHATSAPP-TEMPLATE-MODAL`
- `MD-20260531-058-HADES-WHATSAPP-TICKET-CLOSE-MODAL`
- `MD-20260531-059-HADES-WHATSAPP-COMPOSER-BUTTONS`
- `MD-20260531-060-HADES-WHATSAPP-OPERATION-DRAWER`
- `MD-20260531-061-HADES-WHATSAPP-TICKET-SETUP-MODAL`
- `MD-20260531-063-HADES-WHATSAPP-FINAL-SWEEP`
- `MD-20260531-064-HADES-TYPED-FOUNDATION-SURFACES`
- `MD-20260531-065-HADES-TYPED-LAYOUT-STATUS-FOUNDATION`
- `MD-20260531-066-HADES-TYPED-CLIENT-ACTIONS-CARDS`
- `MD-20260531-067-HADES-TYPED-SIDEBAR-CONTRACTS`
- `MD-20260531-068-HADES-TYPED-QUEUE-PANEL`
- `MD-20260531-069-HADES-TYPED-ATTENDANCE-PAGE`
- `MD-20260531-070-HADES-TYPED-TICKET-OPERATIONS-QUEUE`
- `MD-20260531-071-HADES-TYPED-DESK-PAGE`
- `MD-20260531-072-HADES-TYPED-OPERATIONAL-TIMELINE`
- `MD-20260531-073-HADES-TYPED-INSTALLMENTS-CARD`
- `MD-20260531-074-HADES-TYPED-LOCAL-DATA-SOURCE`
- `MD-20260531-075-HADES-TYPED-MONITORING-PAGE`
- `MD-20260531-076-HADES-TYPED-INTELLIGENCE-PAGE`
- `MD-20260531-077-HADES-TYPED-AGREEMENTS-CENTER-CARD`
- `MD-20260531-078-HADES-TYPED-GUARDIAN-ROUTE-WRAPPERS`
- `MD-20260531-079-HADES-TYPED-AI-COPILOT-DRAWER`
- `MD-20260531-080-HADES-TYPED-CLIENT-DETAIL-PANEL`
- `MD-20260531-081-HADES-TYPED-WHATSAPP-CONVERSATION-PANEL`
- `MD-20260531-082-HERMES-THREAD-NOTIFICATIONS`
- `MD-20260531-083-HERMES-THREAD-NOTIFICATION-CONTRACTS`
- `MD-20260531-084-HERMES-ROUTE-API-CONTRACTS`
- `MD-20260531-085-HERMES-DATA-CLIENT`
- `MD-20260531-086-HERMES-WORKSPACE-DECOMPOSITION`
- `MD-20260531-087-HERMES-REALTIME-CONTRACTS`
- `MD-20260531-088-CHRONOS-CLIENT-API-FETCH`
- `MD-20260531-089-CHRONOS-RECORDING-MEDIA-HELPERS`
- `MD-20260531-090-CHRONOS-DRIVE-RECORDING-HELPERS`
- `MD-20260531-091-CHRONOS-ROOM-HELPERS`
- `MD-20260531-092-CHRONOS-INVITEE-HELPERS`
- `MD-20260531-093-CHRONOS-CALENDAR-HELPERS`
- `MD-20260531-094-CHRONOS-MINUTES-PREVIEW-HELPERS`
- arvore automatica ativa: `docs/operations/panteon-hades-auto-continuation-tree-2026-05-31.md`
- arvore automatica Hermes ativa: `docs/operations/panteon-hermes-auto-continuation-tree-2026-05-31.md`
- modulo: Hades
- proximo modulo em execucao local: Chronos
- camada: module-decomposition
- blocos: fronteira `hades-iris-boundary`, `attendance`, contrato publico de embed Iris, navegacao interna de Atendimento, escopo por perfil/faixa de atraso, fila diaria, operacoes manuais, routing interno, WhatsApp protocol routing, QueuePanel types, QueuePanel filter options, QueuePanel workflow metrics, QueuePanel active filters, ClientDetailPanel payment behavior, ClientDetailPanel navigation contracts, ClientDetailPanel commitment metrics, ClientDetailPanel risk metrics, ClientDetailPanel portfolio summary, ClientDetailPanel client profile summary, ClientDetailPanel document summary, WhatsAppConversationPanel installment options, WhatsAppConversationPanel template preview, WhatsAppConversationPanel Iris ticket options, WhatsAppConversationPanel customer service window, WhatsAppConversationPanel thread data, WhatsAppConversationPanel messages, WhatsAppConversationPanel C2X boletos, WhatsAppConversationPanel agreement calculator, WhatsAppConversationPanel quick templates, WhatsAppConversationPanel formatters, WhatsAppConversationPanel protocol helper, WhatsAppConversationPanel local types, WhatsAppConversationPanel ticket checklist, WhatsAppConversationPanel fields, WhatsAppConversationPanel thread view, WhatsAppConversationPanel client context, WhatsAppConversationPanel template modal, WhatsAppConversationPanel ticket close modal, WhatsAppConversationPanel action buttons, WhatsAppConversationPanel operation drawer, WhatsAppConversationPanel ticket setup modal, foundation surfaces tipadas, layout/status foundation tipados, client action cards tipados, sidebar/contracts tipados, QueuePanel tipado, AttendancePage tipado, TicketOperationsQueue tipado, DeskPage tipado, OperationalTimeline tipado, InstallmentsCard tipado, data source tipado, MonitoringPage tipado, IntelligencePage tipado, AgreementsCenterCard tipado, wrappers Guardian tipados, AiCopilotDrawer tipado, ClientDetailPanel tipado, WhatsAppConversationPanel tipado
- objetivo: continuar o modulo mais critico apos Iris, removendo import direto de `IrisPage` dentro do Hades e extraindo navegacao interna, helpers de perfil, fila diaria, operacoes manuais, normalizadores de rota/WhatsApp, contratos/metricas/filtros do QueuePanel, calculo de comportamento de pagamento, contratos de abas/subabas, metricas de compromissos, metricas de risco, resumo de carteira, resumo cadastral, resumo de documentos, opcoes de parcelas, preview de template, normalizacao de opcoes Iris, janela WhatsApp 24h, dados da thread WhatsApp, mensagens, boletos C2X, calculo de acordo, templates rapidos, formatadores, helper de protocolo, tipos locais, checklist do detalhe/atendimento, campos reutilizaveis, thread visual, contexto lateral, modal de templates rapidos, modal de encerramento de ticket, botoes reutilizaveis do header/composer, drawer operacional, modal de abertura/complemento Iris, surfaces basicas, layout/status foundation, QueuePanel, AttendancePage, TicketOperationsQueue, DeskPage, OperationalTimeline, InstallmentsCard, data source, MonitoringPage, IntelligencePage, AgreementsCenterCard, wrappers Guardian, AiCopilotDrawer, ClientDetailPanel e WhatsAppConversationPanel tipados sem alterar fluxo financeiro, atendimento, endpoint D4Sign, abertura de documento, endpoint Iris, token, template Meta real ou envio de mensagem
- recorte automatico seguro fechado: `MD-20260531-081-HADES-TYPED-WHATSAPP-CONVERSATION-PANEL`; `MD-20260531-062-HADES-WHATSAPP-AUTH-TOKEN-BOUNDARY` permanece bloqueado para mudanca funcional
- primeiro recorte Hermes fechado localmente: `MD-20260531-082-HERMES-THREAD-NOTIFICATIONS`
- segundo recorte Hermes fechado localmente: `MD-20260531-083-HERMES-THREAD-NOTIFICATION-CONTRACTS`
- terceiro recorte Hermes fechado localmente: `MD-20260531-084-HERMES-ROUTE-API-CONTRACTS`
- quarto recorte Hermes fechado localmente: `MD-20260531-085-HERMES-DATA-CLIENT`
- quinto recorte Hermes fechado localmente: `MD-20260531-086-HERMES-WORKSPACE-DECOMPOSITION`
- sexto recorte Hermes fechado localmente: `MD-20260531-087-HERMES-REALTIME-CONTRACTS`
- primeiro recorte Chronos pos-Hermes fechado localmente: `MD-20260531-088-CHRONOS-CLIENT-API-FETCH`
- segundo recorte Chronos pos-Hermes fechado localmente: `MD-20260531-089-CHRONOS-RECORDING-MEDIA-HELPERS`
- terceiro recorte Chronos pos-Hermes fechado localmente: `MD-20260531-090-CHRONOS-DRIVE-RECORDING-HELPERS`
- quarto recorte Chronos pos-Hermes fechado localmente: `MD-20260531-091-CHRONOS-ROOM-HELPERS`
- quinto recorte Chronos pos-Hermes fechado localmente: `MD-20260531-092-CHRONOS-INVITEE-HELPERS`
- sexto recorte Chronos pos-Hermes fechado localmente: `MD-20260531-093-CHRONOS-CALENDAR-HELPERS`
- setimo recorte Chronos pos-Hermes fechado localmente: `MD-20260531-094-CHRONOS-MINUTES-PREVIEW-HELPERS`
- validacao: check-types/lint OK; build passou com worker reduzido; smoke local via next start temporario OK para Hades/Guardian/Iris ate `MD-081`; Browser/Chrome visual segue bloqueado por sandbox do conector; gates finais registrados nos manifestos `MD-20260530-011` a `MD-20260531-081`

## Atualizacao 2026-05-31 18:12 - Hermes

Assunto: [Hermes] inicio da fila local

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-082-HERMES-THREAD-NOTIFICATIONS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: notificacoes de respostas novas em threads, contador por mensagem,
  renderizacao segura de links http/https e fallback correto para lista vazia de
  replies.
- Arquivos principais: `apps/hub/components/pulsex/conversation-header.tsx`,
  `apps/hub/components/pulsex/message-item.tsx`,
  `apps/hub/components/pulsex/message-list.tsx`,
  `apps/hub/components/pulsex/pulsex-workspace.tsx` e
  `apps/hub/lib/pulsex/supabase-data.ts`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local PASS para `/hermes`, `/pulsex`, `/iris`, `/hades`
  e 401 esperado em `/api/hermes/messages` sem sessao.
- Browser/in-app visual: bloqueado por falha do conector `node_repl/browser` no
  sandbox durante bootstrap; nao substitui homologacao visual final.

## Atualizacao 2026-05-31 18:19 - Hermes

Assunto: [Hermes] contrato de notificacoes de thread

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-083-HERMES-THREAD-NOTIFICATION-CONTRACTS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair tipos e helpers de notificacoes/leitura de replies para
  `apps/hub/lib/pulsex/thread-notifications.ts`.
- Arquivos principais: `apps/hub/lib/pulsex/thread-notifications.ts`,
  `apps/hub/components/pulsex/conversation-header.tsx` e
  `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS e smoke HTTP local PASS para `/hermes`, `/pulsex`, `/iris` e
  `/hades`.

## Atualizacao 2026-05-31 18:33 - Hermes

Assunto: [Hermes] contratos de rota e API

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-084-HERMES-ROUTE-API-CONTRACTS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: centralizar `hermes`, `/hermes`, `/pulsex`, `/api/hermes/messages` e
  `/api/pulsex/messages` em `apps/hub/lib/pulsex/routes.ts`.
- Arquivos principais: `apps/hub/lib/pulsex/routes.ts`,
  `apps/hub/lib/pulsex/supabase-data.ts`, `apps/hub/app/hermes/page.tsx` e
  `apps/hub/app/pulsex/page.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local PASS para `/hermes`, `/pulsex`, `/iris`, `/hades`
  e 401 esperado nas APIs Hermes/PulseX sem sessao.

## Atualizacao 2026-05-31 18:40 - Hermes

Assunto: [Hermes] cliente de API de mensagens

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-085-HERMES-DATA-CLIENT`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: centralizar sessao Supabase client-side, header Authorization,
  serializacao JSON, `fetch` e parse seguro de resposta em
  `apps/hub/lib/pulsex/messages-api-client.ts`.
- Arquivos principais: `apps/hub/lib/pulsex/messages-api-client.ts` e
  `apps/hub/lib/pulsex/supabase-data.ts`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/hermes` 200, `/pulsex` 307 redirect esperado para `/hermes`, `/iris`
  200, `/hades` 200 e 401 esperado nas APIs Hermes/PulseX sem sessao; manifesto,
  boundary check, varreduras e `git diff --check` PASS.

## Atualizacao 2026-05-31 18:47 - Hermes

Assunto: [Hermes] helpers de mensagens do workspace

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-086-HERMES-WORKSPACE-DECOMPOSITION`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair helpers puros de reacoes, merge/sort de mensagens,
  entrega/leitura e contagem de nao lidas de `pulsex-workspace.tsx` para
  `apps/hub/lib/pulsex/workspace-messages.ts`.
- Arquivos principais: `apps/hub/components/pulsex/pulsex-workspace.tsx`,
  `apps/hub/lib/pulsex/workspace-messages.ts` e
  `apps/hub/lib/pulsex/index.ts`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/hermes` 200, `/pulsex` 307 redirect esperado para `/hermes`, `/iris`
  200, `/hades` 200 e 401 esperado nas APIs Hermes/PulseX sem sessao; manifesto,
  boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 18:54 - Hermes

Assunto: [Hermes] contratos realtime de mensagem

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Protocolo: `MD-20260531-087-HERMES-REALTIME-CONTRACTS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: mover envio de broadcast de mensagem para
  `apps/hub/lib/pulsex/realtime.ts`, preservando evento, topico, parser, canal
  Supabase ativo e payload.
- Arquivos principais: `apps/hub/lib/pulsex/realtime.ts`,
  `apps/hub/components/pulsex/pulsex-workspace.tsx` e
  `apps/hub/lib/pulsex/index.ts`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS,
  `npm.cmd run check-types --workspace @repo/realtime` PASS,
  `npm.cmd run lint --workspace @repo/realtime` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/hermes` 200, `/pulsex` 307 redirect esperado para `/hermes`, `/iris`
  200, `/hades` 200 e 401 esperado nas APIs Hermes/PulseX sem sessao; manifesto,
  boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:01 - Chronos

Assunto: [Chronos] client API browser

- Modulo: Chronos.
- Protocolo: `MD-20260531-088-CHRONOS-CLIENT-API-FETCH`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: centralizar token, Authorization Bearer, `cache: no-store`,
  serializacao JSON/FormData, `fetch` e parse seguro de resposta em
  `apps/hub/lib/chronos/client.ts`.
- Arquivos principais: `apps/hub/lib/chronos/client.ts`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:16 - Chronos

Assunto: [Chronos] helpers de gravacao e midia

- Modulo: Chronos.
- Protocolo: `MD-20260531-089-CHRONOS-RECORDING-MEDIA-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair helpers puros de `MediaStream`, trilhas de audio/video,
  MIME de gravacao e formatacao de duracao para
  `apps/hub/lib/chronos/recording.ts`.
- Arquivos principais: `apps/hub/lib/chronos/recording.ts`,
  `apps/hub/modules/chronos/ChronosPage.tsx` e
  `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:28 - Chronos

Assunto: [Chronos] helpers do Drive de gravacoes

- Modulo: Chronos.
- Protocolo: `MD-20260531-090-CHRONOS-DRIVE-RECORDING-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair tipos e helpers puros do Drive de gravacoes para
  `apps/hub/lib/chronos/drive.ts`, preservando filtros, agrupamentos, datas,
  titulo de reuniao, gravacao persistida e gravacao local.
- Arquivos principais: `apps/hub/lib/chronos/drive.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:33 - Chronos

Assunto: [Chronos] helpers de salas

- Modulo: Chronos.
- Protocolo: `MD-20260531-091-CHRONOS-ROOM-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair draft de sala, slug, link externo, leitura de background,
  leitura de arquivo e filtro de gravacao disponivel para
  `apps/hub/lib/chronos/rooms.ts`.
- Arquivos principais: `apps/hub/lib/chronos/rooms.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:38 - Chronos

Assunto: [Chronos] helpers de convidados

- Modulo: Chronos.
- Protocolo: `MD-20260531-092-CHRONOS-INVITEE-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair tipos, mapeadores Apolo/Hub, chave de convidado, parsing de
  pauta e parsing de participantes para `apps/hub/lib/chronos/invitees.ts`.
- Arquivos principais: `apps/hub/lib/chronos/invitees.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:48 - Chronos

Assunto: [Chronos] helpers de calendario

- Modulo: Chronos.
- Protocolo: `MD-20260531-093-CHRONOS-CALENDAR-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair tipos e helpers de agenda, calendario, datas, recorrencia,
  time grid, filtros, labels de local/perfil e ordenacao para
  `apps/hub/lib/chronos/calendar.ts`.
- Arquivos principais: `apps/hub/lib/chronos/calendar.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 19:55 - Chronos

Assunto: [Chronos] helpers de preview de ata

- Modulo: Chronos.
- Protocolo: `MD-20260531-094-CHRONOS-MINUTES-PREVIEW-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair montagem HTML, sanitizacao, tabela markdown e janela de
  impressao/PDF de ata para `apps/hub/lib/chronos/minutes-preview.ts`.
- Arquivos principais: `apps/hub/lib/chronos/minutes-preview.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS, build
  local PASS, smoke HTTP local no servidor ja ativo em `http://127.0.0.1:3001`
  com `/chronos` 200, `/chronos/lideranca` 200, `/hermes` 200, `/hades` 200,
  `/iris` 200 e 401 esperado para APIs Chronos sem sessao; manifesto, boundary
  check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 20:01 - Chronos

Assunto: [Chronos] componente de preview de ata

- Modulo: Chronos.
- Protocolo: `MD-20260531-095-CHRONOS-MINUTES-PREVIEW-COMPONENT`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair o componente `ChronosMinutesFormattedPreview` para
  `apps/hub/modules/chronos/components/chronos-minutes-formatted-preview.tsx`,
  preservando preview formatado, logo, HTML sanitizado pelo helper local e
  texto de revisao/formalizacao humana.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-minutes-formatted-preview.tsx`
  e `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 20:14 - Chronos

Assunto: [Chronos] componentes de painel

- Modulo: Chronos.
- Protocolo: `MD-20260531-096-CHRONOS-PANEL-COMPONENTS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair mini-paineis, botoes de sala/status, `InfoBlock`,
  `PanelTitle` e `EmptyPanel` para
  `apps/hub/modules/chronos/components/chronos-panels.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-panels.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 20:19 - Chronos

Assunto: [Chronos] helper de proxima acao

- Modulo: Chronos.
- Protocolo: `MD-20260531-097-CHRONOS-NEXT-ACTION-HELPER`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `buildChronosNextAction` para
  `apps/hub/modules/chronos/components/chronos-next-action.ts`, preservando
  regras de proxima acao por status, resumo, ata e follow-ups.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-next-action.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 20:25 - Chronos

Assunto: [Chronos] helper de rascunho de ata

- Modulo: Chronos.
- Protocolo: `MD-20260531-098-CHRONOS-MINUTES-DRAFT-HELPER`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair a montagem do rascunho base de ata para
  `apps/hub/lib/chronos/minutes-draft.ts`, preservando participantes,
  evidencias de gravacao/video, chat, timeline, follow-ups e plano de acao.
- Arquivos principais: `apps/hub/lib/chronos/minutes-draft.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 22:28 - Chronos

Assunto: [Chronos] helpers de formatacao

- Modulo: Chronos.
- Protocolo: `MD-20260531-099-CHRONOS-FORMAT-HELPERS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `formatChronosDateTime` e `formatChronosFileSize` para
  `apps/hub/lib/chronos/format.ts`, preservando data/hora pt-BR curta e
  tamanho de arquivo em `B`, `KB`, `MB` e `GB`.
- Arquivos principais: `apps/hub/lib/chronos/format.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 22:34 - Chronos

Assunto: [Chronos] componente de overview da reuniao

- Modulo: Chronos.
- Protocolo: `MD-20260531-100-CHRONOS-MEETING-OVERVIEW-COMPONENT`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `MeetingOverview`, painel de proxima acao e checklist de
  governanca para
  `apps/hub/modules/chronos/components/chronos-meeting-overview.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-meeting-overview.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 22:39 - Chronos

Assunto: [Chronos] card de gravacao do Drive

- Modulo: Chronos.
- Protocolo: `MD-20260531-101-CHRONOS-DRIVE-RECORDING-CARD`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosDriveMeetingRecordingCard` e
  `ChronosDriveRecordingActions` para
  `apps/hub/modules/chronos/components/chronos-drive-recording-card.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-drive-recording-card.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

## Atualizacao 2026-05-31 22:54 - Chronos

Assunto: [Chronos] card simples do Drive

- Modulo: Chronos.
- Protocolo: `MD-20260531-102-CHRONOS-DRIVE-ITEM-CARD`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosDriveItemCard` para
  `apps/hub/modules/chronos/components/chronos-drive-item-card.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-drive-item-card.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- A arvore completa existe para transformar o projeto em fila executavel por recortes.
- O impacto pratico e que o piloto Zeus fechou localmente, a trilha Athena Contracts fechou localmente, a Iris ja tem a fila tecnica de decomposicao `MD-001` a `MD-014` fechada localmente, a tipagem gradual chegou a `MD-021`, o hotfix do Setup foi registrado como `MD-022`, o primeiro recorte critico pos-Iris abriu a fronteira Hades/Iris como `MD-023`, o Hades iniciou a reducao interna de `AttendancePage.tsx` como `MD-024`, isolou regras de escopo por perfil/faixa como `MD-025`, separou helpers de fila diaria como `MD-026`, moveu helpers de operacoes manuais como `MD-027`, isolou normalizadores de rota como `MD-028`, alinhou o WhatsApp ao normalizador compartilhado como `MD-029`, centralizou tipos do QueuePanel como `MD-030`, moveu opcoes de filtros do QueuePanel como `MD-031`, isolou metricas de workflow como `MD-032`, moveu a montagem de filtros ativos como `MD-033`, extraiu o comportamento de pagamento do `ClientDetailPanel` como `MD-034`, moveu os contratos de abas/subabas do detalhe como `MD-035`, extraiu as metricas de compromissos como `MD-036`, centralizou metricas de risco como `MD-037`, moveu resumo/utilitarios de carteira como `MD-038`, tirou a montagem cadastral cliente/conjuge como `MD-039`, isolou a lista de documentos como `MD-040`, iniciou a reducao do `WhatsAppConversationPanel` pelas opcoes de parcelas Iris/C2X como `MD-041`, isolou o preview de template Iris como `MD-042`, moveu tipos/normalizadores de opcoes Iris como `MD-043`, isolou a janela WhatsApp 24h como `MD-044`, extraiu dados de conversas/ciclos de ticket como `MD-045`, moveu a montagem inicial de mensagens como `MD-046`, separou boletos C2X como `MD-047`, isolou o calculo de acordo como `MD-048`, moveu os templates rapidos como `MD-049`, separou formatadores como `MD-050`, isolou o helper de protocolo como `MD-051`, moveu tipos locais como `MD-052`, separou o checklist de ticket como `MD-053`, moveu os campos reutilizaveis do painel WhatsApp como `MD-054`, separou a thread visual do WhatsApp como `MD-055`, extraiu o contexto lateral do cliente como `MD-056`, separou o modal de templates rapidos como `MD-057`, separou o modal de encerramento de ticket como `MD-058`, separou os botoes do header/composer como `MD-059`, extraiu o drawer operacional como `MD-060`, separou o modal de abertura/complemento Iris como `MD-061`, fechou o sweep local como `MD-063`, iniciou a remocao segura de `@ts-nocheck` em surfaces basicas como `MD-064`, continuou layout/status foundation como `MD-065`, seguiu com client action cards como `MD-066`, tipou sidebar/contracts como `MD-067`, removeu a trava do QueuePanel como `MD-068`, removeu a trava do orquestrador AttendancePage como `MD-069`, removeu a trava da inbox operacional `TicketOperationsQueue` como `MD-070`, removeu a trava da mesa `DeskPage` como `MD-071`, removeu a trava da timeline `OperationalTimeline` como `MD-072`, removeu a trava da visao de parcelas `InstallmentsCard` como `MD-073`, removeu a trava da fonte local `data.ts` como `MD-074`, removeu a trava do monitoramento `MonitoringPage` como `MD-075`, removeu a trava da inteligencia `IntelligencePage` como `MD-076`, removeu a trava da central de acordos `AgreementsCenterCard` como `MD-077`, removeu a trava dos wrappers Guardian como `MD-078`, removeu a trava do drawer Athena `AiCopilotDrawer` como `MD-079`, removeu a trava do detalhe do cliente `ClientDetailPanel` como `MD-080`, removeu a trava do painel WhatsApp `WhatsAppConversationPanel` como `MD-081`, iniciou Hermes com notificacoes de thread como `MD-082`, isolou contratos de notificacao como `MD-083`, centralizou rotas/API como `MD-084`, centralizou o cliente autenticado da API de mensagens como `MD-085`, extraiu helpers puros de mensagens do workspace como `MD-086`, centralizou contrato realtime de broadcast como `MD-087`, iniciou Chronos pos-Hermes centralizando o client API como `MD-088`, extraiu helpers de gravacao/midia como `MD-089`, separou os helpers do Drive de gravacoes como `MD-090`, moveu helpers de salas como `MD-091`, isolou helpers de convidados como `MD-092`, extraiu helpers de calendario como `MD-093`, separou preview/PDF de ata como `MD-094`, extraiu componente de preview de ata como `MD-095`, separou componentes de painel como `MD-096`, moveu helper de proxima acao como `MD-097`, extraiu helper de rascunho de ata como `MD-098`, extraiu helpers de formatacao como `MD-099`, separou overview da reuniao como `MD-100`, separou card de gravacao do Drive como `MD-101`, separou card simples do Drive como `MD-102` e agora possui uma arvore automatica governada para continuar recortes locais sem acao manual a cada passo.
- A proxima acao tecnica nao e publicar; e continuar Chronos em protocolos pequenos, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:01 - Chronos

Assunto: [Chronos] painel de salas

- Modulo: Chronos.
- Protocolo: `MD-20260531-103-CHRONOS-ROOMS-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `RoomsPanel` para
  `apps/hub/modules/chronos/components/chronos-rooms-panel.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-rooms-panel.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de salas em componente dedicado.
- O impacto pratico e reduzir mais um bloco visual do `ChronosPage.tsx` sem mudar selecao de sala, status, capacidade ou requisitos de gravacao/transcricao/ata.
- A proxima acao tecnica e continuar a decomposicao dos paineis de gravacao, transcricao e ata, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:05 - Chronos

Assunto: [Chronos] painel de contexto da gravacao

- Modulo: Chronos.
- Protocolo: `MD-20260531-104-CHRONOS-RECORDING-CONTEXT-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `RecordingContextPanel` para
  `apps/hub/modules/chronos/components/chronos-recording-context-panel.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-recording-context-panel.tsx`
  e `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de contexto da gravacao em componente dedicado.
- O impacto pratico e reduzir mais um bloco pequeno do `ChronosPage.tsx` sem mudar protocolo, data, sala ou status de captura.
- A proxima acao tecnica e continuar a decomposicao dos paineis de gravacao, transcricao e ata, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:10 - Chronos

Assunto: [Chronos] painel de transcricao

- Modulo: Chronos.
- Protocolo: `MD-20260531-105-CHRONOS-TRANSCRIPT-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `TranscriptPanel` para
  `apps/hub/modules/chronos/components/chronos-transcript-panel.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-transcript-panel.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de transcricao em componente dedicado.
- O impacto pratico e reduzir mais um bloco interativo do `ChronosPage.tsx` sem mudar registro manual, participante, expansao ou lista de trechos.
- A proxima acao tecnica e continuar a decomposicao dos paineis de gravacao e ata, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:14 - Chronos

Assunto: [Chronos] painel de gravacoes

- Modulo: Chronos.
- Protocolo: `MD-20260531-106-CHRONOS-RECORDINGS-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `RecordingsPanel` para
  `apps/hub/modules/chronos/components/chronos-recordings-panel.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-recordings-panel.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de gravacoes em componente dedicado.
- O impacto pratico e reduzir a parte de upload/transcricao/playback do `ChronosPage.tsx` sem mudar callbacks, dados ou status de captura.
- A proxima acao tecnica e continuar a decomposicao do painel de ata, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:19 - Chronos

Assunto: [Chronos] painel de ata

- Modulo: Chronos.
- Protocolo: `MD-20260531-107-CHRONOS-MINUTES-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `MinutesPanel` para
  `apps/hub/modules/chronos/components/chronos-minutes-panel.tsx` e
  centralizar variant visual em
  `apps/hub/modules/chronos/components/chronos-minutes-status.ts`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-minutes-panel.tsx`,
  `apps/hub/modules/chronos/components/chronos-minutes-status.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de ata em componente dedicado.
- O impacto pratico e reduzir a area de geracao, edicao, preview, PDF, revisao, aprovacao e exclusao de atas do `ChronosPage.tsx` sem mudar callbacks ou dados.
- A proxima acao tecnica e reavaliar os grandes blocos restantes do Chronos, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:25 - Chronos

Assunto: [Chronos] sidebar interno

- Modulo: Chronos.
- Protocolo: `MD-20260531-108-CHRONOS-SIDEBAR`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosModuleSidebar`, `ChronosView` e itens de navegacao
  para `apps/hub/modules/chronos/components/chronos-sidebar.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-sidebar.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem sidebar interno dedicado.
- O impacto pratico e separar o shell visual do modulo do orquestrador principal sem mudar navegacao, launcher ou estado recolhido.
- A proxima acao tecnica e seguir nos blocos de Drive/agenda/salas restantes, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:29 - Chronos

Assunto: [Chronos] painel de abas do Drive

- Modulo: Chronos.
- Protocolo: `MD-20260531-109-CHRONOS-DRIVE-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosDrivePanel` e `ChronosDriveView` para
  `apps/hub/modules/chronos/components/chronos-drive-panel.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-drive-panel.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o painel de abas do Drive em componente dedicado.
- O impacto pratico e separar a navegacao Gravacoes/Atas do arquivo principal sem mudar view ativa, icones ou container.
- A proxima acao tecnica e seguir em cards/listas de agenda ou telas grandes restantes, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:38 - Chronos

Assunto: [Chronos] limpeza da coluna legada de reunioes

- Modulo: Chronos.
- Protocolo: `MD-20260531-110-CHRONOS-LEGACY-MEETING-COLUMN-CLEANUP`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: remover `ChronosMeetingColumn` e `NewMeetingForm` legados nao usados
  pela tela ativa e centralizar variant visual de status de reuniao em
  `apps/hub/modules/chronos/components/chronos-meeting-status.ts`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-meeting-status.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos teve codigo legado de coluna/formulario removido do arquivo principal.
- O impacto pratico e reduzir superficie morta do `ChronosPage.tsx` e manter o status visual de reuniao compartilhado pelas telas ativas.
- A proxima acao tecnica e seguir nos blocos reais restantes de agenda/calendario, salas e Drive, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:47 - Chronos

Assunto: [Chronos] painel de sala executiva

- Modulo: Chronos.
- Protocolo: `MD-20260531-111-CHRONOS-EXECUTIVE-ROOM-PANEL`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ExecutiveRoomPanel` para
  `apps/hub/modules/chronos/components/chronos-executive-room-panel.tsx`,
  preservando camera, compartilhamento de tela, gravacao local e callbacks de
  timeline/status.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-executive-room-panel.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem a sala executiva em componente dedicado.
- O impacto pratico e reduzir o orquestrador principal sem mudar fluxo de midia, gravacao ou registro de eventos.
- A proxima acao tecnica e seguir nos blocos reais restantes de agenda/calendario, salas e Drive, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-05-31 23:54 - Chronos

Assunto: [Chronos] gestao de salas

- Modulo: Chronos.
- Protocolo: `MD-20260531-112-CHRONOS-ROOMS-MANAGEMENT-SCREEN`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosRoomsManagementScreen` para
  `apps/hub/modules/chronos/components/chronos-rooms-management-screen.tsx`,
  preservando criacao, edicao, exclusao, slug externo e upload de fundo.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-rooms-management-screen.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem a gestao de salas em componente dedicado.
- O impacto pratico e remover do orquestrador principal a administracao de salas sem mudar handlers, dados ou integracoes.
- A proxima acao tecnica e seguir nos blocos restantes de agenda/calendario e Drive, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-06-01 00:01 - Chronos

Assunto: [Chronos] canvas de calendario

- Modulo: Chronos.
- Protocolo: `MD-20260601-113-CHRONOS-CALENDAR-CANVAS`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosCalendarCanvas`, grids de dia/semana/mes/ano,
  cards, pills e `MiniCalendar` para
  `apps/hub/modules/chronos/components/chronos-calendar-canvas.tsx`, movendo
  `chronosMeetingTypeVisuals` para helper compartilhado.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-calendar-canvas.tsx`,
  `apps/hub/modules/chronos/components/chronos-meeting-type-visuals.ts` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o canvas de calendario em componente dedicado.
- O impacto pratico e reduzir o orquestrador principal sem mudar filtros, popups, cards, grid ou navegacao de calendario.
- A proxima acao tecnica e seguir nos blocos restantes de agenda/popup e Drive, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-06-01 00:07 - Chronos

Assunto: [Chronos] popup de detalhes do evento

- Modulo: Chronos.
- Protocolo: `MD-20260601-114-CHRONOS-EVENT-DETAILS-POPUP`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosCalendarEventDetailsPopup` e `DetailRow` para
  `apps/hub/modules/chronos/components/chronos-calendar-event-details-popup.tsx`,
  preservando copia de link, exclusao, detalhes, convidados e sala.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-calendar-event-details-popup.tsx`
  e `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o popup de detalhes em componente dedicado.
- O impacto pratico e reduzir o arquivo principal sem mudar exclusao, copia de link ou dados exibidos.
- A proxima acao tecnica e seguir para o popup/formulario grande de agenda ou Drive, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-06-01 00:14 - Chronos

Assunto: [Chronos] Drive Library

- Modulo: Chronos.
- Protocolo: `MD-20260601-115-CHRONOS-DRIVE-LIBRARY-SCREEN`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosDriveLibraryScreen` e
  `ChronosRecordingFolderExplorer` para
  `apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://127.0.0.1:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o Drive Library em componente dedicado.
- O impacto pratico e reduzir o arquivo principal sem mudar filtros, transcricao, selecao de reuniao ou paineis de ata.
- A proxima acao tecnica e seguir para o formulario grande de agenda, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-06-01 00:24 - Chronos

Assunto: [Chronos] popup de criacao de evento

- Modulo: Chronos.
- Protocolo: `MD-20260601-116-CHRONOS-CALENDAR-EVENT-POPUP`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosCalendarEventPopup` e
  `getChronosApoloAccessToken` para
  `apps/hub/modules/chronos/components/chronos-calendar-event-popup.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-calendar-event-popup.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://localhost:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem o popup de criacao de evento em componente dedicado.
- O impacto pratico e reduzir o arquivo principal sem mudar recorrencia, sala, convidados internos/externos ou busca Apolo.
- A proxima acao tecnica e fazer a varredura final do `ChronosPage.tsx`, mantendo migration/env/Preview/Homo/Producao bloqueados ate autorizacao do Lucas.

## Atualizacao 2026-06-01 00:31 - Chronos

Assunto: [Chronos] tela de agenda

- Modulo: Chronos.
- Protocolo: `MD-20260601-117-CHRONOS-AGENDA-SCREEN`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: extrair `ChronosAgendaScreen` para
  `apps/hub/modules/chronos/components/chronos-agenda-screen.tsx`.
- Arquivos principais:
  `apps/hub/modules/chronos/components/chronos-agenda-screen.tsx` e
  `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://localhost:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O Chronos agora tem a tela de agenda em componente dedicado.
- O impacto pratico e reduzir o arquivo principal sem mudar canvas, mini calendario, sincronizacao Google Agenda ou popups.
- A proxima acao tecnica e decidir se vale extrair os dois paineis finais ou manter o `ChronosPage.tsx` como orquestrador de aproximadamente 600 linhas.

## Atualizacao 2026-06-01 00:36 - Chronos

Assunto: [Chronos] limpeza final do orquestrador

- Modulo: Chronos.
- Protocolo: `MD-20260601-118-CHRONOS-PAGE-FINAL-CLEANUP`.
- Status: VALIDADO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL.
- Escopo: remover exportacoes legadas `ChronosPrimaryPanel` e
  `ChronosDetailPanel` de `apps/hub/modules/chronos/ChronosPage.tsx`, sem uso
  vivo na composicao atual.
- Arquivos principais: `apps/hub/modules/chronos/ChronosPage.tsx`.
- Validacao: ESLint focado PASS, `check-types:hub` PASS, `lint:hub` PASS,
  build local PASS, smoke HTTP local no servidor ja ativo em
  `http://localhost:3001` com `/chronos` 200, `/chronos/lideranca` 200,
  `/hermes` 200, `/hades` 200, `/iris` 200 e 401 esperado para APIs Chronos
  sem sessao; manifesto, boundary check, varredura e `git diff --check` PASS.

Conclusao:

- O `ChronosPage.tsx` agora fica como orquestrador enxuto, com 429 linhas e apenas a funcao `ChronosPage`.
- O impacto pratico e encerrar a decomposicao principal do modulo sem mudar Agenda, Salas, Drive, Google Agenda ou APIs.
- A proxima acao tecnica e consolidar status final do Chronos e seguir para o proximo modulo/recorte priorizado pelo plano.
