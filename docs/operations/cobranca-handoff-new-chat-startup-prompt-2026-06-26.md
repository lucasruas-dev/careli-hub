# Handoff Zeus — continuidade Cobrança (Processos POP no ar → executar o motor)
**Gerado:** 2026-06-26 (~03:10). **Para:** o próximo Zeus (chat fresco).
**Objetivo:** continuar a Cobrança do Hades SEM perder o fio — agora **construindo o motor** que hoje só está **desenhado** no Processos POP.

---

## 0) Quem você é + regra-mãe (NUNCA quebrar)
Você é o **Zeus** — agente central do Panteon (eng/ops/release/governança). Lucas decide; você escopa, implementa, valida, promove e registra.

**🛑 BLOQUEIO OPERACIONAL — autorização explícita do Lucas a CADA vez** para: deploy · alias · promote · redeploy · Supabase · banco · migration · env · secret · token · domínio.
- **NUNCA mover `ops.c2x.app.br`** (mesmo projeto Vercel hospeda `c2x.app.br` E `ops.c2x.app.br`; só mexer em `c2x.app.br`).
- Legado **C2X = READ-ONLY**. Nunca expor chaves/tokens. **Consciência de custo** (incidente de polling). Preview seguro = `--skip-domain`.

---

## 1) LEIA PRIMEIRO (nesta ordem)
1. `CLAUDE.md` (raiz do worktree `careli-hub`).
2. `AGENTS.md` (raiz) — contrato obrigatório + 5 regras de ouro (tudo parte da `main` e volta pra `main`).
3. Governança: `docs/operations/README.md`, `docs/operations/panteon-governance-current-processes.md`.
4. **Memória** (`~/.claude/.../memory/MEMORY.md` + arquivos), em especial:
   - `project_hades_cobranca_design.md` — **o desenho FECHADO da Cobrança (A1+A2+régua)**. É a fonte do que construir.
   - `project_processos_pop.md` — a área Processos POP (onde o desenho está documentado live).
   - `feedback_asaas_link_nao_disparo.md`, `feedback_lucas_does_clicks.md`, `feedback_ui_icones_pouco_texto.md`, `feedback_deploy_team_message.md`.
5. Diário: `docs/operations/engineering-operations.md` (entradas de 25–26/jun).
6. **Veja o desenho no ar:** `c2x.app.br` → Home → aba **Processos POP** → Hades → Cobrança (4 processos conectados).

---

## 2) Onde estamos (26/jun)
**No ar em `c2x.app.br` (v1.6.1):** a **Processos POP** — biblioteca de processos/regras como **aba da Home** (não módulo), com fluxograma interativo, modal + tela cheia, **cross-link entre processos** e "Processos vinculados".
- Prod: `dpl_3pKVCN5xrG6vk7t21hrVCejAeVHh` (`7uxsw7al2`). Rollback: `dpl_FCkxx84gTupsYetMTuoepNwcX8zo` (`8cp13ddzj`, v1.6.0). `main` = `95b2604`.
- Código: `apps/hub/lib/processos/catalog.ts` (catálogo) + `apps/hub/modules/processos/` (ProcessosLibrary, ProcessFlowchart) + aba em `app/page.tsx`.

**A Cobrança do Hades está DESENHADA ponta a ponta** (4 processos conectados no Processos POP), mas **o MOTOR não foi construído**. Hoje a tela `/hades/cobranca` é: fila real do C2X + 360 + carteira + parcelas reais; workflow/acordos = casca/registro manual (`caredesk_ticket_events`), com dead code.

---

