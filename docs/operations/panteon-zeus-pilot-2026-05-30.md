# Panteon - piloto Zeus

Assunto: [Zeus] piloto de decomposicao segura

Status: `VALIDADO_LOCAL / PILOTO COMPLETO / SEM DEPLOY`

Protocolos: `OP-20260530-003-ZEUS-SHARED-UI` ate `OP-20260530-012-ZEUS-HELPDESK`

## Objetivo

Iniciar a decomposicao real do modulo Zeus com um recorte pequeno, mecanico e reversivel, provando que a nova esteira funciona antes de mexer em blocos maiores como HelpDesk, Deploys, Timeline, Auditorias, Registros ou Database Monitoring.

## Escopo

Incluido:

- extrair componentes visuais internos de `ZeusPage.tsx` para `apps/hub/modules/squadops/blocks/shared/operations-ui.tsx`;
- manter chamadas, estados, APIs, filtros, dados e comportamento iguais;
- registrar manifesto de recorte e validacoes locais.

Fora do escopo:

- sem alteracao visual intencional;
- sem mudanca de API, Supabase, banco, env, secret, alias, dominio, Vercel ou deploy;
- sem mexer em Iris, Hades, Hermes, Chronos, Atlas, Apolo, Ares ou Setup;
- sem decompor internamente o fluxo do HelpDesk alem da movimentacao mecanica para `blocks/helpdesk`.

## Arquivos de produto

- `apps/hub/modules/squadops/ZeusPage.tsx`
- `apps/hub/modules/squadops/blocks/shared/operations-ui.tsx`

## O que foi extraido

Componentes movidos de dentro de `ZeusPage.tsx`:

- `PanelTitle`
- `DetailField`
- `DetailBlock`
- `EmptyState`

Destino:

```text
apps/hub/modules/squadops/blocks/shared/operations-ui.tsx
```

Leitura:

- estes componentes sao usados por varias visoes internas do Zeus;
- a extracao cria o primeiro ponto real de `blocks/shared`;
- a pagina principal continua grande, mas agora existe uma trilha concreta para novas extracoes por bloco.

## Segundo recorte

Protocolo: `OP-20260530-004-ZEUS-MONITORING-UTILS`

Destino:

```text
apps/hub/modules/squadops/blocks/monitoring/performance-utils.ts
```

Helpers puros movidos de dentro de `ZeusPage.tsx`:

- ordenacao e agregacao de checks: `sortMonitoringChecksByLatest`, `getSlowestCheck`, `getHighestPayloadCheck`, `getMaxResponseMs`, `getAverageResponseMs`;
- formatacao e tons: `formatMetricMs`, `formatIndicatorEvidence`, `getResponseChecksTone`, `payloadPerformanceTone`;
- resumos de monitoramento: `getColdStartSummary`, `getCacheSummary`, `getCacheHeaderValue`;
- classes de performance: `monitoringSourceTone`, `responsePerformanceBarClass`, `responsePerformanceTone`, `performanceChartColors`, `performanceCardBorderClass`, `performanceIconClass`, `performancePillClass`.

Leitura:

- a extracao nao muda fetch, estado, APIs, layout ou regra de negocio;
- o arquivo novo isola logica pura de performance para preparar futura extracao do bloco `monitoring`;
- a dependencia com `OperationsCheckMetric` e `OperationsMonitoringSnapshot` continua tipada pelo contrato de monitoring existente.

## Validacao local

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON` no `apps/hub/eslint.config.js`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-003-zeus-shared-ui.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "\s+$"` nos novos arquivos do piloto: sem ocorrencias.

Validacao adicional do segundo recorte:

- `node --check apps\hub\modules\squadops\blocks\monitoring\performance-utils.ts`: OK;
- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON` no `apps/hub/eslint.config.js`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-004-zeus-monitoring-utils.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "\s+$"` nos novos arquivos do recorte: sem ocorrencias.

## Terceiro recorte

Protocolo: `OP-20260530-005-ZEUS-MONITORING-SOURCES`

Destino:

