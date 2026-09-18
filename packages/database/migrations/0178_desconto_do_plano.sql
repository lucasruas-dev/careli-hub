-- 0178 · O DESCONTO DO PLANO
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas. O código sobe ANTES dela e tolera a
-- coluna ausente (ver ATENCAO 4): a Mesa, o espelho, o portal e a aba de planos continuam de pé sem
-- esta migration, vendendo os planos sem desconto, como vendiam.
--
-- ⚠️ O NÚMERO: 0176 e 0177 estão reservados por outra branch. Esta é a 0178.
--
-- Lucas (18/09/2026), mandando o print da Mesa de Venda do Garden: *"olha por favor os planos, esta
-- diferente"* · *"esta faltando as anuais"* · *"tem que ser igual o mmendes"*. O cartão do
-- INVESTIDOR PARCELADO dizia "R$ 4.764 · 84x · entrada R$ 34.800 (8%)" num lote de R$ 435.000: a
-- tabela cheia, sem as anuais e sem o desconto do plano.
--
-- NO MAPA DO GARDEN NO PORTAL DA MMENDES (`apps/hub/masterplans-internos/garden.html`, `PLANOS`), O
-- DESCONTO É PARTE DO PLANO: Normal 0%, Investidor Parcelado 8%, Investidor 12%, e a conta de cada um
-- parte de `preço × (1 − desconto)`. Os planos do Garden foram gravados em `temis_planos` em
-- 17/09/2026 "com os mesmos planos do mapa do Garden no portal da MMendes", mas o desconto não tinha
-- coluna: ficou escrito na `observacao` ("aplicar no campo de desconto do simulador"), para alguém
-- lembrar de aplicar à mão, lote a lote. Esquecer é vender o Investidor Parcelado pelo preço cheio.
--
-- ATENCAO 1: É PERCENTUAL SOBRE O PREÇO DE TABELA, e não reais. "8" é 8%. O plano vale para todos
-- os lotes do produto, cada um com o seu preço: um desconto em reais daria percentuais diferentes
-- em cada lote, que não é o que a tabela da MMendes diz. `numeric(6,3)` guarda até 999,999 com três
-- casas, o mesmo formato de `entrada_percentual`; o CHECK prende em 0 a menos de 100.
--
-- ATENCAO 2: 100% NÃO É DESCONTO DE PLANO, é lote de graça. O CHECK recusa, e a rota
-- (`conferirPlano`, em `apps/hub/lib/temis/planos.ts`) recusa antes, com a frase em português. O
-- simulador usa o desconto pelo campo de desconto que já existia (`ajuste-de-preco.ts`), que corta
-- em 100% e nunca deixa o preço abaixo de um centavo.
--
-- ATENCAO 3: NOT NULL DEFAULT 0, e não nulo. "Sem desconto" tem um número só, e os planos que já
-- existem nascem com zero: todos os empreendimentos continuam vendendo exatamente como vendiam. Os
-- dois planos do Garden que têm desconto recebem o valor no arquivo irmão
-- `0178_desconto_do_plano.dados-garden.sql`, por id, depois desta.
--
-- ATENCAO 4: ENQUANTO ESTA MIGRATION NÃO RODA, as leituras de `temis_planos` que vendem (Mesa de
-- Venda, espelho público, aba de políticas do portal, aba de planos do Apolo) repetem a consulta sem
-- a coluna ao receber 42703 ou PGRST204 citando `desconto_percentual`
-- (`ehColunaDoDescontoAusente`), e o plano sai sem desconto. A escrita só recusa quando alguém tenta
-- GRAVAR um desconto maior que zero; salvar plano sem desconto continua funcionando.
--
-- ATENCAO 5: O DESCONTO DO PLANO NÃO PEDE MOTIVO NA PROPOSTA. Ele é a tabela oficial do plano, e
-- não uma exceção do coordenador; a `ModalDeProposta` só pede nota do que passa dele. A proposta
-- gravada guarda os dois lados: `ajuste_modo`/`ajuste_valor` (0151) com o desconto que foi DADO, e
-- `condicoes.plano.descontoPercentual` com o que o plano PREVIA.

alter table public.temis_planos
  add column if not exists desconto_percentual numeric(6,3) not null default 0;

alter table public.temis_planos
  drop constraint if exists temis_planos_desconto_percentual_faixa;

alter table public.temis_planos
  add constraint temis_planos_desconto_percentual_faixa check (
    desconto_percentual >= 0 and desconto_percentual < 100
  );

comment on column public.temis_planos.desconto_percentual is
  'Desconto do plano sobre o preco de tabela, em percentual (8 = 8%), de 0 a menos de 100. Zero = sem desconto. E o preco do plano, nao excecao: o simulador aplica sozinho ao escolher o plano e a proposta com ele nao pede motivo. Lucas, 18/09/2026: "tem que ser igual o mmendes" (mapa do Garden no portal da MMendes: Investidor Parcelado 8%, Investidor 12%).';
