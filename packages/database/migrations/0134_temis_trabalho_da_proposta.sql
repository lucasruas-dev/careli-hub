-- 0134 · A ENTREGA À TÊMIS NUNCA CHEGOU, E O MOTIVO É UMA CHAVE ESTRANGEIRA
--
-- ⚠️ ISTO ESTÁ QUEBRADO EM PRODUÇÃO DESDE A v1.283.0. Medido no banco em 06/09/2026, antes de
-- escrever esta migration:
--
--     select count(*) from temis_trabalhos;                    ->  4   (as 4 linhas de seed)
--     select count(*) from temis_trabalhos where criado_em > '2026-09-05';  ->  0
--     select count(*) from hercules_vendas;                    ->  0
--
-- As DUAS vendas que o Lucas mandou para contrato em 05/09 (COD 000005 às 18:56 e COD 000006 às
-- 19:58) não abriram card nenhum na fila do jurídico. A tela avisou — o recado "foi para a fase de
-- contrato, mas a proposta NÃO chegou à Têmis" é da v1.283.0 —, mas a causa não estava no ar:
--
--     temis_trabalhos_venda_id_fkey
--       FOREIGN KEY (venda_id) REFERENCES hercules_vendas(id) ON DELETE SET NULL
--
-- `venda_id` aponta para `hercules_vendas`, que tem ZERO linhas, e o Hércules manda ali o id de
-- `hercules_propostas`. A FK é violada em TODA tentativa, sempre — não é intermitência, é o
-- caminho inteiro. `abrirTrabalho` devolve o erro, a rota não derruba a transição de propósito, e o
-- resultado é uma venda em `contrato` sem ninguém do outro lado sabendo que ela existe.
--
-- ⚠️ POR QUE UMA COLUNA NOVA E NÃO TROCAR A FK DA `venda_id`. `hercules_vendas` não é lixo: é a
-- tabela de onde o catálogo de variáveis da Têmis tira `valor_imovel_venda`, `valor_entrada`,
-- `valor_sinal`, `dia_vencimento`, `vendida_em` e o `plano_snapshot` da minuta
-- (apps/hub/lib/temis/variaveis.ts). Ela está vazia porque a venda ainda não é gravada lá — e
-- gravá-la hoje esbarra em `plano_id uuid not null`, que a proposta do Hércules não tem (o plano
-- dela pode vir do C2X, sem uuid no Panteon). Reapontar `venda_id` para as propostas apagaria esse
-- destino e deixaria o catálogo mentindo. As duas coisas convivem: `proposta_id` é a venda de HOJE,
-- `venda_id` continua reservada para quando `hercules_vendas` for preenchida de verdade.
--
-- ⚠️ E A COLUNA NÃO NASCE SÓ PARA SER ESCRITA. `trabalhos-db.ts` passa a lê-la no board junto com o
-- resto: é por ela que a Têmis volta à proposta e encontra cliente, compradores com participação,
-- condições, plano, cronograma e o PDF que o cliente já recebeu. Uma coluna que só recebe insert é
-- a mesma pendência de antes com outro nome.

alter table public.temis_trabalhos
  add column if not exists proposta_id uuid
    references public.hercules_propostas (id) on delete set null;

comment on column public.temis_trabalhos.proposta_id is
  'A proposta do Hércules que originou este trabalho. É dela que a Têmis tira cliente, compradores, condições, plano e PDF.';

-- O board da Têmis abre por proposta ("já existe pedido para esta venda?"), e é essa a pergunta que
-- a rota de cancelamento faz antes de abrir o segundo card.
create index if not exists temis_trabalhos_por_proposta
  on public.temis_trabalhos (proposta_id)
  where proposta_id is not null;

-- ── O PEDIDO DE CANCELAMENTO DEPOIS DO CONTRATO ─────────────────────────────
--
-- ⚠️ A VENDA EM `contrato` NÃO TINHA SAÍDA NENHUMA. Na ficha do lote, as quatro ações aparecem
-- apagadas: Reservar só em unidade disponível, Gerar proposta só sobre reserva, Enviar para
-- contrato só sobre proposta, e Cancelar só em reserva ou proposta. Quem despachou por engano — ou
-- cujo cliente desistiu depois — fica olhando um lote preso, sem um botão sequer.
--
-- ⚠️ E O CANCELAMENTO DEPOIS DO CONTRATO NÃO É DO COORDENADOR: é um PEDIDO ao jurídico, que decide
-- se o caso é cancelamento simples ou distrato com devolução (`lib/temis/cancelamento.ts`, que já
-- existe e está testada). Por isso estas colunas guardam o PEDIDO, e não a baixa: a etapa da venda
-- não se mexe aqui. Quem fecha é a Têmis, e isso ainda não existe — enquanto não existir, o carimbo
-- é o que impede o mesmo pedido de ser aberto duas vezes e o que a tela lê para trocar o botão.
alter table public.hercules_propostas
  add column if not exists cancelamento_pedido_em    timestamptz,
  add column if not exists cancelamento_pedido_tipo  text,
  add column if not exists cancelamento_pedido_por   text;

comment on column public.hercules_propostas.cancelamento_pedido_em is
  'Quando o cancelamento foi PEDIDO à Têmis. A venda continua na etapa em que está até o jurídico decidir.';
