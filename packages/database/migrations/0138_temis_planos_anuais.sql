-- 0138 · AS PARCELAS ANUAIS NO PLANO COMERCIAL
--
-- Lucas (07/09/2026), olhando o formulário de plano: *"aqui faltou as anuais, pode ter plano que já
-- vem configurado isso"*.
--
-- ⚠️ ATÉ AGORA A ANUAL ERA DECISÃO DA VENDA, e não do produto. O simulador do Hércules monta os
-- reforços na hora (`composicoes.ts` varre 0, 15k, 20k, 25k, 30k) e o cronograma os abate a VALOR
-- PRESENTE — um balão que cai daqui a três anos não amortiza saldo de hoje. Isso continua valendo
-- para a venda que negocia caso a caso.
--
-- O que faltava é o outro caso, que é real: o plano que JÁ NASCE com reforço. "120x com anual de
-- R$ 20.000" não é uma composição que o corretor montou — é o produto que o loteador aprovou, e
-- toda venda naquele plano tem a mesma anual. Sem estes campos, essa regra vivia na cabeça de quem
-- vende e era redigitada a cada proposta.
--
-- ⚠️ NULO É "ESTE PLANO NÃO TEM ANUAL", e não "esqueceram de preencher" — a mesma convenção de
-- `juros_taxa` nesta tabela. É o caso da maioria dos planos, e por isso é o default.
--
-- ⚠️ QUANTIDADE E VALOR ANDAM JUNTOS. Um plano com quantidade e sem valor (ou o contrário) não diz
-- nada: o CHECK exige os dois ou nenhum, para a tela não precisar adivinhar o que fazer com meia
-- configuração.

alter table public.temis_planos
  add column if not exists anuais_quantidade integer,
  add column if not exists anuais_valor      numeric(14, 2);

alter table public.temis_planos
  drop constraint if exists temis_planos_anuais_completas;

alter table public.temis_planos
  add constraint temis_planos_anuais_completas check (
    (anuais_quantidade is null and anuais_valor is null)
    or (anuais_quantidade > 0 and anuais_valor > 0)
  );

comment on column public.temis_planos.anuais_quantidade is
  'Quantos reforcos anuais o plano ja traz. NULO = plano sem anual.';
comment on column public.temis_planos.anuais_valor is
  'O valor de cada reforco. Anda junto com a quantidade: os dois ou nenhum.';
