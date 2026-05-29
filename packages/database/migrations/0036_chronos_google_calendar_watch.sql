-- Chronos Google Calendar push notifications.
-- Stores webhook channel metadata without persisting the raw verification token.

begin;

alter table public.chronos_google_calendar_connections
  add column if not exists watch_channel_id text,
  add column if not exists watch_resource_id text,
  add column if not exists watch_resource_uri text,
  add column if not exists watch_token_hash text,
  add column if not exists watch_status text not null default 'missing',
  add column if not exists watch_started_at timestamptz,
  add column if not exists watch_expires_at timestamptz,
  add column if not exists watch_last_notification_at timestamptz,
  add column if not exists watch_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chronos_google_calendar_connections_watch_status_check'
  ) then
    alter table public.chronos_google_calendar_connections
      add constraint chronos_google_calendar_connections_watch_status_check
      check (watch_status in ('active', 'expired', 'missing', 'error'));
  end if;
end $$;

create index if not exists chronos_google_calendar_connections_watch_channel_idx
  on public.chronos_google_calendar_connections (watch_channel_id)
  where watch_channel_id is not null;

comment on column public.chronos_google_calendar_connections.watch_channel_id is
  'Identificador do canal Google Calendar events.watch ativo para o espelho Chronos.';

comment on column public.chronos_google_calendar_connections.watch_token_hash is
  'Hash SHA-256 do token de verificacao do webhook Google. O token em texto puro nao e persistido.';

commit;
