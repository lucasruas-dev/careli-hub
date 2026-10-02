-- 0209 · OS DIAS DE VENCIMENTO DA PARCELA, POR EMPREENDIMENTO
--
-- Lucas (02/10/2026): *"dentro do setup, do empreendimento na aba politicas comerciais, vamos colocar
-- uma parte que apontamos os dias de vencimento da parcela. Hoje está padrão (...), agora passa a ter
-- essa referencia. o usuario pode colocar as datas, inserir mais de uma o ideia seria ir cadastrando
-- as datas para aquele empreendimento"*.
--
-- POR QUE EXISTE: os dias 10 e 20 estavam chumbados em `lib/hercules/proposta.ts`
-- (`DIAS_DE_VENCIMENTO`) e valiam igual para todo empreendimento. Sem lugar para cadastrar, um
-- produto que cobra no dia 5 obrigava o coordenador a digitar a data à mão em toda proposta.
--
-- POR QUE AQUI E NÃO EM TABELA NOVA: `apolo_enterprise_settings` já é a configuração POR
-- EMPREENDIMENTO, chaveada pelo id do C2X, e é onde a aba Política Comercial grava a entrada mínima
-- (0128) e as comissões (0145). Mesma tela, mesma chave. Uma lista curta de inteiros cabe numa coluna.
--
-- ATENCAO 1: NASCE NULA, E NULO É "NÃO CADASTRADO". Quem lê aplica a herança (o filho sem cadastro
-- usa o do pai) e, sem cadastro em lugar nenhum, a proposta oferece 10 e 20 COM o aviso de que falta
-- cadastrar (decisão do Lucas, 02/10/2026: "só avisa"). Nenhum DEFAULT: um `{10,20}` gravado em todos
-- pareceria decisão tomada onde ninguém decidiu, e calaria o aviso.
--
-- ATENCAO 2: LISTA VAZIA É PROIBIDA. Ela diria "este empreendimento não tem dia nenhum", que não é
-- decisão de ninguém, e cortaria a herança do pai em silêncio. Tirar o último dia na tela grava NULO
-- (volta a herdar). O CHECK abaixo garante isso mesmo para quem escrever por SQL direto.
--
-- ATENCAO 3: A FAIXA É 1 A 28, A MESMA DO SERVIDOR DA PROPOSTA. Dia 29, 30 e 31 não existem em todo
-- mês, e o cronograma não pula fevereiro. A lista é ATALHO da tela, não trava: a proposta continua
-- aceitando qualquer dia de 1 a 28 (Lucas, 02/10/2026: "só atalho").
--
-- ATENCAO 4: ORDEM E REPETIÇÃO SÃO CONFERIDAS NA APLICAÇÃO (`conferirDiasDeVencimento`), não aqui.
-- Um CHECK sem subconsulta não consegue dizer "sem repetição", e a leitura (`diasDoBanco`) ordena e
-- tira repetidos de qualquer forma.

alter table public.apolo_enterprise_settings
  add column if not exists dias_vencimento smallint[];

comment on column public.apolo_enterprise_settings.dias_vencimento is
  'Dias de vencimento da parcela oferecidos na proposta deste empreendimento, de 1 a 28, em ordem. '
  'Nasce no Apolo, aba Politica Comercial. Nulo = nao cadastrado: o filho herda do pai e, sem cadastro '
  'nenhum, a proposta oferece 10 e 20 com aviso. Lista vazia e proibida. E atalho da tela, nao trava: '
  'a proposta aceita qualquer dia de 1 a 28.';

alter table public.apolo_enterprise_settings
  drop constraint if exists apolo_enterprise_settings_dias_vencimento_check;

alter table public.apolo_enterprise_settings
  add constraint apolo_enterprise_settings_dias_vencimento_check
  check (
    dias_vencimento is null
    or (
      cardinality(dias_vencimento) between 1 and 28
      and array_position(dias_vencimento, null) is null
      and 1 <= all (dias_vencimento)
      and 28 >= all (dias_vencimento)
    )
  );
