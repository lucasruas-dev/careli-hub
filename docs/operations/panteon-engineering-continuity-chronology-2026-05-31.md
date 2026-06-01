# Panteon - cronologia e arvore de continuidade

Assunto: [Zeus] cronologia e arvore de continuidade da reestruturacao

Status: `AUDITORIA DE CONTINUIDADE / SEM DEPLOY / ROOT MISTO BLOQUEADO`

Data do checkpoint: `2026-05-31`

Responsavel: `Zeus`

## Objetivo

Consolidar, em um unico ponto de retomada, o que foi feito na trilha de reestruturacao de engenharia do Panteon e qual arvore de trabalho deve guiar os proximos recortes.

Este documento nao publica, nao altera producao, nao altera homologacao, nao altera banco, nao altera env, nao move alias e nao substitui manifests. Ele apenas organiza a continuidade.

## Marco imutavel de producao

- Producao vigente na fotografia: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`
- Rollback imediato registrado: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`
- Commit de codigo publicado: `e5c7ac3 fix(chronos): restore google calendar fidelity`
- Commit de registro pos-deploy: `a145058 docs(zeus): register chronos google calendar production deploy`
- Fonte: `docs/operations/panteon-production-snapshot-2026-05-30.md`

Decisao operacional: nenhuma continuidade da reestruturacao pode publicar do root misto. Qualquer deploy futuro precisa nascer de pacote limpo, protocolo, Safety Gate e autorizacao expressa do Lucas.

## Estado local auditado

