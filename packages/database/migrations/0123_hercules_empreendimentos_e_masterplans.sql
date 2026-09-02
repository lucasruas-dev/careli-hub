-- O CADASTRO DE EMPREENDIMENTOS DO PANTEON — PAI E FILHOS — e os MASTERPLANS IMPORTADOS.
--
-- Lucas (02/09/2026): *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon (...)
-- uma das coisas que eu sei que vou querer é ter o empreendimento pai, e os filhos, por exemplo, eu
-- tenho o lagoa bonita pai Lagoa Bonita e eu tenho os filhos LBF - LBR - LBP. no Vale do Ouro (...)
-- o pai VLO, os filhos VOC - VOR - VOL (...) hoje eu não tenho esse agrupamento para o Vale do
-- Ouro, está todo solto, tem que unificar"*.
--
-- ⚠️ POR QUE É TABELA, E NÃO MAIS `ENTERPRISE_GROUPS` EM CÓDIGO. A lista fixa tem quatro grupos e
-- o Vale do Ouro nunca entrou nela — foi exatamente o que o Lucas viu solto na tela. Cadastro no
-- banco muda sem deploy, e é o que deixa o Hércules nascer com o pai já unificado.
--
-- ⚠️ O PAI É O ESPELHO, E É ONDE MORA TUDO. Lucas (02/09/2026): *"o espelho sempre será o pai,
-- porque lá que vai morar todos os registros, vendas"* · *"os filhos podem ter visões
-- segmentadas"*. As unidades e as vendas do Hércules ficam no PAI (o VLO 35, o LAB 31); o FILHO é
-- uma VISÃO por cima do mesmo conjunto — a gleba do Lino (VOL), a do Cecílio (VOC), a fase — com o
-- id do C2X que responde pela burocracia dele (contrato, financeiro). Errar o nível faz o
-- incorporador ver a carteira do vizinho — ver a memória reference_empreendimento_divisoes_niveis.
-- Filho é OPCIONAL: o Garden é pai sem filho.
--
-- ⚠️ O MASTERPLAN É IMPORTADO, NÃO CONSULTADO (*"não quero consultar c2x, quero importar"*). O SVG
-- vai para o bucket privado `apolo-documents` e a SITUAÇÃO de cada lote vem de `hercules_unidades`,
-- nunca do C2X. Versão nova nunca sobrescreve a anterior: o mapa que o cliente viu ontem continua
-- existindo. *"o que não tiver masterplan cadastrado pode até tirar o botão"* — sem linha aqui, o
-- botão some.

create table if not exists public.hercules_empreendimentos (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'careli',
  -- nulo = PAI. Preenchido = FILHO daquele pai. Um nível só, de propósito: três níveis é o
  -- que já confunde a esteira hoje (grupo × divisão).
  pai_id            uuid references public.hercules_empreendimentos (id) on delete restrict,
  codigo            text not null,
  nome              text not null,
  cidade            text,
  uf                text,
  -- O id do empreendimento no C2X. No PAI é o ESPELHO (LAB 31, VLO 35), de onde vêm as unidades;
  -- no FILHO é o empreendimento que responde pela burocracia daquela visão (VOC 37, VOL 36). Pai de
  -- grupo sem espelho no C2X (Lavra do Ouro) fica sem id: existe só no Panteon.
  c2x_enterprise_id text,
  -- os que estão VENDENDO hoje (os 11 com recepção de CAD). Inativo continua no cadastro para
  -- histórico e para o financeiro, mas não aparece para reservar.
  vendendo          boolean not null default false,
  ordem             integer not null default 0,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint hercules_empreendimentos_codigo_uk unique (workspace_id, codigo)
);

-- Um id do C2X aponta para UM cadastro só: o VLO 35 é o pai, e não existe mais "filho VLO" — o
-- histórico dele são as vendas do próprio pai. Dois cadastros com o mesmo id somariam a mesma
-- unidade duas vezes nos cards.
create unique index if not exists hercules_empreendimentos_c2x_uk
  on public.hercules_empreendimentos (workspace_id, c2x_enterprise_id)
  where c2x_enterprise_id is not null;

-- ── A VISÃO SEGMENTADA: a que filho cada unidade do pai pertence ─────────────
-- As unidades vivem no PAI (hercules_unidades.enterprise_id = o espelho). O filho é um recorte
-- delas: a coluna diz qual. Nulo = a unidade não está em nenhuma visão (pai sem filhos, ou ainda
-- não segmentada). Preenchida na importação, cruzando (quadra, lote) com as unidades do C2X da
-- divisão — é a mesma chave de cruzamento da Lagoa Bonita.
alter table public.hercules_unidades
  add column if not exists segmento_id uuid references public.hercules_empreendimentos (id) on delete set null;

create index if not exists hercules_unidades_por_segmento
  on public.hercules_unidades (segmento_id)
  where segmento_id is not null;

comment on column public.hercules_unidades.segmento_id is
  'O FILHO (visão segmentada) a que esta unidade do pai pertence. Nulo = sem segmento.';

-- Filho de filho não existe: o pai de um registro tem que ser raiz.
create or replace function public.hercules_empreendimento_pai_e_raiz()
returns trigger language plpgsql as $$
begin
  if new.pai_id is not null and exists (
    select 1 from public.hercules_empreendimentos p where p.id = new.pai_id and p.pai_id is not null
  ) then
    raise exception 'O pai de um empreendimento precisa ser raiz (um nível só).';
  end if;
  return new;
end $$;

drop trigger if exists hercules_empreendimentos_pai_raiz on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_pai_raiz
  before insert or update of pai_id on public.hercules_empreendimentos
  for each row execute function public.hercules_empreendimento_pai_e_raiz();

alter table public.hercules_empreendimentos enable row level security;

comment on table public.hercules_empreendimentos is
  'Cadastro de empreendimentos do Panteon: o PAI é o espelho e guarda unidades, masterplan, reserva e vendas; o FILHO é uma visão segmentada (gleba, fase, dono) com o id do C2X da burocracia dele.';
comment on column public.hercules_empreendimentos.vendendo is
  'Está à venda hoje. Só estes aparecem para reservar; inativo fica para histórico/financeiro.';

-- ── MASTERPLANS IMPORTADOS ────────────────────────────────────────────────────
create table if not exists public.hercules_masterplans (
  id                 uuid primary key default gen_random_uuid(),
  empreendimento_id  uuid not null references public.hercules_empreendimentos (id) on delete cascade,
  versao             integer not null,
  -- objeto no bucket `apolo-documents`: hercules-masterplans/<codigo>/v<versao>.svg
  svg_path           text not null,
  -- quantos `inkscape:label` de lote o arquivo tem; conferido na importação contra hercules_unidades.
  lotes              integer not null default 0,
  bytes              integer not null default 0,
  -- só a versão PUBLICADA aparece na tela; as outras ficam para voltar atrás.
  publicado_em       timestamptz,
  publicado_por      text,
  observacao         text,
  criado_em          timestamptz not null default now(),
  constraint hercules_masterplans_versao_uk unique (empreendimento_id, versao)
);

-- Uma versão publicada por empreendimento: duas seria a tela escolher pela ordem do banco.
create unique index if not exists hercules_masterplans_uma_publicada
  on public.hercules_masterplans (empreendimento_id)
  where publicado_em is not null;

alter table public.hercules_masterplans enable row level security;

comment on table public.hercules_masterplans is
  'SVG do masterplan IMPORTADO (bucket apolo-documents), versionado. A situação do lote vem de hercules_unidades, não do arquivo nem do C2X.';
