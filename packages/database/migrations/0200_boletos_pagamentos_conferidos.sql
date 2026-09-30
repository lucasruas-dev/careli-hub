-- 0200 · Quem conferiu o pagamento que a baixa do hub não conseguiu resolver sozinha.
--
-- ⚠️ NÚMERO CONFERIDO NA HORA DE APLICAR. A 0199 é a última desta frente; se outra sessão já tiver
-- usado o 0200 no registro ou no repo, renumere ESTE arquivo (nunca o do outro).
--
-- De 2026-09 em diante o boleto pago no Asaas dá baixa na parcela do Garden sozinho
-- (`lib/lsoft/baixa-do-hub.ts`). O que ele não consegue casar com segurança (lote do boleto que não
-- bate com o das parcelas, parcela já baixada com outro valor, estorno depois da baixa, boleto de
-- cliente que ainda está na integração) vai para a lista "Pagamentos a conferir" do Financeiro.
-- Pedido do Lucas (30/09/2026): *"pode fazer a lista de pagamentos a conferir"*.
--
-- Sem esta tabela a lista não tem como esvaziar: o pagamento em dobro que o time já tratou e o
-- boleto que alguém já baixou à mão na ficha continuariam aparecendo para sempre, e uma lista que
-- nunca zera deixa de ser lida.
--
-- ATENCAO 1: A LISTA NÃO MORA AQUI. Ela é calculada na hora, pela mesma régua da baixa, a partir de
-- `boletos_pagamentos` e do espelho. Aqui fica só a decisão humana: "este eu já vi". Copiar a lista
-- para uma tabela criaria uma segunda verdade que envelhece.
--
-- ATENCAO 2: A CHAVE É A COBRANÇA DO ASAAS MAIS O MOTIVO, e cada conferência é uma linha própria
-- (só insert, nunca update). Se a mesma cobrança voltar à conferência por OUTRO motivo (foi
-- conferida como "lote não bate" e depois o Asaas a estornou), ela reaparece, e a conferência nova
-- NÃO apaga quem fez a primeira, quando e com qual observação: com a chave só na cobrança e upsert,
-- quem tratou o possível pagamento em dobro sumiria do banco na segunda conferência (achado da
-- revisão de 30/09/2026, antes de a tabela existir).
--
-- ATENCAO 3: QUEM CONFERIU VEM DA SESSÃO, nunca do corpo do pedido. `conferido_origem` separa o
-- time da Careli do usuário do portal do incorporador, como a trilha do LSoft já faz.
--
-- ATENCAO 4: RLS LIGADA, SEM POLICY, E REVOKE EXPLÍCITO. Toda tabela de `public` é servida pelo
-- PostgREST com a chave anon que vai no bundle do site; e `revoke ... from public` não tira o que o
-- Supabase concede a `anon` e `authenticated`. Só a service role lê e escreve aqui.

create table if not exists public.boletos_pagamentos_conferidos (
  cobranca_id text not null,
  motivo text not null,
  workspace_id text not null default 'careli',
  empreendimento text not null,
  observacao text not null,
  conferido_por text not null,
  conferido_origem text not null default 'incorporador',
  conferido_em timestamptz not null default now(),
  primary key (cobranca_id, motivo)
);

alter table public.boletos_pagamentos_conferidos
  drop constraint if exists boletos_pagamentos_conferidos_origem_check;
alter table public.boletos_pagamentos_conferidos
  add constraint boletos_pagamentos_conferidos_origem_check
  check (conferido_origem in ('careli', 'incorporador'));

create index if not exists boletos_pagamentos_conferidos_empreendimento_idx
  on public.boletos_pagamentos_conferidos (workspace_id, empreendimento);

comment on table public.boletos_pagamentos_conferidos is
  'Pagamentos de boleto (Asaas) que a baixa do hub mandou para conferencia e que alguem ja conferiu. A lista em si e calculada na hora (lib/lsoft/pagamentos-a-conferir.ts); aqui fica so a decisao humana.';
comment on column public.boletos_pagamentos_conferidos.motivo is
  'A chave do motivo no momento da conferencia (classe e texto da decisao da baixa do hub). Faz parte da chave primaria: outro motivo para a mesma cobranca e outra linha, e a cobranca reaparece na lista ate ser conferida de novo.';
comment on column public.boletos_pagamentos_conferidos.conferido_por is
  'Quem conferiu, tirado da sessao (nunca do corpo do pedido).';

alter table public.boletos_pagamentos_conferidos enable row level security;

revoke all on table public.boletos_pagamentos_conferidos from public;
revoke all on table public.boletos_pagamentos_conferidos from anon;
revoke all on table public.boletos_pagamentos_conferidos from authenticated;
