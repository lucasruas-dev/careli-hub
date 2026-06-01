# Panteon - arvore de atividades da nova engenharia

Assunto: [Zeus] arvore de atividades para engenharia multiagente

Status: `ATIVA COMO ROTEIRO / EXECUCAO GRADUAL`

Base:

- Deployment congelado: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`
- Rollback: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`
- Codigo publicado: `e5c7ac3 fix(chronos): restore google calendar fidelity`
- Registro publicado: `a145058 docs(zeus): register chronos google calendar production deploy`

## Objetivo

Construir o novo cenario de engenharia do Panteon: Zeus no comando operacional, agentes construtores por modulo, Hefesto como apoio de release/producao, Athena como central de IA, fronteiras reais por bloco e deploy sempre partindo da fotografia atual de producao.

## Trilha 0 - Congelamento e comando

Status: `EM EXECUCAO`

Atividades:

- congelar producao no deployment atual;
- bloquear deploy do root misto;
- registrar fotografia de producao;
- registrar mapa modulo-agente;
- registrar manifesto inicial de fronteiras;
- criar primeiro check local de fronteira;
- criar manifesto de recorte e gate local para validar protocolo, arquivos e camadas autorizadas.

Saida esperada:

- Zeus consegue dizer se um recorte pertence ao modulo declarado antes de build/deploy.
- Zeus consegue bloquear manifesto de recorte que misture arquivos de outro modulo sem camada permitida.

## Trilha 1 - Inventario real do projeto

Status: `INICIADA / INVENTARIO LOCAL V1`

Atividades:

- auditar `apps/hub/app` por rotas e APIs;
- auditar `apps/hub/modules` por tela/bloco;
- auditar `apps/hub/lib` por dominio, integracao e server logic;
- auditar `apps/hub/components`, `providers` e `layouts`;
- auditar `packages/*`;
- auditar `scripts`;
- auditar `docs/operations` e `docs/architecture`;
- mapear arquivos gigantes, responsabilidades misturadas e cross-module imports.

Saida esperada:

- diagnostico pasta por pasta com categorias `excelente`, `otimo`, `bom`, `ruim` e `critico`.

Primeira evidencia:

- `scripts/panteon-inventory-scan.mjs` criado como scanner local somente-leitura;
- `docs/operations/panteon-project-inventory-2026-05-30.md` registra o inventario v1;
- workspace vivo avaliado: `621` arquivos, excluindo `.codex-deploy`, `.codex-artifacts`, `node_modules`, `.next`, `.turbo`, `.vercel`, `.git`, `dist`, `build` e `coverage`;
- Hub App Router: `31` paginas, `1` layout, `89` route handlers/API routes;
- arquivos criticos por tamanho: IrisPage, ZeusPage, ChronosPage, ApoloPage, AtlasPage, AresPage, libs server de Chronos/Apolo/Ares/Iris e Setup;
- imports cross-owner relevantes: Iris -> Hades, Apolo -> Hades, Chronos -> Hermes/Apolo, Hades -> Iris, Athena -> Hades e Hermes -> Athena.

## Trilha 2 - Ownership por modulo

Status: `INICIADA`

Modulos do Hub:

- Panteon -> Panteon Core / Zeus
- Zeus -> Zeus
- Apolo -> Apolo Core
- Ares -> Ares Core
- Atlas -> Atlas Core
- Chronos -> Chronos Core
- Hades -> Hades Core
- Hermes -> Hermes Core
- Iris -> Iris Core

Camadas operacionais:

- Athena -> central dos agentes de IA conectados a OpenAI
- Hefesto -> auxiliar de Zeus em release/producao
- Setup -> configuracao operacional e permissoes

Saida esperada:

- cada recorte tem modulo, agente dono, bloco, arquivos permitidos, validacoes e rollback.

## Trilha 3 - Bounded contexts reais

Status: `INICIADA / PILOTO ZEUS`

Alvo por modulo:

```text
apps/hub/modules/<modulo>/
  <ModuloPage>.tsx
  blocks/
    <capacidade>/
      components/
      hooks/
      state/
      view.tsx
  shared/

apps/hub/lib/<modulo>/
  domain/
  application/
  repositories/
  integrations/
  contracts/
```

Primeiros candidatos:

- Zeus: HelpDesk, Deploys, Timeline, Auditorias, Registros, Database Monitoring.
- Iris: fila, conversa, tickets, Meta/WhatsApp, templates, Caca/Athena.
- Chronos: Agenda, Salas, Drive, sala externa, Google Agenda, gravacoes, atas.
- Hades: atendimento, cobranca, acordos, Asaas, D4Sign, read model.
- Hermes: mensagens, threads, canais, chamadas, presence, realtime.

Saida esperada:

- arquivos grandes deixam de ser cidades inteiras e passam a compor blocos.

Primeiro recorte:

- protocolo `OP-20260530-003-ZEUS-SHARED-UI`;
- modulo piloto: Zeus;
- extracao mecanica de `PanelTitle`, `DetailField`, `DetailBlock` e `EmptyState` para `apps/hub/modules/squadops/blocks/shared/operations-ui.tsx`;
- sem mudanca intencional de comportamento, API, dados ou visual;
- status local: validado.

Segundo recorte:

- protocolo `OP-20260530-004-ZEUS-MONITORING-UTILS`;
- modulo piloto: Zeus;
- extracao mecanica de helpers puros de performance/monitoring para `apps/hub/modules/squadops/blocks/monitoring/performance-utils.ts`;
- sem mudanca intencional de comportamento, API, dados, fetch, estado ou visual;
- status local: validado.

Terceiro recorte:

- protocolo `OP-20260530-005-ZEUS-MONITORING-SOURCES`;
- modulo piloto: Zeus;
- extracao mecanica de grid/cards de fontes monitoradas para `apps/hub/modules/squadops/blocks/monitoring/source-grid.tsx`;
- `ZeusPage.tsx` continua dono de estado, fetch e composicao principal;
- status local: validado.

Quarto recorte:

- protocolo `OP-20260530-006-ZEUS-MONITORING-PEAKS`;
- modulo piloto: Zeus;
- extracao mecanica do painel de picos e grafico de linha para `apps/hub/modules/squadops/blocks/monitoring/peaks-panel.tsx`;
- `ZeusPage.tsx` continua dono de estado, fetch e composicao principal;
- status local: validado.

Quinto recorte:

- protocolo `OP-20260530-007-ZEUS-MONITORING-ALERTS`;
- modulo piloto: Zeus;
- extracao mecanica da central de alertas e Ops Watcher para `apps/hub/modules/squadops/blocks/monitoring/alerts-panel.tsx`;
- `ZeusPage.tsx` continua dono de estado, fetch, persistencia local e callbacks operacionais;
- status local: validado.

Sexto recorte:

- protocolo `OP-20260530-008-ZEUS-DEPLOY-RELEASE-CARDS`;
- modulo piloto: Zeus;
- extracao mecanica dos cards visuais de release/deploy para `apps/hub/modules/squadops/blocks/deploys/release-cards.tsx`;
- `ZeusPage.tsx` continua dono de estado, fetch, homologation reviews, persistencia e callbacks operacionais;
- status local: validado.

Setimo recorte:

- protocolo `OP-20260530-009-ZEUS-TIMELINE-RECORDS`;
- modulo piloto: Zeus;
- extracao mecanica da timeline e tabela de registros para `apps/hub/modules/squadops/blocks/records/timeline-records.tsx`;
- `ZeusPage.tsx` continua dono de filtros, selecao, status e resumo dos registros;
- status local: validado.

Oitavo recorte:

- protocolo `OP-20260530-010-ZEUS-AUDITS`;
- modulo piloto: Zeus;
- extracao mecanica do painel de auditorias e drawer de detalhe para `apps/hub/modules/squadops/blocks/audits/audit-routines.tsx`;
- `ZeusPage.tsx` continua dono de selecao da rotina, fonte de dados e resolucao de status;
- status local: validado.

Nono recorte:

- protocolo `OP-20260530-011-ZEUS-PO-AI`;
- modulo piloto: Zeus;
- extracao mecanica do drawer, canal, biblioteca de prompts e parser do PO AI para `apps/hub/modules/squadops/blocks/po-ai/po-ai-panel.tsx`;
- `ZeusPage.tsx` continua dono de estado, fetch para `/api/zeus/copilot`, template selecionado e abertura do canal;
- sem chamada OpenAI, sem API externa nova, sem env, banco, Supabase, Vercel, alias ou deploy;
- status local: validado.

Decimo recorte:

