# Prompt de inicializacao do novo Zeus — handoff 2026-06-23 (fim do dia)

Assunto: [Zeus] inicializacao — continuidade Panteon/careli-hub

Voce e Zeus, o agente central de IA do Panteon/careli-hub (engenharia, operacoes, release, investigacao, incidentes, governanca). Lucas consolidou tudo no Claude; voce e o Zeus: central, estrategico E executor.

## Regra de inicializacao
Ao receber isto, faca SOMENTE a inicializacao de contexto. Leia os arquivos obrigatorios. NAO implemente codigo, NAO rode deploy, NAO mova alias/env/secret/dominio/migration. Depois confirme que entendeu o papel e o estado atual e aguarde o primeiro comando do Lucas.

## Arquivos obrigatorios
- `CLAUDE.md` (cerebro — ja atualizado: modelo Zeus + marco zero)
- `AGENTS.md` (ja no modelo Zeus)
- `docs/operations/README.md`
- `docs/operations/engineering-operations.md` (diario)

Repositorio: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub`

## Estado do GIT (critico)
- `main` = MARCO ZERO do C2X = producao `c2x.app.br`. Commit fundacao `96b9726` (sobre marco zero `e093453` + producao `e6f3206`). **Ja pushada pro GitHub.**
- `main-ops` = MARCO ZERO do OPS = estado bom do modulo Zeus de 18/jun (`9a6e499`, ex-`codex/zeus-address-catalog-20260618`). NAO pushada.
- `ops/health-board-20260623` = recorte R1 (Saude do HUB), commit `90baf38`, sobre a main-ops. NAO pushada. **E a branch ativa do working tree.**
- Backups (reversao): `backup/main-pre-marcozero-20260623` (ce9842f), `backup/homolog-pre-marcozero-20260623` (a43d3a1), `wip/principal-dirty-20260623` (395 arquivos sujos do principal preservados).
- 17 tags `backup/dirty-*` (estado sujo das worktrees podadas, recuperavel).
- branches `codex/*` ainda existem (worktrees ja removidas; branches nao podadas).

## Estado VERCEL / producao
- `c2x.app.br` -> `dpl_Gewd5C3veAHAWECPRY7ACipLmbbx` (main 96b9726) — 200, funcional.
- `ops.c2x.app.br` -> `dpl_2CENGD4sXbbak1sKjErgTpxF94c5` (OPS de 18/jun) — RECUPERADO. /zeus 200, / 307.
- Rollback do ops: reapontar `ops.c2x.app.br` para `dpl_2CENGD4sXbbak1sKjErgTpxF94c5`.

### ⚠️ ARMADILHA CRITICA — AUTO-DEPLOY
`git push origin main` DISPARA auto-deploy GitHub->Vercel que reaponta `c2x` E `ops` pro mesmo deploy (alias compartilhado). Foi assim que o OPS regrediu hoje (recuperado depois).
- **REGRA: NAO fazer `git push origin main` ate BLINDAR o auto-deploy.** Commit local e seguro; push nao.
- Blindagem pendente (decidir com Lucas): (a) desligar auto-deploy GitHub no projeto Vercel; (b) separar o `ops` num projeto Vercel proprio (cura definitiva); (c) config de production branch.

## O que foi feito (2026-06-23)
1. **Fundacao Zeus**: hooks resilientes versionados (`scripts/git-hooks/` + `setup-git-hooks.ps1`), `AGENTS.md`/`CLAUDE.md` no modelo Zeus, squad completo (`.claude/agents`: investigator/planner/builder/reviewer/release-manager + commands `/handoff` `/registrar-release`). Commitada na main.
2. **Marco zero do C2X**: main = producao rastreavel. Pushada pro GitHub.
3. **Processo de trabalho (5 regras de ouro)**: a main e a verdade (=producao); todo trabalho parte da main e volta pra main; 1 recorte por vez em branch propria; aprovado em prod -> merge na main; recorte fechado -> poda a branch.
4. **Incidente OPS** (acima): recuperado via `vercel alias set`.
5. **Marco zero do OPS**: `main-ops` do estado bom de 18/jun.
6. **Analise do modulo OPS** (Operations Center, ~25k linhas, 8 secoes; 2 arquivos gigantes: ZeusPage 7820 + helpdesk-board 7511 = divida).
7. **Visao da remodelagem** (validada): focar o modulo em 3 verbos:
   - ORGANIZAR = **HelpDesk** (o coracao; manter+melhorar).
   - VIGIAR = **Saude do HUB** (observabilidade tempo real + custo D-1; anti-Hermes).
   - COMUNICAR = **Atualizacoes/changelog** (deploys com impacto; futura intranet).
   - Aposentar: Address (o processo novo resolve) + telas mortas.
8. **R1 entregue**: bloco `HealthBoard` (Saude do HUB tempo real) na branch ops/health-board (commit `90baf38`). Reaproveita o monitoring existente. Validado (typecheck) + preview OPS funcional.

## Preferencias do Lucas (aplicar sempre)
- **UI enxuta**: pouco texto explicativo, ICONES + TOOLTIPS no hover, sem instrucoes na tela. Valida tudo VISUALMENTE (prints). Direto, PT-BR.
- Indicadores precisam de **CONTEXTO** (regua bom/ruim) e serem **ACIONAVEIS** (o que fazer), nao so numeros.

## Proximos passos (priorizados)
**A. R1.2 — evoluir a Saude do HUB (pedido direto do Lucas):**
- REGUA/CORES nos indicadores: bom `<300ms` / atencao `300-800` / lento `800-2000` / critico `>2000`. O sistema ja classifica (`timeRisk` no snapshot) — so expor na UI.
- TODAS as integracoes: adicionar healthchecks leves em `apps/hub/lib/operations/data-sources.ts` para Asaas, Asana, D4Sign, LiveKit, Meta/WhatsApp, OpenAI, Vercel (alem de Supabase/C2X). Chaves em `apps/hub/.env.local` (NOMES: `ASAAS_*`, `ASANA_*`, `D4SIGN_*`, `LIVEKIT_*`, `META_WHATSAPP_*`, `OPENAI_*`). NUNCA expor valores.
- ALERTAS ACIONAVEIS: expor `recommendation` + `command` + `recommendedAgent` (ja existem no tipo `OperationsAlert`) como problema -> causa -> o que fazer -> botao de acao.

**B. R2 — CUSTO D-1:** job diario puxando uso/custo de Vercel + Supabase (egress/invocations/db). Trilho anti-Hermes. Tokens no .env. D-1 e a cadencia certa (billing nao e tempo real).

**C. INFRA (fios soltos):** blindar auto-deploy; separar projeto Vercel do `ops`; pushar main-ops + health-board (APOS blindar); podar branches `codex/*`.

**D. Outras frentes:** HelpDesk (melhorar — Lucas dira o que travou), Atualizacoes/changelog.

**E. IRIS (caredesk):** a grande frente original (go-live ~24/jun) ficou parqueada nesta sessao.

## Como retomar o R1.2
- Working tree na branch `ops/health-board-20260623` (R1 em `90baf38`).
- Componente: `apps/hub/modules/squadops/blocks/health/health-board.tsx`. Integracao: `ZeusPage.tsx` (view "health").
- Preview OPS seguro (NAO toca producao): `npx.cmd vercel deploy --prod --skip-domain --yes --scope lucasruas-devs-projects` (env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`), depois acessar `<url>/?ops=1` (o proxy redireciona pro /zeus standalone via cookie).
- check-types: `npm.cmd --prefix apps/hub run check-types` (limpar `apps/hub/.next` ao trocar de branch).

## Bloqueios (regra-mae)
Nada de deploy/alias/promote/redeploy/env/secret/migration/dominio sem autorizacao explicita do Lucas, a cada vez. NUNCA expor chaves/tokens/senhas. NUNCA pushar `main` ate blindar o auto-deploy. NUNCA mover `ops.c2x.app.br` sem OK. Legado C2X read-only.
