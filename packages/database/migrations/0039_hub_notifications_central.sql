-- HUB / Central de notificacoes - backbone unico.
--
-- A tabela hub_notifications (criada no 0001) ja e por-destinatario (recipient_user_id)
-- e tem read_at, mas estava subutilizada: so era LIDA como contador na Home e escrita
-- por quase ninguem. Aqui ela vira a fonte UNICA da central do Panteon:
--   - todo modulo (Hermes, Zeus, Iris, Hades...) grava uma linha por destinatario;
--   - o cliente assina via realtime (postgres_changes) filtrado pelo proprio usuario;
--   - o Web Push dispara do mesmo insert.
--
-- Esta migration so ADICIONA (colunas de conteudo + RLS do proprio destinatario +
-- entrada na publicacao realtime). Idempotente. Nao mexe em dados (tabela vazia).

begin;

-- 1) Colunas de conteudo que faltavam para a central renderizar item completo.
alter table public.hub_notifications
  add column if not exists kind text,
  add column if not exists body text,
  add column if not exists context jsonb not null default '{}'::jsonb;

comment on column public.hub_notifications.kind is
  'Tipo da notificacao (mensagem/alerta/atendimento/agenda/operacao/sistema/tarefa).';
comment on column public.hub_notifications.body is
  'Descricao/preview da notificacao (linha secundaria na central).';
comment on column public.hub_notifications.context is
  'Contexto opcional para deep-link (ex.: hermesChannelId, entityId, entityType).';

-- 2) Index para a central por modulo (lista por destinatario + modulo, recente primeiro).
-- O index de nao-lido por destinatario ja existe (hub_notifications_recipient_read_created_at_idx, 0001).
create index if not exists hub_notifications_recipient_module_created_at_idx
  on public.hub_notifications (recipient_user_id, module_id, created_at desc);

-- 3) RLS: o RLS ja esta habilitado (0018), mas sem politicas (so service role acessava).
-- O cliente precisa LER as proprias notificacoes (inclusive via realtime, que respeita
-- RLS) e marcar como lida. O INSERT continua exclusivo do service role (sem policy).
drop policy if exists hub_notifications_select_own on public.hub_notifications;
create policy hub_notifications_select_own
  on public.hub_notifications
  for select
  using (recipient_user_id = auth.uid());

drop policy if exists hub_notifications_update_own on public.hub_notifications;
create policy hub_notifications_update_own
  on public.hub_notifications
  for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- 4) Realtime: entra na publicacao supabase_realtime para emitir postgres_changes.
-- Guardado para ser idempotente (nao falha se ja estiver na publicacao).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'hub_notifications'
  ) then
    alter publication supabase_realtime add table public.hub_notifications;
  end if;
end $$;

commit;
