-- O QUE ACONTECEU NA PROPOSTA ALÉM DE MUDAR DE ETAPA: pagamento e assinatura.
--
-- Lucas (03/09/2026), depois de ver o histórico da unidade: *"há trazer os pagamentos, as
-- assinaturas"*. A linha do tempo por etapa conta o processo; sem o dinheiro que entrou e sem quem
-- assinou, ela conta só metade — e são justamente as duas perguntas que aparecem numa auditoria.
--
-- ⚠️ UMA TABELA PARA OS DOIS, e não duas. Os dois são EVENTOS da mesma linha do tempo, lidos
-- sempre juntos e sempre pela mesma pergunta ("o que houve com este lote"). Duas tabelas dariam
-- duas consultas e um merge em memória para montar uma lista só.
--
-- ⚠️ E ELA NÃO É O FINANCEIRO. Guarda o EVENTO (pagou tanto, tal dia), não a carteira: nada de
-- saldo, vencimento futuro ou renegociação. O financeiro migra por empreendimento até dezembro e
-- terá as suas próprias tabelas; confundir as duas coisas agora criaria uma fonte concorrente de
-- verdade sobre dinheiro.
--
-- ⚠️ SÓ O QUE JÁ ACONTECEU. Das 118.904 parcelas do legado, 15.715 têm data de pagamento: as
-- outras 103 mil são vencimento futuro, e não são fato nenhum ainda.
--
-- ⚠️ E PARCELA NÃO ENTRA (Lucas, no mesmo minuto: *"parcela não precisa"*). A carga traz só Ato e
-- Sinal — 2.820 pagamentos. Num lote de 156 parcelas, as parcelas mensais cobririam os cinco
-- eventos que importam.
--
-- APLICADA em 03/09/2026 (via MCP do Supabase, projeto bxgukywoxgivlrhjkwjx).
create table if not exists public.hercules_proposta_eventos (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text not null default 'careli',
  proposta_id    uuid not null references public.hercules_propostas (id) on delete cascade,
  tipo           text not null,
  origem_c2x_id  bigint,
  quando         timestamptz not null,
  -- Quem assinou. Nulo no pagamento: o C2X guarda quem REGISTROU a baixa, não quem pagou.
  quem           text,
  -- CPF do signatário, cru. A tela mascara — o portal externo nunca mostra documento inteiro.
  documento      text,
  valor          numeric(15, 2),
  descricao      text,
  criado_em      timestamptz not null default now(),
  constraint hercules_proposta_eventos_tipo check (tipo in ('pagamento', 'assinatura')),
  constraint hercules_proposta_eventos_origem unique (tipo, origem_c2x_id)
);

create index if not exists hercules_proposta_eventos_por_proposta
  on public.hercules_proposta_eventos (proposta_id, quando desc);

comment on table public.hercules_proposta_eventos is
  'Pagamentos realizados e assinaturas de uma proposta - os eventos da linha do tempo que nao sao mudanca de etapa. Nao e o financeiro.';
