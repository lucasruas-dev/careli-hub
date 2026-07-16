# Handoff — Apolo: CRUD de cadastro (MOST) + aba Documentos — 2026-07-15

Prompt de partida pro próximo Zeus. Leia isto + `CLAUDE.md` + a memória (`MEMORY.md`) e pegue o fio.

## Quem você é
Zeus do Panteon (Careli Hub). Lucas decide, valida visualmente, itera rápido, PT-BR direto. Raciocine em PT-BR. Deploy/Supabase/migration = **operação sensível, exige OK explícito do Lucas a cada vez**.

## O que ACABOU de ir pra produção (não mexer sem motivo)
**v1.40.0 — Apolo CRM 360** (deploy c2x.app.br, commit `1e756c62`, rollback `40100d11`/v1.39.0). Nesta frente entregamos e deployamos:
- **Carteira por papel** (incorporador/imobiliária/corretor/comprador) com drill-down — `lib/apolo/carteira.ts` (`loadApoloCarteiraScoped`), `modules/apolo/blocks/crm/scoped-portfolio-panel.tsx`.
- **Financeiro = Extrato por participante** (split real via `split_data.fixedValue` do Asaas) — `lib/apolo/extrato.ts`, `statement-panel.tsx`, rota `/api/apolo/extrato`.
- **Histórico (ficha corrida)** — agrega venda/pagamento/Iris/Hades/Chronos + manual, por identidade multi-chave — `lib/apolo/timeline.ts`, `entity-timeline-panel.tsx`, rota `/api/apolo/timeline` (GET+POST). Ver [[project_apolo_timeline]].
- Fixes: tela de Empreendimentos (race), navegação por aba, reversão do esconder de abas, lista recolhível.

## Frente ATIVA (é o que você continua)
**Habilitar CRUD de cadastro dentro do Apolo, com a MOST (MOSTQI) como MOTOR PRINCIPAL.** Hoje o Apolo é read-only sobre o C2X. Direção do Lucas:
- **Apolo é o cadastro-mãe** — nem toda entidade tem C2X (ex.: fornecedor só existe no Apolo). Ter `c2xId` é exceção qualificada (quem entra em proposta/venda). Ver [[project_apolo_acessos_externos]], [[project_apolo_timeline]].
- **MOST é o motor**: o operador dá o documento (ou CPF/CNPJ) → MOST faz **iOCR** (`extractDocument`) + **enriquecimento** (`enrichPerson`) → preenche a ficha → operador revisa → salva. `lib/apolo/mostqi.ts` já pronto (simulado em dev, real em prod). MOST **cobra por consulta** (decidir quando disparar o enrich — PENDENTE).
- **Estratégia acordada**: **finalizar primeiro o cadastro de PROSPECT** (já avançado) e ele vira a **referência** pros demais.

### Estado do cadastro (o wizard)
- `modules/apolo/blocks/cadastro/cadastro-flow.tsx` (2066 linhas) — wizard COMPLETO: PF (prospect) **e PJ (fornecedor, com QSA)**; etapas Identificação → Endereço → [Certidão] → Revisão; MOST alimenta os campos; na Revisão já **gera o PDF do CAD**.
- **O que falta pra "finalizar":** a função `enviar()` (dentro de `StepRevisao`, ~linha 1447) é **placeholder** — só faz `setEnviado(true)`, **NÃO PERSISTE**. É o "fechar o ciclo".
- `/api/apolo/cadastro/route.ts` já faz OCR+enrich → devolve a ficha, mas **não salva**.

### Banco: PRONTO pra receber escrita (verificado)
- `apolo_entities`: `id` gera sozinho (`gen_random_uuid`), obrigatório só `entity_kind`+`display_name`, `status` nasce em `review`, `metadata` (jsonb) pra `source:apolo`/`c2xSynced:false`, `owner_user_id` pra auditoria. As 17 tabelas `apolo_*` cobrem o modelo.
- **Sem triggers**: a app popula tudo (índice `apolo_search_entries`, hash do doc em `apolo_entity_identifiers.value_hash`). Criar entidade = escrever coordenadamente em várias tabelas (é o que o sync já faz).
- **RLS = só leitura** (authenticated SELECT). Escrita via **service role** nas rotas (precedente: `/api/apolo/relationships/create`).

