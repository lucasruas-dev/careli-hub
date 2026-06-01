# Panteon - plano de reestruturacao de engenharia

Assunto: [Zeus] plano de reestruturacao de engenharia do Panteon

Status: `RASCUNHO OPERACIONAL / AGUARDANDO APROVACAO DO LUCAS`

Base: `docs/operations/panteon-production-snapshot-2026-05-30.md`

## Objetivo

Elevar a engenharia do Panteon com organizacao por modulo/bloco, rastreabilidade, worktrees limpos, gates automaticos e promocao segura por protocolo, sem sobrescrever o que ja esta em producao.

## Premissas

- Producao esta congelada no deployment `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`.
- O marco de codigo vigente e `e5c7ac3 fix(chronos): restore google calendar fidelity`.
- O registro pos-deploy vigente e `a145058 docs(zeus): register chronos google calendar production deploy`.
- O root `homolog` esta atrasado e misto, portanto nao deve ser publicado.
- Nenhuma operacao sensivel sai de `BLOQUEADO` sem autorizacao expressa do Lucas.

## Fase 0 - Fotografia e bloqueio

Status: `INICIADA`

Entregas:

- `docs/operations/panteon-production-snapshot-2026-05-30.md`
- registro no diario canonico
- confirmacao de deployment atual de `c2x.app.br` e `ops.c2x.app.br`
- confirmacao de rollback imediato
- mapeamento inicial de root, worktrees, modulos, packages, scripts e riscos

Criterio de saida:

- Lucas reconhece o marco congelado.
- Nenhum agente publica de root misto.
- Primeiro recorte seguro e aprovado por protocolo.

## Fase 1 - Diagnostico estrutural

Status: `INICIADA`

Atividades:

- classificar arquivos por tamanho, risco e acoplamento;
- separar `apps/hub/app`, `apps/hub/modules`, `apps/hub/lib`, `apps/hub/components`, `packages/*`, `docs/*` e `scripts/*`;
- inventariar todos os modulos oficiais do Hub/sidebar: Panteon, Zeus, Apolo, Ares, Atlas, Chronos, Hades, Hermes e Iris;
- inventariar separadamente as camadas/squads/agentes operacionais: Hefesto, Athena e Setup;
- identificar rotas API com dominio pesado;
- identificar componentes de modulo acima de 2000 linhas;
- identificar arquivos compartilhados com impacto transversal;
- identificar recortes ja validados, homologados, bloqueados ou apenas locais.
- registrar o mapa modulo-agente em `docs/operations/panteon-module-agent-map.md`;
- registrar fronteiras iniciais em `docs/operations/panteon-module-boundary-manifest-v1.json`.
- criar scanner local somente-leitura em `scripts/panteon-inventory-scan.mjs`;
- registrar inventario v1 em `docs/operations/panteon-project-inventory-2026-05-30.md`.

Categorias:

- `excelente`: governanca, safety gate e registros vivos.
- `otimo`: worktrees e pacotes limpos quando usados corretamente.
- `bom`: dominios ja nomeados em `modules` e `lib`.
- `ruim`: arquivos gigantes e root misto.
- `critico`: risco de publicar base atrasada ou sobrescrever producao.

Primeira fotografia local:

- workspace vivo: `621` arquivos avaliados;
- App Router Hub: `31` paginas e `89` API route handlers;
- arquivos gigantes mais relevantes: `IrisPage.tsx`, `ZeusPage.tsx`, `ChronosPage.tsx`, `ApoloPage.tsx`, `AtlasPage.tsx`, `AresPage.tsx`, `Chronos server`, `Apolo server`, `Ares server`, `Iris Caca/Meta`, `Setup page`;
- cross-owner imports a tratar por contrato: Iris/Hades, Apolo/Hades, Chronos/Hermes, Chronos/Apolo, Hades/Iris, Athena/Hades e Hermes/Athena.

## Fase 2 - Arquitetura alvo

Status: `PROPOSTA`

Estrutura recomendada por modulo, alinhada ao diagnostico Zeus:

```text
apps/hub/modules/<modulo>/
  <ModuloPage>.tsx
  blocks/
    <tela-ou-capacidade>/
      components/
      hooks/
      state/
      view.tsx
  shared/
    components/
    formatters/
    constants/

apps/hub/lib/<modulo>/
  domain/
  application/
  repositories/
  integrations/
  contracts/
```

Diretrizes:

