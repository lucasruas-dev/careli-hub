-- VOL1106 e VOC0306: a venda volta para Proposta, com a história inteira.
--
-- Por quê: a Nívea indeferiu na Têmis, em 17/09/2026, primeiro o card de contrato das duas vendas
-- (VOC0306: "Contrato não será gerado, pois foi solicitado o cancelamento.") e depois o pedido de
-- cancelamento (VOL1106: "Cancelamento não será realizado, pois não foi gerado contrato nem boletos.").
-- Naquela época o indeferimento não
-- mexia na venda: as duas ficaram em `contrato`, com a marca do pedido de pé, sem card aberto e sem
-- saída pela tela. O código da v1.351.1 faz isto sozinho daqui para frente
-- (`recusarOPedido` → `devolverAQuemVendeu`); este arquivo faz o mesmo, uma vez, para as duas que
-- ficaram presas antes dele. Depois disto, a tela da Venda oferece "Cancelar proposta", e o
-- cancelamento devolve o lote.
--
-- O que grava, na ordem do código:
--   1. história do pedido (quem pediu, quando, por quê) e da recusa (quem, quando, motivo, observação);
--   2. limpa a marca do pedido, só se ela ainda for a mesma lida;
--   3. volta a venda de `contrato` para `proposta`, só se ainda estiver em contrato e sem marca;
--   4. história da volta, com o motivo e a observação do contrato indeferido.
--
-- Conferido antes (18/09/2026, SELECT): as duas com origem panteon, etapa contrato, 0 envelopes, card
-- de contrato e card de cancelamento indeferidos, nenhum card aberto, reserva em `proposta`, unidade
-- `reservada`.
--
-- ⚠️ SÓ RODA COM OK DO LUCAS. É escrita em produção (bxgukywoxgivlrhjkwjx).

begin;

with vendas as (
  select p.id, p.cancelamento_pedido_em, p.cancelamento_pedido_motivo, p.cancelamento_pedido_por,
         p.cancelamento_pedido_tipo
  from hercules_propostas p
  where p.workspace_id = 'careli'
    and p.id in ('ca03bbcb-87b6-4158-b6e9-ab7a253cebe4', '82011db5-74a0-4923-90f6-3be75771a138')
    and p.etapa = 'contrato'
    and p.cancelamento_pedido_em is not null
    and not exists (
      select 1 from temis_trabalhos t
      where t.proposta_id = p.id and t.estagio not in ('faturado', 'indeferido')
    )
),
recusa as (
  select distinct on (t.proposta_id) t.proposta_id, t.indeferido_em, t.indeferido_observacao, t.indeferido_por_nome
  from temis_trabalhos t join vendas v on v.id = t.proposta_id
  where t.tipo in ('cancelamento', 'distrato') and t.estagio = 'indeferido'
  order by t.proposta_id, t.indeferido_em desc
)
insert into hercules_proposta_etapas (autor_nome, de, motivo, observacao, para, proposta_id, quando, workspace_id)
select v.cancelamento_pedido_por, null, v.cancelamento_pedido_motivo, null,
       case when v.cancelamento_pedido_tipo = 'distrato' then 'pedido_de_distrato' else 'pedido_de_cancelamento' end,
       v.id, v.cancelamento_pedido_em, 'careli'
from vendas v
union all
select r.indeferido_por_nome, null, 'Outro motivo', r.indeferido_observacao,
       case when v.cancelamento_pedido_tipo = 'distrato' then 'pedido_de_distrato_indeferido' else 'pedido_de_cancelamento_indeferido' end,
       v.id, r.indeferido_em, 'careli'
from vendas v join recusa r on r.proposta_id = v.id;

update hercules_propostas p
set cancelamento_pedido_em = null, cancelamento_pedido_motivo = null, cancelamento_pedido_por = null,
    cancelamento_pedido_tipo = null, atualizado_em = now()
where p.workspace_id = 'careli'
  and p.id in ('ca03bbcb-87b6-4158-b6e9-ab7a253cebe4', '82011db5-74a0-4923-90f6-3be75771a138')
  and p.etapa = 'contrato'
  and p.cancelamento_pedido_em in ('2026-09-16 18:01:41.367+00', '2026-09-16 19:09:41.362+00');

with contrato as (
  select distinct on (t.proposta_id) t.proposta_id, t.indeferido_observacao, t.indeferido_por_nome
  from temis_trabalhos t
  where t.proposta_id in ('ca03bbcb-87b6-4158-b6e9-ab7a253cebe4', '82011db5-74a0-4923-90f6-3be75771a138')
    and t.tipo = 'contrato'
  order by t.proposta_id, t.criado_em desc
),
voltou as (
  update hercules_propostas p
  set etapa = 'proposta', etapa_desde = now(), etapa_por = c.indeferido_por_nome, atualizado_em = now()
  from contrato c
  where c.proposta_id = p.id
    and p.workspace_id = 'careli'
    and p.etapa = 'contrato'
    and p.cancelamento_pedido_em is null
  returning p.id, c.indeferido_observacao, c.indeferido_por_nome
)
insert into hercules_proposta_etapas (autor_nome, de, motivo, observacao, para, proposta_id, quando, workspace_id)
select v.indeferido_por_nome, 'contrato', 'Contrato indeferido na Têmis: Outro motivo', v.indeferido_observacao,
       'proposta', v.id, now(), 'careli'
from voltou v;

-- Conferência: as duas em proposta, sem marca, com os 3 movimentos novos (pedido, recusa, volta).
select p.id, p.etapa, p.cancelamento_pedido_em,
       (select array_agg(e.para order by e.quando) from hercules_proposta_etapas e
        where e.proposta_id = p.id
          and (e.para in ('pedido_de_cancelamento', 'pedido_de_cancelamento_indeferido')
               or (e.de = 'contrato' and e.para = 'proposta'))) as movimentos
from hercules_propostas p
where p.id in ('ca03bbcb-87b6-4158-b6e9-ab7a253cebe4', '82011db5-74a0-4923-90f6-3be75771a138');

commit;