- CWD: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub`
- Branch local: `homolog`
- Estado Git observado: `homolog...origin/homolog [behind 13]`
- Estado pratico: root misto, com arquivos modificados e nao rastreados em varios modulos.
- Bloqueio: root local nao e candidato a Preview, homologacao ou producao.

## Cronologia do que foi feito

### 1. Chronos Google Agenda entrou como marco de producao

Antes da reestruturacao, foi publicado o hotfix de fidelidade da agenda Google individual do Chronos.

Resultado:

- agenda passou a respeitar a conexao Google individual do colaborador logado;
- eventos nao sao descartados apenas por `organizer.email` ou `creator.email` externo;
- primeira sincronizacao apos hotfix faz full sync uma vez por conexao ativa;
- depois o fluxo volta para incremental por `syncToken`;
- snapshot Chronos subiu de 80 para 1000 reunioes enquanto a arquitetura de cache/janela e formalizada.

Status: `EM PRODUCAO`.

### 2. Fotografia de producao foi criada

Arquivo:

- `docs/operations/panteon-production-snapshot-2026-05-30.md`

Resultado:

- producao congelada para reestruturacao;
- deployment atual, rollback, projeto Vercel e aliases documentados;
- root misto marcado como bloqueado;
- worktree de referencia de producao identificado.

Status: `VALIDADO_LOCAL / PRODUCAO CONGELADA`.

### 3. Modelo de protocolo e gates iniciais foram criados

Arquivos:

- `docs/operations/panteon-recorte-manifest-template.json`
- `scripts/panteon-recorte-manifest-check.mjs`
- `scripts/panteon-boundary-check.mjs`
- `scripts/panteon-inventory-scan.mjs`

Resultado:

- todo recorte passa a exigir manifesto;
- recorte declara modulo, agente, blocos, arquivos incluidos, exclusoes, validacoes, risco e status;
- boundary check bloqueia arquivo fora da fronteira declarada;
- inventory scan permite inventario local sem tocar producao.

Status: `VALIDADO_LOCAL`.

### 4. Inventario real do projeto foi registrado

Arquivos:

- `docs/operations/panteon-project-inventory-2026-05-30.md`
- `docs/operations/panteon-recorte-manifest-op-20260530-002-inventory.json`

Resultado:

- projeto classificado como monorepo com monolito modular Next.js;
- maiores arquivos e dominios foram identificados;
- rotas API, modulos, packages e riscos foram mapeados.

Status: `VALIDADO_LOCAL`.

### 5. Piloto Zeus foi usado para provar o modelo de blocos

Arquivos principais criados:

- `apps/hub/modules/squadops/blocks/shared/operations-ui.tsx`
- `apps/hub/modules/squadops/blocks/monitoring/performance-utils.ts`
- `apps/hub/modules/squadops/blocks/monitoring/source-grid.tsx`
- `apps/hub/modules/squadops/blocks/monitoring/peaks-panel.tsx`
- `apps/hub/modules/squadops/blocks/monitoring/alerts-panel.tsx`
- `apps/hub/modules/squadops/blocks/deploys/release-cards.tsx`
- `apps/hub/modules/squadops/blocks/records/timeline-records.tsx`
- `apps/hub/modules/squadops/blocks/audits/audit-routines.tsx`
- `apps/hub/modules/squadops/blocks/po-ai/po-ai-panel.tsx`
- `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`
- `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts`

Protocolos:

- `OP-20260530-003-ZEUS-SHARED-UI`
- `OP-20260530-004-ZEUS-MONITORING-UTILS`
- `OP-20260530-005-ZEUS-MONITORING-SOURCES`
- `OP-20260530-006-ZEUS-MONITORING-PEAKS`
- `OP-20260530-007-ZEUS-MONITORING-ALERTS`
- `OP-20260530-008-ZEUS-DEPLOY-RELEASE-CARDS`
- `OP-20260530-009-ZEUS-TIMELINE-RECORDS`
- `OP-20260530-010-ZEUS-AUDITS`
- `OP-20260530-011-ZEUS-PO-AI`
- `OP-20260530-012-ZEUS-HELPDESK`

Resultado:

- Zeus virou piloto de decomposicao por blocos;
- comportamento deveria permanecer igual;
- extracoes foram mecanicas;
- nenhum deploy foi feito nesta trilha.

Status: `VALIDADO_LOCAL / SEM DEPLOY`.

### 6. Contratos Athena foram documentados

Arquivos:

- `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`
- `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`
- `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`
- `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`

Protocolos:

- `AT-20260530-001-ATHENA-ZEUS-CONTRACT`
- `AT-20260530-002-ATHENA-IRIS-CACA`
- `AT-20260530-003-ATHENA-HADES-COPILOT`
- `AT-20260530-004-ATHENA-CHRONOS-MINUTES`
- `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`

Resultado:

- Athena ficou definida como camada transversal de IA, nao dona de produto;
- cada modulo consumidor precisa contrato proprio;
- logs com payload sensivel, prompts brutos, tokens e links assinados ficam proibidos;
- operacoes OpenAI/env/secret/banco/Supabase/Vercel continuam bloqueadas sem Lucas.

Status: `VALIDADO_LOCAL / CONTRATOS DOCUMENTAIS`.

### 7. Mapa modulo-agente foi consolidado

Arquivo:

- `docs/operations/panteon-module-agent-map.md`

Resultado:

- modulos oficiais do Hub definidos: Panteon, Zeus, Apolo, Ares, Atlas, Chronos, Hades, Hermes e Iris;
- Zeus definido como agente master operacional e modulo do Hub;
- Hefesto definido como reserva/apoio de producao;
- Athena definida como camada de IA por contrato;
- Setup tratado como camada operacional, nao modulo principal do sidebar.

Status: `ATIVO COMO BASE DOCUMENTAL / AGUARDANDO AUTOMACAO`.

### 8. Iris entrou na decomposicao por blocos

Arquivos criados:

- `apps/hub/modules/caredesk/blocks/shared/iris-ui.tsx`
- `apps/hub/modules/caredesk/blocks/shell/iris-shell.tsx`
- `apps/hub/modules/caredesk/blocks/board/iris-board-view.tsx`
- `apps/hub/modules/caredesk/blocks/board/iris-ticket-queue.tsx`
- `apps/hub/modules/caredesk/blocks/history/iris-history-view.tsx`
- `apps/hub/modules/caredesk/blocks/start-attendance/iris-start-attendance-modal.tsx`
- `apps/hub/modules/caredesk/blocks/conversation/iris-conversation-readonly.tsx`
- `apps/hub/modules/caredesk/blocks/conversation/iris-composer-actions.tsx`
- `apps/hub/modules/caredesk/blocks/caca/iris-attendant-panel.tsx`
- `apps/hub/modules/caredesk/blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx`
- `apps/hub/modules/caredesk/blocks/setup/iris-setup-view.tsx`
- `apps/hub/modules/caredesk/blocks/reports/iris-reports-view.tsx`
- `apps/hub/modules/caredesk/data/iris-data-client.ts`

Protocolos:

- `MD-20260530-001-IRIS-DECOMPOSITION-MAP`
- `MD-20260530-002-IRIS-SHARED-UI`
- `MD-20260530-003-IRIS-SHELL`
- `MD-20260530-004-IRIS-BOARD`
- `MD-20260530-005-IRIS-BOARD-QUEUE`
- `MD-20260530-006-IRIS-HISTORY`
- `MD-20260530-007-IRIS-START-ATTENDANCE`
- `MD-20260530-008-IRIS-CONVERSATION-READONLY`
- `MD-20260530-009-IRIS-COMPOSER-ACTIONS`
- `MD-20260530-010-IRIS-CACA-PANEL`
- `MD-20260530-011-IRIS-META-BROADCASTS`
- `MD-20260530-012-IRIS-SETUP-TEMPLATES`
- `MD-20260530-013-IRIS-REPORTS`
- `MD-20260530-014-IRIS-DATA-CLIENT`

Resultado:

- mapa de decomposicao Iris criado;
- shared UI extraido;
- shell interno extraido;
- composicao do board extraida;
- fila e linha de ticket extraidas;
- historico, foco e filtros de consulta local extraidos;
- modal de contato ativo/novo atendimento extraido;
- conversation-readonly, composer-actions, Caca, Meta/Disparos, Setup/Templates, Relatorios e Data Client extraidos;
- `IrisPage.tsx` continua como composicao raiz com `6.667` linhas aferidas neste checkout.

Status: `VALIDADO_LOCAL / SEM DEPLOY`.

### 9. Arvore executavel foi criada

Arquivos:

- `docs/operations/panteon-work-execution-tree-2026-05-30.md`
- `docs/operations/panteon-engineering-activity-tree-2026-05-30.md`
- `docs/operations/panteon-engineering-restructure-plan.md`

Resultado:

- trilha `PANTEON-ENG-RESET` organizada;
- fases de governanca, inventario, ownership, Zeus pilot, Athena contracts, module decomposition, shared packages, gates, Zeus cockpit, homologation lane e production lane;
- proximo recorte recomendado registrado como `MD-20260530-008-IRIS-CONVERSATION-READONLY`.

Status: `ATIVA / EXECUCAO POR RECORTE`.

## Arvore atual de continuidade

```text
PANTEON-ENG-RESET
  00-governanca [VALIDADO_LOCAL]
    feito:
      - fotografia de producao
      - regra de root misto bloqueado
      - mapa modulo-agente
      - manifesto de recorte
      - boundary gate inicial
    continuar:
      - ownership check por bloco
      - root dirty blocker antes de deploy
      - integracao com Safety Gate

  01-inventario [VALIDADO_LOCAL]
    feito:
      - inventario real do projeto
      - arquivos gigantes identificados
      - rotas API mapeadas por dominio
    continuar:
      - inventario fino de app/api por owner
      - mapa de imports cross-owner por severidade
      - lista de arquivos sem owner

  02-ownership [INICIADO]
    feito:
      - modulos oficiais definidos
      - camadas Zeus, Hefesto, Athena e Setup separadas
    continuar:
      - ownership check automatico
      - declarar blocos por modulo
      - mapear packages shared/database/uix

  03-zeus-pilot [VALIDADO_LOCAL / PILOTO COMPLETO]
    feito:
      - shared UI
      - monitoring utils
      - source grid
      - peaks
      - alerts
      - release cards
      - timeline records
      - audits
      - PO AI
      - helpdesk
    continuar:
      - nao ampliar Zeus agora
      - usar aprendizado do piloto nos outros modulos
      - dividir helpdesk-board depois, pois ainda e grande

  04-athena-contracts [VALIDADO_LOCAL / TRILHA FECHADA]
    feito:
      - contrato Athena/Zeus
      - contrato Athena/Iris Caca
      - contrato Athena/Hades Copilot
      - contrato Athena/Chronos Minutes
      - contrato de logs seguros
    continuar:
      - automatizar checagem de payload sensivel
      - exigir contrato Athena antes de nova IA

  05-module-decomposition [INICIADO]
    iris [EM ANDAMENTO]
      feito:
        - MD-001 mapa
        - MD-002 shared UI
        - MD-003 shell
        - MD-004 board
        - MD-005 board queue
        - MD-006 history
        - MD-007 start attendance
      proximo:
        - MD-008 conversation readonly
      depois:
        - conversa/ticket detail
        - setup Meta
        - Caca/IA
        - relatorios/metricas
    chronos [CONGELADO NO CURTO PRAZO]
      motivo:
        - e baseline recente de producao
      continuar depois:
        - agenda
        - salas
        - drive
        - sala externa
        - google-calendar
        - gravacoes
        - atas
    hermes [AGUARDANDO]
      continuar depois:
        - messages
        - calls
        - channels
        - presence
    hades [AGUARDANDO]
      continuar depois:
        - cobranca
        - atendimento
        - acordos
        - Asaas
        - D4Sign
        - read model legado
    apolo [AGUARDANDO]
    ares [AGUARDANDO]
    atlas [AGUARDANDO]
    panteon-core [AGUARDANDO GATES MADUROS]

  06-shared-packages [PENDENTE]
    continuar:
      - packages/uix
      - packages/shared
      - packages/auth
      - packages/realtime
      - packages/database somente com autorizacao explicita

  07-gates-and-ci [INICIADO]
    feito:
      - boundary check
      - recorte manifest check
      - inventory scan
    continuar:
      - ownership check
      - root dirty blocker
      - secret/env name scan sem valores
      - import cross-owner severity
      - Safety Gate integrado

  08-zeus-cockpit-vivo [PENDENTE]
    continuar:
      - painel de baseline de producao
      - painel de recortes
      - painel de worktrees
      - painel de gates
      - painel de riscos

  09-homologation-preview-lane [BLOQUEADO]
    liberar somente com:
      - protocolo aprovado
      - pacote limpo
      - Preview imutavel
      - Safety Gate
      - autorizacao do Lucas

  10-production-lane-hefesto [BLOQUEADO]
    liberar somente com:
      - recorte homologado
      - healthchecks
      - rollback
      - releases-production atualizado
      - autorizacao explicita do Lucas