- `app/api` deve ser transporte fino.
- Dominio e integracoes devem viver em `apps/hub/lib/<modulo>/domain`, `application`, `repositories`, `integrations` e `contracts`.
- Blocos de modulo devem exportar contratos, nao internals.
- Cada bloco deve declarar owner, arquivos permitidos e validacoes minimas.
- Refatoracao deve preservar comportamento de producao e ser mecanica.

Exemplo Chronos:

```text
apps/hub/modules/chronos/
  blocks/
    agenda/
    rooms/
    drive/
    external-room/
    minutes/
    google-calendar/
    recordings/
  shared/

apps/hub/lib/chronos/
  domain/
  application/
  repositories/
  integrations/
  contracts/
```

Exemplo Hermes:

```text
apps/hub/modules/hermes/
  blocks/
    messages/
    calls/
    channels/
    presence/
  shared/

apps/hub/lib/hermes/
  messages/
  calls/
  realtime/
  storage/
```

## Fase 3 - Governanca multiagente

Status: `INICIADA`

Entregas:

- `docs/operations/panteon-agent-governance-v2.md`
- ownership por modulo/bloco
- regra de protocolo obrigatoria para qualquer recorte
- regra de handoff para Zeus/Hefesto
- bloqueio formal para root misto

Papeis operacionais:

- Lucas: autoridade final para producao, env, banco, migration, dominios e operacoes sensiveis.
- Zeus: modulo do Hub e agente operacional para homologacao quando autorizado, Safety Gate, snapshots, rollback, incidentes, governanca e protecao de aliases.
- Hefesto: promocao para producao, healthchecks finais, rollback e rastreabilidade oficial.
- Athena: central dos agentes de IA conectados a OpenAI, sem alterar codigo fora de recorte aprovado e sem substituir owner de modulo.
- Agentes de modulo: implementam somente modulo/bloco autorizado, validam, registram e entregam recorte para Zeus/Hefesto.

Modulos oficiais do Hub:

- Panteon;
- Zeus;
- Apolo;
- Ares;
- Atlas;
- Chronos;
- Hades;
- Hermes;
- Iris.

## Fase 4 - Gates automaticos

Status: `INICIADA`

Gates propostos:

- ownership check por modulo;
- boundary check para import entre modulos;
- recorte manifest obrigatorio;
- deploy manifest obrigatorio;
- check de root sujo antes de deploy;
- check de aliases `c2x.app.br`, `ops.c2x.app.br` e `homo.c2x.app.br`;
- check de arquivos gigantes e acoplamento;
- smoke pack por modulo;
- secret/env scan antes de pacote.
- compare contra producao atual antes de qualquer worktree antiga publicar;
- check de participacao Athena em arquivos de IA declarados.

Scripts candidatos:

- `scripts/panteon-ownership-check.mjs`
- `scripts/panteon-boundary-check.mjs` criado como primeiro gate local
- `scripts/panteon-recorte-manifest-check.mjs` criado como gate local de manifesto de recorte
- extensao segura de `scripts/homologation-safety-gate.mjs`

Nenhum script novo deve executar escrita real, deploy, alias, env, migration ou banco.

Entregas locais ja criadas:

- `docs/operations/panteon-recorte-manifest-template.json`
- `scripts/panteon-recorte-manifest-check.mjs`

Validacao esperada para todo recorte:

- o manifesto declara `protocolId`, `module`, `agent`, `blocks`, `includedFiles`, `excludedPaths`, `validations`, `riskLevel`, `status`, `allowedLayers` e `productionBaseline` quando aplicavel;
- o gate bloqueia arquivo de outro modulo quando a camada nao foi declarada em `allowedLayers`;
- status de homologacao/producao exige `approvedBy = Lucas`;
- operacoes sensiveis continuam bloqueadas sem aprovacao expressa do Lucas.

## Fase 5 - Refatoracao segura

Status: `INICIADA LOCALMENTE / PILOTO ZEUS / SEM DEPLOY`

Ordem recomendada:

1. Reconciliar base documental/root com o marco de producao sem tocar produto.
2. Criar ownership minimo por modulo.
3. Decompor ZeusPage em blocos de Operations Center.
4. Decompor IrisPage em atendimento, fila, conversa, setup Meta e Caca.
5. Decompor ChronosPage em Agenda, Salas, Drive, sala externa, Google Agenda, gravacoes e atas.
6. Decompor Hades/Guardian em cobranca, atendimento, acordos, Asaas, D4Sign e read model legado.
7. Isolar Athena como camada transversal de IA com contratos por modulo, sem tomar ownership de produto.
8. Mover dominio pesado das rotas API para server modules.
9. Criar testes/smokes minimos por modulo critico.
10. Evoluir Zeus para cockpit vivo de engenharia com producao, homologacao, worktrees, recortes, env names, migrations, incidentes e validacoes sem valores sensiveis.

