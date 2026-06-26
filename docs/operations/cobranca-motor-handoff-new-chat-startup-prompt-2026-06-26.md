# Handoff — Motor da Cobrança (Hades) — startup prompt p/ o próximo Zeus

> Gerado em 2026-06-26 ao fim de uma sessão longa (lockdown de segurança v1.6.3 + foundation do motor da Cobrança). Use este arquivo como prompt de abertura da sessão nova.

## §1 — Ritual de abertura (faça primeiro)
Você é o **Zeus** (agente central do Panteon/Careli Hub). Antes de tocar em código:
1. Leia `CLAUDE.md` (cérebro) e `AGENTS.md` (operating model) na raiz do `careli-hub`.
2. Leia a memória: `MEMORY.md` e principalmente [[project_hades_cobranca_design]], [[project_security_lockdown]], [[project_processos_pop]].
3. Leia o fim do diário `docs/operations/engineering-operations.md` (entradas de 26/jun).
4. **Idioma: sempre pt-BR.** Lucas valida visualmente, é direto, pragmático.
5. **🛑 BLOQUEIO OPERACIONAL:** nada de deploy/alias/Supabase/migration/env/secret/token/domínio sem **OK explícito do Lucas, a cada vez**. Nunca mover `ops.c2x.app.br`. Legado C2X = read-only.

## §2 — Estado atual (o que está no ar)
- **Produção** `c2x.app.br` = **v1.6.3** (`careli-hub-hub-i2bs-jur4gvue9`, `dpl_4FDPWQY1XoJrhqHEGEa7WviZxsLU`). Rollback = `71eyvk82g` (v1.6.2). `ops.c2x.app.br` → 307 (intocado). `main` = commit `ef9c995`.
- **Segurança (FEITO):** gate central de login em todo `/api/*` vive no **`apps/hub/proxy.ts`** (Next 16 renomeou `middleware`→`proxy`; **NÃO criar `middleware.ts`**, o build quebra). Allowlist = videochamada Chronos (`/api/chronos/public`), webhook Meta, crons, OAuth callback, login, `db/health`, `pwa/manifest`. Política: **tudo exige login, exceto a videochamada do Chronos**. Helpers de auth por módulo (`authorizeHadesRead`, `authorizeApoloRead`, etc.). Sessão é **Bearer** (token Supabase no header), **não cookie**.
- **Motor da Cobrança — tijolo 1 (banco) FEITO:** migration **0036** `guardian_cobranca_motor` **aplicada no Supabase de prod** (`bxgukywoxgivlrhjkwjx`). Puramente aditiva — nada no app referencia ainda. Sequence de protocolo em 1 (primeiro compromisso = `PR-000001`).

## §3 — Sua tarefa: continuar o motor (tijolos 2→5)
Nada do que falta precisa de nova migration — é engenharia de app. Ordem sugerida:
2. **Lib server + tipos TS** (`apps/hub/lib/guardian/...`): CRUD de compromisso + parcelas + lembretes sobre as 3 tabelas. Espelhar o padrão dos outros módulos (ex.: `lib/ares/server.ts`, `lib/guardian/*`).
3. **Rotas API** protegidas (padrão `authorizeHadesRead`): criar compromisso (promessa/acordo), listar por cliente, mudar stage/status. Geram protocolo via `select public.next_guardian_compromisso_protocol('promessa'|'acordo')`. **Ao criar, emitir também a nota na timeline** (hoje o "compromisso manual" é gravado em `caredesk_ticket_events` com `event_type='guardian_manual_commitment'` + `metadata.source_module='guardian'`, `metadata.client_id`; ver `app/api/guardian/attendance/manual-events/route.ts`). O novo motor é a fonte estruturada; a timeline continua sendo a leitura humana.
4. **Régua de lembretes:** cron diário (Vercel cron) que pega `guardian_compromisso_lembretes` `pendente` com `scheduled_for <= hoje`, **confere no `c2x_payments` se já pagou** (se sim, marca parcela paga + cancela lembrete), senão dispara template WhatsApp via Meta e marca `enviado`. Idempotente pelo unique `(compromisso, parcela, kind) NULLS NOT DISTINCT`. ⚠️ **Custo:** sem polling novo; cron 1x/dia. Rota do cron deve entrar na allowlist do `proxy.ts` e se proteger por segredo próprio.
5. **UI** no atendimento da Cobrança (`apps/hub/modules/guardian/attendance/*` — `AttendancePage`, `ClientDetailPanel`, `InstallmentsCard`, o modal de "abrir cobrança pela Iris" que já tem o seletor "Parcelas relacionadas"): registrar promessa/acordo, ver compromissos do cliente, acompanhar a régua.

