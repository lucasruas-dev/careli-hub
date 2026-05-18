-- HubOps alert protocols.
-- Stores Operations Center monitoring alerts and the technical feedback loop.

begin;

create sequence if not exists public.hub_operations_alert_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1;

create or replace function public.next_hub_operations_alert_protocol()
returns text
language sql
set search_path = public
as $$
  select 'AL-' || lpad(nextval('public.hub_operations_alert_protocol_seq')::text, 4, '0')
$$;

revoke all on function public.next_hub_operations_alert_protocol() from public;
grant execute on function public.next_hub_operations_alert_protocol()
to authenticated, service_role;
grant usage, select on sequence public.hub_operations_alert_protocol_seq
to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_ops_alert_status') then
    create type public.hub_ops_alert_status as enum (
      'ativo',
      'em_analise',
      'tratado',
      'monitorando',
      'silenciado'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_ops_alert_feedback_status') then
    create type public.hub_ops_alert_feedback_status as enum (
      'pendente',
      'em_analise',
      'persiste',
      'corrigido',
      'nao_observado',
      'bloqueado',
      'falso_positivo'
    );
  end if;
end $$;

create table if not exists public.hub_operations_alert_protocols (
  id uuid primary key default gen_random_uuid(),
  protocol text not null default ('AL-' || lpad(nextval('public.hub_operations_alert_protocol_seq')::text, 4, '0')),
  fingerprint text not null,
  title text not null,
  module text not null,
  origin text not null,
  alert_type text not null,
  level text not null,
  status public.hub_ops_alert_status not null default 'ativo',
  technical_feedback_status public.hub_ops_alert_feedback_status not null default 'pendente',
  technical_feedback text,
  technical_feedback_by_user_id uuid references public.hub_users(id) on delete set null,
  technical_feedback_at timestamptz,
  impact text not null,
  recommendation text not null,
  recommended_agent text not null,
  command text not null,
  acknowledged_by_user_id uuid references public.hub_users(id) on delete set null,
  acknowledged_at timestamptz,
  treated_by_user_id uuid references public.hub_users(id) on delete set null,
  treated_at timestamptz,
  endpoint text,
  expected_result text,
  received_result text,
  http_status integer,
  response_ms integer not null default 0 check (response_ms >= 0),
  payload_bytes bigint not null default 0 check (payload_bytes >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_operations_alert_protocols_protocol_key unique (protocol),
  constraint hub_operations_alert_protocols_fingerprint_key unique (fingerprint),
  constraint hub_operations_alert_protocols_protocol_not_blank check (btrim(protocol) <> ''),
  constraint hub_operations_alert_protocols_fingerprint_not_blank check (btrim(fingerprint) <> ''),
  constraint hub_operations_alert_protocols_title_not_blank check (btrim(title) <> ''),
  constraint hub_operations_alert_protocols_module_not_blank check (btrim(module) <> ''),
  constraint hub_operations_alert_protocols_origin_not_blank check (btrim(origin) <> ''),
  constraint hub_operations_alert_protocols_type_not_blank check (btrim(alert_type) <> ''),
  constraint hub_operations_alert_protocols_level_not_blank check (btrim(level) <> ''),
  constraint hub_operations_alert_protocols_impact_not_blank check (btrim(impact) <> ''),
  constraint hub_operations_alert_protocols_recommendation_not_blank check (btrim(recommendation) <> ''),
  constraint hub_operations_alert_protocols_agent_not_blank check (btrim(recommended_agent) <> ''),
  constraint hub_operations_alert_protocols_command_not_blank check (btrim(command) <> '')
);

comment on table public.hub_operations_alert_protocols is
  'Protocolos persistidos dos alertas do HubOps Operations Center, agrupando alerta, prompt e devolutiva tecnica.';

comment on column public.hub_operations_alert_protocols.protocol is
  'Codigo curto e sequencial do alerta, no padrao AL-0001.';

comment on column public.hub_operations_alert_protocols.fingerprint is
  'Chave tecnica usada para deduplicar alertas recorrentes da mesma origem.';

comment on column public.hub_operations_alert_protocols.technical_feedback_status is
  'Estado informado na devolutiva tecnica: pendente, em_analise, persiste, corrigido, nao_observado, bloqueado ou falso_positivo.';

create table if not exists public.hub_operations_alert_feedbacks (
  id uuid primary key default gen_random_uuid(),
  alert_protocol_id uuid not null references public.hub_operations_alert_protocols(id) on delete cascade,
  status public.hub_ops_alert_feedback_status not null,
  feedback text not null,
  informed_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_operations_alert_feedbacks_feedback_not_blank check (btrim(feedback) <> '')
);

comment on table public.hub_operations_alert_feedbacks is
  'Historico das devolutivas tecnicas vinculadas a cada protocolo de alerta HubOps.';

create index if not exists hub_operations_alert_protocols_status_seen_idx
  on public.hub_operations_alert_protocols (status, last_seen_at desc);

create index if not exists hub_operations_alert_protocols_module_type_idx
  on public.hub_operations_alert_protocols (module, alert_type, last_seen_at desc);

create index if not exists hub_operations_alert_protocols_feedback_status_idx
  on public.hub_operations_alert_protocols (technical_feedback_status, last_seen_at desc);

create index if not exists hub_operations_alert_feedbacks_protocol_created_idx
  on public.hub_operations_alert_feedbacks (alert_protocol_id, created_at desc);

drop trigger if exists set_hub_operations_alert_protocols_updated_at
  on public.hub_operations_alert_protocols;
create trigger set_hub_operations_alert_protocols_updated_at
before update on public.hub_operations_alert_protocols
for each row execute function public.set_hub_updated_at();

alter table public.hub_operations_alert_protocols enable row level security;
alter table public.hub_operations_alert_feedbacks enable row level security;

grant select, insert, update on
  public.hub_operations_alert_protocols,
  public.hub_operations_alert_feedbacks
to authenticated, service_role;

drop policy if exists "hubops alert protocols admin read"
  on public.hub_operations_alert_protocols;
create policy "hubops alert protocols admin read"
  on public.hub_operations_alert_protocols
  for select
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
  );

drop policy if exists "hubops alert protocols admin manage"
  on public.hub_operations_alert_protocols;
create policy "hubops alert protocols admin manage"
  on public.hub_operations_alert_protocols
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

drop policy if exists "hubops alert feedbacks admin read"
  on public.hub_operations_alert_feedbacks;
create policy "hubops alert feedbacks admin read"
  on public.hub_operations_alert_feedbacks
  for select
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
  );

drop policy if exists "hubops alert feedbacks admin manage"
  on public.hub_operations_alert_feedbacks;
create policy "hubops alert feedbacks admin manage"
  on public.hub_operations_alert_feedbacks
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

alter table public.hub_operations_alert_protocols replica identity full;
alter table public.hub_operations_alert_feedbacks replica identity full;

commit;