Piloto autorizado por continuidade do Lucas no chat:

- protocolo `OP-20260530-003-ZEUS-SHARED-UI`;
- modulo piloto: Zeus;
- primeiro bloco criado: `apps/hub/modules/squadops/blocks/shared/operations-ui.tsx`;
- natureza: extracao mecanica de componentes visuais compartilhados;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias ou alteracao de comportamento.

Segundo recorte do piloto:

- protocolo `OP-20260530-004-ZEUS-MONITORING-UTILS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/monitoring/performance-utils.ts`;
- natureza: extracao mecanica de helpers puros de performance/monitoring;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Terceiro recorte do piloto:

- protocolo `OP-20260530-005-ZEUS-MONITORING-SOURCES`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/monitoring/source-grid.tsx`;
- natureza: extracao mecanica do grid/cartoes das fontes monitoradas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Quarto recorte do piloto:

- protocolo `OP-20260530-006-ZEUS-MONITORING-PEAKS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/monitoring/peaks-panel.tsx`;
- natureza: extracao mecanica do painel de picos e grafico de linha do monitoring;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Quinto recorte do piloto:

- protocolo `OP-20260530-007-ZEUS-MONITORING-ALERTS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/monitoring/alerts-panel.tsx`;
- natureza: extracao mecanica da central de alertas, Ops Watcher e historico de protocolos;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Sexto recorte do piloto:

- protocolo `OP-20260530-008-ZEUS-DEPLOY-RELEASE-CARDS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/deploys/release-cards.tsx`;
- natureza: extracao mecanica dos cards visuais de release/deploy;
- limite: sem Preview, homologacao real, producao, banco, env, Supabase, alias, Vercel, fetch novo ou alteracao de comportamento.

Setimo recorte do piloto:

- protocolo `OP-20260530-009-ZEUS-TIMELINE-RECORDS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/records/timeline-records.tsx`;
- natureza: extracao mecanica da timeline e tabela de registros estruturados;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Oitavo recorte do piloto:

- protocolo `OP-20260530-010-ZEUS-AUDITS`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/audits/audit-routines.tsx`;
- natureza: extracao mecanica do painel de auditorias e drawer de detalhe;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, fetch novo ou alteracao de comportamento.

Nono recorte do piloto:

- protocolo `OP-20260530-011-ZEUS-PO-AI`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/po-ai/po-ai-panel.tsx`;
- natureza: extracao mecanica do botao flutuante, drawer, canal PO AI, biblioteca de prompts e parser de respostas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Decimo recorte do piloto:

- protocolo `OP-20260530-012-ZEUS-HELPDESK`;
- modulo piloto: Zeus;
- bloco criado: `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`;
- helper criado: `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts`;
- natureza: movimentacao mecanica do board HelpDesk para a arvore de blocos e extracao dos contadores de tickets;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, API externa nova, fetch novo ou alteracao de comportamento.

Primeiro contrato Athena:

- protocolo `AT-20260530-001-ATHENA-ZEUS-CONTRACT`;
- modulo de controle: Zeus;
- camada transversal: Athena;
- documento criado: `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`;
- natureza: contrato documental para IA transversal, owners de produto, env names, fallback, logs e bloqueios sensiveis;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Segundo contrato Athena:

- protocolo `AT-20260530-002-ATHENA-IRIS-CACA`;
- modulo consumidor: Iris;
- camada transversal: Athena;
- documento criado: `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`;
- natureza: contrato documental para separar Caca customer-facing, Athena transversal, Iris Core owner e Zeus governanca sensivel;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, Meta, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Terceiro contrato Athena:

- protocolo `AT-20260530-003-ATHENA-HADES-COPILOT`;
- modulo consumidor: Hades;
- camada transversal: Athena;
- documento criado: `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`;
- natureza: contrato documental para separar copilot interno, Athena transversal, Hades Core owner e Zeus governanca sensivel;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, Asaas, D4Sign, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Quarto contrato Athena:

- protocolo `AT-20260530-004-ATHENA-CHRONOS-MINUTES`;
- modulo consumidor: Chronos;
- camada transversal: Athena;
- documento criado: `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`;
- natureza: contrato documental para separar transcricao/rascunho revisavel, Athena transversal, Chronos Core owner e Zeus governanca sensivel;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, Google, Drive, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Quinto contrato Athena:

- protocolo `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`;
- modulo de controle: Zeus;
- camada transversal: Athena;
- documento criado: `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`;
- natureza: contrato documental para consolidar logs seguros, payload minimizado, mascaramento e bloqueio de incidente;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Asaas, D4Sign, Google, Drive, OpenAI/API externa nova, fetch novo ou alteracao de comportamento.

Primeiro mapa de decomposicao Iris:

- protocolo `MD-20260530-001-IRIS-DECOMPOSITION-MAP`;
- modulo alvo: Iris;
- documento criado: `docs/operations/panteon-iris-decomposition-map-2026-05-30.md`;
- manifesto criado: `docs/operations/panteon-recorte-manifest-md-20260530-001-iris-decomposition-map.json`;
- natureza: mapa documental da `IrisPage.tsx`, rotas `app/api/iris`, libs `lib/iris`, blocos alvo e ordem segura de recortes;
- limite: sem codigo, Preview, homologacao, producao, banco, env, Supabase, alias, Meta, OpenAI/API externa nova, fetch novo ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-002-IRIS-SHARED-UI`.