```

## Pacote tecnico mais recente

Protocolos:

- `MD-20260530-011-IRIS-META-BROADCASTS`
- `MD-20260530-012-IRIS-SETUP-TEMPLATES`
- `MD-20260530-013-IRIS-REPORTS`
- `MD-20260530-014-IRIS-DATA-CLIENT`

Modulo: `Iris`

Blocos: `meta-whatsapp`, `setup`, `reports`, `data-client`

Objetivo:

- extraiu Meta engine e disparos para `apps/hub/modules/caredesk/blocks/meta-whatsapp/iris-meta-broadcasts-view.tsx`;
- extraiu Setup, filas, assuntos e templates para `apps/hub/modules/caredesk/blocks/setup/iris-setup-view.tsx`;
- extraiu relatorios para `apps/hub/modules/caredesk/blocks/reports/iris-reports-view.tsx`;
- extraiu carga client-side, CRM360, timeout, mappers, parser de mensagens e snapshot para `apps/hub/modules/caredesk/data/iris-data-client.ts`;
- reduziu `IrisPage.tsx` para `6.667` linhas neste checkout;
- manteve `IrisPage.tsx` como composicao raiz e dona de estado, realtime, lifecycle, auth, callbacks e modais mutaveis.

Exclusoes obrigatorias:

- realtime;
- ciclo de vida de tickets;
- endpoint novo;
- Meta/WhatsApp env, chave, webhook ou Meta real;
- prompt runtime novo;
- OpenAI;
- APIs;
- envs;
- banco;
- Supabase admin, service role ou migration;
- Vercel;
- homologacao;
- producao;
- mudanca de layout/UX nao solicitada.

Validacoes esperadas:

- `npm.cmd run check-types:hub`: PASS
- `npm.cmd run lint:hub`: PASS com warning conhecido de `MODULE_TYPELESS_PACKAGE_JSON`
- `$env:CIRCLE_NODE_TOTAL='2'; npm.cmd run build --workspace @repo/hub`: PASS com warning conhecido Turbopack/NFT
- `next start` smoke local: `/iris` retornou `200 OK`
- Browser visual: BLOQUEADO por falha de sandbox do conector (`windows sandbox failed: spawn setup refresh`)
- manifest check e boundary check dos recortes
- `git diff --check`

Status atual:

- Fila tecnica Iris `MD-20260530-001` a `MD-20260530-014` fechada localmente.
- Sem Preview, homologacao, producao, banco, env, secret, alias, Vercel ou operacao externa sensivel.

## Regras para continuar sem repetir o erro de sobrescrita

- Nunca publicar do root `homolog` enquanto ele estiver misto e atrasado.
- Todo recorte precisa manifest e boundary antes de virar candidato.
- So mexer no modulo/bloco declarado.
- Worktree antiga precisa comparar contra o marco de producao antes de qualquer publicacao.
- Athena so toca produto dentro de contrato e fronteira do modulo.
- Zeus/Hefesto controlam deploy, homologacao e producao.
- Chronos fica congelado no curto prazo porque e o marco recente de producao.

## Decisao pendente do Lucas

Para continuar a execucao, a opcao segura e:

1. manter tudo sem deploy;
2. abrir novo protocolo especifico para tipagem gradual, visual autenticado ou outro modulo;
3. validar localmente;
4. registrar o protocolo;
5. decidir se criaremos uma worktree limpa para consolidar a reestruturacao antes de qualquer Preview/Homo.

Conclusao:

A reestruturacao segue consolidada nesta cronologia e nesta arvore de continuidade, com documentos, manifests, scripts e blocos novos como trilha auditavel. A fila tecnica Iris foi fechada localmente de `MD-001` a `MD-014`; o proximo passo tecnicamente seguro e abrir novo protocolo especifico, sem tocar producao, Chronos, Hermes, banco, env, secret, alias, Vercel ou Supabase admin.