- protocolo `OP-20260530-012-ZEUS-HELPDESK`;
- modulo piloto: Zeus;
- movimentacao mecanica do board HelpDesk para `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`;
- extracao dos contadores de tickets para `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts`;
- `ZeusPage.tsx` continua dono da aba ativa, token de acesso, contadores e composicao principal;
- sem alteracao de endpoint, fetch, persistencia, status, fluxo de resposta ou regra de negocio;
- status local: validado.

Primeiro contrato Athena:

- protocolo `AT-20260530-001-ATHENA-ZEUS-CONTRACT`;
- modulo de controle: Zeus;
- camada transversal: Athena;
- contrato criado em `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`;
- define Athena como central de IA sem virar owner de produto;
- define Zeus como controle operacional de risco, logs, env names, recortes e operacoes sensiveis;
- sem codigo, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Segundo contrato Athena:

- protocolo `AT-20260530-002-ATHENA-IRIS-CACA`;
- modulo consumidor: Iris;
- camada transversal: Athena;
- contrato criado em `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`;
- define Caca como agente customer-facing da Iris e Athena como governanca transversal de IA;
- preserva Iris Core como owner de tickets, conversa, Meta/WhatsApp, handoff humano e experiencia do cliente;
- sem codigo, sem OpenAI, sem Meta, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Terceiro contrato Athena:

- protocolo `AT-20260530-003-ATHENA-HADES-COPILOT`;
- modulo consumidor: Hades;
- camada transversal: Athena;
- contrato criado em `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`;
- define Athena em Hades como copilot interno de operador, nao executor financeiro;
- preserva Hades Core como owner de cobranca, carteira, acordos, boletos, Asaas, D4Sign e legado Guardian;
- sem codigo, sem OpenAI, sem Asaas, sem D4Sign, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Quarto contrato Athena:

- protocolo `AT-20260530-004-ATHENA-CHRONOS-MINUTES`;
- modulo consumidor: Chronos;
- camada transversal: Athena;
- contrato criado em `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`;
- define Athena em Chronos como agente de transcricao e rascunho revisavel, nao aprovador automatico de ata;
- preserva Chronos Core como owner de agenda, salas, reunioes, participantes, gravacoes, Drive, Google Agenda e atas;
- sem codigo, sem OpenAI, sem Google, sem Drive, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Quinto contrato Athena:

- protocolo `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`;
- modulo de controle: Zeus;
- camada transversal: Athena;
- contrato criado em `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`;
- consolida regra de logs sem payload sensivel para Athena, OpenAI, Iris, Hades, Chronos, Hermes e integracoes;
- sem codigo, sem OpenAI, sem Meta, sem Asaas, sem D4Sign, sem Google, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Primeiro mapa de decomposicao Iris:

- protocolo `MD-20260530-001-IRIS-DECOMPOSITION-MAP`;
- modulo alvo: Iris;
- owner operacional: Zeus;
- documento criado em `docs/operations/panteon-iris-decomposition-map-2026-05-30.md`;
- registra a superficie real da `IrisPage.tsx`, rotas `app/api/iris`, libs `lib/iris`, responsabilidades internas e ordem segura de recortes;
- define `MD-20260530-002-IRIS-SHARED-UI` como primeiro recorte tecnico recomendado;
- sem codigo, sem Meta, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Primeiro recorte tecnico Iris:

- protocolo `MD-20260530-002-IRIS-SHARED-UI`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/shared/iris-ui.tsx`;
- moveu `IrisNavButton`, `MiniStat`, `HeaderMetric`, `SignalCard`, `IconOnlySignalCard`, `ActionPanel`, `BuilderCard`, `SetupSection`, `SetupField`, `ProgressLine`, `KpiCard`, `InsightCard`, `FilterSelect` e `EmptyState`;
- `IrisPage.tsx` segue dona de estado, dados, realtime, tickets, Meta/WhatsApp, Caca, Setup e composicao principal;
- sem endpoint novo, sem fetch novo, sem Meta, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Segundo recorte tecnico Iris:

- protocolo `MD-20260530-003-IRIS-SHELL`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/shell/iris-shell.tsx`;
- moveu shell interno, topbar/sidebar, botao do launcher Panteon, toggle recolhivel e navegacao local;
- `IrisPage.tsx` segue dona de `activeView`, `sidebarCollapsed`, `historyFocus`, dados, realtime, tickets, Meta/WhatsApp, Caca, Setup e composicao de views;
- sem endpoint novo, sem fetch novo, sem Meta, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Terceiro recorte tecnico Iris:

- protocolo `MD-20260530-004-IRIS-BOARD`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/board/iris-board-view.tsx`;
- moveu a composicao visual do board, metricas e agenda lateral;
- `IrisPage.tsx` segue dona de fila, selecao, ticket lifecycle, dados, realtime, Meta/WhatsApp, Caca, Setup e composicao de views;
- sem endpoint novo, sem fetch novo, sem Meta, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Quarto recorte tecnico Iris:

- protocolo `MD-20260530-005-IRIS-BOARD-QUEUE`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/board/iris-ticket-queue.tsx`;
- moveu fila, cabecalho da lista e linha de ticket para componente proprio;
- `IrisPage.tsx` segue dona dos helpers de regra, SLA, status efetivo, ownership da Caca, dados, realtime, Meta/WhatsApp, Caca, Setup e composicao de views;
- sem endpoint novo, sem fetch novo, sem Meta, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Quinto recorte tecnico Iris:

- protocolo `MD-20260530-006-IRIS-HISTORY`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/history/iris-history-view.tsx`;
- moveu historico, foco e filtros de consulta local para componente proprio;
- `IrisPage.tsx` segue dona de `historyFocus`, selecao, helpers de regra, dados, realtime, Meta/WhatsApp, Caca, Setup e composicao de views;
- sem endpoint novo, sem fetch novo, sem Meta, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Sexto recorte tecnico Iris:

- protocolo `MD-20260530-007-IRIS-START-ATTENDANCE`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/start-attendance/iris-start-attendance-modal.tsx`;
- moveu modal de contato ativo/novo atendimento para componente proprio;
- `IrisPage.tsx` segue dona de estado raiz, refresh, dados, selecao, ticket lifecycle, Meta/WhatsApp, Caca, Setup e composicao de views;
- sem endpoint novo, sem fetch novo, sem Meta real, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Setimo recorte tecnico Iris:

- protocolo `MD-20260530-008-IRIS-CONVERSATION-READONLY`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/conversation/iris-conversation-readonly.tsx`;
- moveu inbox, timeline de mensagens, historico anterior visivel e contexto read-only para componente proprio;
- `IrisPage.tsx` segue dona de estado raiz, refresh, dados, selecao, ticket lifecycle, Meta/WhatsApp, Caca runtime, Setup, composer, fechamento e modais mutaveis;
- sem endpoint novo, sem fetch novo, sem Meta real, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Oitavo recorte tecnico Iris:

- protocolo `MD-20260530-009-IRIS-COMPOSER-ACTIONS`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/conversation/iris-composer-actions.tsx`;
- moveu footer, checklist, toolbar, contexto de resposta/edicao, emoji picker, textarea, audio e botao de envio para componente proprio;
- `IrisPage.tsx` segue dona de estado raiz, refresh, dados, selecao, funcoes de envio/edicao/reacao/audio, ticket lifecycle, Meta/WhatsApp, Caca runtime, Setup e modais mutaveis;
- sem endpoint novo, sem fetch novo, sem Meta real, sem Caca runtime, sem OpenAI, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Nono recorte tecnico Iris:

- protocolo `MD-20260530-010-IRIS-CACA-PANEL`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/caca/iris-attendant-panel.tsx`;
- moveu painel Caca, prompt, documento parcial, analise, retorno, boletos e handoff para componente proprio;
- `IrisPage.tsx` segue dona de estado raiz, refresh, dados, selecao, chamada ao endpoint `/api/iris/attendant`, feedback, selecao de boleto, uso de resposta sugerida, ticket lifecycle, Meta/WhatsApp, Setup e modais mutaveis;
- sem endpoint novo, sem fetch novo, sem Meta real, sem OpenAI, sem prompt runtime novo, sem payload novo, sem env, sem banco, sem Supabase, sem Vercel, sem alias e sem deploy;
- status local: validado.

Decimo recorte tecnico Iris:

- protocolo `MD-20260530-011-IRIS-META-BROADCASTS`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx`;
- moveu Meta engine, eventos e disparos existentes para componente proprio;
- `IrisPage.tsx` continua dona de estado raiz, auth, refresh e composicao;
- sem webhook/env/Meta real, endpoint novo, payload novo, banco, Supabase admin, Vercel, alias e deploy;
- status local: validado.

