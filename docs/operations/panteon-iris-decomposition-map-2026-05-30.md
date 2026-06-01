# Panteon - mapa de decomposicao da Iris

Assunto: [Iris] mapa de decomposicao

Status: `VALIDADO_LOCAL / DOCUMENTAL / SEM CODIGO`

Protocolo: `MD-20260530-001-IRIS-DECOMPOSITION-MAP`

Owner operacional: Zeus

Modulo consumidor: Iris

Camada transversal relacionada: Athena, somente pelo contrato `AT-20260530-002-ATHENA-IRIS-CACA`

## Objetivo

Mapear a decomposicao segura da Iris antes de mover codigo. Este recorte nao altera comportamento, UI, API, banco, Supabase, Meta, OpenAI, env, secret, Vercel, alias, Preview, homologacao ou producao.

O objetivo pratico e transformar a `IrisPage.tsx` em fila de recortes pequenos, auditaveis e validaveis, preservando atendimento, tickets, conversa, Meta/WhatsApp, Setup, relatorios e Caca.

## Fontes verificadas

- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`
- `docs/architecture/design-guidelines.md`
- `docs/architecture/agent-operating-model.md`
- `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`
- `apps/hub/modules/caredesk/IrisPage.tsx`
- `apps/hub/app/iris/page.tsx`
- `apps/hub/lib/iris/**`
- `apps/hub/app/api/iris/**`

## Diagnostico atual

A Iris esta funcionalmente concentrada em `apps/hub/modules/caredesk/IrisPage.tsx`.

Evidencias locais:

- `IrisPage.tsx` tem `13.050` linhas.
- O arquivo inicia com `/* eslint-disable */` e `// @ts-nocheck`.
- A pagina concentra shell interno, navegacao, carga de dados, realtime, fila, historico, atendimento, conversa, Caca, Meta/WhatsApp, disparos, Setup, templates, relatorios, helpers visuais, helpers de dados e mapeadores de Supabase.
- `IrisPage` recebe modos como `boardOnly`, `embedded`, `initialTickets`, `loadFromSupabase`, `operatorScoped` e `queueSlugFilter`.
- Views reconhecidas: `gestao`, `historico`, `atendimento`, `disparos`, `setup` e `relatorios`.
- O atendimento detalhado e aberto por selecao de ticket, nao como item principal do sidebar.

## Superficie real encontrada

Rotas e libs do dominio Iris:

```text
apps/hub/app/iris/page.tsx
apps/hub/modules/caredesk/IrisPage.tsx
apps/hub/lib/iris/caca-agent.ts
apps/hub/lib/iris/caca-media-analysis.ts
apps/hub/lib/iris/meta-inbound-processor.ts
apps/hub/lib/iris/meta-server.ts
apps/hub/lib/iris/meta-whatsapp.ts
apps/hub/lib/iris/notification-effects.ts
apps/hub/app/api/iris/apolo/phone-match/route.ts
apps/hub/app/api/iris/apolo/search/route.ts
apps/hub/app/api/iris/attendant/route.ts
apps/hub/app/api/iris/meta/events/route.ts
apps/hub/app/api/iris/meta/messages/route.ts
apps/hub/app/api/iris/meta/status/route.ts
apps/hub/app/api/iris/meta/templates/media/route.ts
apps/hub/app/api/iris/meta/templates/route.ts
apps/hub/app/api/iris/meta/webhook/route.ts
apps/hub/app/api/iris/tickets/route.ts
```

Principais simbolos internos em `IrisPage.tsx`:

