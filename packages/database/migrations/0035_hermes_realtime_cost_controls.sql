-- Hermes realtime and cost controls.
-- Prepared for controlled Supabase application only after Lucas approval.

begin;

create index if not exists pulsex_channel_members_user_active_channel_idx
  on public.pulsex_channel_members (user_id, channel_id)
  where status = 'active';

-- Keep the canonical index name from the active database to avoid duplicate indexes.
create index if not exists pulsex_messages_channel_active_created_at_idx
  on public.pulsex_messages (channel_id, created_at desc)
  where deleted_at is null;

drop policy if exists "hermes authenticated read channel messages"
  on public.pulsex_messages;

create policy "hermes authenticated read channel messages"
  on public.pulsex_messages
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.pulsex_channel_members member
      where member.channel_id = pulsex_messages.channel_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );

drop policy if exists "hermes authenticated insert own channel messages"
  on public.pulsex_messages;

create policy "hermes authenticated insert own channel messages"
  on public.pulsex_messages
  for insert
  to authenticated
  with check (
    author_user_id = (select auth.uid())
    and exists (
      select 1
      from public.pulsex_channel_members member
      where member.channel_id = pulsex_messages.channel_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );

commit;
