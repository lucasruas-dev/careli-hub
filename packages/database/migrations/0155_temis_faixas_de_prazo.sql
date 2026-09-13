-- A FAIXA DE PRAZO: as premissas do produto deixam de morar dentro de cada plano.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026: *"em vez de cadastrar os juros e correção dentro de um
-- plano, ter um cadastro de juros e correção separado por parcelas. Exemplo: 1-12 parcelas, sem
-- juros e sem correção; 13-36, sem juros correção IPCA; 37 a 48 juros de x correção IPCA mensal;
-- 49-60, juros de y INCC (...) quando eu montar o plano e falar que aquele plano é de x parcelas,
-- automaticamente buscar esses valores correspondente ao número de parcelas daquele plano"*. E,
-- logo depois: *"acho que podemos também colocar a % da entrada nesse comportamento"*.
--
-- ATENCAO 1: A FAIXA VALE PELO PRAZO TOTAL DO PLANO, NÃO POR TRECHO DO CONTRATO. Um plano de 40
-- parcelas cai na faixa 37–48 e usa a taxa, o índice e a entrada dela do começo ao fim. A OUTRA
-- leitura — "as parcelas 1 a 12 do contrato sem juros, as 13 em diante com IPCA" — é um motor
-- completamente diferente: `montarCronograma` calcula UMA taxa para o contrato inteiro, e taxa por
-- trecho obrigaria a reescrever a amortização parcela a parcela. Reescrever amortização é a conta
-- que já divergiu 44% entre o card e o PDF nesta casa. Não é isso que esta tabela faz.
--
-- ATENCAO 2: O VOCABULÁRIO É "FAIXA DE PRAZO", E NUNCA "FAIXA DE PARCELAS". A tela do simulador JÁ
-- tem um painel chamado "Reajuste da parcela" que fala em "parcelas 1 a 12", "13 a 24" — e aquelas
-- SÃO faixas dentro do mesmo contrato (os degraus anuais do SACOC). Se esta tabela usasse as mesmas
-- palavras, as duas coisas colidiriam no primeiro mal-entendido e alguém construiria o sistema
-- errado. Na tela, o rótulo é "planos de 13 a 36 parcelas", não "parcelas 13 a 36".
--
-- ATENCAO 3: A FAIXA É POR EMPREENDIMENTO. Decisão do Lucas, perguntado em 13/09/2026: *"Faixa é
-- por empreendimento"*. Não há faixa global da casa. Medido no legado no mesmo dia: 74 planos
-- slotados em 26 empreendimentos produzem 42 combinações distintas de premissa, das quais 11 servem
-- a dois ou mais empreendimentos e a maior serve a SETE — ou seja, copiar UMA FAIXA de outro
-- empreendimento vale muito, e copiar a tabela inteira quase nada (são 24 tabelas distintas em 26
-- empreendimentos). Por isso a cópia é por linha, na tela, e não uma herança automática no banco.
--
-- ATENCAO 4: FAIXAS NÃO PODEM SE SOBREPOR, e o banco é quem garante. Duas faixas cobrindo 10 a 20 e
-- 1 a 12 fariam um plano de 11 parcelas ter duas premissas, e a escolha cairia na ordem em que o
-- banco devolvesse as linhas — o mesmo plano com juros diferentes entre dois cliques iguais. O
-- `exclude` com `int4range` recusa a segunda faixa no ato de gravar.
--
-- ATENCAO 5: `juros_taxa` NULO E ZERO SÃO COISAS DIFERENTES, e confundi-los zera contrato. Em
-- `temis_planos`, `juros_taxa is null` significa "plano sem juros" (é o caso de INVESTIDOR e CURTO
-- em quase todos os empreendimentos). Se aqui o nulo significasse "esta faixa não opina sobre
-- juros", uma faixa sem opinião ZERARIA os juros do plano que ela governa. Por isso existe
-- `define_juros`: a faixa diz explicitamente se ela manda naquele campo, e o nulo com
-- `define_juros = true` quer dizer "sem juros", igual ao plano.
--
-- ATENCAO 6: A FAIXA NÃO ALCANÇA CONTRATO ASSINADO, NEM PROPOSTA ABERTA. O que congela a premissa é
-- a proposta: desde 13/09/2026 ela grava `condicoes.plano` com taxa, periodicidade, convenção,
-- índice e sistema no instante em que foi gerada. Mudar uma faixa muda o que a PRÓXIMA proposta vai
-- herdar, e nada do que já foi prometido. (E o risco era pequeno hoje: medido em 13/09/2026, as 5
-- propostas nascidas no Panteon são todas do ZZ TESTE, com CPF 9999*, e `hercules_vendas` tem zero
-- linhas — Lucas: *"todos os contrato hoje são teste"*.)
--
-- ATENCAO 7: ESTA TABELA NÃO APAGA NADA DE `temis_planos`. As colunas `juros_taxa`,
-- `indice_correcao` e `entrada_percentual` continuam lá e continuam sendo a verdade do plano. A
-- faixa é quem PREENCHE esses campos quando o plano nasce ou muda de prazo, e o plano pode ficar
-- diferente dela — é para isso que existe a nota do corretor. Trocar isso por leitura dinâmica
-- faria o plano mudar sozinho no dia em que alguém editasse a faixa, e planos já usados em
-- propostas mudariam de premissa sem ninguém saber.
--
-- Autorização do Lucas, 13/09/2026: *"pode fazer a migration"*.

