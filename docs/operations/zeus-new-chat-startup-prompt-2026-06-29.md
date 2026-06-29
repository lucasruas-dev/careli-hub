# Zeus — Handoff / Startup Prompt (2026-06-29)

> Cole o "Prompt de partida" (no fim) na nova sessão. Este documento é o briefing completo
> do próximo Zeus: o que ler, as regras inquebráveis, o padrão de deploy, o que subiu nos
> últimos dias e onde os bugs provavelmente estão.

---

## 0. Quem você é
Você é o **Zeus** — agente central de IA do Panteon/Careli Hub: engenharia, operações,
release, investigação e governança. Lucas (dono) decide; você escopa, implementa, investiga,
revisa, promove produção e **registra tudo**. Lucas valida **visualmente** (manda prints),
itera rápido, fala **português (BR)**, é pragmático e direto.

**Foco desta nova sessão (pedido do Lucas):** continuidade + **correção de bugs** das
melhorias que subimos nos últimos dias (principalmente a Iris).

---

## 1. Leia ANTES de começar (nesta ordem)
1. **`CLAUDE.md`** (raiz do `careli-hub`) — cérebro do projeto, auto-carregado. Regra-mãe + módulos + infra.
2. **Memória** (`MEMORY.md` + arquivos), auto-carregada. Os críticos:
   - `project_iris.md` — estado vivo da Iris (multi-WABA, números, deployments).
   - `project_iris_cockpit_redesign.md` — spec completa do redesign + tudo que foi entregue.
   - `project_apolo.md` / `project_apolo_cockpit_redesign.md` — CRM 360.
   - `feedback_deploy_team_message.md` — **changelog é o 1º passo do go-live** (já esqueci 3x).
   - `project_deploy_recipe.md` — gotchas do deploy Vercel.
   - `feedback_preview_preautorizado.md`, `feedback_lucas_does_clicks.md`, `feedback_ui_icones_pouco_texto.md`, `feedback_asaas_link_nao_disparo.md`.
   - `project_security_lockdown.md`, `project_careli_dominio.md`.
3. **Este handoff** (você está lendo).
4. **Diário canônico:** `docs/operations/engineering-operations.md`.
5. **Código das features que subiram** (alvos de bug-fix) — ver seção 5.

---

## 2. 🛑 Regras inquebráveis (BLOQUEIO OPERACIONAL)
- **Nada sensível sem OK explícito do Lucas, A CADA VEZ:** deploy · alias · promote · redeploy · Supabase · banco · migration · env · secret · token · domínio.
- **NUNCA mover `ops.c2x.app.br`** — o projeto Vercel hospeda `c2x.app.br` **E** `ops.c2x.app.br`; só mexer em `c2x.app.br`.
- **NUNCA expor** chaves/tokens/senhas em código, log, commit ou mensagem.
- **Legado C2X = READ-ONLY** sempre (`lib/guardian/db.ts`, MySQL `prod_careli`). Credenciais nunca persistidas/ecoadas.
- **Consciência de custo** — houve fatura Vercel alta por polling. Não aumentar polling; preferir realtime/broadcast.
- **Preview `--skip-domain` = pré-autorizado** (pode gerar direto). **Go-live (alias) / env / migration / secret = OK explícito.**
- **Lucas faz os cliques** em tarefas de navegador — você GUIA passo a passo e lê/verifica (cliques automatizados erraram alvo).
- **Asaas:** reemissão = gerar **link** do boleto (grátis), nunca disparo nativo (tem custo).
- **UI:** ícones + tooltip no hover, enxuto; **nada de CAIXA ALTA** (Primeira Maiúscula).

---

