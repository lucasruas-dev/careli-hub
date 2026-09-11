---
name: deploy-panteon
description: Use ao publicar o Panteon (careli-hub) em produção no c2x.app.br, gerar preview da Vercel, escrever a entrada de changelog do deploy, verificar se o deployment subiu ou preparar rollback.
---

# Deploy do Panteon — do jeito desta casa

Fonte: `CLAUDE.md` (Padrão de deploy + Infra), `AGENTS.md` (travas de segurança), memória do Lucas.

## Regra-mãe — leia antes de qualquer coisa

⚠️ **`git push origin main` = deploy de PRODUÇÃO em `c2x.app.br`, automático.** A integração
Vercel↔GitHub está ligada desde 1/jul/2026 e a branch de produção é a `main`. Isso torna o push
uma **operação sensível: exige OK explícito do Lucas a cada vez** (CLAUDE.md, "BLOQUEIO
OPERACIONAL"). Commitar e empurrar branch de feature é livre — ela só gera preview.

**Preview é pré-autorizado** (Lucas, 26/jun: "todo preview não precisa do meu ok, pode gerar").
Go-live, alias, env, secret e migration continuam exigindo OK, sempre.

⚠️ **`ops.c2x.app.br` está sendo DESATIVADO** (decisão do Lucas, 1/jul) — não mover, não aliasar,
não "consertar". Ele ainda é domínio de projeto, então todo deploy git o reatribui (307 → /zeus,
inofensivo). A remoção definitiva é manual, no painel Settings → Domains. Não é tarefa sua.

## Os passos, em ordem

1. ⚠️ **Changelog PRIMEIRO** — antes do typecheck e do build, não depois. Ver a seção abaixo.
2. **Typecheck limpo:** `npm --prefix apps/hub run check-types` (é `tsc --noEmit`; não gera cache).
   Se a mudança pede mais: `npm --prefix apps/hub run lint` e `npm --prefix apps/hub run test`
   (vitest). ⚠️ **Não rode `turbo build`/`next build` local só para conferir** — gera `.turbo`, que
   já inchou para 8,3 GB e envenenou o upload do deploy (28/jun).
3. **Preview:** empurre a branch de feature (preview automático) ou, da **RAIZ do monorepo**:
   `npx vercel deploy --prod --skip-domain --yes --archive=tgz --scope lucasruas-devs-projects`
   com `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX` e
   `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`.
   `--skip-domain` é o que impede de ir ao ar; `--archive=tgz` evita "Request body too large.
   Limit: 10mb" (o deployável tem ~34 MB). Nunca `--force` (re-upload total).
4. **Lucas valida** — ele confere visualmente e manda prints.
5. **Go-live, só com OK explícito:** `git push origin main`.
6. **Verificar:** `c2x.app.br` responde 200. ⚠️ E confira o **deployment**, não o push: em 10/jul o
   commit `c0c29891` chegou na `main` e a Vercel **não criou deployment nenhum** (22 min, zero
   builds) — suspeita de dois pushes seguidos em janela curta. Conserto: `git commit --allow-empty`
   + push. Nunca assuma que subiu porque o push passou.
7. **Anotar o rollback** = o deployment anterior (Instant Rollback no painel) e o commit anterior.
   O campo `rollback` da entrada de changelog guarda esse commit.
8. **Registrar:** `docs/operations/releases-production.md` (commit publicado, healthcheck, rollback)
   e um resumo curto em `docs/operations/engineering-operations.md`.

## ⚠️ O changelog é obrigatório

Regra do Lucas de 2/jul/2026: **todo deploy de produção é informado no painel de Novidades e na
build do avatar.** Sem entrada, o time fica no escuro e ninguém dá Ctrl+F5 (a PWA cacheia).

Arquivo: `apps/hub/lib/changelog/changelog.ts` → array `PANTEON_CHANGELOG`, **entrada nova no
índice 0** (índice 0 = o que está no ar). `apps/hub/lib/build-info.ts` deriva `PANTEON_VERSION` e
`PANTEON_BUILD_TAG` de `PANTEON_CHANGELOG[0]` — um só edit atualiza painel, avatar e aviso de
versão. Não existe bump manual em dois lugares.

Campos do tipo `ChangelogEntry`: `version` (semver bumpada), `buildTag`, `deployedAt`, `type`
(`correcao` | `melhoria` | `novidade`), `title`, `modules[]` (→ `screens[]` → `items[]`, linguagem
do usuário, é o que aparece na Home), `technical.done` / `technical.motivation` (técnico, só na aba
Deploy do Zeus), `rollback` (commit anterior) e o opcional `internal`.

- **`type: "correcao"` nasce com `internal: true`** (Lucas, 20/jul): bumpa a versão e fica no
  changelog técnico, mas some do painel de Novidades — o filtro é
  `apps/hub/components/panteon/home-novidades-panel.tsx:55` (`.filter((entry) => !entry.internal)`).
  Isso **substitui** a instrução antiga de "não criar entrada": sempre criar, marcar `internal`.
- ⚠️ **`deployedAt` = hora REAL da publicação** (Lucas cobrou em 29/jun). Pegue do sistema
  (`Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"`) na hora de subir. Não chute.
- **Não mande bloco copia-e-cola no chat nem no grupo** — aposentado por Lucas em 25 e 28/jun.
  A entrada do changelog **é** a comunicação do deploy.

## Infra (os ids que valem)

- Vercel: project `prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`, team `team_0AsY43vvHN2fwEkcN8u5LKXX`,
  scope `lucasruas-devs-projects`.
- Supabase: prod `bxgukywoxgivlrhjkwjx` (o nome "careli-hub-dev" engana) · homolog `qanlldynttyxgmcwkxqv`.
- Domínios: `c2x.app.br` (app) · `ops.c2x.app.br` (⚠️ em desativação, não tocar).

## Armadilhas já medidas

- ⚠️ **Rode o `vercel deploy` da RAIZ (`careli-hub/`), nunca de `apps/hub/`** — de lá a Vercel
  ignora o `vercel.json` do monorepo, poda 237 pacotes (entre eles o `turbo`) e falha em ~15s com
  "Missing `devEngines.packageManager`". Custou um deploy de produção em 05/08/2026. Sintoma: local
  passa limpo e a Vercel quebra rápido demais para ser build de verdade.
- ⚠️ **Env colada na UI como "Sensitive" pode chegar VAZIA ao runtime** — 20/jul, a
  `SESSAO_CAD_SECRET` existia no painel e o runtime lia vazio (503 em produção); redeploy limpo não
  resolveu, recriar via `vercel env add` resolveu. E `vercel env pull` **mente**: grava
  `"[Encrypted]"` para qualquer variável, não serve para diagnóstico. (Toda mexida em env exige OK.)
- ⚠️ **Erro de JSON na tela costuma ser TIMEOUT da Vercel, não parsing** — `Unexpected token 'A',
  "An error o"...` é o texto "An error occurred with your deployment" após 300s (03/09, geração de
  141 boletos). **O corte não desfaz o que já foi criado**: recarregue a tela antes de reemitir.
- ⚠️ **Duas sessões no mesmo worktree se atropelam** — 15/08, um `git add -A` de outra sessão
  commitou metade de um trabalho alheio sob título que não tinha nada a ver, numa branch que já
  tinha changelog pronto para release. Trabalho paralelo vai em worktree próprio
  (`git worktree add ../careli-hub-worktrees/<nome> -b <branch>`); antes de mexer no principal,
  `git log --oneline -3` para ver se o HEAD andou sozinho.
