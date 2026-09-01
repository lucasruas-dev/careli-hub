-- TEMIS — MINUTAS
--
-- Pedido do Lucas (01/09/2026): *"vou liberar para o time já subir a minuta e editar"*. É a peça
-- que precisa estar de pé hoje.
--
-- ⚠️ VERSÃO PUBLICADA É IMUTÁVEL. Editar não altera a versão publicada: cria a próxima. É o que
-- torna possível, daqui a oito anos, reproduzir exatamente o contrato que a pessoa assinou — o
-- padrão do "answer file" do HotDocs, que é a referência do setor. Sem isso, alguém corrige uma
-- vírgula em 2028 e o contrato de 2026 deixa de existir como foi assinado.
--
-- ⚠️ O CONTEÚDO VIVE EM DOIS FORMATOS, e os dois importam:
--   • `conteudo` (jsonb) é o documento do editor, a fonte de edição;
--   • `conteudo_html` é o mesmo documento renderizado, que é o que vai para a geração do contrato
--     e para o PDF. Guardar os dois evita depender do editor para gerar um contrato — se um dia
--     trocarmos de editor, o HTML das minutas publicadas continua servindo.
--
-- ⚠️ A MINUTA PERTENCE AO EMPREENDIMENTO, e o VÍNCULO COM O PLANO é que decide qual usar na venda
-- (regra do Lucas: "o que define qual minuta usar é o plano de pagamento"). O vínculo mora em
-- `temis_planos.minuta_id` e não aqui, porque um mesmo texto pode servir a mais de um plano — é o
-- caso do ACP, cujos três planos apontam para a mesma minuta.

create table if not exists public.temis_minutas (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text        not null default 'careli',
  enterprise_id text        not null,

  nome          text        not null,
  descricao     text,

  -- contrato | pa | aditivo | distrato — o Temis vai gerar mais que contrato.
  tipo          text        not null default 'contrato',

  -- rascunho | publicada | arquivada
  situacao      text        not null default 'rascunho',
  versao        integer     not null default 1,
  -- Aponta para a versão anterior, formando a linha do tempo da minuta.
  versao_anterior_id uuid   references public.temis_minutas (id) on delete set null,

  conteudo      jsonb,
  conteudo_html text,

  -- O arquivo que o loteador entregou, guardado como veio. É a prova do que foi recebido, e a
  -- entrada do agente de absorção.
  origem_arquivo_nome text,
  origem_storage_path text,

  -- As variáveis encontradas no texto, para a tela avisar o que a minuta exige antes de publicar.
  variaveis     jsonb       not null default '[]'::jsonb,

  publicada_em  timestamptz,
  publicada_por uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid,

  constraint temis_minutas_tipo check (tipo in ('contrato', 'pa', 'aditivo', 'distrato')),
  constraint temis_minutas_situacao check (situacao in ('rascunho', 'publicada', 'arquivada')),
  constraint temis_minutas_versao_positiva check (versao > 0),
  -- Publicada sem conteúdo seria uma minuta que gera contrato em branco.
  constraint temis_minutas_publicada_tem_conteudo
    check (situacao <> 'publicada' or conteudo_html is not null)
);

create index if not exists temis_minutas_por_empreendimento
  on public.temis_minutas (workspace_id, enterprise_id, situacao, atualizado_em desc);

-- ⚠️ UMA PUBLICADA POR NOME. Duas versões publicadas do mesmo documento fariam a geração escolher
-- por sorteio. Publicar a v2 arquiva a v1 — a v1 continua existindo (os contratos antigos apontam
-- para ela), só deixa de ser a vigente.
create unique index if not exists temis_minutas_publicada_unica
  on public.temis_minutas (workspace_id, enterprise_id, nome)
  where situacao = 'publicada';

-- O vínculo que decide a minuta na hora da venda.
alter table public.temis_planos
  add column if not exists minuta_id uuid references public.temis_minutas (id) on delete set null;

create index if not exists temis_planos_minuta on public.temis_planos (minuta_id) where minuta_id is not null;

alter table public.temis_minutas enable row level security;

comment on table public.temis_minutas is
  'Temis: modelo de contrato do empreendimento. Versão publicada é imutável; editar cria a próxima.';
comment on column public.temis_minutas.conteudo is
  'Documento do editor (fonte de edição). O conteudo_html é o que gera o contrato.';
comment on column public.temis_minutas.origem_storage_path is
  'O arquivo original entregue pelo loteador, guardado como veio.';
