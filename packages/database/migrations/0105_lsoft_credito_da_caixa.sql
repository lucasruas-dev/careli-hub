-- 0105 · O que a CAIXA já liberou — os créditos do extrato CIWEB do Vale do Sol.
--
-- Lucas (25/08/2026): *"todos os pagamentos da caixa estão nos extratos"*. É a frase que decide o
-- desenho: o LSoft NÃO sabe desse dinheiro. Medido hoje — o LSoft tem R$ 598.029,21 baixados nas
-- 180 parcelas de subsídio, enquanto o extrato mostra **R$ 8.437.617,09** em 771 liberações. São
-- R$ 7,84 mi que a Caixa pagou e o sistema do cliente nunca registrou.
--
-- A CONTA VIVA: cada unidade tem um valor contratado com a Caixa (a parcela de financiamento no
-- LSoft) e recebe esse valor AOS POUCOS, por medição de obra. Quando a soma das liberações alcança
-- o contratado, a unidade LIQUIDA — e é isso que a tela precisa mostrar, mês a mês.
--
-- ⚠️ SÓ `CR DESBLOQ` É LIBERAÇÃO. Medido nos 17 arquivos: das 31 rubricas do extrato, só essa é
-- entrada de dinheiro da Caixa (771 lançamentos). As outras são movimentação da própria
-- construtora e NÃO podem abater em conta de cliente: RESG AUT (R$ 1,38 mi), RG CDB 95
-- (R$ 1,23 mi), aplicações e resgates.
--
-- ⚠️ O `Nr_Doc` É O CONTRATO, mas só dentro de CR DESBLOQ (medido: 77 valores distintos, zero
-- colisão com número de cheque de outras rubricas).
--
-- ⚠️ PRINCIPAL x SECUNDÁRIO (decisão do Lucas, 25/08: *"separa esse valor menor então, só para
-- gente não ter a visão poluida sem saber o que é"*). Quando a Caixa libera mais de um crédito no
-- mesmo dia para o mesmo contrato, o MAIOR é a liberação principal e os menores ficam à parte.
-- ⚠️ MAS NÃO SÃO RENDIMENTO, ao contrário do que parecia: medido, a razão menor/maior é EXATAMENTE
-- constante por contrato ao longo de datas irregulares (doc 163222 = 3,063% em 7 medições; doc
-- 166194 = 7,790% em 7). Juros não fazem isso. Tem cara de rateio contratual entre fontes, e a
-- planilha da Amanda soma tudo no "recebido acumulado" — por isso os dois campos ficam gravados e
-- somáveis; a tela é que os mostra separados até alguém confirmar a natureza.

create table if not exists public.lsoft_credito_da_caixa (
  id uuid primary key default gen_random_uuid(),

  -- Do extrato, cru.
  conta text not null,
  -- `Nr_Doc` do CIWEB = o contrato da Caixa (6 dígitos). É o que casa com a planilha da Amanda.
  contrato_caixa text not null,
  data_movimento date not null,
  historico text not null,
  valor numeric not null,

  -- Ordem dentro do grupo (contrato + data), do maior para o menor: 1 = liberação principal.
  posicao_no_dia integer not null default 1,
  -- true no maior crédito do dia; false nos menores (mostrados à parte na tela).
  eh_principal boolean not null default true,

  -- Preenchido quando o crédito é reconhecido como a liberação do TERRENO: medido, em 75 dos 77
  -- contratos existe um crédito EXATAMENTE igual ao "financiamento do terreno" da planilha,
  -- somando R$ 1.302.520,52. O Lucas pediu para mostrar essa linha separada das medições de obra.
  eh_terreno boolean not null default false,

  -- O elo com o cliente. NÃO existe no LSoft (medido: zero ocorrências do contrato nas 6.776
  -- observações), então é RECONSTRUÍDO por CPF + unidade e pode estar vazio.
  cliente_codigo text,
  -- 'cpf' | 'unidade' | 'manual' | null — como o vínculo foi feito, para auditar depois.
  origem_do_vinculo text,

  -- De onde veio a linha, para reimportar sem duplicar.
  arquivo_origem text not null,

  importado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint lsoft_credito_origem_vinculo_valida
    check (origem_do_vinculo is null or origem_do_vinculo in ('cpf', 'unidade', 'manual'))
);

-- ⚠️ A TRAVA CONTRA DUPLICAR NA REIMPORTAÇÃO. O extrato é reenviado todo mês e os meses antigos
-- vêm juntos; sem isto, rodar duas vezes dobraria o dinheiro liberado. A chave é a identidade do
-- lançamento no extrato — mesma conta, contrato, dia, valor e posição no dia.
create unique index if not exists lsoft_credito_da_caixa_unico
  on public.lsoft_credito_da_caixa (conta, contrato_caixa, data_movimento, valor, posicao_no_dia);

create index if not exists lsoft_credito_por_contrato
  on public.lsoft_credito_da_caixa (contrato_caixa, data_movimento);

create index if not exists lsoft_credito_por_cliente
  on public.lsoft_credito_da_caixa (cliente_codigo);

comment on table public.lsoft_credito_da_caixa is
  'Creditos do extrato CIWEB da Caixa (Vale do Sol / MCMV): o que a Caixa ja liberou por medicao de obra. So historico CR DESBLOQ entra. eh_principal separa o maior credito do dia dos menores; o vinculo com o cliente e reconstruido por CPF+unidade porque o contrato nao existe no LSoft.';

-- Mesma postura das irmãs `lsoft_*`: só a service role enxerga.
alter table public.lsoft_credito_da_caixa enable row level security;
