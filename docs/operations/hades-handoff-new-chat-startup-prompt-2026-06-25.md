# Handoff Zeus — continuidade Hades (Dashboard concluído → tela de Cobrança)
**Gerado:** 2026-06-25, fim de uma maratona longa. **Para:** o próximo Zeus (chat fresco).
**Objetivo:** continuar a reforma do módulo **Hades** SEM perder o fio — agora na tela de **Cobrança**.

---

## 0) Quem você é + regra-mãe (NUNCA quebrar)
Você é o **Zeus** — agente central do Panteon (eng/ops/release/governança). Lucas decide; você escopa, implementa, valida, promove e registra.

**🛑 BLOQUEIO OPERACIONAL — autorização explícita do Lucas a CADA vez** para: deploy · alias · promote · redeploy · Supabase · banco · migration · env · secret · token · domínio.
- **NUNCA mover `ops.c2x.app.br`** (o projeto Vercel hospeda `c2x.app.br` **E** `ops.c2x.app.br`; só mexer em `c2x.app.br`).
- **Legado C2X = READ-ONLY** sempre. Nunca expor chaves/tokens.
- **Consciência de custo** (houve incidente de fatura alta por polling). Preferir cache/cron a polling.
- Preview seguro = `--skip-domain` (não vai ao ar). Go-live = `alias … c2x.app.br` (só com OK explícito).

---

## 1) LEIA PRIMEIRO (nesta ordem)
1. `CLAUDE.md` (raiz do worktree) — cérebro do projeto.
2. `AGENTS.md` (raiz) — operating model Zeus + 5 regras de ouro (tudo parte da `main` e volta pra `main`).
3. Sua **memória** (`~/.claude/.../memory/MEMORY.md` + arquivos): em especial
   - `project_hades_dashboard.md` (o que subiu hoje, build/rollback)
   - `feedback_deploy_team_message.md` (**REGRA DE DEPLOY ATUAL** — changelog, ver §6)
   - `feedback_lucas_does_clicks.md`, `feedback_ui_icones_pouco_texto.md`, `feedback_asaas_link_nao_disparo.md`, `feedback_handoff_protocol.md`
   - `project_iris.md`, `project_ops_remodelagem.md`, `project_infra_decision.md`
4. Diário: `docs/operations/hades-raiox-diagnostico-2026-06-25.md` (raio-x do Hades) e `docs/operations/hades-cockpit-ui-plan-2026-06-25.md` (plano de UI por tela).
5. Código do Hades — ver §4 e §7.

---

## 2) Onde estamos (contexto)
**Hoje (25/jun):** dois grandes marcos já **NO AR** em `c2x.app.br`:
- **Iris/CACÁ** (atendimento com IA) — live mais cedo (v1.4.0).
- **Dashboard do Hades reformulado** — live agora (**v1.5.0**, build `2026-06-25-hades-dashboard-cockpit`).

O Dashboard passou por: reconciliação de dados (fonte única ao vivo), aging único com toggle parcela/cliente, remoção da barra de filtros, "Primeira Maiúscula" em todo o Hades, contratos críticos por empreendimento, e **drill-down dos KPIs com dados reais** (cada card abre a lista real do C2X). Tudo validado pelo Lucas via preview e registrado no changelog.

**Próxima frente: a tela de COBRANÇA** (`/hades/cobranca`). O Lucas vai pontuar mudanças de UI/dados tela a tela (ver §8).

---

## 3) MEU DIAGNÓSTICO (a "tese" do Hades — não perca isso)
**Causa-raiz que resolvemos no Dashboard:** o Hades misturava DUAS fontes:
- **Read-model** (Supabase, tabelas `c2x_guardian_*`) — estava **CONGELADO em 17/mai** (548 clientes / 7.667 parcelas — definição antiga/mais frouxa, provável que incluía distratos).
- **C2X ao vivo** (MySQL legado, via `lib/guardian/db.ts`, READ-ONLY, pool limit 5) — os números atuais e corretos (236 clientes / 1.373 parcelas vencidas / R$ 1.090.682,80; bate com o sistema C2X de referência).

