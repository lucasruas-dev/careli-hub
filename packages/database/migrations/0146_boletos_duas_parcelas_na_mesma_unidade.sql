-- DUAS COBRANÇAS NA MESMA UNIDADE, NO MESMO MÊS — a mensal e a entrada.
--
-- Pedido do Lucas (08/09/2026), sobre o Vale do Ouro - 2: *"Cria duas linhas vou verificar, ae se
-- for o caso fazemos emissão separado"*.
--
-- O caso concreto: LUCAS AGUIAR SOARES, unidade Q10 L03, competência 2026-09, tem DUAS parcelas
-- vencendo — a mensal de R$ 1.666,67 no dia 10 (parcela 2 de 60) e a ENTRADA de R$ 8.750,00 no dia
-- 20 (parcela 3 de 4). Só a primeira cabia na tabela, e a carga gravou nove das dez unidades da
-- carteira deixando essa de fora, listada, esperando decisão humana.
--
-- ⚠️ A TRAVA NÃO SAI, GANHA UM DISCRIMINADOR. `UNIQUE (workspace_id, empreendimento, unidade,
-- competencia)` é o que impede a mesma pessoa receber dois boletos do mesmo mês, e ela protege
-- carteiras muito maiores que esta: em setembro/2026 são 143 linhas no Garden, 103 no Vale do Sol,
-- 30 no Guaimbé, 22 no Giant Towers, 18 no On Sky, mais os quatro edifícios da CER. Afrouxar a
-- unicidade para caber um caso poria as outras a duplicar em silêncio — o upsert da carga mensal
-- passaria a INSERIR onde hoje ATUALIZA. O que muda aqui é o que a chave AFIRMA: de "uma cobrança
-- por unidade no mês" para "uma cobrança por unidade, mês e SEQUÊNCIA".
--
-- ⚠️ A SEQUÊNCIA É UM NÚMERO SEM SIGNIFICADO DE NEGÓCIO, E ISSO FOI MEDIDO ANTES DE ESCOLHER. O
-- candidato óbvio era `parcela_atual` (na do Lucas Aguiar são 2 e 3), e ele NÃO serve:
--   · `parcela_atual` é NULO em 9 das 4.094 linhas de `boletos_parcelas` (medido em 08/09/2026).
--     Nulo em UNIQUE não colide com nada no Postgres: a trava simplesmente deixaria de existir
--     exatamente nessas nove linhas, e ninguém veria;
--   · no espelho do LSoft, 342 grupos (753 linhas) têm DUAS parcelas do mesmo cliente e lote no
--     mesmo mês carregando o MESMO `parcela_numero`. O Garden, cliente 00000005, lote 367 quadra
--     13, traz "001/084" duas vezes em abril/2026, uma de R$ 1.130,95 e outra de R$ 2.261,90. Com
--     `parcela_atual` na chave, essas continuariam não cabendo — e o caso do Vale do Ouro teria
--     sido consertado só para a forma que ele tem hoje.
-- Uma sequência explícita não depende de o LSoft numerar direito. Ela só precisa ser distinta, e
-- quem a atribui é a carga.
--
-- ⚠️ `boletos_documentos` NÃO MUDA, E CONTINUA SENDO POR UNIDADE. O CPF é da PESSOA, não da
-- cobrança: as duas parcelas do Lucas Aguiar são do mesmo comprador, no mesmo lote, e apontam para
-- o mesmo cadastro. Repetir o documento por parcela criaria duas verdades sobre o mesmo CPF, e a
-- correção de uma delas deixaria a outra velha.
--
-- ⚠️ `rotulo` NÃO É CHAVE, É O QUE A TELA MOSTRA. Duas linhas na mesma unidade parecem erro de
-- cadastro; quem olha precisa bater o olho e ver "Mensal" e "Entrada". A informação existe no texto
-- livre do LSoft (`lsoft_parcelas.observacoes` traz "LOTE: 3 QUADRA P10 VALE DO OURO ENTRADA") e
-- morreria na carga se não tivesse onde ficar. Deduzir da contagem seria adivinhar: "3 de 4" não
-- diz por si que é entrada.
--
-- ⚠️ O RÓTULO NÃO VAI PARA O BOLETO NEM PARA O WHATSAPP. O que o cliente lê continua saindo de
-- `rotuloDaParcela` (nome do empreendimento + "Parcela N de M"). Este campo é recado interno, e
-- pôr recado interno no documento que o cliente guarda é como "VINICIUS FERREIRA ARAUJO - TAXA
-- SELIC" foi parar num boleto.

alter table public.boletos_parcelas
  add column if not exists sequencia smallint not null default 1;

alter table public.boletos_parcelas
  add column if not exists rotulo text;

-- A troca da unicidade. As 4.094 linhas existentes nascem com `sequencia = 1` pelo DEFAULT, então a
-- chave nova barra exatamente o que a antiga barrava — nenhuma delas passa a caber duas vezes.
alter table public.boletos_parcelas
  drop constraint if exists boletos_parcelas_unica;

alter table public.boletos_parcelas
  add constraint boletos_parcelas_unica
    unique (workspace_id, empreendimento, unidade, competencia, sequencia);

-- ⚠️ O TETO DE 99 É PROPOSITAL. Uma unidade com dezenas de cobranças no mesmo mês não é carteira, é
-- carga repetida em laço — e o erro precisa aparecer na gravação, não na conta do cliente.
alter table public.boletos_parcelas
  drop constraint if exists boletos_parcelas_sequencia;

alter table public.boletos_parcelas
  add constraint boletos_parcelas_sequencia
    check (sequencia between 1 and 99);

comment on column public.boletos_parcelas.sequencia is
  'Separa duas cobrancas da MESMA unidade no MESMO mes (a mensal e a entrada). 1 = a unica, ou a primeira. Sem significado de negocio: parcela_atual repete e e nulo, entao nao serve de chave.';
comment on column public.boletos_parcelas.rotulo is
  'Recado interno que distingue as linhas na tela ("Mensal", "Entrada"). NAO sai no boleto nem no WhatsApp.';