## Aba DOCUMENTOS (o passo que estava em curso quando pausamos)
Decisão do Lucas: **antes de fechar o salvamento**, criar a aba **Documentos** no CRM (ficha da entidade) E no **Empreendimento**. Docs do MOST caem automaticamente na aba (arquivo + `extracted_payload`).

### JÁ FEITO (preservado na branch `feat/apolo-documentos`, commit `8befd997`)
- **INFRA aplicada EM PROD** (migration `0050_apolo_documents.sql`): bucket **privado** `apolo-documents` + tabela **`apolo_enterprise_documents`** (docs de empreendimento por `enterprise_code`; o empreendimento é do C2X, não é apolo_entity). `apolo_documents` (entidade) já existia com `storage_bucket`/`storage_path`/`extracted_payload`.
- **`lib/apolo/documentos.ts`** — camada de serviço: `uploadApoloDocument`, `listApoloDocuments`, `getApoloDocumentSignedUrl`, `deleteApoloDocument`. Genérica por scope (`entidade` → apolo_documents / `empreendimento` → apolo_enterprise_documents). Arquivo no bucket privado, leitura por **signed URL** via service role. Typecheck limpo.

### FALTA (seu próximo passo, em ordem)
1. **Rotas**: `/api/apolo/documentos` (GET list por `entityId`/`enterprise`; POST upload) e `/api/apolo/documentos/[id]` (GET → signed URL / abrir; DELETE). Auth via `authorizeApoloRead`; adminClient via `createApoloAdminClient`. Autor = `hub_users.display_name` do `authorization.userId`.
2. **Aba Documentos no CRM**: adicionar `{ id:"documentos", label:"Documentos" }` em `crm-tabs.ts` (`apoloTabs`); plugar no `TabPanel` do `record-workspace.tsx`. O `DocumentsPanel` já existe (`panels.tsx:1190`) mas é **só leitura** — ampliar com **upload (drag-drop)** + lista real (via a rota) + abrir/remover.
3. **Aba Documentos no Empreendimento**: em `empreendimentos-view.tsx` (detalhe do empreendimento), por `enterprise_code`.
4. **DEPOIS — fechar o salvamento do cadastro**: `createApoloEntity` (camada de serviço) que pega a ficha do wizard e grava coordenadamente: `apolo_entities` (+source:apolo, c2xSynced:false, owner=operador, status review) + contatos + endereço + papéis (`apolo_entity_profiles` = prospect) + identificadores (CPF/CNPJ hasheado) + `apolo_search_entries`; cônjuge/imobiliária → `apolo_relationships`. Rota POST. O `enviar()` do wizard passa a chamar. **Conectar MOST→docs**: guardar o arquivo lido no cadastro (upload) + `extracted_payload`.
5. **DEPOIS — estender**: PJ/fornecedor, cadastro sem documento (só CPF/CNPJ), e **edição** de entidade existente.

## Git / estado
- `main` = produção (v1.40.0). Branch local atual: **`feat/apolo-documentos`** (commit `8befd997`, WIP dos documentos — NÃO deployado).
- Stash guardado: `pulsex-wip-nao-desta-frente` (mudanças de outra frente, não mexer).
- Migration `0050` **já aplicada em prod** — não re-aplicar; o arquivo está versionado na branch.

## Regras que o Lucas reforçou nesta sessão (memória atualizada)
- Timeline/Histórico = **exaustividade** (registrar TODO evento, não lista curada). Nome da aba: **Histórico**.
- Ação/verbo do evento segue a **perspectiva** da entidade (comprador → "Pagamento realizado").
- Hora real: pagamento só tem data no C2X (hora via `updated_at` quando é o mesmo dia = webhook Asaas); fuso `America/Sao_Paulo`.
- Contratos "entre módulos" = integração (o **chip** `apolo_entity_id` universal é a frente seguinte; hoje casamos por identidade multi-chave).

## Primeiro movimento sugerido
Construir as **rotas de documentos** (item 1) + a **aba Documentos no CRM** (item 2), rodar em localhost pro Lucas validar o upload/lista, e emendar no Empreendimento. Só então o salvamento do cadastro.