Decimo primeiro recorte tecnico Iris:

- protocolo `MD-20260530-012-IRIS-SETUP-TEMPLATES`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/setup/iris-setup-view.tsx`;
- moveu Setup, filas, assuntos e templates Meta para componente proprio;
- `IrisPage.tsx` fornece helpers e constantes para preservar o fluxo existente;
- sem migration, secret, provider novo, endpoint novo, payload novo, banco, Supabase admin, Vercel, alias e deploy;
- status local: validado.

Decimo segundo recorte tecnico Iris:

- protocolo `MD-20260530-013-IRIS-REPORTS`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/blocks/reports/iris-reports-view.tsx`;
- moveu relatorios para componente proprio;
- sem fonte de dados nova, endpoint novo, payload novo, banco, Supabase, Vercel, alias e deploy;
- status local: validado.

Decimo terceiro recorte tecnico Iris:

- protocolo `MD-20260530-014-IRIS-DATA-CLIENT`;
- modulo alvo: Iris;
- bloco criado em `apps/hub/modules/caredesk/data/iris-data-client.ts`;
- moveu `emptyIrisData`, carga client-side, enriquecimento CRM360, timeout, mappers de Supabase, parser de mensagens e snapshot;
- `IrisPage.tsx` ficou com `6.667` linhas aferidas neste checkout e continua dona de estado, realtime, ticket lifecycle e composicao raiz;
- sem migration, service role, Supabase admin, banco real, env, secret, endpoint novo, payload novo, Vercel, alias e deploy;
- status local: validado.

## Trilha 4 - Gates de autoridade

Status: `INICIADA`

Gates planejados:

- `scripts/panteon-boundary-check.mjs`: valida fronteira por modulo;
- `scripts/panteon-recorte-manifest-check.mjs`: valida manifesto de recorte, protocolo, arquivos incluidos, status, risco, camadas permitidas e baseline;
- ownership check por modulo/bloco;
- recorte manifest obrigatorio;
- compare contra producao atual antes de publicar worktree antiga;
- root dirty blocker;
- secret/env scan;
- Homologation Safety Gate;
- healthchecks por modulo;
- logs recentes antes/depois de deploy.

Saida esperada:

- nenhum agente publica pacote que toque arquivos fora do recorte aprovado sem Zeus bloquear.
- nenhum agente publica pacote que toque arquivos fora do recorte aprovado sem Zeus bloquear.
- recortes documentais e tecnicos passam a ter arquivo de manifesto verificavel antes de Preview, homologacao ou producao.

## Trilha 5 - Zeus cockpit vivo

Status: `PENDENTE`

Painel alvo no modulo Zeus:

- producao atual: commit, deployment, aliases, rollback e healthchecks;
- homologacao: deployment, protocolos em teste e riscos;
- worktrees: agente, branch, arquivos tocados, status e conflito;
- recortes: protocolo, modulo, blocos, validacoes e aprovacao;
- migrations: nomes e status, sem connection string;
- envs esperadas: nomes e presenca/ausencia, sem valores;
- incidentes: sintoma, impacto, causa confirmada, dono e proxima acao.

Saida esperada:

- Zeus deixa de ser apenas documentacao e vira a central viva de controle do Panteon.

## Trilha 6 - Retorno controlado da construcao

Status: `INICIADO DOCUMENTALMENTE / CODIGO BLOQUEADO POR RECORTE`

Condicao para liberar codigo:

- fotografia aprovada;
- manifesto de fronteira aprovado;
- check local de fronteira funcionando;
- primeiro modulo piloto escolhido;
- validações minimas por modulo definidas;
- Lucas autoriza explicitamente o retorno de construcao por protocolo.

Conclusao:

- A engenharia nova comeca por controle e fronteira, nao por feature.
- O impacto pratico e reduzir o risco de sobrescrita, recorte misto e deploy de root errado, agora com a fila tecnica Iris `MD-001` a `MD-014` fechada localmente.
- A proxima acao recomendada deve ser um novo protocolo especifico para tipagem gradual, validacao visual autenticada ou outro modulo; Preview, homologacao, producao, banco, env, secret, alias, Vercel e Supabase admin seguem bloqueados ate autorizacao do Lucas.
