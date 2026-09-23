-- O BEM E A PERMUTA RECEBIDOS NA AQUISICAO PASSAM A MORAR NA PROPOSTA.
--
-- Lucas (22/09/2026), respondendo as quatro perguntas que decidiram o formato:
-- *"Abate, como uma entrada"* (a permuta reduz o que o cliente ainda deve, nao e so anotacao),
-- *"Varios"* (cabe mais de um bem na mesma proposta), *"pode ser um ou outro, pode apontar na
-- entrada ou somente no valor negociado"* e *"Ja no contrato tambem"*.
--
-- ATENCAO 1: SEM ESTA COLUNA O CARRO E O LOTE DADOS EM PAGAMENTO SO EXISTEM NA `observacao`, em
-- texto corrido. A proposta ja aceitava um valor negociado menor para acomodar a permuta, mas o
-- que justificava o abatimento nao ficava em lugar nenhum estruturado: nem a Temis consegue
-- imprimir "recebe em permuta o Ford Ka placa ABC1D23, R$ 32.000" no contrato, nem a analise
-- consegue somar quanto da entrada foi dinheiro e quanto foi bem. E o contrato precisa dizer.
--
-- ATENCAO 2: NAO E TABELA FILHA, E O PRECEDENTE E `compradores` (0126). A permuta nao tem vida
-- propria: ninguem consulta "todos os bens recebidos" sem a proposta em volta, ela nasce e morre
-- com a proposta, e e SEMPRE lida junto do pai (na tela da venda, no PDF e na minuta). Uma tabela
-- filha cobraria um join em toda leitura de proposta para um dado que nunca e perguntado sozinho,
-- e abriria a chance de bem orfao quando a proposta for apagada. `compradores` resolveu o mesmo
-- problema com jsonb e ate cinco itens por linha, e nunca precisou virar tabela.
--
-- ATENCAO 3: O DEFAULT ENTRA JUNTO DO NOT NULL, E ISSO NAO E ZELO — COLUNA NOT NULL SEM DEFAULT
-- QUEBRA TODO UPSERT EXISTENTE, CALADO. O Postgres valida o NOT NULL do INSERT ANTES de resolver o
-- `on conflict`, entao todo upsert que hoje nao nomeia esta coluna (a rota da proposta, as cargas
-- e os scripts de conferencia) passaria a estourar na primeira gravacao. Com `'[]'::jsonb` de
-- default, "esta proposta nao tem bem nenhum" e uma lista vazia de verdade, e quem le nunca
-- precisa distinguir nulo de vazio: `bens_e_permutas` sempre responde `jsonb_array_length`.
--
-- ATENCAO 4: `entraComo` E CAMPO DE CADA ITEM, E NAO REGRA FIXA DA CASA. Foi a resposta literal do
-- Lucas a pergunta "conta para a entrada minima de 10%?": *"pode ser um ou outro"*. Um mesmo
-- cliente pode dar o carro como ENTRADA (e ai o bem cumpre o piso de 10%, que a regua confere em
-- `lib/hercules/proposta.ts`) e o lote como ABATIMENTO (reduz o saldo a financiar mas NAO cumpre o
-- piso). Cravar a regra na coluna, ou no codigo, obrigaria o coordenador a mentir no cadastro para
-- fechar o negocio que ele acabou de combinar.
--
-- ATENCAO 5: O CHECK SO GARANTE QUE E UMA LISTA, e o formato de cada item fica no codigo. E a
-- mesma divisao de `compradores` e de `condicoes`: o banco impede o erro grosseiro (um objeto, um
-- numero ou um texto gravado onde a leitura faz `.map`, que quebraria a tela da venda inteira), e
-- a conferencia campo a campo mora na rota, onde da para responder 400 dizendo QUAL campo esta
-- errado. Um CHECK de jsonb nao consegue nomear o campo para quem esta preenchendo a tela.

alter table public.hercules_propostas
  add column if not exists bens_e_permutas jsonb not null default '[]'::jsonb;

alter table public.hercules_propostas
  drop constraint if exists hercules_propostas_bens_e_permutas_e_lista;

alter table public.hercules_propostas
  add constraint hercules_propostas_bens_e_permutas_e_lista
  check (jsonb_typeof(bens_e_permutas) = 'array');

comment on column public.hercules_propostas.bens_e_permutas is
  'Bens e permutas recebidos na aquisicao, em lista: [{descricao, entraComo, tipo, valor}]. '
  'tipo = bem | permuta. entraComo = entrada (cumpre a entrada minima de 10%) | abatimento '
  '(reduz o saldo a financiar, NAO cumpre o piso) — Lucas, 22/09/2026: "pode ser um ou outro". '
  'Lista vazia = proposta so em dinheiro. Nunca nulo.';
