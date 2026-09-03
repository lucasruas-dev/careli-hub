-- 0128 · A % MÍNIMA DE ENTRADA POR EMPREENDIMENTO
--
-- Lucas (03/09/2026), depois de ver o simulador oferecer entrada de R$ 5.000 num lote de R$ 178 mil:
-- *"lembrando que temos um valor mínimo de entrada, 10%"*, depois *"10% em diante"* (o próprio 10%
-- vale) e, ao decidir onde o número mora: *"vamos ter um campo dentro da parte que vamos cadastrar a
-- política comercial e lá vamos apontar a % mínima"*.
--
-- POR QUE DEIXA DE SER CONSTANTE. Os 10% nasceram chumbados em `lib/hercules/composicoes.ts`, e a
-- varredura do repositório mostrou por que isso não podia ficar assim: o GARDEN tem planos
-- cadastrados com 8% de entrada no C2X. Uma constante única ou proíbe o que o Garden vende, ou
-- libera abaixo do mínimo em todos os outros. A regra é por empreendimento porque a política
-- comercial é por empreendimento.
--
-- POR QUE AQUI E NÃO EM TABELA NOVA: `apolo_enterprise_settings` já é a configuração POR
-- EMPREENDIMENTO (limite de crédito, valor do PIX, gestão de carteira) e é onde a aba Política
-- Comercial já grava. Mesmo caminho, mesma tela, mesma chave.
--
-- ⚠️ NÃO CONFUNDIR COM `commercial_policies.initial_input_value` DO C2X, que a mesma aba já mostra
-- como "entrada mínima". Aquele é do legado, read-only, e alimenta a fórmula do líquido; ninguém no
-- Panteon o usa como trava. Este nasce no Apolo e é o que o simulador e a proposta vão OBEDECER — a
-- mesma divisão de águas da gestão de carteira (`gestao_carteira_c2x` × `gestao_carteira_apolo`).
--
-- ⚠️ NASCE NULO, e nulo NÃO É ZERO. Nulo significa "este empreendimento não cadastrou o mínimo", e
-- quem lê aplica o padrão da casa (10%). Um DEFAULT de 10 pareceria decisão tomada em 24
-- empreendimentos onde ninguém decidiu nada — e um DEFAULT de 0 liberaria venda sem entrada em
-- todos eles no dia em que a coluna subisse.

alter table public.apolo_enterprise_settings
  add column if not exists entrada_minima_percentual numeric(5, 2);

comment on column public.apolo_enterprise_settings.entrada_minima_percentual is
  'Percentual minimo de entrada (ato + sinal) aceito neste empreendimento, de 0 a 100. Nasce no '
  'Apolo, na aba Politica Comercial. Nulo = nao cadastrado; quem le aplica o padrao da casa (10%). '
  'NAO confundir com commercial_policies.initial_input_value do C2X, que e read-only e nao trava.';

-- Sanidade: fora de 0..100 é erro de digitação (8 e 80 são fáceis de confundir num campo de %).
alter table public.apolo_enterprise_settings
  drop constraint if exists apolo_enterprise_settings_entrada_minima_check;

alter table public.apolo_enterprise_settings
  add constraint apolo_enterprise_settings_entrada_minima_check
  check (
    entrada_minima_percentual is null
    or (entrada_minima_percentual >= 0 and entrada_minima_percentual <= 100)
  );
