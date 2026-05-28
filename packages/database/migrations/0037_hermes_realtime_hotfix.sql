begin;

create index if not exists pulsex_messages_channel_active_created_at_idx
  on public.pulsex_messages (channel_id, created_at desc)
  where deleted_at is null;

create index if not exists pulsex_messages_thread_parent_created_at_idx
  on public.pulsex_messages (
    channel_id,
    ((metadata ->> 'threadParentMessageId')),
    created_at desc
  )
  where deleted_at is null and metadata ? 'threadParentMessageId';

create index if not exists pulsex_messages_client_message_id_idx
  on public.pulsex_messages ((metadata ->> 'clientMessageId'))
  where deleted_at is null and metadata ? 'clientMessageId';

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'pulsex_messages'
    ) then
      alter publication supabase_realtime add table public.pulsex_messages;
    end if;
  end if;
end $$;

commit;
