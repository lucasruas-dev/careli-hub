# Hades — Plano de execução da UI (por tela)

Status: `EM EXECUCAO` · Data: 2026-06-25 · Driver: Zeus (Lucas aponta, Zeus implementa)
Branch: `feat/iris-caca-port` · Validação: preview por lote.

## Navegação (global)
- [ ] **N1. Reexibir as demais telas do Hades** (foram ocultadas a pedido; agora liberar).
  Hoje o menu mostra só Dashboard + Cobrança; voltar as outras (Inteligência, Monitoramento...).

## Tela: Dashboard (`app/guardian/page.tsx`)
- [ ] **D1. Composição da cobrança** — hoje o gráfico conta TODAS as parcelas; no Hades
  precisa contar **só as vencidas**.
- [ ] **D2. Remover o painel "Iris"** (Tickets abertos/SLA/etc.) do dashboard.
- [ ] **D3. Remover o painel "Workflow"** do dashboard.
- [ ] **D4. "IA operacional" → inteligência da operação (overview, não preditivo):**
  - Aging da inadimplência: além da visão por **parcelas** (já existe), adicionar a visão
    por **cliente** (clientes distintos por faixa de atraso).
  - **Top 15 clientes inadimplentes** (por valor em aberto: cliente, empreendimento,
    parcelas, valor, maior atraso).
  - Zeus pode **sugerir** mais indicadores úteis (ex.: maior exposição, nº com Asaas).
  - ⚠️ Nada de preditivo aqui — isso fica na tela **Inteligência**. Dashboard = overview.
- Referência: relatório Excel do Lucas "Clientes com parcelas vencidas > 60 dias"
  (aging por faixa, top clientes por valor, por empreendimento, maior exposição, nº c/ Asaas).

## Tela: Cobrança (`/hades/cobranca`)
- (a pontuar — próxima rodada)

## Tela: Inteligência
- (futuro — cenários preditivos, mais inteligência; separado do Dashboard)
