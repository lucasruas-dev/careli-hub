-- Hub Core IT tickets.
-- Opens a user-facing feedback loop through Caca and a HubOps treatment queue.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_it_ticket_category') then
    create type public.hub_it_ticket_category as enum (
      'erro',
      'bug',
      'melhoria',
      'sugestao',
      'acesso',
      'performance',
      'outro'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_it_ticket_priority') then
    create type public.hub_it_ticket_priority as enum (
      'baixa',
      'media',
      'alta',
      'critica'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_it_ticket_status') then
    create type public.hub_it_ticket_status as enum (
      'novo',
      'em_triagem',
      'em_execucao',
      'aguardando_cliente',
      'em_revisao',
      'resolvido',
      'fechado'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_it_ticket_event_type') then
    create type public.hub_it_ticket_event_type as enum (
      'created',
      'triaged',
      'status_changed',
      'admin_reply',
      'resolved',
      'closed',
      'attachment_added',
      'review_requested',
      'user_comment'
    );
  end if;
end $$;

create table if not exists public.hub_it_tickets (
  id uuid primary key default gen_random_uuid(),
  protocol text not null,
  title text not null,
  user_description text not null,
  technical_summary text not null,
  category public.hub_it_ticket_category not null default 'outro',
  priority public.hub_it_ticket_priority not null default 'media',
  status public.hub_it_ticket_status not null default 'novo',
  module text not null default 'Hub',
  source_url text,
  source_path text,
  expected_result text,
  actual_result text,
  requested_by_user_id uuid not null references public.hub_users(id) on delete cascade,
  requester_name text not null,
  requester_email text,
  requester_avatar_url text,
  assigned_to_user_id uuid references public.hub_users(id) on delete set null,
  assigned_to_name text,
  assigned_to_email text,
  assigned_to_avatar_url text,
  last_response_by_user_id uuid references public.hub_users(id) on delete set null,
  last_response_by_name text,
  last_response_by_email text,
  last_response_by_avatar_url text,
  admin_response text,
  resolution_summary text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_it_tickets_protocol_key unique (protocol),
  constraint hub_it_tickets_protocol_not_blank check (btrim(protocol) <> ''),
  constraint hub_it_tickets_title_not_blank check (btrim(title) <> ''),
  constraint hub_it_tickets_description_not_blank check (btrim(user_description) <> ''),
  constraint hub_it_tickets_technical_summary_not_blank check (btrim(technical_summary) <> ''),
  constraint hub_it_tickets_module_not_blank check (btrim(module) <> '')
);

comment on table public.hub_it_tickets is
  'Tickets TI enviados pelos usuarios via Caca para triagem e devolutiva no SquadOps.';

comment on column public.hub_it_tickets.protocol is
  'Protocolo operacional sequencial do ticket, por exemplo TI-000001.';

create table if not exists public.hub_it_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hub_it_tickets(id) on delete cascade,
  event_type public.hub_it_ticket_event_type not null,
  message text not null,
  technical_note text,
  visible_to_requester boolean not null default true,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_it_ticket_events_message_not_blank check (btrim(message) <> '')
);

comment on table public.hub_it_ticket_events is
  'Historico de status, devolutivas e eventos visiveis dos tickets TI.';

create table if not exists public.hub_it_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hub_it_tickets(id) on delete cascade,
  type text not null check (type in ('audio', 'image', 'video', 'file')),
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null default 0 check (size_bytes >= 0 and size_bytes <= 6000000),
  content_data_url text,
  captured_at timestamptz not null default now(),
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_it_ticket_attachments_file_name_not_blank check (btrim(file_name) <> ''),
  constraint hub_it_ticket_attachments_mime_type_not_blank check (btrim(mime_type) <> '')
);

comment on table public.hub_it_ticket_attachments is
  'Capturas pequenas anexadas ao ticket TI. Arquivos pesados devem migrar para Storage em etapa futura.';

create index if not exists hub_it_tickets_status_updated_idx
  on public.hub_it_tickets (status, updated_at desc);

create index if not exists hub_it_tickets_requester_updated_idx
  on public.hub_it_tickets (requested_by_user_id, updated_at desc);

create index if not exists hub_it_tickets_module_priority_idx
  on public.hub_it_tickets (module, priority, updated_at desc);

create index if not exists hub_it_ticket_events_ticket_created_idx
  on public.hub_it_ticket_events (ticket_id, created_at desc);

create index if not exists hub_it_ticket_attachments_ticket_created_idx
  on public.hub_it_ticket_attachments (ticket_id, created_at desc);

drop trigger if exists set_hub_it_tickets_updated_at
  on public.hub_it_tickets;
create trigger set_hub_it_tickets_updated_at
before update on public.hub_it_tickets
for each row execute function public.set_hub_updated_at();

alter table public.hub_it_tickets enable row level security;
alter table public.hub_it_ticket_events enable row level security;
alter table public.hub_it_ticket_attachments enable row level security;

grant select, insert, update on
  public.hub_it_tickets,
  public.hub_it_ticket_events,
  public.hub_it_ticket_attachments
to authenticated, service_role;

drop policy if exists "hub it tickets requester read own"
  on public.hub_it_tickets;
create policy "hub it tickets requester read own"
  on public.hub_it_tickets
  for select
  to authenticated
  using (requested_by_user_id = auth.uid());

drop policy if exists "hub it tickets requester create own"
  on public.hub_it_tickets;
create policy "hub it tickets requester create own"
  on public.hub_it_tickets
  for insert
  to authenticated
  with check (requested_by_user_id = auth.uid());

drop policy if exists "hub it tickets admin manage"
  on public.hub_it_tickets;
create policy "hub it tickets admin manage"
  on public.hub_it_tickets
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

drop policy if exists "hub it ticket events requester read own visible"
  on public.hub_it_ticket_events;
create policy "hub it ticket events requester read own visible"
  on public.hub_it_ticket_events
  for select
  to authenticated
  using (
    visible_to_requester
    and exists (
      select 1
      from public.hub_it_tickets ticket
      where ticket.id = hub_it_ticket_events.ticket_id
        and ticket.requested_by_user_id = auth.uid()
    )
  );

drop policy if exists "hub it ticket events requester create own"
  on public.hub_it_ticket_events;
create policy "hub it ticket events requester create own"
  on public.hub_it_ticket_events
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.hub_it_tickets ticket
      where ticket.id = hub_it_ticket_events.ticket_id
        and ticket.requested_by_user_id = auth.uid()
    )
  );

drop policy if exists "hub it ticket events admin manage"
  on public.hub_it_ticket_events;
create policy "hub it ticket events admin manage"
  on public.hub_it_ticket_events
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

drop policy if exists "hub it ticket attachments requester read own"
  on public.hub_it_ticket_attachments;
create policy "hub it ticket attachments requester read own"
  on public.hub_it_ticket_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_it_tickets ticket
      where ticket.id = hub_it_ticket_attachments.ticket_id
        and ticket.requested_by_user_id = auth.uid()
    )
  );

drop policy if exists "hub it ticket attachments requester create own"
  on public.hub_it_ticket_attachments;
create policy "hub it ticket attachments requester create own"
  on public.hub_it_ticket_attachments
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.hub_it_tickets ticket
      where ticket.id = hub_it_ticket_attachments.ticket_id
        and ticket.requested_by_user_id = auth.uid()
    )
  );

drop policy if exists "hub it ticket attachments admin manage"
  on public.hub_it_ticket_attachments;
create policy "hub it ticket attachments admin manage"
  on public.hub_it_ticket_attachments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

alter table public.hub_it_tickets replica identity full;
alter table public.hub_it_ticket_events replica identity full;
alter table public.hub_it_ticket_attachments replica identity full;

commit;
