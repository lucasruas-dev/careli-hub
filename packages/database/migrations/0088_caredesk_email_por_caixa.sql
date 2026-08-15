-- IRIS: um canal de e-mail POR CAIXA, dividido entre as duas centrais.
--
-- Pedido do Lucas (15/08/2026): "já cria a aba de e-mails. contato, compras e rh vai para o
-- relacionamento, o resto vai para o atendimento (…) quero incluir a cacá no atendimento (ela
-- está no grupo de cada e-mails, ou seja, ela recebe todos os e-mails de todas as caixas)".
--
-- ⚠️ O ROTEAMENTO POR CAIXA JÁ EXISTE NO CÓDIGO, e é por isso que esta migration é só dado.
-- `gmail-inbound.ts:127` cruza os destinatários de `Delivered-To` E de `To`, e a linha 214
-- documenta que um e-mail de grupo bate DOIS canais: o da caixa que o cliente escreveu
-- (contato@, do To) e o da caixa robô (caca@, do Delivered-To). Faltavam os canais.
--
-- Hoje existe UM canal só (`email-contato`, ingestMailbox `caca@careli.adm.br`), então tudo de
-- todas as caixas cai na mesma porta, na fila Atendimento: 118 tickets em 30 dias sem
-- separação nenhuma.
--
-- ✅ APLICADA EM PRODUCAO em 15/08/2026, com autorizacao do Lucas.
-- Resultado: 8 canais de e-mail, 5 na Central de Atendimento (4 com a CACA ligada) e 3 na
-- Central de Relacionamento. A caixa robo virou 'E-mail (outros)' e segue ativa como rede de
-- seguranca. Nenhuma fila ficou orfa.

-- ── AS FILAS QUE FALTAM ──────────────────────────────────────────────────────
-- Cobrança, Financeiro e Jurídico já existem e são reusadas. Estas nascem agora, com o mesmo
-- SLA padrão das demais.
insert into public.caredesk_queues (workspace_id, name, slug, status, metadata)
select q.workspace_id, v.nome, v.slug, q.status,
       jsonb_build_object('central', v.central)
  from public.caredesk_queues q
 cross join (values
   ('Contato',            'contato',     'relacionamento'),
   ('Recursos Humanos',   'rh',          'relacionamento'),
   ('Compras',            'compras',     'relacionamento'),
   ('Antecipação',        'antecipacao', 'atendimento')
 ) as v(nome, slug, central)
 where q.slug = 'atendimento'
   and not exists (select 1 from public.caredesk_queues x where x.slug = v.slug);

-- ── UM CANAL POR CAIXA ───────────────────────────────────────────────────────
-- `ingestMailbox` é o que o roteador compara com os destinatários do e-mail.
-- `cacaEnabled` liga a CACÁ: TRUE nas caixas da Central de Atendimento (pedido do Lucas),
-- FALSE nas de Relacionamento, onde ela ainda não tem contexto de corretor.
insert into public.caredesk_channels
  (workspace_id, name, slug, kind, provider, status, config, metadata)
select
  base.workspace_id,
  v.nome,
  v.slug,
  base.kind,
  base.provider,
  base.status,
  jsonb_build_object(
    'ingestMailbox', v.caixa,
    'defaultQueueSlug', v.fila,
    'cacaEnabled', v.caca,
    'inbound_enabled', true,
    'outbound_enabled', true,
    'webhook_path', base.config->>'webhook_path'
  ),
  jsonb_build_object('origem', 'migration 0088', 'central', v.central)
from public.caredesk_channels base
cross join (values
  -- CENTRAL DE RELACIONAMENTO
  ('E-mail Contato',      'email-contato-caixa', 'contato@careli.adm.br',     'contato',     'relacionamento', false),
  ('E-mail RH',           'email-rh',            'rh@careli.adm.br',          'rh',          'relacionamento', false),
  ('E-mail Compras',      'email-compras',       'compras@careli.adm.br',     'compras',     'relacionamento', false),
  -- CENTRAL DE ATENDIMENTO (com a CACÁ ligada, pedido do Lucas)
  ('E-mail Cobrança',     'email-cobranca',      'cobranca@careli.adm.br',    'cobranca',    'atendimento',    true),
  ('E-mail Financeiro',   'email-financeiro',    'financeiro@careli.adm.br',  'financeiro',  'atendimento',    true),
  ('E-mail Jurídico',     'email-juridico',      'juridico@careli.adm.br',    'juridico',    'atendimento',    true),
  ('E-mail Antecipação',  'email-antecipacao',   'antecipacao@careli.adm.br', 'antecipacao', 'atendimento',    true)
) as v(nome, slug, caixa, fila, central, caca)
where base.slug = 'email-contato'
  and not exists (select 1 from public.caredesk_channels x where x.slug = v.slug);

-- ── A CAIXA ROBÔ CONTINUA EXISTINDO, COMO REDE DE SEGURANÇA ─────────────────
-- `email-contato` (ingestMailbox caca@) fica ATIVO de propósito: e-mail endereçado só à caca@,
-- ou de uma caixa que ainda não tem canal, continua entrando por aqui em vez de sumir.
-- Passa a se chamar "E-mail (outros)" para ninguém confundir com a caixa contato@.
update public.caredesk_channels
   set name = 'E-mail (outros)',
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'central', 'atendimento',
         'papel', 'rede de seguranca: e-mail sem caixa mapeada cai aqui')
 where slug = 'email-contato';

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
do $$
declare orfas text;
begin
  select string_agg(slug, ', ') into orfas
    from public.caredesk_queues where metadata->>'central' is null;
  if orfas is not null then
    raise exception 'Filas sem central: %', orfas;
  end if;
end $$;