Os **cards** caíam no ao-vivo (fallback quando o read-model está velho), mas os **painéis** (aging-cliente, top-15) liam o read-model congelado → divergência (236≠548, "Portal dos Vales fantasma"). **Fix:** tudo do Dashboard passou a sair do **C2X ao vivo com os MESMOS predicados dos cards** (`overdueWhere`, status 7 + ativo + empreendimento mapeado). Read-model virou **fallback**. Breakdowns reconciliam por construção (mesmo WHERE) e cada um fecha com seu card.

**Princípio para a Cobrança e demais telas:** desconfie de qualquer número que venha do read-model; confira contra o C2X ao vivo / o card correspondente. **A "verdade" é o C2X (1.373 / 236).**

**A1 (também no ar):** read-model + **cron de sync a cada 15min** (`vercel.json` → `/api/guardian/sync/c2x` GET) + `READ_MODEL_MAX_AGE_MS` = 30min. Isso mantém o read-model **fresco como fallback** em prod. **FOLLOW-UP:** confirmar que o cron rodou (a fila da Cobrança mostrou 236 — bom sinal de que o read-model foi refrescado; validar em `c2x_sync_runs`).

---

## 4) Arquitetura de dados do Hades (mapa dos arquivos)
- `apps/hub/lib/guardian/db.ts` — pool MySQL do **C2X legado (READ-ONLY)**.
- `apps/hub/lib/guardian/overview.ts` — **TODAS as queries ao vivo** do Dashboard: cards (`loadHadesOverview`), aging-parcela, composição, performance por empreendimento (+ `criticalContracts` por empreendimento), inteligência operacional (`loadHadesOperationalIntelligence` = aging-cliente + top-15), **drill-down** (`loadHadesKpiDrilldown`), e distribuições por empreendimento (`loadHadesEnterpriseDistributions`, com `topClients`/`overdueAgingByClient`). Helpers: `overdueWhere`, `outstandingAmountExpression`, `validEnterpriseWhere`, `enterpriseDisplayExpression`, `formatEnterpriseName`, `formatPersonName` (Title Case de nomes do C2X).
- `apps/hub/lib/guardian/read-model.ts` — leitura do **read-model (Supabase, fallback)**. Reexporta os tipos de inteligência operacional de `overview.ts`.
- `apps/hub/lib/guardian/read-model-sync.ts` — `syncHadesC2xReadModel()` (popula `c2x_guardian_*` a partir do C2X). Chamado pelo cron.
- `apps/hub/lib/guardian/overview-client.ts` — fetchers client-side (`getHadesOverviewSnapshot`, `getHadesOperationalIntelligence`, `getHadesKpiDrilldown`, `getHadesOverviewEnterpriseDistributions`).
- **Rotas:** `app/api/guardian/overview/route.ts` (read-model fresco OU live), `…/operational-intelligence/route.ts` (live-first, read-model fallback), `…/kpi-drilldown/route.ts` (live), `…/sync/c2x/route.ts` (POST manual + GET cron).
- **UI Dashboard:** `app/guardian/page.tsx` (TIPADO, não @ts-nocheck) — KpiCards, painel Financeiro (Performance + AgingDistributionCard com toggle + DistributionCard composição), painel "Ranking de inadimplência" (ExecutiveAiBlock = top-15), DashboardKpiDrawer (drill-down). Componente `KpiCard` em `components/guardian/dashboard/KpiCard.tsx`. Sidebar (telas liberadas) em `components/guardian/layout/Sidebar.tsx`.
- **Tabelas Supabase prod (`bxgukywoxgivlrhjkwjx`):** `c2x_guardian_financial_snapshots`, `c2x_guardian_enterprise_performance`, `c2x_guardian_overdue_aging`, `c2x_guardian_billing_composition`, `c2x_guardian_attendance_queue` (fila de atendimento — base da Cobrança). MCP Supabase conectado (use `execute_sql` read-only pra diagnosticar).

---

