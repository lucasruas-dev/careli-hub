-- O CRECI E A NATUREZA JURIDICA PASSAM A MORAR NO PANTEON.
--
-- Sem estas colunas o contrato sai com o colchete no papel. Medido em 21/09/2026, gerando o
-- contrato do Vale do Ouro: a linha do beneficiario imprimiu "CRECI: [creci_vinculado]" para a
-- FLAT IMOBILIARIA enquanto a tela do Apolo mostrava "CRECI 53964" na mesma hora -- porque a tela
-- le o C2X AO VIVO so para exibir (lib/apolo/server.ts: "nao alimenta envio") e o gerador de
-- documento le so o Panteon, onde o numero nunca existiu.
--
-- Lucas, 21/09/2026: "todos os dados de cadastro do empreendimento, tem que está dentro do banco,
-- se não tiver vamos criar as tabelas e fazer a importação" e "tudo que precisa estar dentro do
-- contrato (ou seja as variaveis) tem que estar dentro do panteon".
--
-- ATENCAO 1: A COLUNA E DA ENTIDADE, NAO DA IMOBILIARIA. Coordenadora de vendas, imobiliaria e
-- corretor sao todos `apolo_entities` -- uma coluna serve aos quatro campos do contrato
-- (creci_vinculado, imobiliaria_creci, corretor_creci, creci_coordenadora_vendas). Medido: as
-- cinco buscas por column_name ilike '%creci%' em information_schema voltaram ZERO, e o numero so
-- existia em metadata->'cadastro'->>'creci', preenchido em 31 das 5.566 entidades.
--
-- ATENCAO 2: COLUNA, E NAO `metadata`. O sync do C2X substitui o jsonb INTEIRO
-- (lib/apolo/server.ts), e ja apagou estado operacional assim antes -- foi o que obrigou a criar
-- `apolo_esteira` em 0057. Dado que o contrato depende NAO pode morar em campo que outro processo
-- reescreve.
--
-- ATENCAO 3: NULO E "NAO SABEMOS", E ISSO TEM DE CONTINUAR VISIVEL. Sem default e sem NOT NULL: o
-- contrato imprime o colchete e trava a geracao quando o CRECI falta, que e o aviso proposital de
-- `preencherContrato` (variavel sem valor entra em `semValor`). Preencher com string vazia
-- silenciaria a falta.
--
-- ATENCAO 4: A VALIDADE VAI JUNTO PORQUE O C2X JA A TEM (`users.creci_validate`). Sem ela, a
-- primeira vez que o juridico pedir "CRECI vigente" vira outra migration e outra importacao.

alter table public.apolo_entities
  add column if not exists creci text,
  add column if not exists creci_uf text,
  add column if not exists creci_validade date,
  add column if not exists natureza_juridica text;

comment on column public.apolo_entities.creci is
  'Numero do CRECI da entidade (imobiliaria, corretor ou coordenadora de vendas). Alimenta as quatro variaveis de CRECI do contrato. Importado de users.creci_number do C2X pelo sync; nulo = nao sabemos, e o contrato acusa.';
comment on column public.apolo_entities.creci_uf is
  'UF do registro no CRECI, quando informada. O C2X nao guarda separado: hoje vem nulo e e preenchido a mao no cadastro.';
comment on column public.apolo_entities.creci_validade is
  'Validade do CRECI (users.creci_validate no C2X). Nulo = sem informacao, nao "vencido".';
comment on column public.apolo_entities.natureza_juridica is
  'Natureza juridica da pessoa juridica (LTDA, S/A, EIRELI...), que o contrato escreve na qualificacao da vendedora. Medido: 0 das 23 vendedoras tinham o dado em coluna; 57 entidades o tinham em metadata.';

-- Busca por CRECI (o jurídico confere por numero) e varredura do que ainda falta importar.
create index if not exists apolo_entities_creci_idx
  on public.apolo_entities (creci)
  where creci is not null;
