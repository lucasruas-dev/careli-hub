-- 0141 — QUEM VENDE: a vendedora (incorporador/SPE) por categoria, com queda para o empreendimento.
--
-- Lucas, 07/09/2026, mandando a qualificacao real de um contrato: *"aqui e os dados do incorporador
-- ou spe, vai estar no sistema tambem"*. E o motivo de nao bastar prender isso ao empreendimento:
-- *"acho legal ter pois agora com as categorias, eu posso dentro de um mesmo empreendimento ter
-- dois vendedores"*.
--
-- A CADEIA DE LEITURA (a mesma da minuta, ver 0140):
--
--     unidade -> categoria -> vendedor_entity_id        o caso do recorte
--              \ sem categoria -> vendedor do empreendimento   o caso de todo dia
--
-- ATENCAO 1: A VENDEDORA E UMA `apolo_entities` PJ, e nao um cadastro novo. Razao social em
-- `legal_name`, CNPJ e natureza juridica em `apolo_esteira.ficha.empresa`, sede em `ficha.endereco`
-- — o MESMO caminho que a imobiliaria da venda ja usa. `apolo_incorporadores` (0083) existe para o
-- ACESSO ao portal (slug, logo, o que ele enxerga) e nao guarda CNPJ nem endereco; quando o
-- incorporador tiver ficha, e o `entity_id` dele que entra aqui.
--
-- ATENCAO 2: `on delete restrict`. Apagar a entidade que assinou os contratos de uma categoria
-- deixaria a categoria apontando para o vazio e o contrato seguinte sairia sem vendedora — sem erro
-- nenhum. Quem quiser apagar tem de trocar a vendedora antes.
--
-- ATENCAO 3: NULO E O ESTADO NORMAL nas duas colunas. Nenhum empreendimento tem vendedora
-- cadastrada hoje, e so o Lagoa Bonita tem categorias. O motor le a categoria, cai no
-- empreendimento, e sai vazio ate alguem preencher — que e exatamente o que as variaveis
-- `vendedora_*` do catalogo dizem (estao marcadas como PENDENTE em lib/temis/variaveis.ts).

-- ── A vendedora do recorte ───────────────────────────────────────────────────
alter table public.temis_categorias
  add column if not exists vendedor_entity_id uuid
    references public.apolo_entities (id) on delete restrict;

comment on column public.temis_categorias.vendedor_entity_id is
  'Entidade PJ (apolo_entities) que assina como VENDEDORA os contratos desta categoria. Nulo = usa a vendedora do empreendimento.';

create index if not exists temis_categorias_vendedor_idx
  on public.temis_categorias (vendedor_entity_id)
  where vendedor_entity_id is not null;

-- ── A vendedora padrao do empreendimento ─────────────────────────────────────
-- `apolo_enterprise_settings` e onde as outras configuracoes por empreendimento ja vivem
-- (gestao_carteira_percentual, taxa_cessao, os portoes de recepcao) e a chave e o enterprise_id do
-- C2X em texto — o mesmo tipo que o resto do Apolo usa.
alter table public.apolo_enterprise_settings
  add column if not exists vendedor_entity_id uuid
    references public.apolo_entities (id) on delete restrict;

comment on column public.apolo_enterprise_settings.vendedor_entity_id is
  'Entidade PJ (apolo_entities) que assina como VENDEDORA os contratos do empreendimento, quando a categoria nao define outra.';

create index if not exists apolo_enterprise_settings_vendedor_idx
  on public.apolo_enterprise_settings (vendedor_entity_id)
  where vendedor_entity_id is not null;