Primeiro recorte tecnico Iris:

- protocolo `MD-20260530-002-IRIS-SHARED-UI`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/shared/iris-ui.tsx`;
- natureza: extracao mecanica de helpers visuais puros da `IrisPage.tsx`;
- `IrisPage.tsx` reduziu de `13.050` para `12.640` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Caca runtime, OpenAI/API externa nova, fetch novo ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-003-IRIS-SHELL`.

Segundo recorte tecnico Iris:

- protocolo `MD-20260530-003-IRIS-SHELL`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/shell/iris-shell.tsx`;
- natureza: extracao mecanica do shell interno, topbar/sidebar, toggle recolhivel e navegacao local da `IrisPage.tsx`;
- `IrisPage.tsx` reduziu de `12.640` para `12.522` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Caca runtime, OpenAI/API externa nova, fetch novo ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-004-IRIS-BOARD`.

Terceiro recorte tecnico Iris:

- protocolo `MD-20260530-004-IRIS-BOARD`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/board/iris-board-view.tsx`;
- natureza: extracao mecanica da composicao visual do board, metricas e agenda lateral da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte: `11.370` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Caca runtime, OpenAI/API externa nova, fetch novo ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-005-IRIS-BOARD-QUEUE`.

Quarto recorte tecnico Iris:

- protocolo `MD-20260530-005-IRIS-BOARD-QUEUE`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/board/iris-ticket-queue.tsx`;
- natureza: extracao mecanica de fila, cabecalho de lista e linha de ticket da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte: `11.016` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Caca runtime, OpenAI/API externa nova, fetch novo ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-006-IRIS-HISTORY`.

Quinto recorte tecnico Iris:

- protocolo `MD-20260530-006-IRIS-HISTORY`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/history/iris-history-view.tsx`;
- natureza: extracao mecanica do historico, foco e filtros de consulta local da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte neste checkout: `11.914` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta, Caca runtime, OpenAI/API externa nova, fetch novo, ticket lifecycle ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-007-IRIS-START-ATTENDANCE`.

Sexto recorte tecnico Iris:

- protocolo `MD-20260530-007-IRIS-START-ATTENDANCE`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/start-attendance/iris-start-attendance-modal.tsx`;
- natureza: extracao mecanica do modal de contato ativo/novo atendimento da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte neste checkout: `11.190` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta real, Caca runtime, OpenAI/API externa nova, fetch novo, ticket lifecycle, Apolo/search/templates novos ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-008-IRIS-CONVERSATION-READONLY`.

Setimo recorte tecnico Iris:

- protocolo `MD-20260530-008-IRIS-CONVERSATION-READONLY`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/conversation/iris-conversation-readonly.tsx`;
- natureza: extracao mecanica do inbox, timeline de mensagens e contexto read-only da conversa da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte neste checkout: `10.965` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta real, Caca runtime, OpenAI/API externa nova, fetch novo, ticket lifecycle, composer, envio, audio, fechamento ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-009-IRIS-COMPOSER-ACTIONS`.

Oitavo recorte tecnico Iris:

- protocolo `MD-20260530-009-IRIS-COMPOSER-ACTIONS`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/conversation/iris-composer-actions.tsx`;
- natureza: extracao mecanica do footer/composer, checklist, toolbar, contexto de resposta/edicao, emoji picker, textarea, audio e botao de envio da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte neste checkout: `10.743` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta real, Caca runtime, OpenAI/API externa nova, fetch novo, endpoint novo, payload novo, ticket lifecycle ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-010-IRIS-CACA-PANEL`.