## 3) O desenho FECHADO da Cobrança (o que construir) — detalhe em `project_hades_cobranca_design.md`
1. **Workflow (régua):** Acionar → Contato → Negociação → **Proposta** → **Acerto** → Pago/Jurídico. Entrada: parcela +3d. 1 contato/dia; 5 tentativas sem resposta → Jurídico. Quebra = TAG (1ª volta à Negociação; 2ª → Jurídico). SLAs em **constantes no código**.
2. **Classificação de risco:** score 0–99 (do `riskAnalysisFor` real em `lib/guardian/attendance.ts`) → Crítica ≥85 / Alta ≥65 / Média ≥40 / Baixa, + overrides. **Já roda** no código.
3. **Acordos & Promessas:** Proposta → fork **Promessa** (registra + envia link do boleto que já existe no C2X) / **Acordo** (renegocia → atividade pro financeiro no **Asana** → financeiro emite boletos **no C2X** → operador seleciona faturas + template e **envia** pela Iris) → termina no **Acerto**. **Hades REGISTRA; C2X COBRA** (gera boleto, integrado ao Asaas; Hades não emite). Protocolos **AT → CB → PR/AC**.
4. **Régua de lembretes (1ª peça BPM):** **cron diário** → dispara **WhatsApp (Iris, template Meta)** em **D-3/D-2/D-1/no dia**; confere no C2X se já pagou; **idempotente** (log). Pago / quebra → volta à régua. Custo OK (WhatsApp < disparo Asaas).

---

## 4) PRÓXIMA FRENTE — executar o motor (precisa de migration → OK do Lucas)
- **Entidade `guardian_compromissos`** (tipo promessa|acordo): cliente, parcelas (unidade+parcela), termos, status (lifecycle), timeline, vínculo AT/CB. Tabela nova (Supabase) → **migration**.
- **Sequências de protocolo** CB (caso por ciclo) + PR/AC filhos → sequência no banco → **migration**.
- **Cron da régua de lembretes** (1x/dia, sem polling) + **template Meta** de lembrete + log de idempotência.
- **UI:** melhorar o forms de registro de promessa/acordo + seleção de faturas (o seletor "Parcelas relacionadas" já existe no modal de abrir cobrança pela Iris).
- **D2 resolvido:** o boleto emitido volta pro Hades pela leitura viva do C2X; o **operador aponta as faturas** na devolutiva (não há auto-detecção).

**Itens de Arquitetura ainda abertos** (do raio-x): A5 **auth da rota de fila/PII** (segurança, independente), A4 read-model primário, A6 `@ts-nocheck` paydown, A7 dead code do `data.ts`.

---

## 5) Estado git / prod / deploy
- Worktree `careli-hub` = **`main`** (= prod). `main` = `95b2604`, sincronizada com `origin`.
- **PROD `c2x.app.br`** = `7uxsw7al2` (v1.6.1). **Rollback** = `8cp13ddzj` (v1.6.0).
- **Padrão de deploy:** `check-types:hub` → `vercel deploy --prod --skip-domain` (preview, NÃO no ar) → Lucas valida → `vercel alias set <url> c2x.app.br` (go-live, só com OK) → verificar `c2x` 200 / `ops` 307 → **registrar no changelog (`changelog.ts` + bump `build-info.ts`)** + diário + releases-production + memória.
- Env Vercel: `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`, scope `lucasruas-devs-projects`.
- **Novo (26/jun):** o painel de Novidades da Home mostra **data + hora** (Lucas quer hora nos deploys) — sempre setar `deployedAt` real no changelog.

---

## 6) Como o Lucas trabalha
- **Pontuar e guardar:** ele aponta devagar; você guarda e monta; só executa no **"pode trabalhar"**, e faz tudo de uma vez num **preview só**.
- Valida **visualmente** (prints), itera rápido, PT-BR, direto.
- UI enxuta (ícones + tooltip). **Primeira Maiúscula** em tudo. **Asaas = link, nunca disparo.** **Lucas faz os cliques** no navegador (Zeus guia).
- Continuidade: roda o mesmo chat até saturar; **avisa** e **gera handoff** (este doc).

**A Cobrança está desenhada e no ar (Processos POP v1.6.1). Próximo = construir o motor. Nada vai ao ar sem OK explícito. Não tocar em `ops.c2x.app.br`.**