## §4 — Schema do motor (migration 0036, já no banco)
- **`public.guardian_compromissos`** — entidade central. Campos: `id`, `protocol` (unique, PR-/AC-), `kind` (`promessa|acordo`), `status` (`ativo|cumprido|quebrado|cancelado`), `stage` (`aguardando_pagamento` p/ promessa; `aguardando_emissao|emitido|enviado` p/ acordo — há constraint de coerência kind↔stage), `client_c2x_id` (bigint, chave estável do C2X, **sem FK**), `acquisition_request_c2x_id`, `attendance_protocol`, `cobranca_protocol`, `channel`, `total_amount`, `installments_count`, `promised_date`, `first_due_date`, `risk_score`, `priority`, `notes`, `metadata`, `created_by_user_id`/`updated_by_user_id` (→hub_users), timestamps, `fulfilled_at`, `broken_at`.
- **`public.guardian_compromisso_parcelas`** — `compromisso_id` (FK cascade), `sequence`, `due_date`, `amount`, `status` (`pendente|emitida|enviada|paga|vencida|cancelada`), **`payment_c2x_id`** (elo com o boleto real do C2X/Asaas), `boleto_url`, `paid_at`, `metadata`. Unique `(compromisso_id, sequence)`.
- **`public.guardian_compromisso_lembretes`** — `compromisso_id` (FK), `parcela_id` (FK, null p/ promessa), `kind` (`D-3|D-2|D-1|D0`), `scheduled_for`, `channel`, `meta_template`, `status` (`pendente|enviado|falhou|cancelado`), `sent_at`, `message_id`, `failure_reason`, `metadata`. Unique idempotente `(compromisso_id, parcela_id, kind) NULLS NOT DISTINCT`.
- **Função:** `public.next_guardian_compromisso_protocol(p_kind text)` → `PR-NNNNNN`/`AC-NNNNNN` (grant a service_role).
- **RLS** habilitado nas 3; policies por papel (ler: admin/leader/operator/viewer; escrever: admin/leader/operator). App usa service_role (valida em código via `authorizeHadesRead`).

## §5 — Regras de ouro / pointers
- **Deploy:** `npm --prefix apps/hub run check-types` → `npx vercel deploy --prod --skip-domain` (preview, env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`, scope `lucasruas-devs-projects`) → Lucas testa → `vercel alias set <url> c2x.app.br` (só com OK) → verifica c2x 200 / ops 307 → changelog (`lib/changelog/changelog.ts`) + bump `lib/build-info.ts` + diário + releases-production + memória + **bloco copiável pro grupo** (build tag + "Ctrl+F5 pra atualizar").
- **Git:** trabalhe do `careli-hub` (rode `git -C careli-hub ...` se o cwd for o pai `Sistemas`). Commit em pt-BR, terminando com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Follow-up pendente (chip):** unificar `app/api/apolo/relationships/route.ts` no helper `lib/apolo/auth.ts` (`authorizeApoloRead`) — hoje tem auth inline duplicada.
- **Design completo da Cobrança** (A1 workflow + A2 acordos/promessas + régua): memória [[project_hades_cobranca_design]] e os 4 processos conectados no Processos POP (`apps/hub/lib/processos/catalog.ts`).