Nono recorte tecnico Iris:

- protocolo `MD-20260530-010-IRIS-CACA-PANEL`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/caca/iris-attendant-panel.tsx`;
- natureza: extracao mecanica do painel Caca, prompt, documento parcial, retorno, boletos e handoff da `IrisPage.tsx`;
- contagem corrente aferida da `IrisPage.tsx` apos o recorte neste checkout: `10.481` linhas;
- limite: sem Preview, homologacao, producao, banco, env, Supabase, alias, Meta real, OpenAI/API externa nova, fetch novo, endpoint novo, payload novo, prompt runtime novo, ticket lifecycle ou alteracao de comportamento;
- proximo recorte recomendado: `MD-20260530-011-IRIS-META-BROADCASTS`.

Decimo recorte tecnico Iris:

- protocolo `MD-20260530-011-IRIS-META-BROADCASTS`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx`;
- natureza: extracao mecanica de Meta engine, eventos e disparos existentes da `IrisPage.tsx`;
- limite: sem webhook/env/Meta real, endpoint novo, payload novo, banco, Supabase admin, Preview, homologacao, producao ou alteracao de comportamento;
- status local: validado.

Decimo primeiro recorte tecnico Iris:

- protocolo `MD-20260530-012-IRIS-SETUP-TEMPLATES`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/setup/iris-setup-view.tsx`;
- natureza: extracao mecanica de Setup, filas, assuntos e templates Meta da `IrisPage.tsx`;
- limite: sem migration, secret, provider novo, endpoint novo, payload novo, banco, Supabase admin, Preview, homologacao, producao ou alteracao de comportamento;
- status local: validado.

Decimo segundo recorte tecnico Iris:

- protocolo `MD-20260530-013-IRIS-REPORTS`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/blocks/reports/iris-reports-view.tsx`;
- natureza: extracao mecanica do painel de relatorios da `IrisPage.tsx`;
- limite: sem fonte de dados nova, endpoint novo, payload novo, banco, Supabase, Preview, homologacao, producao ou alteracao de comportamento;
- status local: validado.

Decimo terceiro recorte tecnico Iris:

- protocolo `MD-20260530-014-IRIS-DATA-CLIENT`;
- modulo alvo: Iris;
- bloco criado: `apps/hub/modules/caredesk/data/iris-data-client.ts`;
- natureza: extracao mecanica de `emptyIrisData`, carga client-side da Iris, enriquecimento CRM360, timeout, mappers de Supabase, parser de mensagens e snapshot;
- contagem corrente aferida da `IrisPage.tsx` apos a fila `MD-001` a `MD-014`: `6.667` linhas;
- limite: sem migration, service role, Supabase admin, banco real, env, secret, endpoint novo, payload novo, Preview, homologacao, producao ou alteracao de comportamento;
- status local: validado.

Regras:

- nada de commit gigante;
- nada de publicar root misto;
- nada de alterar comportamento junto com move mecanico sem registro explicito;
- cada etapa deve rodar `git diff --check`, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` quando aplicavel;
- se validacao global falhar por outro modulo, registrar bloqueio real e validar recorte escopado.

## Historico inicial de recorte seguro

`ZEUS-20260530-001-FOTOGRAFIA-REESTRUTURACAO`

Escopo:

- apenas documentos em `docs/operations/`;
- registrar fotografia, plano e governanca v2;
- sem codigo de produto;
- sem Vercel, Supabase, banco, alias, env, secret ou migration;
- sem limpeza de worktree.

Proxima acao:

- A fila tecnica Iris `MD-20260530-001` a `MD-20260530-014` foi fechada localmente. Proximo passo deve ser novo protocolo especifico para tipagem gradual, validacao visual autenticada ou outro modulo, mantendo OpenAI/env/chave, endpoints novos, prompt runtime novo, dados reais sensiveis, banco, Supabase admin, Vercel, homologacao, producao e comportamento fora do escopo sem autorizacao.

Conclusao:

- A reestruturacao deve comecar por controle, nao por refatoracao.
- O impacto pratico e impedir que agentes misturem recortes e publiquem base errada.
- A governanca documental e os contratos Athena ja foram fechados localmente; a Iris tem mapa de decomposicao, shared UI, shell interno, board, fila/linha, historico, start-attendance, conversation-readonly, composer-actions, Caca, Meta/Disparos, Setup/Templates, Relatorios e Data Client locais, com produto publicado congelado ate Lucas autorizar qualquer Preview/Homo/Producao.
