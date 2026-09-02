-- O TRABALHO QUE NASCEU DE UMA VENDA DO HÉRCULES.
--
-- Regra do Lucas (02/09/2026): *"contrato vai nascer do hercules, o coordenador ou operador vai
-- inputar a proposta e vai ter a opção de emissão de contrato"*.
--
-- ⚠️ UM CONTRATO POR VENDA, E A TRAVA É DO BANCO. Dois cliques em segundos abrem dois trabalhos, e
-- o board mostra a mesma pessoa duas vezes na fila de assinatura — que é como se despacha dois
-- contratos do mesmo imóvel para o mesmo comprador. A mesma lição do índice parcial que impede
-- vender duas vezes a mesma unidade: no salão, dezenas de tablets abrem a mesma tela.
--
-- ⚠️ O ÍNDICE É PARCIAL, e não único simples: `venda_id` é nulo em todo trabalho que NÃO nasceu de
-- venda (cessão, distrato, cancelamento), e um único comum trataria os nulos como iguais em alguns
-- bancos — travando o segundo distrato da casa.
alter table public.temis_trabalhos
  add column if not exists venda_id uuid references public.hercules_vendas (id) on delete set null;

create unique index if not exists temis_trabalhos_uma_por_venda
  on public.temis_trabalhos (venda_id)
  where venda_id is not null;

comment on column public.temis_trabalhos.venda_id is
  'A venda do Hércules que originou este contrato. Uma venda gera no máximo um trabalho.';
