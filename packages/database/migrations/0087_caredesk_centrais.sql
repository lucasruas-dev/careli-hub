-- IRIS: as DUAS CENTRAIS como visão de topo.
--
-- Pedido do Lucas (15/08/2026): "eu queria uma aba geral que separa Atendimento de
-- Relacionamento, aplicaria as mesma estrutura, somente a separação. (…) depois vou linkar os
-- colaboradores para cada central, ae ele enxergariam separado, ae alguns teria a visão das
-- duas centrais".
--
-- A central é um agrupamento de FILAS, um nível acima do que já existe. Não substitui fila,
-- canal nem o escopo por departamento/setor: some a eles.
--
-- ⚠️ VIVE EM `metadata`, não em coluna nova. É o padrão que as filas já usam para
-- `defaultAssigneeUserId` e `channelId`, e evita DDL numa tabela que a Iris lê o tempo todo.
-- Se um dia a central virar entidade com regra própria, aí sim ganha tabela.
--
-- ✅ APLICADA EM PRODUCAO em 15/08/2026, com autorizacao do Lucas.
-- Resultado: Atendimento com 8 filas (98 abertos, 1.702 em 30 dias) e Relacionamento com 4
-- (67 abertos, 658). Nenhuma fila ficou orfa — a trava do final confirmou.

-- ── CENTRAL DE ATENDIMENTO: o cliente final ──────────────────────────────────
-- Inclui as filas hoje zeradas (decisão do Lucas): elas nasceram do fluxo de cliente, e deixar
-- fila sem central faria um ticket futuro sumir das duas visões, ou seja, da tela de todo mundo.
update public.caredesk_queues
   set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('central', 'atendimento')
 where slug in (
   'atendimento',
   'financeiro',
   'cobranca',
   'contrato',
   'suporte',
   'juridico',
   'supervisionamento-de-atendimento',
   'comunicados'
 );

-- ── CENTRAL DE RELACIONAMENTO: corretor, imobiliária e parceiro ──────────────
-- `gurgel` entra aqui por decisão do Lucas: quem fala naquele número é a equipe do parceiro,
-- não o cliente final.
-- `relacionamento` (slug antigo, 1 ticket) entra junto para não ficar órfã.
update public.caredesk_queues
   set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('central', 'relacionamento')
 where slug in (
   'relacionamento-direct',
   'grupos-whatsapp',
   'relacionamento',
   'gurgel'
 );

-- ── CONFERÊNCIA: nenhuma fila pode ficar sem central ─────────────────────────
-- Fila sem central não aparece em nenhuma das duas visões. Se sobrar alguma, a migration falha
-- em vez de deixar o buraco passar despercebido.
do $$
declare
  orfas text;
begin
  select string_agg(slug, ', ') into orfas
    from public.caredesk_queues
   where metadata->>'central' is null;

  if orfas is not null then
    raise exception 'Filas sem central: %. Mapeie antes de aplicar.', orfas;
  end if;
end $$;