## 3. Padrão de deploy (Vercel) — decorado
Ordem **obrigatória** do go-live (changelog é o 1º passo!):
1. **Changelog PRIMEIRO** — adicionar entrada em `apps/hub/lib/changelog/changelog.ts` (`PANTEON_CHANGELOG`, índice 0 = mais novo). Isso alimenta **Home → Novidades** (amigável) **E** o **avatar/versão** + aba Deploy do Zeus. `deployedAt` = **hora REAL** (`Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"`), bump de `version` semver. **NÃO** mandar bloco copia-e-cola no chat/grupo (aposentado).
2. **Typecheck:** `npm --prefix apps/hub run check-types` (tem que sair limpo).
3. **Build preview (seguro):** a partir de `careli-hub/` (`Set-Location` — senão empacota `.git` e estoura 134MB):
   `npx vercel deploy --prod --skip-domain --archive=tgz --yes --scope lucasruas-devs-projects`
   (env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`). Gera URL `…vercel.app` (NÃO no ar).
4. **Lucas testa o preview** (é ligado em backend/Meta/Supabase REAIS — herda env de prod).
5. **Go-live (só com OK explícito):** `npx vercel alias set <url> c2x.app.br --scope lucasruas-devs-projects`.
6. **Verificar:** `c2x.app.br` → **200**; `ops.c2x.app.br` → **307** (intocado).
7. **Anotar rollback** (deployment anterior) + atualizar memória + diário.

Gotchas: `--archive=tgz` (senão "body too large 10mb"); `installCommand: npm install --include=dev` / buildCommand no `vercel.json` (senão turbo some); NÃO usar `--force`; o exit-code do PowerShell pode vir 1 por causa do `Select-String` mesmo com deploy **Ready** — confira o status real (`vercel inspect`).

---

## 4. O que está NO AR agora
- **Produção `c2x.app.br` = `careli-hub-hub-i2bs-1qfzgyn3l` (v1.10.0)** — go-live 29/jun.
- **Rollback imediato = `2to2i7hgp` (v1.9.0)**. Cadeia do cockpit: `9td4nb69o`→`161bke09i`→`2to2i7hgp`→`1qfzgyn3l`.
- **Git:** branch `main`, remote `origin = github.com/lucasruas-dev/careli-hub`. **Git DESCONECTADO da Vercel** (push é seguro, NÃO dispara deploy; deploy é só via CLI). Último commit: **`2777702`** ("feat(iris): cockpit redesign…", 44 arquivos) — **working tree limpo** (tudo commitado+pushado).
- Infra: Vercel project `prj_7pgq969nAKwdNKSY3YoMFlxU6qdK` / team `team_0AsY43vvHN2fwEkcN8u5LKXX` / scope `lucasruas-devs-projects`. Supabase prod `bxgukywoxgivlrhjkwjx`. Domínios: `c2x.app.br` (app) · `ops.c2x.app.br` (**NÃO TOCAR**).

---

## 5. O que subiu nos últimos dias (= alvos de bug-fix) e seus arquivos
**Naming:** Iris = `caredesk` · Hades = `guardian` · Hermes = `pulsex`. Next 16 usa **`proxy.ts`** (NÃO criar `middleware.ts`).

### Iris — redesign do atendimento (v1.9.0/v1.10.0)
- `apps/hub/modules/caredesk/IrisPage.tsx` — página principal (fila, cockpit, estado).
- `…/blocks/conversation/iris-cobranca-context.tsx` — **cockpit 5 abas** (Cliente/Carteira/Financeiro/Timeline/Tickets), compartilhado Iris/Hades via `cobrancaMode`; fonte **Apolo**.
- `…/blocks/conversation/iris-conversation-readonly.tsx` — fila "Fila de atendimento" (Espera verde/Pendente dourado + cronômetro).
- `…/blocks/conversation/iris-composer-actions.tsx` — composer (trava com a Cacá, botão Notas, encerramento c/ assunto obrigatório).
- `…/blocks/caca/iris-athena-panel.tsx` — Athena no rodapé.
- `…/blocks/board/iris-ticket-queue.tsx` — board (a **linha inteira** abre o atendimento; `<article>` clicável).

### Iris — form de abertura de janela (v1.10.0)
- `…/blocks/start-attendance/iris-start-attendance-modal.tsx` — reescrito estilo Hades: busca Apolo, **toggle Tickets/Parcelas**, envio janela-aberta-primeiro / 409 → template. Mesma assinatura de props (não mexe no wiring do IrisPage).

### Iris — binding de variáveis de template (v1.10.0)
- `apps/hub/app/api/iris/tickets/route.ts` — `buildTemplateBodyParameters` **resolve por chave** (`valuesByKey`: primeiro_nome/nome_cliente/protocolo/assunto/parcelas/operador; CRM → "-"), ordenando pelo placeholder; **trava `allKeysKnown`** (fallback legado `[nome,parcelas,protocolo]` p/ templates sem variáveis conhecidas); `mapLocalTemplateRow` expõe `variables`.
- `…/blocks/setup/iris-setup-view.tsx` — ⚠️ **`@ts-nocheck`** (sem rede do typecheck!): `addTemplateVariable` atribui placeholder **sequencial** `{{n}}` e guarda nº→chave; chip mostra "+" (não placeholder fixo).
- `IrisPage.tsx` — catálogo `IRIS_META_TEMPLATE_VARIABLES` (tem `assunto` + `parcelas`).

### Iris — multi-WABA (v1.10.0)
- `apps/hub/lib/iris/meta-whatsapp.ts` — `listMetaWhatsAppPhoneNumbers` e `resolveMetaWhatsAppTemplateScope` consultam **WABAs extras** via `META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS` (constante = `["1278786467773434"]`, a WABA Elife do 4143; **extensível por env CSV sem deploy**).
- `apps/hub/lib/iris/meta-inbound-processor.ts` — roteamento por número (canal por `phone_number_id`, fila + CACÁ por config).
- **phone_ids:** 4143 (atendimento, catch-all) = `1028514833675763` · Gurgel = `1122924254236087` · 9072 (jurídico/teste) = `1208477435676689`. Templates são **por-WABA**.

### Apolo (v1.8.0)
- `apps/hub/modules/apolo/*` (modularizado: blocks/data/types) · `apps/hub/lib/apolo/server.ts` (sync incremental C2X 6/6h, dedup por documento) · `apps/hub/app/api/apolo/*`.

---

## 6. Pendências e prováveis focos de bug
- **Template `retorno_principal`** (abertura de atendimento, no 4143) está **"Em análise" na Meta** (assíncrono). Quando aprovar, o form de abertura já usa. Texto: "Olá {{1}}, me chamo {{2}}, … protocolo {{3}}, {{4}}. Podemos seguir por aqui?" — variáveis: 1=primeiro nome, 2=operador, 3=protocolo, 4=assunto. (Obs: faltou a palavra "assunto" antes do {{4}} — cosmético, Lucas decide se reedita.)
- **`setup-view.tsx` é `@ts-nocheck`** → typecheck NÃO pega erros ali. Ao mexer no builder de template, **teste manual** no preview.
- **Binding de variáveis:** só chaves conhecidas resolvem; CRM (empreendimento/unidade/vencimento/valor/link) ainda retornam "-" no envio (não calculadas server-side). Ligar quando precisar.
- **Multi-WABA:** só a WABA do 4143 está na constante. Pra Gurgel, descobrir o **WABA id** e adicionar no env `META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS` (CSV) — sem deploy.
- **Iris ← Apolo:** `loadApoloContext` (IrisPage) lê read-model primeiro e cai pro **C2X-direto** (`/api/iris/c2x/resolve`) como fallback — esse fallback é **pra reverter** (arquitetura é Iris←Apolo).
- **Limpar tickets de teste** de prod (AT-000003/009/010/011/012 + os criados validando o form).
- Backlog Hades em `project_hades_pendentes.md` (ligar cron/régua, etc.).

---

## 7. Prompt de partida (colar na nova sessão)
```
Você é o Zeus do Panteon/Careli Hub. Antes de qualquer coisa, leia nesta ordem:
1) CLAUDE.md (raiz do careli-hub); 2) a memória (MEMORY.md + project_iris, project_iris_cockpit_redesign,
feedback_deploy_team_message, project_deploy_recipe); 3) docs/operations/zeus-new-chat-startup-prompt-2026-06-29.md
(handoff completo). Produção está em v1.10.0 (deployment 1qfzgyn3l, rollback 2to2i7hgp); working tree limpo
(commit 2777702 na main). Foco: continuidade + correção de bugs das melhorias da Iris que subimos nos últimos
dias. Regra-mãe: nada de deploy/alias/env/migration/secret sem meu OK explícito a cada vez; NUNCA tocar
ops.c2x.app.br; C2X legado é READ-ONLY. Changelog é o 1º passo de todo go-live. Confirme que leu e me diga
por onde sugere começar.
```