```text
apps/hub/modules/squadops/blocks/monitoring/source-grid.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `MonitoringSourceGrid`;
- `MonitoringSourceCard`;
- `MiniTrendBars`;
- `MonitoringSourceSummary`;
- `getMonitoringSourceMeta`;
- `getMonitoringSourceIcon`;
- `getMonitoringSourceOrder`.

Leitura:

- o `ZeusPage.tsx` continua dono de estado, fetch e composicao da tela;
- o novo arquivo renderiza a grade/cartoes de fontes monitoradas e a curva curta de tendencia;
- funcoes de status/payload seguem no `ZeusPage.tsx` e sao injetadas como props para evitar ampliar o recorte.

Validacao do terceiro recorte:

- `node --check apps\hub\modules\squadops\blocks\monitoring\source-grid.tsx`: nao aplicavel a TSX direto (`ERR_UNKNOWN_FILE_EXTENSION`), substituido por typecheck/lint/build;
- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, apos remover import residual `Wifi` do `ZeusPage.tsx`, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-005-zeus-monitoring-sources.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "\s+$"` nos novos arquivos do recorte: sem ocorrencias.

## Quarto recorte

Protocolo: `OP-20260530-006-ZEUS-MONITORING-PEAKS`

Destino:

```text
apps/hub/modules/squadops/blocks/monitoring/peaks-panel.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `MonitoringPeakPanel`;
- `PerformanceLineChart`.

Leitura:

- o `ZeusPage.tsx` continua dono de estado, fetch e composicao da tela;
- o novo arquivo renderiza picos recentes, curva de resposta e maior payload recente;
- formatadores de data/payload e variante de risco seguem injetados por props para evitar ampliar o recorte.

Validacao do quarto recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON` no `apps/hub/eslint.config.js`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-006-zeus-monitoring-peaks.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Quinto recorte

Protocolo: `OP-20260530-007-ZEUS-MONITORING-ALERTS`

Destino:

```text
apps/hub/modules/squadops/blocks/monitoring/alerts-panel.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `OperationsAlertCenter`;
- `OperationsAlertsDialog`;
- `OperationsAlertsPanel`;
- `OpsWatcherPanel`;
- `AlertProtocolsHistoryPanel`.

Leitura:

- o `ZeusPage.tsx` continua dono de estado, fetch, persistencia local e callbacks operacionais;
- o novo arquivo renderiza a central de alertas, o Ops Watcher, o historico de notificacoes e os protocolos de alertas/devolutivas;
- formatadores de data, status e variantes de risco seguem injetados por props para evitar ampliar o recorte.

Validacao do quinto recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, apos remover imports residuais `BellRing` e `EyeOff` do `ZeusPage.tsx`, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-007-zeus-monitoring-alerts.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Sexto recorte

Protocolo: `OP-20260530-008-ZEUS-DEPLOY-RELEASE-CARDS`

Destino:

```text
apps/hub/modules/squadops/blocks/deploys/release-cards.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `ReleaseModuleGroupSection`;
- `ReleaseProtocolCard`;
- `ReleaseProtocolPipeline`;
- `ReleaseMetaLine`;
- tipo `ReleaseModuleGroup`.

Leitura:

- o `ZeusPage.tsx` continua dono de estado, fetch, homologation reviews, persistencia local/compartilhada e callbacks operacionais;
- o novo arquivo renderiza cards visuais de release/deploy, pipeline de homologacao/producao e metadados de commit, deployment e healthcheck;
- o recorte nao executa Vercel, alias, deploy, homologacao real ou producao.

Validacao do sexto recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-008-zeus-deploy-release-cards.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Setimo recorte

Protocolo: `OP-20260530-009-ZEUS-TIMELINE-RECORDS`

Destino:

```text
apps/hub/modules/squadops/blocks/records/timeline-records.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `ProtocolRecordCard`;
- `TimelinePanel`;
- `RecordsTable`;
- `TimelineItem`.

Leitura:

- o `ZeusPage.tsx` continua dono de filtros, selecao, status e resumo dos registros;
- o novo arquivo renderiza cards curtos, timeline operacional e tabela de registros estruturados;
- o recorte nao altera fonte de dados, API, fetch ou persistencia.

Validacao do setimo recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-009-zeus-timeline-records.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Oitavo recorte

Protocolo: `OP-20260530-010-ZEUS-AUDITS`

Destino:

```text
apps/hub/modules/squadops/blocks/audits/audit-routines.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `AuditRoutinesPanel`;
- `AuditSummaryPill`;
- `AuditRoutineGroup`;
- `AuditRoutineCard`;
- `AuditRoutineDetailDrawer`.

