# Handoff / Startup prompt — Iris CACÁ + port da Iris avançada (2026-06-25)

> Cole este arquivo (ou o resumo no fim) num **chat NOVO do Zeus** para continuar o trabalho de **melhorar + portar o CACÁ e a Iris avançada para produção**, com foco e qualidade.

## 🎯 Missão
Revisar (criteriosamente) e **PORTAR a Iris avançada — em especial o agente CACÁ — do snapshot sujo para produção**, com cuidado. NÃO é hackear: o código é bom; o trabalho é **revisar + integrar + testar**.

## ✅ Estado em PRODUÇÃO hoje (c2x.app.br / main)
- **Iris WhatsApp + atendimento humano VALIDADO em prod (2026-06-25):** mensagem real → ticket `AT-000002`; **contexto Apolo automático** (identificou o cliente: nome, CPF mascarado, CRM 360, fila, SLA); cockpit; **resposta humana chegando no WhatsApp** (outbound OK).
- Migration **0024** aplicada em prod (`caredesk_meta_webhook_events` + `caredesk_whatsapp_message_refs`) — versão SEM o UPDATE do canal (que regrediria `inbound/outbound_enabled`).
- Webhook Meta repontado para **prod** (`https://c2x.app.br/api/iris/meta/webhook`). ⚠️ Para salvar mudança de URL, a Meta **exige RE-DIGITAR o verify token**; como os env `META_WHATSAPP_*` são **"Sensitive"** (valor irrecuperável, nem por `vercel env pull`), Lucas definiu um **NOVO** `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, atualizou na Vercel e fizemos **redeploy** (`5yma8rwce` → c2x).
- App Meta: ID `4340149309532541` (Empresa **Careli-CX** — o app "Iris-Panteon" tem 2 instâncias, usar essa), número **+55 31 9072-8420**, phone_id `1208477435676689`, WABA `994894846427478`. App em "Desenvolvimento" mas **mensagem real entregou** (publish não bloqueou).

## 📦 Onde está a Iris AVANÇADA (a portar)
- **Branch `wip/principal-dirty-20260623`** (backup da worktree suja do marco-zero) = a versão MAIS completa: `caca-agent.ts` **2.930 linhas**, **100 arquivos** de Iris. (Também `origin/homolog`: caca 2.846, um pouco mais antiga.)
- **Worktree já criada para trabalhar:** `careli-hub-worktrees/iris-wip-analise` (checkout de `wip/principal-dirty-20260623`).
- **prod (main)** tem só a base: `IrisPage.tsx` monolítica (~8.607 linhas), SEM CACÁ.

## 🧩 O que a Iris avançada tem que prod NÃO tem
- **CACÁ (IA atendente):** `lib/iris/caca-agent.ts` (2930), `lib/iris/caca-media-analysis.ts`, `app/api/iris/attendant/route.ts`, `modules/caredesk/blocks/caca/iris-attendant-panel.tsx`.
- **Regra janela 24h (Meta):** em `app/api/iris/meta/messages/route.ts`, `blocks/conversation/iris-composer-actions.tsx`, inbound-processor.
- **Cockpit DECOMPOSTO em blocks:** `board` (fila: `iris-ticket-queue`, `iris-board-view`), `conversation`, `history`, `reports`, `setup`, `shell`, `start-attendance`, `shared/iris-ui`, `data/iris-data-client`, `types/iris-types`.
- **Disparos em massa, Relatórios, Histórico, Integração Hades** (`embeds/iris-collection-queue-embed`, `guardian/attendance/iris-ticket-{installments,options,template-preview}`), **templates com mídia** (`meta/templates/media/route.ts`).
- **Docs/spec:** `docs/operations/iris-ai-attendant-agent-operating-contract.md` (contrato do CACÁ) + `docs/operations/panteon-iris-decomposition-map-2026-05-30.md` (arquitetura) + ~40 recorte-manifests `panteon-recorte-manifest-md-20260530/31-*-iris-*`.

## 🔍 Análise do CACÁ (já feita)
V10, **bem construído**: OpenAI **Responses API** (`POST /v1/responses`), modelo governável (`HUB_IRIS_ATTENDANT_MODEL` → fallback `gpt-5.5`), `reasoning.effort=medium`/`text.verbosity=low`, **fallback determinístico** quando OpenAI cai, **auth determinística** por fragmento de CPF (Apolo) ANTES de ação financeira, **trilha de auditoria** sanitizada (`toolsUsed`/`trace`), guardrails fortes (sem SQL livre/payload financeiro para o modelo, sem expor CPF/secret). **Sem bug óbvio.** Ganhos = sutis.

## 🗺️ Plano priorizado (sugerido)
0. Ler `panteon-iris-decomposition-map-2026-05-30.md` + o contrato do CACÁ (entender a arquitetura decomposta).
1. **Branch nova a partir de `main`.** Portar o módulo Iris decomposto (`types` → `data-client` → `blocks` → `IrisPage`) e fazer **compilar** (`npm --prefix apps/hub run check-types` limpo). Resolver deps (libs server de Apolo/Hades já existem em prod).
2. Trazer o **CACÁ** (`caca-agent` + `attendant/route` + `caca-media-analysis`) e ligar no inbound-processor (auto-resposta).
3. **Revisão de CUSTO/contexto** do CACÁ — ele carrega "contexto rico" por turno (histórico, tickets anteriores, financeiro) → tokens + queries. Avaliar trim/cache (consciência anti-incidente-Hermes-polling).
4. **Regra janela 24h** (Meta) no envio.
5. Preview `--skip-domain` → Lucas valida → go-live `c2x` (com OK explícito) → registrar no diário + releases.

## 📌 Pendências de hoje (follow-ups)
- Registrar o go-live Iris WhatsApp no diário (`engineering-operations.md`) + `releases-production.md`.
- **Limpar o ticket de TESTE `AT-000001`** ("Sem cadastro") do banco de prod (foi o teste do painel Meta).
- Gerar **System User token permanente** na Meta (o `META_WHATSAPP_ACCESS_TOKEN` atual é **temporário** → expira → outbound/resposta do atendente quebraria).
- Iris pendentes: **canal e-mail**; consolidar `caredesk`→`iris` (rotas legadas).

## 🛑 Regra-mãe (nunca quebrar)
Toda op sensível (deploy/alias/promote/redeploy/Supabase/migration/env/secret/token/domínio) inicia **BLOQUEADA** até autorização **explícita** do Lucas, **a cada vez**. Nunca mover `ops.c2x.app.br`. Nunca expor token/secret. Legado C2X read-only. Custo importa. **Lucas faz os cliques no navegador — Zeus GUIA (lê/verifica), não dirige.** Zeus nunca digita secret/token em campo.

---

### Resumo curto para colar no chat novo
> Zeus, retomar o **port + melhoria do CACÁ / Iris avançada** pra produção. Estado: WhatsApp+humano JÁ no ar em prod (ticket `AT-000002` validado, migration 0024 aplicada, webhook → c2x com verify token novo). A Iris avançada (CACÁ 2930 linhas, fila, 24h, cockpit decomposto, relatórios, Hades) está no branch `wip/principal-dirty-20260623` (worktree `careli-hub-worktrees/iris-wip-analise`). CACÁ é V10, bem feito (Responses API, auth determinística, guardrails) — sem bug óbvio; ganhos = custo/contexto + port. Plano: branch da main → portar Iris decomposta (compilar) → trazer CACÁ → revisar custo → 24h → preview → go-live. Ler `docs/operations/iris-caca-port-startup-prompt-2026-06-25.md` e `panteon-iris-decomposition-map-2026-05-30.md`. Respeitar a regra-mãe.