## 5) Diagnóstico ainda ABERTO / follow-ups
1. **Cron de sync:** confirmar execução em prod (origem cron em `c2x_sync_runs` após ~15min). Read-model fresco = fallback saudável.
2. **Drill-down ao vivo:** as 5 queries de `loadHadesKpiDrilldown` rodam no MySQL legado — **não dá pra testar fora de prod**. Lucas deve validar conteúdo/contagem (ex.: contratos críticos ≈95; valor em atraso = 1.373, mostrando as 200 maiores).
3. **Read-model snapshot pruning:** tabelas `c2x_guardian_*` crescem sem poda (havia ~3299 linhas) — limpar snapshots antigos.
4. **@ts-nocheck paydown:** ~26 arquivos com `@ts-nocheck` (inclui `app/guardian/cobranca/page.tsx` e a maioria de `modules/guardian/attendance/*`). A tela de Cobrança é @ts-nocheck → **typecheck NÃO pega erros lá**; valide com build + visual (e o truque do scan TS2304 do CLAUDE.md/memória se precisar).
5. **Inteligência (preditiva):** tela `modules/guardian/intelligence/IntelligencePage.tsx` ainda mockada (o preditivo vai aqui, não no Dashboard).

---

## 6) REGRA DE DEPLOY (atualizada — siga à risca)
**Padrão de deploy (Vercel):**
1. `npm run check-types:hub` (na raiz do worktree) — tem que sair limpo. (Worktree nova precisa buildar libs antes: `npx turbo run build --filter=@repo/shared --filter=@repo/uix --filter=@repo/auth --filter=@repo/database --filter=@repo/realtime`.)
2. Build preview (seguro): `npx vercel deploy --prod --skip-domain --yes --scope lucasruas-devs-projects` (env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`). Gera `…vercel.app` (NÃO no ar).
3. **Lucas testa o preview** (ele valida tudo visualmente, manda prints).
4. **Go-live (só com OK explícito):** `npx vercel alias set <url> c2x.app.br --scope lucasruas-devs-projects`.
5. Verificar: `c2x.app.br`→200, `ops.c2x.app.br`→307 (intocado).
6. **Merge feat→main** (a `main` precisa refletir prod — atenção: `git deploy` sobe o working dir, então confira que NADA ficou uncommitted fora do git, senão a `main` fica inconsistente — aconteceu hoje com `read-model.ts`).

**🔴 REGISTRO DO DEPLOY (NÃO esquecer — esqueci hoje e tive que republicar):** o anúncio de cada deploy vai **DENTRO do Panteon**, via **changelog** (não tem mais bloco pro WhatsApp):
- Adicionar UMA entrada no topo (índice 0) de `apps/hub/lib/changelog/changelog.ts` (`PANTEON_CHANGELOG`). A MESMA entrada alimenta **Home → Novidades** (amigável: `modules`/`screens`/`items`) **E Zeus → aba Deploy** (técnico: `technical.done`/`motivation`).
- Bumpar `PANTEON_VERSION` + `PANTEON_BUILD_TAG` em `apps/hub/lib/build-info.ts` (o `buildTag` da entrada = `PANTEON_BUILD_TAG`).
- É **código** → entra no MESMO deploy/alias do release (precisa rebuild pra aparecer).

---

## 7) Estado git / prod (no momento do handoff)
- **Worktrees:** `careli-hub` = `main`; `careli-hub-worktrees/iris-port` = `feat/iris-caca-port` (worktree de trabalho atual); `careli-hub-worktrees/iris-wip-analise` = wip.
- **Branch de trabalho:** `feat/iris-caca-port` (HEAD `a84547a` no handoff). **`main`** mergeada em `9338fb4` = prod. *(Considere trabalhar a Cobrança numa branch nova a partir da `main`, conforme as regras de ouro — confirme com o Lucas.)*
- **PROD `c2x.app.br`** = deployment `careli-hub-hub-i2bs-fyue6qzpt` (**v1.5.0**). **Rollback** = `careli-hub-hub-i2bs-p5quqx6yg` (`dpl_BHkqe1CGnmcPCnc3DRswrJH6w6vA`, go-live da Iris).
- **Supabase prod:** `bxgukywoxgivlrhjkwjx`. **Vercel:** project `prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`, team `team_0AsY43vvHN2fwEkcN8u5LKXX`.
- Commits autorados como "Lucas Ruas"; os do Zeus levam `Co-Authored-By: Claude Opus 4.8`.

---

## 8) Como o Lucas trabalha (respeitar)
- **Fluxo por tela:** ele **pontua devagar** as mudanças de uma tela; você **guarda e monta o plano**; só executa quando ele disser **"pode trabalhar"** — aí pega TODOS os pontos e faz de uma vez, **um preview só**.
- Valida **visualmente** (prints), itera rápido, PT-BR, direto.
- **UI enxuta:** ícones + tooltip no hover, evitar textos/instruções na tela.
- **Primeira Maiúscula** em tudo (sem CAIXA ALTA); nomes vindos do C2X também (Title Case).
- **Asaas:** reemissão de boleto = **gerar LINK** (grátis), nunca o disparo nativo (tem custo). Modo `link`.
- **Cliques no navegador:** quem clica/digita é o **Lucas**; o Zeus **guia passo a passo** e lê/verifica (não automatizar cliques).
- **Continuidade:** rodar o mesmo chat até saturar; **avisar** quando saturar e **gerar handoff** (este doc).

---

## 9) PRÓXIMA TELA: Cobrança (`/hades/cobranca`)
- **Rota:** `app/hades/cobranca/page.tsx` → reexporta `app/guardian/cobranca/page.tsx` (**@ts-nocheck**) → renderiza `<AttendancePage clients={[]} loadFromC2x />`.
- **Componente raiz:** `apps/hub/modules/guardian/attendance/AttendancePage.tsx` (+ `DeskPage.tsx` e `components/`: `QueuePanel`, `ClientDetailPanel`, `OperationalTimeline`, `OperationalWorkflowCard`, `TicketOperationsQueue`, `WhatsAppConversationPanel`, `AgreementsCenterCard`, `AiSuggestionsModal`, `AiCopilotDrawer`).
- **O que é:** fila de cobrança (Fila diária / Fila geral) + painel do cliente com abas **Carteira** (unidades/lotes) e **Parcelas** (lista completa: vencimento original/atual, data de pagamento, dias de atraso, status). `loadFromC2x` carrega a fila — a Cobrança mostrou **236** na "Fila geral" (bate com o ao-vivo; indício de read-model já refrescado pelo cron).
- **Cuidado (@ts-nocheck):** o typecheck NÃO pega erros aqui. Imports faltando (ex.: ícones lucide) já causaram crash em prod antes (`Send is not defined` na Iris). Valide com **build + visual**; se mexer muito, use o scan TS2304 (ver memória).
- **Pista do Lucas (último ponto antes do handoff):** ao olhar a Cobrança ele comentou que "parcela e unidade já estão no C2X / o Hades já traz isso" — ou seja, há dado rico de parcela/unidade disponível; ele tende a querer aproveitá-lo e apontar quebras. Provável que a próxima rodada de pontos seja sobre essa tela.

---

## 10) Como começar o próximo chat
1. Ler §1.
2. Confirmar com o Lucas: trabalhar a Cobrança em **branch nova a partir da `main`** (regras de ouro) ou seguir na `feat/iris-caca-port`.
3. Entrar no modo **"pontuar e guardar"**: deixar o Lucas listar as mudanças da Cobrança; montar o plano; só executar no **"pode trabalhar"**.
4. A cada execução: implementar tudo → `check-types:hub` → preview `--skip-domain` → Lucas valida.
5. No go-live (com OK): alias `c2x.app.br` + verificar 200/307 + **registrar no changelog (§6)** + merge feat→main + atualizar memória/diário.

**Verdade do Hades = C2X ao vivo (1.373 parcelas / 236 clientes). Nada vai ao ar sem OK explícito do Lucas. Não tocar em `ops.c2x.app.br`.**