Leitura:

- o `ZeusPage.tsx` continua dono de selecao da rotina, fonte de dados e resolucao de status;
- o novo arquivo renderiza painel de auditorias, cards de rotina e drawer de detalhe;
- o recorte nao altera fonte de dados, API, fetch ou persistencia.

Validacao do oitavo recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, apos remover imports residuais `DetailBlock` e `DetailField` do `ZeusPage.tsx`, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-010-zeus-audits.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Nono recorte

Protocolo: `OP-20260530-011-ZEUS-PO-AI`

Destino:

```text
apps/hub/modules/squadops/blocks/po-ai/po-ai-panel.tsx
```

Movido de dentro de `ZeusPage.tsx`:

- `FloatingPoAiButton`;
- `PoAiDrawer`;
- `PoAiChannelPanel`;
- `PromptLibraryModal`;
- `PoAiMessageBubble`;
- `CopilotAnswerBubbles`;
- parser e badges de resposta do PO AI;
- tipos `PoAiChatMessage` e `PromptTemplate`;
- helper `createPoAiMessage`.

Leitura:

- o `ZeusPage.tsx` continua dono de estado, pergunta atual, fetch para `/api/zeus/copilot`, abertura/fechamento e selecao de template;
- o novo arquivo renderiza botao flutuante, drawer, canal de conversa, biblioteca de prompts e organizacao visual das respostas;
- o recorte nao chama OpenAI, nao altera endpoint, nao altera prompt template e nao executa API externa.

Validacao do nono recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, apos remover imports residuais `CalendarDays`, `MessageSquareText`, `Send`, `ServerCog` e `WandSparkles` do `ZeusPage.tsx`, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-011-zeus-po-ai.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Decimo recorte

Protocolo: `OP-20260530-012-ZEUS-HELPDESK`

Destino:

```text
apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx
apps/hub/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts
```

Movido/isolado:

- `HubItTicketsBoard` saiu de `apps/hub/modules/squadops/HubItTicketsBoard.tsx` e passou para `blocks/helpdesk/helpdesk-board.tsx`;
- `countOpenItTickets` e `countItTicketsWaitingForZeus` sairam do `ZeusPage.tsx` e passaram para `blocks/helpdesk/helpdesk-ticket-summary.ts`.

Leitura:

- o `ZeusPage.tsx` continua dono da aba ativa, token de acesso, contadores e composicao principal;
- o board HelpDesk continua dono da fila, detalhes, anexos, gravacao e respostas;
- o recorte nao altera endpoint, fetch, persistencia, status, fluxo de resposta ou regra de negocio.

Validacao do decimo recorte:

- `npm.cmd run check-types:hub`: OK;
- `npm.cmd run lint:hub`: OK, com aviso conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido de Turbopack sobre trace de `engineering-operations-source.ts`;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-012-zeus-helpdesk.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no recorte: OK, com aviso esperado de LF/CRLF em `ZeusPage.tsx` e no diario;
- `rg -n "[ \t]+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Proximas extracoes candidatas

Ordem recomendada para o Zeus:

1. `shared/operations-ui`: componentes pequenos e reutilizaveis.
2. `monitoring`: `DatabaseMonitoringView`, fontes, cards, hotspots, graficos e watcher.
3. `deploys`: protocolos, homologacao, releases e prompts de producao.
4. `timeline-records`: filtros, timeline, registros e detalhes.
5. `audits`: rotinas e drawers de auditoria.
6. `po-ai`: canal PO AI, prompts e parsing de respostas.
7. `helpdesk`: board e tickets.

Conclusao:

- O piloto Zeus foi fechado localmente por extracoes seguras e mecanicas.
- O impacto pratico e provar a esteira de decomposicao sem alterar comportamento de producao.
- A proxima acao e iniciar o contrato `AT-20260530-001-ATHENA-ZEUS-CONTRACT`.
