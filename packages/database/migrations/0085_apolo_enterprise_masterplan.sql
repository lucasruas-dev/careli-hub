-- Apolo: o MASTERPLAN de cada empreendimento, para o portal do incorporador abrir do card.
--
-- Hoje os masterplans existem como paginas estaticas publicadas
-- (/garden/masterplan.html, /masterplans/vale-do-ouro.html), cada uma nascida de um SVG
-- vetorizado. O card de Produtos precisa saber para onde levar, e essa informacao e' do
-- EMPREENDIMENTO — nao do incorporador, nem do vinculo entre os dois: o mesmo mapa serve para
-- quem for que enxergue aquele empreendimento.
--
-- Por isso a coluna mora em apolo_enterprise_settings, a tabela que ja' guarda o que e' por
-- empreendimento (o `credenciamento_ativo` da 0052). Nulo = sem mapa publicado, e o botao do
-- card fica desligado em vez de levar a lugar nenhum.
--
-- ⚠️ Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists masterplan_url text;

comment on column public.apolo_enterprise_settings.masterplan_url is
  'Endereco do masterplan publicado deste empreendimento (ex.: /masterplans/vale-do-ouro.html). Nulo = sem mapa, botao desligado no card.';
