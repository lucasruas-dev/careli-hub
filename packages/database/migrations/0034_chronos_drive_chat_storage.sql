-- Chronos Drive, chat and storage preparation.
-- Prepared for DataOps review; do not apply without Lucas/DataOps approval.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'chronos-drive',
  'chronos-drive',
  false,
  500000000,
  array[
    'video/webm',
    'video/mp4',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'application/json',
    'application/pdf',
    'text/plain'
  ]::text[]
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.chronos_recordings
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint
    check (size_bytes is null or size_bytes >= 0),
  add column if not exists uploaded_at timestamptz;

create table if not exists public.chronos_chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.chronos_meetings(id) on delete cascade,
  participant_id uuid
    references public.chronos_participants(id) on delete set null,
  sender_name text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chronos_chat_messages_sender_not_blank
    check (btrim(sender_name) <> ''),
  constraint chronos_chat_messages_content_not_blank
    check (btrim(content) <> '')
);

comment on table public.chronos_chat_messages is
  'Mensagens registradas dentro de chamadas Chronos para preservar memoria formal.';

create table if not exists public.chronos_participant_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.hub_users(id) on delete cascade,
  room_id uuid references public.chronos_rooms(id) on delete cascade,
  participant_fingerprint text,
  preference_type text not null,
  value jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_participant_preferences_type_not_blank
    check (btrim(preference_type) <> ''),
  constraint chronos_participant_preferences_owner_present
    check (user_id is not null or btrim(coalesce(participant_fingerprint, '')) <> '')
);

comment on table public.chronos_participant_preferences is
  'Preferencias de participante Chronos, incluindo fundo virtual da sala externa.';

create index if not exists chronos_recordings_storage_path_idx
  on public.chronos_recordings (storage_bucket, storage_path)
  where storage_path is not null;

create index if not exists chronos_chat_messages_meeting_created_idx
  on public.chronos_chat_messages (meeting_id, created_at);

create index if not exists chronos_participant_preferences_user_idx
  on public.chronos_participant_preferences (user_id, room_id, preference_type)
  where user_id is not null;

create unique index if not exists chronos_participant_preferences_user_key
  on public.chronos_participant_preferences (user_id, room_id, preference_type)
  where user_id is not null;

create unique index if not exists chronos_participant_preferences_guest_key
  on public.chronos_participant_preferences (
    participant_fingerprint,
    room_id,
    preference_type
  )
  where user_id is null
    and participant_fingerprint is not null;

drop trigger if exists set_chronos_participant_preferences_updated_at
  on public.chronos_participant_preferences;
create trigger set_chronos_participant_preferences_updated_at
before update on public.chronos_participant_preferences
for each row execute function public.set_hub_updated_at();

alter table public.chronos_chat_messages enable row level security;
alter table public.chronos_participant_preferences enable row level security;

grant select on
  public.chronos_chat_messages,
  public.chronos_participant_preferences
to authenticated, service_role;

grant insert, update on
  public.chronos_chat_messages,
  public.chronos_participant_preferences
to authenticated, service_role;

do $$
declare
  chronos_table text;
begin
  foreach chronos_table in array array[
    'chronos_chat_messages',
    'chronos_participant_preferences'
  ] loop
    execute format(
      'drop policy if exists "chronos authenticated read" on public.%I',
      chronos_table
    );
    execute format($policy$
      create policy "chronos authenticated read"
        on public.%I
        for select
        to authenticated
        using (public.has_chronos_permission('chronos:view'))
    $policy$, chronos_table);

    execute format(
      'drop policy if exists "chronos authenticated manage" on public.%I',
      chronos_table
    );
    execute format($policy$
      create policy "chronos authenticated manage"
        on public.%I
        for all
        to authenticated
        using (public.has_chronos_permission('chronos:manage'))
        with check (public.has_chronos_permission('chronos:manage'))
    $policy$, chronos_table);
  end loop;
end $$;

drop policy if exists "chronos drive authenticated read" on storage.objects;
create policy "chronos drive authenticated read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chronos-drive'
    and public.has_chronos_permission('chronos:view')
  );

drop policy if exists "chronos drive authenticated manage" on storage.objects;
create policy "chronos drive authenticated manage"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'chronos-drive'
    and public.has_chronos_permission('chronos:manage')
  )
  with check (
    bucket_id = 'chronos-drive'
    and public.has_chronos_permission('chronos:manage')
  );

alter table public.chronos_chat_messages replica identity full;
alter table public.chronos_participant_preferences replica identity full;

commit;
