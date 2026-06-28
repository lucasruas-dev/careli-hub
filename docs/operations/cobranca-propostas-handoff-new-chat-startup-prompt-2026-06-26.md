# Handoff — Cobranca: Propostas Fase 2 + deploy — startup prompt p/ o proximo Zeus

> Gerado em 2026-06-26 ao fim de uma sessao MUITO longa (motor da Cobranca de manha + redesign tela-a-tela da Cobranca + Propostas Fase 1 a tarde). Use como prompt de abertura da sessao nova.

## §1 — Ritual de abertura (faca primeiro)
Voce e o **Zeus** (agente central do Panteon/Careli Hub). Antes de tocar em codigo:
1. Leia `CLAUDE.md` (cerebro) e `AGENTS.md` (operating model) na raiz do `careli-hub`.
2. Leia a memoria: `MEMORY.md` e principalmente [[project_cobranca_motor_ui]], [[project_hades_cobranca_design]], [[project_security_lockdown]], [[feedback_preview_preautorizado]], [[feedback_lucas_does_clicks]], [[feedback_ui_icones_pouco_texto]].
3. Leia o fim do diario `docs/operations/engineering-operations.md` (entradas de 26/jun, em especial "Cobranca: redesign tela-a-tela + motor de Propostas (Fase 1)").
4. **Idioma: sempre pt-BR.** Lucas valida **visualmente** (manda prints), e direto, pragmatico, itera rapido.
5. **🛑 BLOQUEIO:** nada de **deploy go-live (alias)/migration/Supabase/env/secret/token/dominio** sem **OK explicito do Lucas, a cada vez**. **EXCECAO: previews `--skip-domain` sao PRE-AUTORIZADOS** (pode gerar direto; ver [[feedback_preview_preautorizado]]). Nunca mover `ops.c2x.app.br`. Legado C2X = read-only (credenciais NO `.env.local`, da pra inspecionar schema read-only sem ecoar credencial).

## §2 — Estado atual (o que esta no ar e o que NAO esta)
- **Producao `c2x.app.br` = v1.6.3** (`careli-hub-hub-i2bs-jur4gvue9`). **NADA da Cobranca de hoje foi pra prod** — esta tudo em PREVIEW.
- **Ultimo preview da Cobranca:** `https://careli-hub-hub-i2bs-q5e69k9ao-lucasruas-devs-projects.vercel.app`. (Use o codigo da Vercel pra rollback/comparar.)
- **Migration 0036** (motor: `guardian_compromissos`/`_parcelas`/`_lembretes` + protocolo PR/AC) **ja em prod**. **Migration 0037 NAO existe ainda** (e a Fase 2).
- **main** ainda NAO tem o trabalho de hoje (esta tudo local/preview). Decidir com Lucas: commitar na main + deploy quando a Fase 2 fechar.
- **Dado de teste:** ha compromissos de teste (AC-000002/AC-000004/PR-000001/PR-000003 e outros) gravados no **Supabase de PROD** (o preview usa o Supabase de prod). **Limpar antes do go-live.**

