-- 0180 — QUEM ASSINA OS TERMOS PELA VENDEDORA: um quarto papel no quadro de assinatura.
--
-- Lucas (20/09/2026), depois de ver que o envio do termo de acordo exige uma pessoa física pela
-- vendedora: *"essa tela determina os assinantes, vamos ter o comprador e a vendedora, então temos
-- uma fonte de busca para quem vai assinar os acordos. (nessa tela vc pode abrir mais um campo para
-- assinatura de termos vendedora, ae eu posso apontar quem vai assinar os termos, não precisa
-- necessariamente ser os representantes legais, pode ser o juridico, analista, enfim)"*.
--
-- ✅ APLICADA EM PRODUÇÃO em 20/09/2026, com OK do Lucas ("tem o meu ok"), ANTES do código.
-- Conferido depois: o CHECK aceita os quatro papéis (pg_get_constraintdef).
--
-- ATENÇÃO 1: O PAPEL É NOVO PORQUE A PERGUNTA É OUTRA. `vendedora` responde "quem assina o CONTRATO
-- de venda pela empresa" — é uma linha da qualificação do papel impresso, e o jurídico confere o
-- nome dela contra a procuração. `termos_vendedora` responde "quem a empresa apontou para assinar
-- os TERMOS que a Careli emite sobre a carteira dela" (hoje o termo de acordo; amanhã os outros).
-- Lucas foi explícito: *"não precisa necessariamente ser os representantes legais, pode ser o
-- juridico, analista"*. Enfiar essa pessoa em `vendedora` a poria, no mesmo instante, dentro do
-- envelope e da qualificação de TODO contrato daquele empreendimento — um analista assinando a
-- compra e venda no lugar de quem tem poderes para isso.
--
-- ATENÇÃO 2: SÓ O CHECK MUDA. A tabela, os índices, a RLS e as colunas são os da 0158: a `posicao`
-- continua única DENTRO do papel (vendedora 1 e termos_vendedora 1 convivem, são documentos
-- diferentes), `ordem_assinatura` continua opcional e `origem` continua distinguindo a linha
-- digitada da herdada do cadastro da PJ. Um papel a mais numa lista de valores permitidos é a
-- mudança mais barata que existe aqui, e é a razão de o quadro ter nascido como UMA tabela com uma
-- coluna `papel` em vez de três tabelas com a mesma forma (ver a 0158).
--
-- ATENÇÃO 3: O CÓDIGO SOBE ANTES DESTA MIGRATION, E ELE SABE DISSO. A LEITURA do quadro não filtra
-- por papel: sem a migration a consulta é a mesma e devolve zero linha do papel novo, que é o certo
-- (não há nenhuma). A ESCRITA é que esbarra no check — o Postgres recusa com `23514`, e
-- `incluirAssinante` traduz esse código para uma frase que NOMEIA esta migration, do mesmo jeito que
-- o envio do acordo nomeia a 0179. O que não pode acontecer é o operador cadastrar, ver "não foi
-- possível gravar" e não saber que o defeito é de banco, não do que ele digitou.
--
-- ATENÇÃO 4: NÃO HÁ BACKFILL, E ISSO É MEDIDO. `temis_assinantes` tem ZERO linhas em produção
-- (medido em 20/09/2026), e ZERO das 23 incorporadoras distintas de `apolo_enterprise_settings` tem
-- representante legal em `apolo_relationships`. Não há o que converter: toda linha deste papel vai
-- nascer digitada, depois desta migration.
--
-- ATENÇÃO 5: O CONTRATO NÃO ENXERGA ESTE PAPEL, E A GARANTIA É DE CÓDIGO, NÃO DE BANCO.
-- `lib/assinatura/quadro-db.ts` traduz a linha do quadro para o papel do contrato por um mapa
-- (`PAPEL_DO_QUADRO`) e DESCARTA o que não está nele; `termos_vendedora` não entra no mapa, não
-- entra em `PapelNoContrato` e, por isso, não entra no envelope do contrato, na ordem de assinatura
-- nem na tela de categorias. Um teste prende as três coisas.

begin;

alter table public.temis_assinantes drop constraint if exists temis_assinantes_papel;
alter table public.temis_assinantes
  add constraint temis_assinantes_papel
  check (papel in ('coordenador', 'termos_vendedora', 'testemunha', 'vendedora'));

comment on column public.temis_assinantes.papel is
  'vendedora | coordenador | testemunha | termos_vendedora. Os tres primeiros assinam o CONTRATO de venda (ver ATENCAO 1 e 5 da 0158). O quarto assina os TERMOS que a Careli emite sobre a carteira (termo de acordo do Hades) e NAO entra no contrato - ver ATENCAO 1 da 0180.';

commit;
