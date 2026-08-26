-- 0109 · Uma linha por pessoa no financeiro do Apolo — para o card do Board não mentir.
--
-- ⚠️ O BUG QUE ISTO FECHA (26/08/2026). O card da Iris decide "Comprador" x "Prospect" pela
-- presença do snapshot financeiro, e a rota /api/iris/apolo/phone-match lia assim:
--
--     .from("apolo_financial_snapshots").select("entity_id,overdue_installments")
--     .in("entity_id", [ate 100 pessoas])
--
-- `apolo_financial_snapshots` tem UMA LINHA POR COMPETENCIA: medido, ~55 por pessoa em 256.621
-- linhas. Com 100 telefones no lote, a consulta pede ~5.500 linhas e o PostgREST corta em 1.000 —
-- só as primeiras ~18 pessoas voltavam com financeiro. As outras 82 chegavam ao card sem o dado, e
-- o card as mostrava como "Prospect" mesmo tendo carteira.
--
-- Ao ABRIR a conversa era uma pessoa só (55 linhas, cabe), e ali aparecia "Comprador" — a
-- divergência que o Lucas apontou: *"o status no card dentro do board está trazendo o perfil
-- errado (...) quando eu abro a conversa o status atualiza para comprador que é o correto"*.
--
-- ⚠️ A CORREÇÃO É NÃO PEDIR 5.500 LINHAS PARA RESPONDER 100 PERGUNTAS. Esta view devolve uma linha
-- por pessoa (4.707 hoje), então o mesmo lote de 100 telefones lê 100 linhas e nunca esbarra no
-- teto. Aumentar o limite do PostgREST resolveria hoje e voltaria a quebrar quando a carteira
-- crescer; agregar resolve para sempre.
--
-- ⚠️ O QUE A VIEW RESPONDE, e só isso: "esta pessoa tem carteira?" e "tem parcela vencida?". O
-- histórico mês a mês continua na tabela, para quem precisa dele.

create or replace view public.apolo_financeiro_por_entidade as
select
  entity_id,
  -- Do snapshot MAIS RECENTE: a inadimplência de hoje, não a soma histórica. Somar competências
  -- diria "12 parcelas vencidas" de quem atrasou uma e já pagou.
  (array_agg(overdue_installments order by snapshot_date desc nulls last))[1] as overdue_installments,
  (array_agg(overdue_amount order by snapshot_date desc nulls last))[1] as overdue_amount,
  (array_agg(total_portfolio_amount order by snapshot_date desc nulls last))[1] as total_portfolio_amount,
  max(snapshot_date) as snapshot_date,
  count(*) as competencias
from public.apolo_financial_snapshots
group by entity_id;

comment on view public.apolo_financeiro_por_entidade is
  'Uma linha por pessoa a partir de apolo_financial_snapshots (que tem ~55 por pessoa, uma por competencia). Existe para a rota /api/iris/apolo/phone-match responder "tem carteira?" e "tem parcela vencida?" sem estourar o teto de 1.000 linhas do PostgREST — era o que fazia o card do Board mostrar Prospect para quem ja e Comprador. Valores vem do snapshot MAIS RECENTE.';

-- A view herda a RLS da tabela-base (security invoker é o padrão em views novas no Postgres 15+),
-- então quem já lia o snapshot lê isto, e ninguém a mais.
grant select on public.apolo_financeiro_por_entidade to authenticated;
