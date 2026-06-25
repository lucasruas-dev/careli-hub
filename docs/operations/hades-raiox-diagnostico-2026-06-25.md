# Hades (guardian) — Raio-X / Diagnóstico de alto nível

Status: `DIAGNOSTICO / ALTO NIVEL` · Data: 2026-06-25 · Autor: Zeus

Contexto: o Hades foi iniciado e pausado; há **muita coisa mockada**. Este doc é um
raio-x de alto nível para guiar o ataque aos problemas, organizado em camadas:
**Arquitetura → Integrações → UI** (de baixo pra cima).

Marca↔código: **Hades = `guardian`**. Cobrança que **usa a Iris como canal**;
forte acesso ao legado **C2X** (READ-ONLY).

---

## 1. Arquitetura

- **Superfície (~24k linhas):** `modules/guardian` (UI) + `lib/guardian` (libs) +
  `app/guardian` + `app/api/guardian`. `app/hades/*` e `app/api/hades/*` são
  **re-exports finos** do `guardian/*` (rename em transição).
- **Rotas vivas:** `/hades/cobranca` (cobrança — o coração), dashboard
  `app/guardian/page.tsx`, `intelligence`, `monitoring`. Redirecionam:
  `/hades/atendimento`→`/hades/cobranca`, `/hades/desk`→`/iris`.
- **Estratégia de dados (read-model):** o legado C2X (MySQL RDS) é caro; existe um
  **read-model em Supabase (`c2x_*`)** como cache. A rota overview só serve do
  read-model se ele tiver **< 60s** (`READ_MODEL_MAX_AGE_MS`).
- ⚠️ **Dívida:** **26 arquivos com `@ts-nocheck`** (erro de runtime que o build não
  pega — mesma classe do bug Send/X da Iris).
- ⚠️ **Mock como default arquitetural:** `lib/.../attendance/data.ts` exporta
  `queueClients` montado do `hadesMockData`; `AttendancePage`/`DeskPage` caem nesse
  mock quando `loadFromC2x` é falso.

## 2. Integrações

| Integração | Como | Estado |
|---|---|---|
| **C2X legado (MySQL)** | `lib/guardian/db.ts` — pool singleton, `connectionLimit:5`, `queueLimit:0`+wait, connectTimeout 8s, erros sanitizados | **READ-ONLY confirmado** (zero insert/update/delete) ✅ |
| **Read-model (`c2x_*`)** | `read-model-sync.ts` lê overview+fila do legado e grava snapshots no Supabase (service role) | sync **MANUAL, sem cron** ⚠️ |
| **Asaas (boleto)** | `asaas.ts` — reusa link já existente no C2X (`payments.payment_asaas_url`) + `viewingInfo` on-demand | só modo **"link"**; disparo nativo / reemissão **não implementado** ⚠️ |
| **D4Sign (contratos)** | `app/api/guardian/d4sign/contracts/[id]` | read-only |
| **Iris (canal WhatsApp)** | `WhatsAppConversationPanel` posta em **`/api/iris/tickets`** (Meta = nº de cobrança), rastreia `irisTicketId/irisMessageId`, escolhe profile/canal/template da Iris | **fiado end-to-end** ✅ |
| **Apolo** | contexto 360 do cliente | ok |

## 3. UI

- **Cobrança (`/hades/cobranca`):** `AttendancePage clients={[]} loadFromC2x` →
  **fila REAL** do C2X (sem fallback mock; em erro mostra erro). Fluxo:
  fila → `ClientDetailPanel` (360) → `WhatsAppConversationPanel` (dispara via Iris) +
  `InstallmentsCard`/`AgreementsCenterCard`/`OperationalTimeline`. ✅
- **Dashboard (`app/guardian/page.tsx`):** KPIs **reais** (overview C2X, **poll 30s**)
  **+ lista "contracts" MOCK** (`page.tsx:104`). ⚠️
- **IA:** `AiCopilotDrawer` (1510) + `AiSuggestionsModal` + tabela
  `caredesk_ai_suggestions` → copiloto OpenAI no atendimento (vetor de custo; sem
  deep-dive ainda).
- **Componentes pesados (não auditados linha-a-linha):** `WhatsAppConversationPanel`
  (2953), `ClientDetailPanel` (1975), `AgreementsCenterCard` (1287),
  `IntelligencePage` (1375), `MonitoringPage` (1075).

---

## Riscos (priorizados)

- 🔴 **Custo — read-model bypassado:** dashboard faz **poll de 30s**; sem cron o
  read-model fica sempre stale (>60s) → **cada poll cai no LEGADO VIVO** (agregação
  pesada, pool 5) por aba aberta. **Classe do incidente Hermes.** O cache existe mas
  está anulado.
- 🔴 **Mock no dashboard** (`contracts`) → operador não pode ver cliente fake em
  "Hades full". (A fila de cobrança em si é real.)
- 🟠 **Read-model stale** (sync manual) → atraso/boleto desatualizado.
- 🟠 **26 `@ts-nocheck`** → risco de bug em runtime.
- 🟠 **Asaas** sem reemissão/disparo nativo → handoff manual.
- 🟠 **Tabelas snapshot crescem sem poda.**
- 🟢 **Segurança ok:** legado read-only; credenciais por env; erros sanitizados.

---

## Plano de ataque (em camadas: Arquitetura → Integrações → UI)

### Camada 1 — Arquitetura
- A1. Decidir a estratégia do read-model: **cron de sync** (ex.: 10-15 min) para o
  read-model ficar fresco e o poll servir do cache barato (resolve o 🔴 custo + a
  staleness). *(cron/env = precisa de OK do Lucas.)*
- A2. Tirar o **mock como default** do `data.ts`/`AttendancePage`/`DeskPage`
  (estado inicial vazio/real em vez do `queueClients` mock).
- A3. Plano de pagamento do `@ts-nocheck` (começar pelos arquivos de cobrança;
  varredura TS2304 como gate).
- A4. Consolidação `guardian`↔`hades` (rotas/re-exports) — quando fizer sentido.

### Camada 2 — Integrações
- I1. Poda das tabelas snapshot do read-model (manter `is_current` + N histórico).
- I2. Asaas: reemissão de boleto vencido / disparo nativo (ou documentar handoff).
- I3. Robustez do pool legado sob concorrência (Hades + CACÁ juntos no MySQL 5).

### Camada 3 — UI
- U1. Remover/_substituir_ o mock do dashboard (`contracts` reais).
- U2. Auditar `WhatsAppConversationPanel` / copiloto IA (custo + correção).
- U3. Polimento das telas (consistência com o padrão Iris já remodelado).

---

Conclusão: o Hades está **funcional e seguro para cobrança via Iris** (fila real,
canal WhatsApp via Iris fiado, legado read-only). Os bloqueadores reais para
"Hades full" são o **cron do read-model** (custo+freshness) e o **mock do
dashboard**; o resto é dívida/otimização. Ataque em camadas: começar pela
Arquitetura.
