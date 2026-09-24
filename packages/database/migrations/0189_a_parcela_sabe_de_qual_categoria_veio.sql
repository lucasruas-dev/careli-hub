-- A PARCELA DO LSOFT PASSA A GUARDAR DE QUAL CATEGORIA VEIO, e o espelho aceita os demais
-- empreendimentos.
--
-- Pedido do Lucas (24/09/2026): subir os demais empreendimentos para o LSoft Integração, e marcar a
-- categoria 17 com uma tag de patrimônio (*"ele deve estar vinculado ao empreendimento, mas ter uma
-- tag de patrimonio e que eu pudesse ver esse valor, ter filtros"*; o recorte é "toda a categoria
-- 17"). Autorização para aplicar: Lucas, 24/09/2026, *"tem o meu ok"*.
--
-- ⚠️ POR QUE A CATEGORIA, E NÃO O EMPREENDIMENTO, É A UNIDADE QUE A CARGA SUBSTITUI.
--   No LSoft a categoria 17 ("Vitor") carrega venda de vários produtos, com o produto só no texto
--   livre de OBSERVACOES. Medido em 24/09/2026: Vale do Sol, Guaimbê, Giant Towers e On Sky recebem
--   título da categoria PRÓPRIA e também da 17. A carga (lib/lsoft/carga.ts) grava antes de apagar
--   e apaga só o que veio nela; se a unidade fosse o empreendimento, carregar a 17 para trazer o
--   Guaimbê apagaria as 6.844 parcelas do Vale do Sol que vêm da 102, e com elas as baixas do
--   time, trocando-as pelas 761 da 17. Pela categoria, a carga da 17 só substitui a 17.
--
-- ⚠️ A MESMA COLUNA É A TAG DE PATRIMÔNIO. Patrimônio é "toda a categoria 17", decisão do Lucas.
--   Guardar a categoria de origem é guardar a tag, e ela vem do próprio LSoft a cada carga: não há
--   marca separada para cair fora de sincronia.
--
-- ⚠️ NULÁVEL DE PROPÓSITO. As 20.866 parcelas de hoje recebem a categoria pelo backfill abaixo; o
--   importador passa a gravá-la sempre. Um NOT NULL agora quebraria qualquer caminho de escrita que
--   ainda não mande o campo (ver a armadilha do upsert com NOT NULL na skill de migration).

begin;

-- ── 1. A coluna ─────────────────────────────────────────────────────────────
alter table public.lsoft_parcelas
  add column if not exists categoria_lsoft integer;

comment on column public.lsoft_parcelas.categoria_lsoft is
  'CATEGORIA do LSoft de onde a parcela veio (o "centro de custo"). É a unidade que a carga substitui, e 17 = patrimônio. NÃO é o empreendimento: a 17 mistura vários.';

-- ── 2. Backfill: tudo que está hoje veio de uma categoria só por empreendimento ─
-- Medido em 24/09/2026: Garden 13.401 (extrator com CATEGORIA=124), Vale do Sol 6.844 (102) e
-- Vale do Ouro - 2 621 (69, que o LSoft chama de "Loteamento José Lino"). Nenhuma parcela da 17
-- foi carregada até hoje, então não há ambiguidade.
update public.lsoft_parcelas set categoria_lsoft = 124 where empreendimento = 'Garden' and categoria_lsoft is null;
update public.lsoft_parcelas set categoria_lsoft = 102 where empreendimento = 'Vale do Sol' and categoria_lsoft is null;
update public.lsoft_parcelas set categoria_lsoft = 69 where empreendimento = 'Vale do Ouro - 2' and categoria_lsoft is null;

create index if not exists lsoft_parcelas_categoria_idx on public.lsoft_parcelas (categoria_lsoft);

-- ── 3. Os empreendimentos que o espelho aceita ──────────────────────────────
--
-- ⚠️ A LISTA CONTINUA EXPLÍCITA, e é proteção, não burocracia: a tela de boletos casa pelo nome
-- exato, e um acento de diferença devolve carteira vazia sem erro. Foi o que quase aconteceu em
-- 24/09 com "Guaimbê" (circunflexo) contra o "Guaimbé" (agudo) do catálogo. Com o CHECK, o nome
-- errado é recusado na gravação em vez de sumir da tela. Os nomes são os de lib/lsoft/categorias.ts,
-- que um teste prende ao catálogo de boletos.
--
-- ⚠️ "A classificar" é o balde dos títulos da 17 cujo texto não diz o produto (medido: 199 em
-- aberto, R$ 6,3 mi; galpões, salas em BH, veículos, e apartamentos sem o nome do prédio). Eles
-- precisam existir no espelho para o time classificar na tela; sem empreendimento, o importador os
-- descartaria em silêncio.
alter table public.lsoft_parcelas drop constraint if exists lsoft_parcelas_empreendimento_check;
alter table public.lsoft_parcelas add constraint lsoft_parcelas_empreendimento_check check (
  empreendimento = any (array[
    'Garden',
    'Vale do Sol',
    'Vale do Ouro - 2',
    'On Sky',
    'Guaimbé',
    'Giant Towers',
    'Ed. Cristal',
    'Ed. Rubi',
    'Ed. Jade',
    'Ed. Esmeralda',
    'Mirage Residence',
    'Manhattan',
    'A classificar'
  ]::text[])
);

commit;
