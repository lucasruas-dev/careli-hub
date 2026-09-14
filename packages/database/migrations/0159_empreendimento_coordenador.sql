-- O COORDENADOR DE VENDAS DO EMPREENDIMENTO — a empresa que coordena AQUELE produto.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026: *"o coordenador pode vir preenchido, só vamos incluir se
-- precisar, vendedora também que vir"*. O quadro de assinatura pré-preenche cada papel a partir do
-- cadastro da PJ correspondente; a vendedora tinha onde morar (`vendedor_entity_id`, 0141) e o
-- coordenador não tinha coluna nenhuma.
--
-- ATENCAO 1: SÃO DUAS COISAS DIFERENTES, E O NOME QUASE AS JUNTOU. `coordenadora_entity_id` (0145)
-- é a COORDENAÇÃO DE VENDAS — a empresa que faz a gestão comercial da casa, hoje a GURGEL
-- LANÇAMENTOS, a mesma em 16 empreendimentos. `coordenador_entity_id`, esta coluna, é o COORDENADOR
-- DE VENDAS daquele empreendimento: LUNA, HUBER, ZALUZ, MATHEUS GUEDES… e ele muda de produto para
-- produto. Lucas: *"a coordenadora é a empresa que faz a gestão comercial, quando eu falo
-- coordenador de vendas é a pessoa que trabalha na coordenadora"*.
--
-- ATENCAO 2: O LEGADO JÁ SEPARAVA OS DOIS, e ninguém tinha percebido. Em `enterprises` do C2X,
-- `coordenador_id` é a coordenação (Gurgel) e `manager_id` é o coordenador do empreendimento — é o
-- `manager_id` que a tela do legado rotula "Coordenador de Vendas". Confundir os dois foi o que pôs
-- o FABRÍCIO (que ocupa um terceiro campo, `captivator_id`, o CAPTADOR) como representante da
-- coordenação no Panteon: o contrato sairia mandando assinar a pessoa errada.
--
-- ATENCAO 3: SEM FOREIGN KEY, como a 0141 e a 0145. `apolo_entities` recebe merge e arquivamento, e
-- uma FK rígida transformaria uma limpeza de cadastro em erro de gravação numa tela que não tem
-- nada a ver com isso. Id órfão vira "sem coordenador", que é a mesma lacuna visível de sempre.
--
-- ATENCAO 4: TODO COORDENADOR DE VENDAS É PJ (Lucas, no mesmo dia), então quem assina por ele é uma
-- PESSOA — o representante legal, pelo mesmo caminho da vendedora. Medido em 13/09/2026: dos 33
-- CNPJs de incorporador e coordenador do legado, 30 já existem em `apolo_entities` e apenas UM tem
-- representante legal cadastrado. A coluna resolve a metade do TEXTO do contrato (razão social,
-- CNPJ, endereço); a metade da ASSINATURA depende de alguém cadastrar quem assina.
--
-- Autorização do Lucas, 13/09/2026: *"tem o meu ok"*.

alter table public.apolo_enterprise_settings
  add column if not exists coordenador_entity_id uuid;

comment on column public.apolo_enterprise_settings.coordenador_entity_id is
  'O COORDENADOR DE VENDAS deste empreendimento (PJ). Nao confundir com coordenadora_entity_id, que e a COORDENACAO de vendas da casa. Ver ATENCAO 1 da migration 0159.';

create index if not exists apolo_enterprise_settings_coordenador
  on public.apolo_enterprise_settings (coordenador_entity_id)
  where coordenador_entity_id is not null;
