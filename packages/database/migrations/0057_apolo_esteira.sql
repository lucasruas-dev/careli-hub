-- A esteira do Board sai do `metadata` e ganha tabela própria.
--
-- POR QUÊ (incidente 20/jul): a etapa era gravada em `apolo_entities.metadata.esteira`. O SYNC
-- DO C2X monta a entidade com `metadata: { profileNames, responsibleName }` e faz
-- `upsert(..., { onConflict: 'id' })` — o que SUBSTITUI o metadata inteiro. Resultado: as 122
-- CADs que vieram do "Finalizado" (entidades do C2X) perderam etapa, analista e empreendimento
-- na primeira rodada do sync depois da importação. O Lucas viu a coluna "Análise de crédito"
-- sumir do Board.
--
-- Qualquer coisa que o Apolo escreva no metadata de uma entidade sincronizada tem prazo de
-- validade: dura até o próximo sync. Isso vale para a esteira e valeria para qualquer campo
-- operacional futuro.
--
-- A correção MAIS SEGURA é esta: tabela separada, com `entity_id` como chave. Não exige mexer
-- no caminho que sincroniza ~4 mil entidades do legado (que seria o conserto arriscado), fica
-- imune ao upsert, e ainda dá índice de verdade para filtrar por etapa.

create table if not exists public.apolo_esteira (
  -- Uma linha por entidade: a esteira é o estado ATUAL dela no Board.
  entity_id uuid primary key
    references public.apolo_entities (id) on delete cascade,

  -- validacao | credito | revisao | prevenda | credenciado | correcao | indeferido
  etapa text not null default 'validacao',
  analista_id uuid,

  -- Dados da CAD de origem que o Board mostra na fila. Ficam aqui porque a entidade do C2X
  -- não tem onde guardá-los sem serem apagados.
  chegou_em timestamptz,
  corretor text,
  empreendimento text,
  imobiliaria text,

  -- De onde veio (asana/apolo) e por que está nesta etapa (motivo de recusa/correção).
  motivo text,
  origem text,

  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  created_at timestamptz not null default now()
);

create index if not exists apolo_esteira_etapa_idx
  on public.apolo_esteira (etapa, atualizado_em desc);
create index if not exists apolo_esteira_analista_idx
  on public.apolo_esteira (analista_id);

alter table public.apolo_esteira enable row level security;

drop policy if exists apolo_esteira_read on public.apolo_esteira;
create policy apolo_esteira_read
  on public.apolo_esteira for select to authenticated using (true);

-- Traz o que ainda existe em metadata.esteira (as 153 criadas no Apolo, que o sync não tocou).
-- As 122 do C2X já perderam o dado; elas são restauradas à parte, pela seção de origem
-- gravada em apolo_source_links.
insert into public.apolo_esteira (
  entity_id, etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria, origem,
  atualizado_em
)
select
  e.id,
  coalesce(e.metadata->'esteira'->>'etapa', 'validacao'),
  nullif(e.metadata->'esteira'->>'analistaId', '')::uuid,
  nullif(e.metadata->'esteira'->>'chegouEm', '')::timestamptz,
  nullif(e.metadata->'esteira'->>'corretor', ''),
  nullif(e.metadata->'esteira'->>'empreendimento', ''),
  nullif(e.metadata->'esteira'->>'imobiliaria', ''),
  coalesce(nullif(e.metadata->'esteira'->>'origem', ''), 'apolo'),
  coalesce(nullif(e.metadata->'esteira'->>'atualizadoEm', '')::timestamptz, now())
from public.apolo_entities e
where e.metadata ? 'esteira'
on conflict (entity_id) do nothing;
