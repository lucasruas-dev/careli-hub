-- 0165 · A DATA DA POSSE, QUE HOJE NÃO EXISTE EM LUGAR NENHUM
--
-- ⚠️ RENUMERADA DE 0164 PARA 0165 EM 16/09/2026, DEPOIS DE APLICADA. Outra sessão publicou
-- `0164_permissao_gerir_pessoas.sql` na main enquanto esta era escrita. O Supabase registra por
-- data e não por número, então no banco as duas convivem sem conflito: esta está gravada como
-- `20260915132444 · 0164_posse_da_unidade`. Só o nome do arquivo mudou — não reaplicar.
--
-- Lucas (15/09/2026): *"vamos precisar de incluir esse campo de posse, ae vc pode incluir no lugar
-- correto. se não estiver preenchido é que a posse não aconteceu."*
--
-- A posse é o marco que a Lei 13.786/18 usa para a FRUIÇÃO: o comprador que ocupou o imóvel paga
-- pelo tempo de ocupação quando o contrato é desfeito. Sem a data, o termo de rescisão não tem como
-- cobrar fruição — e cobrar sem saber a data seria inventar o número mais pesado do documento
-- (medido no caso de referência: R$ 542,91/mês, 21 meses, R$ 11.401,11, mais do que todas as outras
-- deduções somadas).
--
-- ⚠️ NÃO EXISTE COLUNA DE POSSE NO C2X INTEIRO. Varri `information_schema.columns` por posse,
-- possession, delivery, entrega e habite: o único achado é `enterprises.expected_delivery_date`,
-- que é a entrega PREVISTA do empreendimento e não a posse DESTE comprador. E o C2X é read-only
-- para nós em qualquer hipótese. Por isso a tabela nasce aqui.
--
-- ⚠️ A POSSE É DO CONTRATO, NÃO DA UNIDADE, e é por isso que a chave é o contrato. A unidade pode
-- ser revendida: a posse que o comprador anterior teve não vale para o comprador novo, e guardar o
-- fato na linha da unidade faria a fruição do segundo contrato começar na data do primeiro.
--
-- ⚠️ DOIS MUNDOS, UMA TABELA. São 3.022 contratos vivos no C2X (`acquisition_requests`) e as vendas
-- que nascem no Panteon (`hercules_vendas`). O CHECK obriga exatamente um dos dois: linha com os
-- dois preenchidos seria um fato com duas explicações, e linha com nenhum seria um fato órfão.
--
-- ⚠️ VAZIO SIGNIFICA "NÃO ACONTECEU", e isso é regra de negócio, não omissão de cadastro. Foi o que
-- o Lucas definiu, e a leitura dos 3.020 contratos com texto explica por que não dá para derivar a
-- data: 62% citam a imissão na posse, mas 23% a ligam à ASSINATURA, 14% à QUITAÇÃO e 44% falam de
-- habite-se ou termo de vistoria. Não há regra única para calcular.
--
-- ⚠️ E A MINUTA DA LAVRA DO OURO PÕE DUAS CONDIÇÕES, não uma (cláusula 5.1): *"A Posse precária do
-- imóvel somente será concedida ao PROMISSÁRIO COMPRADOR após 2 (dois) anos a contar da assinatura
-- deste instrumento E DESDE QUE ESTEJA(M) ELE(S) EM DIA com suas obrigações."* Quem está
-- inadimplente — que é exatamente de quem se faz rescisão — não recebeu a posse. Na prática a
-- ausência vai ser o caso normal, e a tabela vazia é o estado correto, não o estado pendente.
--
-- ⚠️ SEM TETO NO CHECK, DE PROPÓSITO. Posse com data futura é erro de digitação, mas o Postgres não
-- aceita `current_date` em CHECK (não é IMMUTABLE). O piso fica aqui; o teto é conferido na
-- aplicação, onde a mensagem de erro pode dizer ao operador o que ele errou.

