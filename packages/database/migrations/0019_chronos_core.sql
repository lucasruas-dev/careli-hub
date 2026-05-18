-- Chronos executive meeting core.
-- Formal rooms, meetings, recordings, transcripts, minutes and follow-ups.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_meeting_type') then
    create type public.chronos_meeting_type as enum (
      'executive',
      'external',
      'client',
      'results',
      'alignment',
      'formal'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_meeting_status') then
    create type public.chronos_meeting_status as enum (
      'scheduled',
      'lobby',
      'live',
      'review',
      'closed',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_capture_status') then
    create type public.chronos_capture_status as enum (
      'not_started',
      'pending',
      'recording',
      'processing',
      'available',
      'failed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_minutes_status') then
    create type public.chronos_minutes_status as enum (
      'not_started',
      'draft',
      'in_review',
      'approved',
      'rejected'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_participant_role') then
    create type public.chronos_participant_role as enum (
      'host',
      'presenter',
      'participant',
      'external',
      'reviewer'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_followup_status') then
    create type public.chronos_followup_status as enum (
      'open',
      'in_progress',
      'done',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chronos_event_type') then
    create type public.chronos_event_type as enum (
      'created',
      'scheduled',
      'joined',
      'left',
      'screen_shared',
      'recording_started',
      'recording_stopped',
      'transcript_added',
      'summary_generated',
      'minutes_drafted',
      'minutes_submitted',
      'minutes_approved',
      'followup_created',
      'followup_done',
      'note'
    );
  end if;
end $$;

create table if not exists public.chronos_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  name text not null,
  slug text not null,
  room_type text not null default 'executive',
  capacity integer not null default 12 check (capacity > 0),
  status public.hub_record_status not null default 'active',
  recording_required boolean not null default true,
  transcription_required boolean not null default true,
  minutes_required boolean not null default true,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_rooms_slug_key unique (slug),
  constraint chronos_rooms_name_not_blank check (btrim(name) <> ''),
  constraint chronos_rooms_slug_not_blank check (btrim(slug) <> ''),
  constraint chronos_rooms_type_not_blank check (btrim(room_type) <> '')
);

comment on table public.chronos_rooms is
  'Salas executivas e institucionais do Chronos para reunioes formais.';

create table if not exists public.chronos_meetings (
  id uuid primary key default gen_random_uuid(),
  protocol text not null,
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  room_id uuid references public.chronos_rooms(id) on delete set null,
  title text not null,
  meeting_type public.chronos_meeting_type not null default 'executive',
  status public.chronos_meeting_status not null default 'scheduled',
  objective text,
  external_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  host_user_id uuid references public.hub_users(id) on delete set null,
  host_name text,
  recording_status public.chronos_capture_status not null default 'not_started',
  transcription_status public.chronos_capture_status not null default 'not_started',
  minutes_status public.chronos_minutes_status not null default 'not_started',
  executive_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_meetings_protocol_key unique (protocol),
  constraint chronos_meetings_protocol_not_blank check (btrim(protocol) <> ''),
  constraint chronos_meetings_title_not_blank check (btrim(title) <> '')
);

comment on table public.chronos_meetings is
  'Reunioes formais do Chronos com status, resumo executivo e trilha de formalizacao.';

create table if not exists public.chronos_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  user_id uuid references public.hub_users(id) on delete set null,
  display_name text not null,
  email text,
  organization text,
  role public.chronos_participant_role not null default 'participant',
  attendance_status text not null default 'invited',
  joined_at timestamptz,
  left_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_participants_name_not_blank check (btrim(display_name) <> ''),
  constraint chronos_participants_attendance_not_blank check (btrim(attendance_status) <> '')
);

comment on table public.chronos_participants is
  'Participantes internos, externos, apresentadores e revisores da reuniao.';

create table if not exists public.chronos_timeline_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  event_type public.chronos_event_type not null default 'note',
  title text not null,
  description text,
  actor_user_id uuid references public.hub_users(id) on delete set null,
  event_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chronos_timeline_events_title_not_blank check (btrim(title) <> '')
);

comment on table public.chronos_timeline_events is
  'Linha do tempo formal de eventos, decisoes e marcos da reuniao.';

create table if not exists public.chronos_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  speaker_label text,
  content text not null,
  source text not null default 'manual',
  started_at timestamptz,
  ended_at timestamptz,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chronos_transcript_segments_content_not_blank check (btrim(content) <> ''),
  constraint chronos_transcript_segments_source_not_blank check (btrim(source) <> '')
);

comment on table public.chronos_transcript_segments is
  'Trechos de transcricao da reuniao, manuais ou vindos de provedor de IA.';

create table if not exists public.chronos_minutes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status public.chronos_minutes_status not null default 'draft',
  content text not null,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  reviewer_user_id uuid references public.hub_users(id) on delete set null,
  reviewed_at timestamptz,
  approved_by_user_id uuid references public.hub_users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_minutes_content_not_blank check (btrim(content) <> ''),
  constraint chronos_minutes_meeting_version_key unique (meeting_id, version)
);