| Linha | Simbolo                    | Responsabilidade atual                                                 |
| ----: | -------------------------- | ---------------------------------------------------------------------- |
|    73 | `IrisPageProps`            | contrato de entrada da pagina Iris                                     |
|   829 | `IrisPage`                 | composicao raiz, estado, carga, realtime, selecao e roteamento interno |
|  1549 | `IrisTopbar`               | cabecalho interno da Iris                                              |
|  1567 | `ManagementView`           | visao de gestao/fila                                                   |
|  1653 | `HistoryView`              | historico e foco por ticket/contato                                    |
|  1891 | `IrisTicketQueue`          | lista operacional de tickets                                           |
|  2157 | `IrisStartAttendanceModal` | abertura de atendimento                                                |
|  3013 | `IrisTicketRow`            | linha/card de ticket                                                   |
|  3160 | `AttendanceView`           | envelope da tela de atendimento                                        |
|  3219 | `IrisConversationPanel`    | conversa, composer, contexto, acoes e atendimento                      |
|  5336 | `IrisAttendantPanel`       | painel Caca/Athena dentro da Iris                                      |
|  5656 | `TicketChecklist`          | checklist operacional do ticket                                        |
|  5684 | `MetaWhatsAppEnginePanel`  | painel Meta/WhatsApp e eventos                                         |
|  5986 | `BroadcastView`            | disparos e governanca de campanhas                                     |
|  6091 | `SetupView`                | Setup da Iris                                                          |
|  6951 | `IrisSetupTabs`            | abas do Setup                                                          |
|  6990 | `IrisTemplateSetupPanel`   | templates Meta                                                         |
|  8808 | `ReportsView`              | relatorios                                                             |
| 10019 | `loadIrisData`             | leitura Supabase e montagem do snapshot                                |
| 10230 | `enrichTicketsWithCrm360`  | enriquecimento com Apolo/CRM360 via API interna                        |
| 11284 | `mapTicketRow`             | mapeamento de ticket                                                   |
| 11348 | `mapMessageRow`            | mapeamento de mensagens                                                |

## Arvore alvo recomendada

Estrutura alvo para decompor sem redesenhar o produto:

```text
apps/hub/modules/caredesk/
  IrisPage.tsx
  blocks/
    shell/
      iris-shell.tsx
      iris-sidebar.tsx
      iris-topbar.tsx
    board/
      management-view.tsx
      ticket-queue.tsx
      ticket-row.tsx
      ticket-summary.ts
    history/
      history-view.tsx
      history-focus.ts
    start-attendance/
      start-attendance-modal.tsx
    conversation/
      iris-conversation-readonly.tsx
      iris-composer-actions.tsx
      attendance-view.tsx
      conversation-panel.tsx
      message-list.tsx
      composer.tsx
      ticket-actions.tsx
      context-panel.tsx
    caca/
      iris-attendant-panel.tsx
      attendant-contract.ts
    meta-whatsapp/
      meta-whatsapp-engine-panel.tsx
      meta-events.tsx
    broadcasts/
      broadcast-view.tsx
    setup/
      setup-view.tsx
      setup-tabs.tsx
      template-setup-panel.tsx
      template-feedback.ts
    reports/
      reports-view.tsx
    shared/
      components.tsx
      formatters.ts
      status.ts
      ticket-selectors.ts

apps/hub/lib/iris/
  contracts/
  application/
  repositories/
  integrations/
    apolo/
    meta/
  agents/
    caca/
```

Observacao: esta e uma arvore alvo incremental. Ela nao autoriza criacao em massa. Cada pasta deve nascer apenas quando um recorte pequeno mover codigo real para ela.

## Ordem segura de recortes

