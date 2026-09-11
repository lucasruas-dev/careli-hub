-- A PROPOSTA PASSA A GUARDAR O DESCONTO, E NÃO SÓ O RESULTADO DELE.
--
-- Lucas (08/09/2026), pedindo o campo no simulador: *"desconto em valor ou % que influencia o
-- valor da proposta — isso não pode mudar o valor original de tabela"*. O módulo foi feito
-- (`lib/hercules/ajuste-de-preco.ts`, com testes) e o simulador usa: o corretor dá o desconto em
-- reais ou em %, e a tabela fica intacta na tela. Mas ao salvar, a rota gravava só
-- `valor = valorNegociado` — o número já descontado. A intenção morria na tela.
--
-- ⚠️ O QUE ISSO CUSTAVA. Depois de salvo, ninguém sabia se R$ 142.500 num lote foram desconto de
-- 5%, tabela desatualizada ou erro de digitação — que é textualmente o defeito que o comentário
-- do `ajuste-de-preco.ts` diz que o módulo existe para evitar. E a Têmis, que analisa a proposta
-- antes de emitir contrato, não tinha como apontar desconto nenhum: comparar `hercules_propostas.
-- valor` com `hercules_unidades.preco_tabela` é uma TAUTOLOGIA, porque a carga inicial escreveu o
-- mesmo número nos dois lados (`importar-fluxo-de-venda.mjs`, "u.price as valor"). Medido em
-- 10/09/2026: 4.856 das 4.863 propostas batem ao centavo, e as 6 que divergem são resíduo do
-- retrato de 01/09, não desconto negociado.
--
-- ⚠️ E O NÚMERO É CONGELADO, NÃO CONSULTADO. `preco_tabela` fica sendo o preço DAQUELE dia. Ler o
-- cadastro da unidade na hora de analisar faria o passado mudar toda vez que alguém corrigisse o
-- preço do lote — a proposta de agosto passaria a "ter desconto" porque o preço subiu em outubro.
-- Congelado na proposta, o que foi combinado continua correto para sempre.
--
-- ⚠️ TUDO NO PANTEON. Lucas (10/09/2026): *"por que estamos consultando o legado? já cansei de
-- falar que não vamos usar o legado mais como referência"*. Nenhuma destas colunas depende do
-- C2X: o preço sai de `hercules_unidades`, o ajuste sai da tela, e a Têmis lê só a proposta.

alter table public.hercules_propostas
  -- O preço de tabela da unidade no instante em que a proposta nasceu.
  add column if not exists preco_tabela numeric(14, 2),
  -- Em que moeda o desconto foi PENSADO: 'percentual' ou 'reais'. É a informação que se perde
  -- quando se guarda só o resultado — 5% e R$ 7.500 dão o mesmo número num lote de R$ 150.000, e
  -- só um dos dois é o que o coordenador combinou.
  add column if not exists ajuste_modo text,
  -- Quanto foi dado, na moeda de `ajuste_modo`. Negativo é desconto, positivo é acréscimo — a
  -- mesma convenção de `AjusteDePreco` (o simulador aceita os dois, ver AJUSTE_MAXIMO).
  add column if not exists ajuste_valor numeric(14, 4);

-- ⚠️ FAIL-CLOSED NO MODO, MAS NULO CONTINUA VÁLIDO. As 4.857 propostas importadas do C2X e todas
-- as nativas anteriores a esta migration não têm ajuste nenhum — e não ter ajuste é diferente de
-- ter ajuste zero. Um CHECK que exigisse valor recusaria a linha antiga; um que aceitasse
-- qualquer texto deixaria entrar 'porcentagem', 'pct' e o que mais alguém digitasse.
alter table public.hercules_propostas
  drop constraint if exists hercules_propostas_ajuste_modo_valido;

alter table public.hercules_propostas
  add constraint hercules_propostas_ajuste_modo_valido
  check (ajuste_modo is null or ajuste_modo in ('percentual', 'reais'));

-- Modo e valor andam juntos: modo sem valor não diz quanto, valor sem modo não diz de quê.
alter table public.hercules_propostas
  drop constraint if exists hercules_propostas_ajuste_completo;

alter table public.hercules_propostas
  add constraint hercules_propostas_ajuste_completo
  check ((ajuste_modo is null) = (ajuste_valor is null));

comment on column public.hercules_propostas.preco_tabela is
  'Preço de tabela da unidade quando a proposta nasceu. Congelado: não reler do cadastro.';
comment on column public.hercules_propostas.ajuste_modo is
  'percentual | reais — a moeda em que o desconto foi pensado. Nulo = sem ajuste.';
comment on column public.hercules_propostas.ajuste_valor is
  'Quanto foi dado, na moeda de ajuste_modo. Negativo = desconto.';