create table if not exists public.temis_faixas_de_prazo (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  -- Texto porque é assim que `temis_planos.enterprise_id` guarda (o id do C2X como string).
  enterprise_id text not null,

  -- O intervalo, em número de parcelas do PLANO. Inclusivo nas duas pontas: 1 a 12 cobre o de 12.
  parcela_minima integer not null,
  parcela_maxima integer not null,

  -- ⚠️ Os três `define_*` são o que separa "esta faixa manda neste campo" de "o valor é nulo".
  -- Ver ATENCAO 5.
  define_entrada boolean not null default true,
  entrada_percentual numeric(6, 3),

  define_juros boolean not null default true,
  juros_taxa numeric(14, 4),
  juros_periodicidade text not null default 'mensal',
  juros_convencao text not null default 'equivalente',

  define_indice boolean not null default true,
  indice_correcao text,

  ativo boolean not null default true,
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid,

  constraint temis_faixas_intervalo check (parcela_minima >= 1 and parcela_maxima >= parcela_minima),
  constraint temis_faixas_entrada check (
    entrada_percentual is null or (entrada_percentual >= 0 and entrada_percentual <= 100)
  ),
  constraint temis_faixas_juros_nao_negativo check (juros_taxa is null or juros_taxa >= 0),
  constraint temis_faixas_periodicidade check (juros_periodicidade in ('anual', 'mensal')),
  constraint temis_faixas_convencao check (juros_convencao in ('equivalente', 'proporcional')),
  -- Quem diz que manda na entrada precisa dizer quanto.
  constraint temis_faixas_entrada_coerente check (not define_entrada or entrada_percentual is not null),
  -- No índice o mesmo, e aqui o nulo não tem segundo sentido: "não corrige" é a linha SEM_CORRECAO.
  constraint temis_faixas_indice_coerente check (not define_indice or indice_correcao is not null),
  -- O índice sai do mesmo cadastro dos planos (0154). Sem isto, a faixa poderia mandar um plano para
  -- um índice que não existe, e o erro só apareceria na hora de gravar o plano.
  constraint temis_faixas_indice_cadastrado
    foreign key (workspace_id, indice_correcao)
    references public.temis_indices (workspace_id, codigo)
);

comment on table public.temis_faixas_de_prazo is
  'Premissas do produto por FAIXA DE PRAZO (quantas parcelas o plano tem), por empreendimento. É o que preenche juros, índice e entrada quando um plano nasce ou muda de prazo.';
comment on column public.temis_faixas_de_prazo.parcela_minima is
  'Prazo TOTAL do plano, não posição da parcela dentro do contrato. Ver ATENCAO 1 e 2 da migration.';
comment on column public.temis_faixas_de_prazo.define_juros is
  'A faixa manda nos juros? Falso deixa o campo do plano intocado. Distingue "sem juros" (nulo com define ligado) de "não opino".';

-- ⚠️ A TRAVA DA SOBREPOSIÇÃO (ATENCAO 4). `btree_gist` é o que permite misturar igualdade de texto
-- com intervalo no mesmo `exclude`.
create extension if not exists btree_gist;

alter table public.temis_faixas_de_prazo
  drop constraint if exists temis_faixas_sem_sobreposicao;

alter table public.temis_faixas_de_prazo
  add constraint temis_faixas_sem_sobreposicao
  exclude using gist (
    workspace_id with =,
    enterprise_id with =,
    int4range(parcela_minima, parcela_maxima, '[]') with &&
  )
  where (ativo);

create index if not exists temis_faixas_por_empreendimento
  on public.temis_faixas_de_prazo (workspace_id, enterprise_id, parcela_minima)
  where ativo;

-- RLS ligada e sem policy: o padrão da casa desde a 0075. Acesso só por service role.
alter table public.temis_faixas_de_prazo enable row level security;