| Ordem | Protocolo sugerido                           | Escopo                                                             | Regra                                                            |
| ----: | -------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
|     1 | `MD-20260530-002-IRIS-SHARED-UI`             | extrair helpers visuais puros                                      | sem estado, sem fetch, sem API, sem comportamento novo           |
|     2 | `MD-20260530-003-IRIS-SHELL`                 | topbar, sidebar e navegacao interna                                | manter identidade visual Panteon e contrato do design guidelines |
|     3 | `MD-20260530-004-IRIS-BOARD`                 | composicao `IrisBoardView`, metricas e agenda lateral              | `IrisPage` continua dona da fila, carga e selecao                |
|     4 | `MD-20260530-005-IRIS-BOARD-QUEUE`           | `IrisTicketQueue`, `IrisTicketRow` e dependencias visuais do board | sem alterar filtros, selecao ou lifecycle de ticket              |
|     5 | `MD-20260530-006-IRIS-HISTORY`               | `HistoryView` e helpers de foco                                    | sem alterar filtros ou semantica de historico                    |
|     6 | `MD-20260530-007-IRIS-START-ATTENDANCE`      | modal de abertura de atendimento                                   | sem mudar Apolo/search/templates                                 |
|     7 | `MD-20260530-008-IRIS-CONVERSATION-READONLY` | envelope, lista e renderizacao de mensagens                        | sem mexer no envio ainda                                         |
|     8 | `MD-20260530-009-IRIS-COMPOSER-ACTIONS`      | composer, editar, reparar, audio e fechamento                      | validar atendimento com rota local                               |
|     9 | `MD-20260530-010-IRIS-CACA-PANEL`            | `IrisAttendantPanel`                                               | seguir contrato Athena/Iris Caca                                 |
|    10 | `MD-20260530-011-IRIS-META-BROADCASTS`       | Meta engine e disparos                                             | sem tocar webhook/env/Meta real sem autorizacao                  |
|    11 | `MD-20260530-012-IRIS-SETUP-TEMPLATES`       | Setup, abas e templates                                            | preservar Setup existente e fluxo Meta                           |
|    12 | `MD-20260530-013-IRIS-REPORTS`               | relatorios                                                         | sem alterar fonte de dados                                       |
|    13 | `MD-20260530-014-IRIS-DATA-CLIENT`           | `loadIrisData`, mappers e snapshot                                 | recorte de maior risco, exige validacao forte                    |

O primeiro recorte tecnico executado e `MD-20260530-002-IRIS-SHARED-UI`, porque reduziu tamanho sem tocar em fonte de dados, realtime, APIs, Caca, Meta ou regras de atendimento.

Recortes executados:

| Protocolo                                    | Status         | Saida                                                                                                          |
| -------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `MD-20260530-001-IRIS-DECOMPOSITION-MAP`     | validado local | mapa documental da decomposicao Iris                                                                           |
| `MD-20260530-002-IRIS-SHARED-UI`             | validado local | `blocks/shared/iris-ui.tsx` com helpers visuais puros                                                          |
| `MD-20260530-003-IRIS-SHELL`                 | validado local | `blocks/shell/iris-shell.tsx` com shell interno, topbar/sidebar e navegacao local                              |
| `MD-20260530-004-IRIS-BOARD`                 | validado local | `blocks/board/iris-board-view.tsx` com composicao do board, metricas e agenda lateral                          |
| `MD-20260530-005-IRIS-BOARD-QUEUE`           | validado local | `blocks/board/iris-ticket-queue.tsx` com fila, cabecalho da lista e linha de ticket                            |
| `MD-20260530-006-IRIS-HISTORY`               | validado local | `blocks/history/iris-history-view.tsx` com historico, foco e filtros de consulta local                         |
| `MD-20260530-007-IRIS-START-ATTENDANCE`      | validado local | `blocks/start-attendance/iris-start-attendance-modal.tsx` com modal de contato ativo e abertura de atendimento |
| `MD-20260530-008-IRIS-CONVERSATION-READONLY` | validado local | `blocks/conversation/iris-conversation-readonly.tsx` com inbox, timeline e contexto read-only da conversa      |
| `MD-20260530-009-IRIS-COMPOSER-ACTIONS`      | validado local | `blocks/conversation/iris-composer-actions.tsx` com footer, checklist, toolbar, emoji, textarea, audio e envio |
| `MD-20260530-010-IRIS-CACA-PANEL`            | validado local | `blocks/caca/iris-attendant-panel.tsx` com painel Caca, prompt, documento parcial, retorno, boletos e handoff  |
| `MD-20260530-011-IRIS-META-BROADCASTS`       | validado local | `blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx` com Meta engine e disparos existentes                     |
| `MD-20260530-012-IRIS-SETUP-TEMPLATES`       | validado local | `blocks/setup/iris-setup-view.tsx` com Setup, filas, assuntos e templates Meta                                 |
| `MD-20260530-013-IRIS-REPORTS`               | validado local | `blocks/reports/iris-reports-view.tsx` com relatorios existentes                                               |
| `MD-20260530-014-IRIS-DATA-CLIENT`           | validado local | `data/iris-data-client.ts` com carga, enriquecimento CRM360, mappers, mensagens e snapshot                     |
| `MD-20260531-015-IRIS-TYPES-FOUNDATION`      | validado local | `types/iris-types.ts` com contratos centrais usados por Data Client e Relatorios                               |
| `MD-20260531-016-IRIS-START-ATTENDANCE-TYPES` | validado local | `start-attendance` ligado aos tipos compartilhados de filas, assuntos, templates, Meta, Apolo e feedback       |
| `MD-20260531-017-IRIS-META-WHATSAPP-TYPES`   | validado local | `meta-whatsapp` ligado aos tipos compartilhados de broadcasts, snapshot e eventos Meta                         |
| `MD-20260531-018-IRIS-SETUP-TYPES`           | validado local | `setup` com props/constants tipados, payloads Meta e helpers internos religados                                |
| `MD-20260531-019-IRIS-PAGE-SHARED-TYPES`     | validado local | `IrisPage.tsx` importando tipos centrais compartilhados e mantendo apenas contratos contextuais locais         |
| `MD-20260531-020-IRIS-CONTEXT-TYPES`          | validado local | `IrisPage.tsx` importando contratos contextuais compartilhados para Apolo, agenda, origem e inbound notice     |
| `MD-20260531-021-IRIS-APOLO-ANY-GUARDS`       | validado local | helpers Apolo/avatar sem `any`, usando `unknown` e guard de record                                             |
| `MD-20260531-022-IRIS-SETUP-CONSTANTS-HOTFIX` | validado local | hotfix do Setup extraido, reinjetando labels/status/prioridades via `constants` e restaurando imports de icones |

Status atual:

- A fila tecnica mapeada para a Iris (`MD-001` a `MD-014`) esta fechada localmente.
- `IrisPage.tsx` segue como composicao raiz, agora com `6.359` linhas aferidas neste checkout.
- Nao houve Preview, homologacao, producao, migration, env, secret, alias, Supabase admin, banco real ou Meta real.
- Tipagem gradual iniciada por `MD-20260531-015` e continuada em `MD-20260531-016`, `MD-20260531-017`, `MD-20260531-018`, `MD-20260531-019`, `MD-20260531-020` e `MD-20260531-021`, seguida pelo hotfix `MD-20260531-022` no Setup extraido, sem fluxo novo.
- Proxima etapa: continuar tipagem dos blocos herdados e validacao visual autenticada quando o Browser/local estiver disponivel.

## Fronteiras por bloco

