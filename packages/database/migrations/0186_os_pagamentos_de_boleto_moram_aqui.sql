-- OS PAGAMENTOS DE BOLETO PASSAM A MORAR NO PANTEON.
--
-- Lucas (22/09/2026): *"primeiro, vamos trazer essa informacoes de pago para dentro do panteon, nao
-- faz sentido, vamos colocar uma tabela para organizar esses pagamentos"*.
--
-- ATENCAO 1: ISTO NAO REVOGA A DECISAO DE 01/09, E ESSA DISTINCAO E A TABELA INTEIRA. A aba Boletos
-- continua lendo o Asaas AO VIVO (`app/api/boletos/emitidos/route.ts`), porque o estado muda lá sem
-- nos avisar e uma copia local mostraria "em aberto" para quem pagou ontem. O que nasce aqui é
-- outra coisa: o REGISTRO DATADO do que o Asaas disse, para conciliar com a carteira (o LSoft, no
-- pedido que motivou isto) e para responder "quem pagou setembro" sem depender de sete chamadas a
-- uma API externa. A tela pergunta ao Asaas; a conciliacao pergunta a esta tabela.
--
-- ATENCAO 2: A CHAVE E A COBRANCA DO ASAAS (`cobranca_id`), e nao a nossa parcela. Uma unidade pode
-- ter DUAS cobrancas na mesma competencia (a mensal e a entrada: a referencia da segunda termina em
-- `:2026-09:2`), e amarrar pela parcela faria a segunda sobrescrever a primeira -- o mesmo defeito
-- que ja mordeu a listagem de emitidos, onde `endsWith(":2026-09")` escondia a segunda cobranca.
--
-- ATENCAO 3: `valor_pago` E `pago_em` SAO NULOS ATE O PAGAMENTO EXISTIR, e o que diz se pagou e o
-- `situacao`, nao o valor. Pagamento parcial e devolucao existem no Asaas (`RECEIVED_IN_CASH`,
-- `REFUNDED`), e quem ler "valor_pago > 0" como "quitado" vai marcar como paga uma parcela que
-- voltou. A regua de leitura mora no codigo, com os status escritos por extenso.
--
-- ATENCAO 4: A SINCRONIZACAO E IDEMPOTENTE POR `cobranca_id` (upsert). Rodar de novo no mesmo mes
-- atualiza a linha; nunca duplica. `sincronizado_em` diz de quando e o retrato -- sem ele, ninguem
-- sabe se "em aberto" e de hoje ou da semana passada.
--
-- ATENCAO 5: RLS LIGADA, SEM POLICY, como as irmas (0114-0117, 0165, 0166, 0169). A tabela guarda
-- CPF por tabela-irma e valor de cobranca; acesso so pelo service role.

create table if not exists public.boletos_pagamentos (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'careli',

  -- De onde veio: a conta do Asaas que emitiu, e a carteira dentro dela. Os quatro edificios da CER
  -- dividem a MESMA conta, entao `conta` sozinha nao diz o empreendimento.
  conta             text not null,
  empreendimento    text not null,
  unidade           text not null,
  competencia       text not null,
  -- Separa a mensal da entrada na mesma unidade e mes (1 = a primeira).
  sequencia         integer not null default 1,

  -- A cobranca no Asaas.
  cobranca_id       text not null,
  referencia        text,
  situacao          text not null,
  forma             text,

  valor_cobrado     numeric(14,2) not null,
  valor_pago        numeric(14,2),
  vencimento        date not null,
  pago_em           date,
  -- A data que o cliente informou no pagamento em dinheiro (`clientPaymentDate` do Asaas), quando
  -- difere da data em que o dinheiro entrou.
  pago_em_informado date,

  criado_em         timestamptz not null default now(),
  sincronizado_em   timestamptz not null default now(),

  constraint boletos_pagamentos_valores check (
    valor_cobrado >= 0 and (valor_pago is null or valor_pago >= 0)
  ),
  constraint boletos_pagamentos_sequencia check (sequencia >= 1)
);

-- Uma cobranca do Asaas, uma linha. E o que faz a sincronizacao poder rodar quantas vezes quiser.
create unique index if not exists boletos_pagamentos_uma_por_cobranca
  on public.boletos_pagamentos (cobranca_id);

-- A leitura da conciliacao: "o que aconteceu nesta competencia, nesta carteira".
create index if not exists boletos_pagamentos_por_competencia
  on public.boletos_pagamentos (workspace_id, competencia, empreendimento);

-- A volta: da unidade para o pagamento, que e como a carteira pergunta.
create index if not exists boletos_pagamentos_por_unidade
  on public.boletos_pagamentos (workspace_id, empreendimento, unidade, competencia);

comment on table public.boletos_pagamentos is
  'Retrato datado do que o Asaas diz sobre cada cobranca emitida pela aba Boletos. NAO substitui a '
  'leitura ao vivo da tela (0114-0117): existe para conciliar com a carteira e para ter historico.';
comment on column public.boletos_pagamentos.situacao is
  'Status do Asaas, cru: PENDING, RECEIVED, CONFIRMED, RECEIVED_IN_CASH, OVERDUE, REFUNDED, '
  'CHARGEBACK_REQUESTED... Quem decide o que e "pago" e a regua do codigo, nunca uma comparacao de valor.';
comment on column public.boletos_pagamentos.sequencia is
  'Separa a mensal (1) da entrada (2) na mesma unidade e competencia. Vem do sufixo da referencia.';

alter table public.boletos_pagamentos enable row level security;
revoke all on public.boletos_pagamentos from anon, authenticated;
