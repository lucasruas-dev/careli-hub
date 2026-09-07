-- 0139 · A CATEGORIA COMO RECORTE DO EMPREENDIMENTO
--
-- Lucas (07/09/2026), respondendo o que a categoria é: *"pode ser fase, condomínio e loteamento,
-- lotes caucionados, TUDO QUE EU PRECISAR TER UMA MINUTA ESPECÍFICA EU TENHO QUE TER COMO
-- CATEGORIA"*. E, sobre a motivação: *"pode ser os dois, tanto geográfica quanto comercial"*.
--
-- ⚠️ ISSO REDEFINE A CATEGORIA. Ela nasceu na 0111 como "agrupamento livre de PLANOS dentro do
-- empreendimento" — servia para separar os seis planos do JDG em internos e externos, e mais nada.
-- O que o Lucas descreve é outra coisa, maior e mais simples de explicar: a categoria é o RECORTE
-- DO EMPREENDIMENTO QUE TEM CONTRATO PRÓPRIO. O critério não é geográfico nem comercial — é
-- documental: se aquele conjunto de lotes assina um instrumento diferente, ele é uma categoria.
--
-- ⚠️ E ISSO FECHA A CADEIA QUE FALTAVA PARA GERAR CONTRATO:
--
--     unidade → categoria → planos da categoria → plano da venda → minuta
--
-- Até aqui a ponta esquerda não existia: a unidade não pertencia a recorte nenhum, e a regra do
-- Lucas (*"o que define qual minuta usar é o plano de pagamento"*) começava no meio da corrente.
--
-- ⚠️ NÃO É A "ETAPA" DO C2X, e ele foi explícito ao ser perguntado. O legado divide Lavra do Ouro em
-- LOS + LOU e Lagoa Bonita em LBF + LBR + LBP; isso continua sendo o que é, vindo de lá. A
-- categoria é nossa, e um lote pode estar numa etapa do legado e numa categoria daqui ao mesmo
-- tempo, sem que uma explique a outra.

-- ── HIERARQUIA ──────────────────────────────────────────────────────────────
--
-- *"eu posso criar uma subcategoria da categoria"*. Condomínio dentro de loteamento, fase dentro de
-- condomínio, caucionados dentro da fase — a profundidade é do negócio, não do modelo.
--
-- ⚠️ AUTORREFERÊNCIA COM `on delete restrict`, e não cascade: apagar uma categoria que tem filhas
-- levaria junto um pedaço da estrutura do empreendimento sem ninguém pedir. Recusar obriga a
-- desmontar de baixo para cima, que é como se desfaz uma árvore de propósito.
alter table public.temis_categorias
  add column if not exists categoria_pai_id uuid
    references public.temis_categorias (id) on delete restrict;

create index if not exists temis_categorias_por_pai
  on public.temis_categorias (categoria_pai_id)
  where categoria_pai_id is not null;

comment on column public.temis_categorias.categoria_pai_id is
  'A categoria acima desta. NULO = categoria de primeiro nivel no empreendimento.';

-- ⚠️ O NOME É ÚNICO POR EMPREENDIMENTO desde a 0111, e isso agora atrapalha: "Fase 1" pode existir
-- dentro do Condomínio A e dentro do Condomínio B do mesmo produto. A unicidade passa a ser por
-- PAI — dois irmãos não podem ter o mesmo nome, primos podem.
alter table public.temis_categorias
  drop constraint if exists temis_categorias_nome_por_empreendimento;

create unique index if not exists temis_categorias_nome_no_nivel
  on public.temis_categorias (workspace_id, enterprise_id, coalesce(categoria_pai_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nome));

-- ── A UNIDADE PERTENCE À CATEGORIA ──────────────────────────────────────────
--
-- *"isso tem que estar refletido no cadastro das unidades"*.
--
-- ⚠️ NULO É O ESTADO NORMAL, e não falta de cadastro: são 5.540 unidades vivas em 36
-- empreendimentos, e a esmagadora maioria não precisa de recorte nenhum — o empreendimento inteiro
-- assina a mesma minuta. Exigir categoria em todas transformaria uma regra de exceção em trabalho
-- de cadastro para todo mundo.
--
-- ⚠️ `on delete set null`: apagar a categoria não pode apagar o lote. O lote volta a ser do
-- empreendimento, que é o que ele era antes de alguém recortar.
alter table public.hercules_unidades
  add column if not exists categoria_id uuid
    references public.temis_categorias (id) on delete set null;

create index if not exists hercules_unidades_por_categoria
  on public.hercules_unidades (categoria_id)
  where categoria_id is not null;

comment on column public.hercules_unidades.categoria_id is
  'O recorte do empreendimento a que esta unidade pertence. NULO = segue a regra geral do produto.';