create table if not exists public.hercules_posse (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null default 'careli',

  -- O contrato do C2X (`acquisition_requests.id`). Sem FK: o C2X é outro banco, outro servidor.
  contrato_c2x_id bigint,
  -- A venda nascida no Panteon. Cascade: apagada a venda, o marco dela não tem mais sujeito.
  venda_id      uuid references public.hercules_vendas (id) on delete cascade,

  -- ⚠️ RETRATO, COPIADO NO ATO, para a pergunta "quais lotes deste empreendimento têm posse?" sem
  -- atravessar o MySQL. Não é fonte da verdade e nunca decide nada: só filtra.
  enterprise_id text,
  unidade_c2x_id bigint,

  data_da_posse date not null,

  -- De onde a data saiu. Vai impressa no termo, porque o jurídico precisa saber se o número veio de
  -- um papel assinado ou da memória de quem cadastrou.
  origem        text not null default 'declarada',
  observacao    text,

  registrado_em       timestamptz not null default now(),
  registrado_por      uuid,
  registrado_por_nome text,
  atualizado_em       timestamptz not null default now(),

  constraint hercules_posse_um_dono check (
    (contrato_c2x_id is not null and venda_id is null)
    or (contrato_c2x_id is null and venda_id is not null)
  ),
  constraint hercules_posse_origem check (
    origem in ('termo_de_vistoria', 'contrato', 'declarada')
  ),
  constraint hercules_posse_data_plausivel check (data_da_posse >= date '2000-01-01')
);

-- ⚠️ UM REGISTRO POR CONTRATO, E OS ÍNDICES SÃO PARCIAIS PORQUE UMA DAS DUAS CHAVES É SEMPRE NULA.
-- `unique (workspace_id, contrato_c2x_id)` sem o `where` deixaria passar duas linhas de venda do
-- Panteon (nulo não colide com nulo em índice único), que é exatamente o caso que precisa travar.
create unique index if not exists hercules_posse_um_por_contrato
  on public.hercules_posse (workspace_id, contrato_c2x_id)
  where contrato_c2x_id is not null;

create unique index if not exists hercules_posse_um_por_venda
  on public.hercules_posse (workspace_id, venda_id)
  where venda_id is not null;

create index if not exists hercules_posse_por_empreendimento
  on public.hercules_posse (workspace_id, enterprise_id, data_da_posse desc)
  where enterprise_id is not null;

-- ⚠️ MESMO DESENHO DAS IRMÃS: RLS ligada, sem policy, e o grant de escrita revogado do `anon`. Toda
-- a família hercules_* fechou assim (0112, 0123, 0125, 0133, 0136). O app fala com esta tabela pelo
-- service role, que passa por cima de RLS. A linha carrega data de posse ligada a um CPF: é dado de
-- contrato, e a chave `anon` viaja no bundle que qualquer visitante baixa.
alter table public.hercules_posse enable row level security;
revoke all on public.hercules_posse from anon;

comment on table public.hercules_posse is
  'Quando o comprador recebeu a posse do lote. Ausencia = posse nao aconteceu = sem fruicao na rescisao. Uma linha por contrato (C2X) ou por venda (Panteon).';
comment on column public.hercules_posse.contrato_c2x_id is
  'acquisition_requests.id do C2X. Sem FK: banco diferente. Exclusivo com venda_id.';
comment on column public.hercules_posse.venda_id is
  'hercules_vendas.id, para as vendas nascidas no Panteon. Exclusivo com contrato_c2x_id.';
comment on column public.hercules_posse.enterprise_id is
  'Retrato do empreendimento, copiado no ato. So para filtrar: nao decide nada e nao e ressincronizado.';
comment on column public.hercules_posse.data_da_posse is
  'A data em que a posse foi efetivamente concedida. A fruicao conta dela ate a restituicao.';
comment on column public.hercules_posse.origem is
  'De onde a data saiu: termo_de_vistoria (papel assinado), contrato (clausula com data certa), declarada (informada pelo operador).';
comment on column public.hercules_posse.registrado_por_nome is
  'Nome de quem registrou, COPIADO no ato. Nao resolver por join: o historico tem de dizer quem era naquele dia.';