comment on table public.chronos_minutes is
  'Atas do Chronos. Aprovacao humana e obrigatoria antes do fechamento formal.';

create table if not exists public.chronos_followups (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  title text not null,
  owner_user_id uuid references public.hub_users(id) on delete set null,
  owner_name text,
  due_at timestamptz,
  status public.chronos_followup_status not null default 'open',
  completed_at timestamptz,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_followups_title_not_blank check (btrim(title) <> '')
);

comment on table public.chronos_followups is
  'Encaminhamentos operacionais derivados de reunioes formais.';

create table if not exists public.chronos_recordings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  status public.chronos_capture_status not null default 'pending',
  storage_bucket text,
  storage_path text,
  started_at timestamptz,
  stopped_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chronos_recordings is
  'Metadados das gravacoes do Chronos; binarios devem ser armazenados em Storage.';

insert into public.hub_modules (
  id,
  name,
  description,
  category,
  status,
  base_path,
  icon_key,
  realtime_enabled,
  "order"
) values (
  'chronos',
  'Chronos',
  'Reunioes executivas, atas, transcricoes e memoria formal.',
  'operations',
  'active',
  '/chronos',
  'chronos',
  true,
  22
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  status = excluded.status,
  base_path = excluded.base_path,
  icon_key = excluded.icon_key,
  realtime_enabled = excluded.realtime_enabled,
  "order" = excluded."order",
  updated_at = now();

insert into public.hub_permissions (
  id,
  key,
  scope,
  module_id,
  description
) values
  ('chronos-view', 'chronos:view', 'module', 'chronos', 'Acessar o Chronos.'),
  ('chronos-manage', 'chronos:manage', 'module', 'chronos', 'Gerenciar salas, reunioes, atas e follow-ups do Chronos.')
on conflict (id) do update set
  key = excluded.key,
  scope = excluded.scope,
  module_id = excluded.module_id,
  description = excluded.description,
  updated_at = now();

insert into public.hub_department_modules (
  department_id,
  module_id,
  status
)
select
  department.id,
  'chronos',
  'enabled'::public.hub_department_module_status
from public.hub_departments department
where department.status = 'active'
on conflict (department_id, module_id) do update set
  status = excluded.status,
  updated_at = now();

insert into public.chronos_rooms (
  name,
  slug,
  room_type,
  capacity,
  recording_required,
  transcription_required,
  minutes_required,
  metadata
) values
  ('Sala Executiva', 'sala-executiva', 'executive', 12, true, true, true, '{"seed": true}'::jsonb),
  ('Sala Cliente', 'sala-cliente', 'external', 16, true, true, true, '{"seed": true}'::jsonb),
  ('Sala Resultado', 'sala-resultado', 'results', 20, true, true, true, '{"seed": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  room_type = excluded.room_type,
  capacity = excluded.capacity,
  recording_required = excluded.recording_required,
  transcription_required = excluded.transcription_required,
  minutes_required = excluded.minutes_required,
  metadata = public.chronos_rooms.metadata || excluded.metadata,
  updated_at = now();

create or replace function public.has_chronos_permission(required_permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.hub_users user_profile
    where user_profile.id = auth.uid()
      and user_profile.status = 'active'
      and (
        (
          required_permission = 'chronos:view'
          and user_profile.role in ('admin', 'leader', 'operator', 'viewer')
        )
        or (
          required_permission = 'chronos:manage'
          and user_profile.role in ('admin', 'leader')
        )
        or exists (
          select 1
          from public.hub_user_permissions user_permission
          join public.hub_permissions permission
            on permission.id = user_permission.permission_id
          where user_permission.user_id = user_profile.id
            and user_permission.revoked_at is null
            and permission.key = required_permission
        )
      )
  );
$$;

comment on function public.has_chronos_permission(text) is
  'Verifica permissao Chronos para RLS sem expor tabelas internas de permissoes.';

revoke all on function public.has_chronos_permission(text) from public;
grant execute on function public.has_chronos_permission(text)
to authenticated, service_role;

create index if not exists chronos_rooms_status_order_idx
  on public.chronos_rooms (status, name);

create index if not exists chronos_meetings_status_starts_idx
  on public.chronos_meetings (status, starts_at desc nulls last, updated_at desc);

create index if not exists chronos_meetings_host_idx
  on public.chronos_meetings (host_user_id, updated_at desc);

create index if not exists chronos_participants_meeting_idx
  on public.chronos_participants (meeting_id, role);

create index if not exists chronos_timeline_events_meeting_created_idx
  on public.chronos_timeline_events (meeting_id, event_at desc);

create index if not exists chronos_transcript_segments_meeting_created_idx
  on public.chronos_transcript_segments (meeting_id, created_at);

create index if not exists chronos_minutes_meeting_status_idx
  on public.chronos_minutes (meeting_id, status, created_at desc);

create index if not exists chronos_followups_meeting_status_idx
  on public.chronos_followups (meeting_id, status, due_at);

create index if not exists chronos_recordings_meeting_status_idx
  on public.chronos_recordings (meeting_id, status, created_at desc);

drop trigger if exists set_chronos_rooms_updated_at on public.chronos_rooms;
create trigger set_chronos_rooms_updated_at
before update on public.chronos_rooms
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_meetings_updated_at on public.chronos_meetings;
create trigger set_chronos_meetings_updated_at
before update on public.chronos_meetings
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_participants_updated_at on public.chronos_participants;
create trigger set_chronos_participants_updated_at
before update on public.chronos_participants
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_minutes_updated_at on public.chronos_minutes;
create trigger set_chronos_minutes_updated_at
before update on public.chronos_minutes
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_followups_updated_at on public.chronos_followups;
create trigger set_chronos_followups_updated_at
before update on public.chronos_followups
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_recordings_updated_at on public.chronos_recordings;
create trigger set_chronos_recordings_updated_at
before update on public.chronos_recordings
for each row execute function public.set_hub_updated_at();

alter table public.chronos_rooms enable row level security;
alter table public.chronos_meetings enable row level security;
alter table public.chronos_participants enable row level security;
alter table public.chronos_timeline_events enable row level security;
alter table public.chronos_transcript_segments enable row level security;
alter table public.chronos_minutes enable row level security;
alter table public.chronos_followups enable row level security;
alter table public.chronos_recordings enable row level security;

grant select on
  public.chronos_rooms,
  public.chronos_meetings,
  public.chronos_participants,
  public.chronos_timeline_events,
  public.chronos_transcript_segments,
  public.chronos_minutes,
  public.chronos_followups,
  public.chronos_recordings
to authenticated, service_role;

grant insert, update on
  public.chronos_rooms,
  public.chronos_meetings,
  public.chronos_participants,
  public.chronos_timeline_events,
  public.chronos_transcript_segments,
  public.chronos_minutes,
  public.chronos_followups,
  public.chronos_recordings
to authenticated, service_role;

do $$
declare
  chronos_table text;
begin
  foreach chronos_table in array array[
    'chronos_rooms',
    'chronos_meetings',
    'chronos_participants',
    'chronos_timeline_events',
    'chronos_transcript_segments',
    'chronos_minutes',
    'chronos_followups',
    'chronos_recordings'
  ] loop
    execute format('drop policy if exists "chronos authenticated read" on public.%I', chronos_table);
    execute format($policy$
      create policy "chronos authenticated read"
        on public.%I
        for select
        to authenticated
        using (public.has_chronos_permission('chronos:view'))
    $policy$, chronos_table);
  end loop;
end $$;

do $$
declare
  chronos_table text;
begin
  foreach chronos_table in array array[
    'chronos_rooms',
    'chronos_meetings',
    'chronos_participants',
    'chronos_timeline_events',
    'chronos_transcript_segments',
    'chronos_minutes',
    'chronos_followups',
    'chronos_recordings'
  ] loop
    execute format('drop policy if exists "chronos authenticated manage" on public.%I', chronos_table);
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

alter table public.chronos_meetings replica identity full;
alter table public.chronos_participants replica identity full;
alter table public.chronos_timeline_events replica identity full;
alter table public.chronos_transcript_segments replica identity full;
alter table public.chronos_minutes replica identity full;
alter table public.chronos_followups replica identity full;
alter table public.chronos_recordings replica identity full;

commit;