| Bloco            | Dono                    | Pode tocar                                         | Nao pode tocar neste ciclo                          |
| ---------------- | ----------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Shell            | Iris Core / Zeus visual | navegacao interna, header e composicao             | login, Panteon shell global, permissoes             |
| Board            | Iris Core               | fila, cards, contadores, selecao local             | carga Supabase, mutacoes, Meta                      |
| History          | Iris Core               | historico, foco e filtros de consulta local        | fechamento de ticket, envio de mensagem             |
| Start Attendance | Iris Core               | modal, formulario e chamada interna existente      | alterar contrato do Apolo ou criar integracao nova  |
| Conversation     | Iris Core               | renderizacao, contexto, composer e acoes humanas   | payload sensivel em log, IA automatica, Meta env    |
| Caca             | Iris Core + Athena      | painel IA, prompt, fallback e evidencia autorizada | OpenAI real/env/chave sem autorizacao Lucas         |
| Meta/WhatsApp    | Iris Core               | painel operacional e eventos ja existentes         | webhook/env/chave/Meta real sem autorizacao Lucas   |
| Setup/Templates  | Iris Core               | UI de filas, perfis e templates                    | migration, secret, alteracao de provider            |
| Reports          | Iris Core               | apresentacao de indicadores existentes             | nova fonte de dados sem protocolo                   |
| Data Client      | Iris Core / Zeus Data   | mappers, snapshot, repositorio local               | banco real, migration, Supabase admin, service role |

## Validacao esperada para recortes tecnicos

Para qualquer move de codigo Iris:

- `node scripts/panteon-recorte-manifest-check.mjs --manifest <manifesto>`
- `node scripts/panteon-boundary-check.mjs --module iris --allow athena --files <arquivos>`
- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- smoke local autenticado da rota `/iris` quando houver alteracao visual ou de fluxo
- validacao visual com Browser/print quando o recorte tocar layout, sidebar, topbar, cards, conversa ou Setup

Para recortes que toquem Caca, Meta, OpenAI, Apolo, Hades, Supabase, env, banco, Vercel, alias, Preview, homologacao ou producao, o status inicial e `BLOQUEADO` ate autorizacao expressa do Lucas e contrato especifico no manifesto.

## Riscos atuais

- `IrisPage.tsx` concentra muitas responsabilidades e esta com `@ts-nocheck`, entao extracoes grandes podem esconder regressao.
- Caca, Meta/WhatsApp, Apolo/CRM360 e ticket lifecycle estao proximos no mesmo arquivo.
- `loadIrisData` concentra Supabase, mappers, filtros e enriquecimento, portanto deve ficar para depois dos moves visuais.
- A decomposicao nao deve virar redesign. A identidade visual deve seguir o Panteon principal e `docs/architecture/design-guidelines.md`.
- Existem pontos de UI e tipagem herdados que devem ser tratados como debito existente, nao como escopo automatico deste recorte.

## Rollback

Como este recorte e documental, o rollback e:

- remover `docs/operations/panteon-iris-decomposition-map-2026-05-30.md`;
- remover o manifesto `docs/operations/panteon-recorte-manifest-md-20260530-001-iris-decomposition-map.json`;
- retirar as referencias ao protocolo `MD-20260530-001-IRIS-DECOMPOSITION-MAP` dos documentos operacionais atualizados.

Nao ha rollback de runtime porque nenhum codigo de produto foi alterado.

## Conclusao

O mapa confirma que a Iris entrou na nova engenharia por decomposicao incremental e fechou localmente a fila tecnica registrada de `MD-20260530-001` a `MD-20260530-014`. Os recortes `MD-20260531-015` a `MD-20260531-021` continuam a tipagem gradual com contratos compartilhados e guards para Data Client, Relatorios, Start Attendance, Meta/WhatsApp, Setup/Templates, pagina raiz, contexto Apolo/agenda/inbound e helpers Apolo/avatar. O hotfix `MD-20260531-022` corrigiu o Setup extraido ao reinjetar labels/status/prioridades via contrato `constants` e restaurar imports de icones usados pelos cards de templates. O impacto pratico e que a pagina unica de `13.050` linhas passou a uma composicao raiz de `6.359` linhas, com blocos isolados para shared UI, shell, board, fila, historico, start-attendance, conversation-readonly, composer-actions, Caca, Meta/Disparos, Setup/Templates, Relatorios e Data Client. Nao precisa de acao do Lucas agora para execucao local; qualquer Preview, homologacao, producao, banco, env, secret, alias ou operacao externa segue bloqueado ate autorizacao explicita.