## §3 — O que foi feito hoje (preview), por arquivo
- **`modules/guardian/attendance/components/ClientDetailPanel.tsx`** (@ts-nocheck): abas reordenadas (Visao geral·Cliente·Carteira·Propostas·Timeline); Visao geral estrategica (faixa topo + Cockpit unificado regra/IA + Workflow com Editar->popup+motivo+log Manual/Auto + Ultimos eventos); Cliente (icone UserRound, Documentos so Contrato D4Sign); **Carteira abre direto em Parcelas** (sem submenu, aside sticky, selecao por **matricula**, mantem subtab ao trocar unidade). Componentes orfaos (AgreementsCenterCard, SubtabNav, renderUnitSubtab, RiskTab, DocumentsTab, ExecutiveCockpit, CommitmentOverviewCards, AiExecutiveCard, UnitScopeControl, RecoveryFocus) ficaram DEAD CODE (limpar depois).
- **`modules/guardian/attendance/components/PropostasPanel.tsx`** (NOVO, **tipado**): a aba Propostas ligada ao motor (lista GET + forms promessa/acordo + POST + editar via PUT). Forms: promessa(parcela+data), acordo(parcelas->original; Desconto/Juros/Multa %|R$ ->valor do acordo; A vista/Parcelado com entrada + tabela editavel; ultima parcela absorve centavos; **valores com virgula**; total verde/vermelho bloqueia envio). Estado de aprovacao em `metadata.approval_status='pendente'`.
- **`lib/guardian/compromissos.ts`**: `+replaceGuardianCompromissoDraft` (update de proposta pendente: regrava + substitui parcelas/lembretes), Update type expandido.
- **`app/api/guardian/compromissos/route.ts`** (`parseCreatePayload` agora exportado) + **`/[id]/route.ts`** (+`PUT` p/ replace).
- **`lib/guardian/attendance.ts`** (estrito): query traz `reference_date` (Competencia) e `parcelNumber` traz o **tipo correto** (1=Ato/2=Sinal/3=Parcela/4=Avulso; Sinal usa current_signal_parcel/total_signal_parcels). `InstallmentsCard.tsx` parou de prefixar "Parcela" fixo.
- **`read-model.ts` + `data.ts`**: todos os clientes entram em **"A acionar"** (fim da derivacao de estagio por dias de atraso).
- **`modules/guardian/attendance/AttendancePage.tsx`** (@ts-nocheck): botao recolher fila no topo-direito do `QueuePanel`.

## §4 — Sua tarefa: Fase 2 das Propostas + fechar a frente
1. **Migration 0037** (precisa OK do Lucas): colunas de aprovacao em `guardian_compromissos` (`approval_status` em_elaboracao|pendente|aprovado|reprovado, `approved_by_user_id`->hub_users, `approval_reason`, `submitted_at`, `approved_at`) + tabela **`guardian_compromisso_comments`** (compromisso_id FK, author_user_id, body, created_at; RLS por papel). Promover o `metadata.approval_status` (Fase 1) pra coluna real. Financeiro (juros/multa/desconto/entrada/forma) pode ficar no metadata.
2. **Central do gestor = 3o icone da tela** (hoje "Acordos feitos" / `AgreementsPanel`): lista TODAS as propostas (todos os clientes) pendentes, **aprovar/reprovar com motivo obrigatorio** (**so Admin**), **thread de comentarios**. Rota PATCH de aprovacao (status + approved_by + reason).
3. **Execucao pos-aprovacao:** promessa aprovada = regua + link; acordo aprovado = aguardando emissao -> operador aponta faturas -> C2X emite -> enviado. Liga na **regua** (cron ja existe) + no **disparo Iris** (template com 3 botoes: Receber boleto->CACA, Negociar/Falar->operador). **Templates Meta: um por acao, criar (Lucas clica no Setup->Templates ou cria via API com OK).**
4. **Disparo em grupo** (aba na fila): multiselecao + filtros + "todas as vencidas" por cliente + confirmacao/throttle/dedup. (Desenhado, nao construido — ver [[project_cobranca_motor_ui]].)
5. **Limpeza + deploy:** remover o dead code da reforma; limpar compromissos de teste do Supabase prod; **commit na main + deploy prod** de toda a frente (com OK do Lucas + bloco copiavel pro grupo — [[feedback_deploy_team_message]]).

## §5 — Regras de ouro / pointers
- **Deploy:** `npm --prefix apps/hub run check-types` (limpo) -> preview `npx vercel deploy --prod --skip-domain --yes --scope lucasruas-devs-projects` (env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`). **Previews pre-autorizados.** Go-live (`alias c2x.app.br`) so com OK.
- **Armadilha @ts-nocheck:** ao editar arquivos @ts-nocheck e adicionar prop/identificador, o tsc NAO pega refs indefinidas (quebra em runtime — caso `onCollapse`). **Sempre rodar varredura TS2304** (strip temporario do @ts-nocheck + `tsc`) nos arquivos editados antes do deploy.
- **Vercel as vezes falha o deploy por hiccup transitorio** ("npm install ... package.json" / "Not authorized") mesmo com build OK — **so reenviar**.
- **Auth das rotas:** `authorizeHadesRead`/`authorizeHadesWrite` (Bearer Supabase no header). O front manda o Bearer via `getHubSupabaseClient().auth.getSession()`.
- **Cobranca e por CLIENTE, nao por parcela.** Acordo pode juntar parcelas de varias unidades.
