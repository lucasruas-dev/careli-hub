-- ✅ APLICADA em produção em 2026-08-05 (OK explícito do Lucas).
--
-- OVERRIDE DA COORDENAÇÃO no crédito reprovado — PROBLEMA 3 (Lucas, 04/08).
--
-- Quando o crédito é REPROVADO no Serasa, a ficha trava em `apolo_esteira.etapa = 'revisao'`. A
-- coordenação pode, ainda assim, aprovar ("aprovado com restrição pela coordenação"). Esta tabela
-- é o RASTRO durável dessa decisão: quem aprovou, quando, por quê e — o que a auditoria exige — a
-- EVIDÊNCIA do de-acordo (o PDF/print do aval), guardada em `apolo_documents` e apontada aqui.
--
-- ⚠️ TABELA PRÓPRIA, não colunas em `serasa_consultas`. Dois motivos:
--   1. `serasa_consultas` é POR CHAMADA (uma linha por consulta) e não carrega `enterprise_id`; o
--      override é POR CAD, cuja chave desde a 0080/0081 é `(entity_id, enterprise_id)`. A
--      granularidade não bate.
--   2. O sync do C2X faz upsert substituindo `metadata` inteiro; manter o registro de decisão fora
--      de `apolo_entities.metadata` já é regra (ver 0057/0058/0059). Uma tabela própria segue essa
--      disciplina.
--
-- Enquanto esta migration não roda, o endpoint do override degrada com elegância: a evidência vai
-- para `apolo_documents` (que já existe), a decisão fica em `apolo_audit_events` (que já existe) e a
-- esteira destrava do mesmo jeito. Esta tabela só acrescenta o registro ESTRUTURADO da decisão.

create table if not exists public.apolo_credito_overrides (
  id uuid primary key default gen_random_uuid(),

  -- De QUAL CAD é a aprovação. O par casa com a chave da esteira desde a 0080/0081. `enterprise_id`
  -- é text (id do C2X), como em `apolo_esteira` (migration 0061). ON DELETE CASCADE em entity: se a
  -- ficha some, o override perde o sentido; a evidência em `apolo_documents` tem seu próprio ciclo.
  entity_id uuid not null references public.apolo_entities (id) on delete cascade,
  enterprise_id text not null,

  -- QUEM aprovou (coordenação: admin/leader). Guarda o id e o nome no momento da decisão — o nome
  -- porque `hub_users` pode mudar/sair, e o rastro tem que sobreviver a isso.
  aprovado_por uuid,
  aprovado_por_nome text,

  -- POR QUÊ. Texto livre do coordenador (ex.: "cliente com fiador", "acordo já quitado").
  motivo text,

  -- A EVIDÊNCIA do de-acordo (PDF/PNG/JPEG). Fica no bucket privado via `apolo_documents`; aqui só
  -- o ponteiro. ON DELETE SET NULL: apagar o documento não apaga o fato de que houve override.
  evidencia_doc_id uuid references public.apolo_documents (id) on delete set null,

  -- PARA ONDE destravou (prevenda | credenciado), pela regra do toggle `prevenda_habilitada` do
  -- empreendimento (PROBLEMA 1). Guardado para o rastro dizer o que a esteira fez na hora.
  destino text not null,

  created_at timestamptz not null default now()
);

-- Histórico da CAD, do mais novo para o mais antigo.
create index if not exists apolo_credito_overrides_cad_idx
  on public.apolo_credito_overrides (entity_id, enterprise_id, created_at desc);

alter table public.apolo_credito_overrides enable row level security;

-- Leitura para usuário autenticado; escrita só via service role (a rota do servidor). O recorte
-- por papel (só coordenação aprova) é feito na aplicação, como no resto do Apolo.
drop policy if exists apolo_credito_overrides_read on public.apolo_credito_overrides;
create policy apolo_credito_overrides_read
  on public.apolo_credito_overrides for select to authenticated using (true);

comment on table public.apolo_credito_overrides is
  'Override da coordenação em crédito reprovado (PROBLEMA 3, Lucas 04/08): quem aprovou, quando, por quê, a evidência (apolo_documents) e para onde a esteira destravou. Chave de negócio: (entity_id, enterprise_id).';
