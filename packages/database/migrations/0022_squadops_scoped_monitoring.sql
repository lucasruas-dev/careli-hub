-- SquadOps scoped monitoring persistence.
-- Moves the V1 monitoring/watcher persistence from generic Hub names to
-- SquadOps-owned tables and removes the generic tables created in 0021.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_squadops_monitoring_status') then
    create type public.hub_squadops_monitoring_status as enum (
      'aguardando',
      'operacional',
      'operacional_com_atencao',
      'critico',
      'indisponivel'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_squadops_risk_level') then
    create type public.hub_squadops_risk_level as enum (
      'baixo',
      'medio',
      'alto',
      'critico'
    );
  end if;
end $$;

create table if not exists public.hub_squadops_monitoring_check_runs (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  source text not null default 'squadops',
  status public.hub_squadops_monitoring_status not null default 'aguardando',
  total_checks integer not null default 0,
  alert_count integer not null default 0,
  highest_risk public.hub_squadops_risk_level,
  critical_alerts integer not null default 0,
  high_alerts integer not null default 0,
  slow_checks integer not null default 0,
  payload_critical integer not null default 0,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_squadops_monitoring_check_runs_counts_check check (
    total_checks >= 0
    and alert_count >= 0
    and critical_alerts >= 0
    and high_alerts >= 0
    and slow_checks >= 0
    and payload_critical >= 0
  )
);

comment on table public.hub_squadops_monitoring_check_runs is
  'Execucoes do Database Monitoring pertencentes ao modulo SquadOps.';

create table if not exists public.hub_squadops_monitoring_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hub_squadops_monitoring_check_runs(id) on delete cascade,
  check_id text not null,
  origin text not null,
  module text not null default 'nao informado',
  endpoint text,
  status_code integer,
  response_ms integer not null default 0,
  payload_bytes integer not null default 0,
  risk public.hub_squadops_risk_level not null default 'baixo',
  time_risk text not null default 'bom',
  payload_risk text not null default 'bom',
  expected_result text,
  received_result text,
  alert_generated boolean not null default false,
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_squadops_monitoring_checks_response_check check (response_ms >= 0),
  constraint hub_squadops_monitoring_checks_payload_check check (payload_bytes >= 0)
);

comment on table public.hub_squadops_monitoring_checks is
  'Checks individuais do Database Monitoring exibidos e tratados pelo SquadOps.';

create table if not exists public.hub_squadops_watcher_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  protocol text,
  risk public.hub_squadops_risk_level not null default 'baixo',
  status text not null default 'notificar',
  agent text not null default 'Hub SupportOps',
  message text not null,
  impact text,
  reason text,
  command text,
  notify_lucas boolean not null default false,
  source_alert_ids text[] not null default '{}'::text[],
  source_alert_protocols text[] not null default '{}'::text[],
  generated_at timestamptz not null default now(),
  cooldown_seconds integer not null default 1800,
  occurrence_count integer not null default 1,
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_squadops_watcher_notifications_dedupe_key_key unique (dedupe_key),
  constraint hub_squadops_watcher_notifications_dedupe_not_blank check (btrim(dedupe_key) <> ''),
  constraint hub_squadops_watcher_notifications_message_not_blank check (btrim(message) <> ''),
  constraint hub_squadops_watcher_notifications_cooldown_check check (cooldown_seconds >= 0),
  constraint hub_squadops_watcher_notifications_occurrence_check check (occurrence_count > 0)
);

comment on table public.hub_squadops_watcher_notifications is
  'Notificacoes deduplicadas do Ops Watcher dentro do SquadOps.';

create index if not exists hub_squadops_monitoring_check_runs_created_idx
  on public.hub_squadops_monitoring_check_runs (created_at desc);

create index if not exists hub_squadops_monitoring_checks_run_idx
  on public.hub_squadops_monitoring_checks (run_id, created_at);

create index if not exists hub_squadops_monitoring_checks_risk_idx
  on public.hub_squadops_monitoring_checks (risk, checked_at desc);

create index if not exists hub_squadops_watcher_notifications_last_seen_idx
  on public.hub_squadops_watcher_notifications (last_seen_at desc);

create index if not exists hub_squadops_watcher_notifications_protocol_idx
  on public.hub_squadops_watcher_notifications (protocol)
  where protocol is not null;

drop trigger if exists set_hub_squadops_watcher_notifications_updated_at
  on public.hub_squadops_watcher_notifications;
create trigger set_hub_squadops_watcher_notifications_updated_at
before update on public.hub_squadops_watcher_notifications
for each row execute function public.set_hub_updated_at();

do $$
begin
  if to_regclass('public.hub_operations_monitoring_check_runs') is not null then
    execute $copy$
      insert into public.hub_squadops_monitoring_check_runs (
        id,
        generated_at,
        source,
        status,
        total_checks,
        alert_count,
        highest_risk,
        critical_alerts,
        high_alerts,
        slow_checks,
        payload_critical,
        created_by_user_id,
        metadata,
        created_at
      )
      select
        id,
        generated_at,
        'squadops',
        status::text::public.hub_squadops_monitoring_status,
        total_checks,
        alert_count,
        highest_risk::text::public.hub_squadops_risk_level,
        critical_alerts,
        high_alerts,
        slow_checks,
        payload_critical,
        created_by_user_id,
        metadata,
        created_at
      from public.hub_operations_monitoring_check_runs
      on conflict (id) do nothing
    $copy$;
  end if;

  if to_regclass('public.hub_operations_monitoring_checks') is not null then
    execute $copy$
      insert into public.hub_squadops_monitoring_checks (
        id,
        run_id,
        check_id,
        origin,
        module,
        endpoint,
        status_code,
        response_ms,
        payload_bytes,
        risk,
        time_risk,
        payload_risk,
        expected_result,
        received_result,
        alert_generated,
        checked_at,
        metadata,
        created_at
      )
      select
        id,
        run_id,
        check_id,
        origin,
        module,
        endpoint,
        status_code,
        response_ms,
        payload_bytes,
        risk::text::public.hub_squadops_risk_level,
        time_risk,
        payload_risk,
        expected_result,
        received_result,
        alert_generated,
        checked_at,
        metadata,
        created_at
      from public.hub_operations_monitoring_checks
      where exists (
        select 1
        from public.hub_squadops_monitoring_check_runs runs
        where runs.id = public.hub_operations_monitoring_checks.run_id
      )
      on conflict (id) do nothing
    $copy$;
  end if;

  if to_regclass('public.hub_operations_watcher_notifications') is not null then
    execute $copy$
      insert into public.hub_squadops_watcher_notifications (
        id,
        dedupe_key,
        protocol,
        risk,
        status,
        agent,
        message,
        impact,
        reason,
        command,
        notify_lucas,
        source_alert_ids,
        source_alert_protocols,
        generated_at,
        cooldown_seconds,
        occurrence_count,
        last_seen_at,
        acknowledged_at,
        acknowledged_by_user_id,
        metadata,
        created_at,
        updated_at
      )
      select
        id,
        dedupe_key,
        protocol,
        risk::text::public.hub_squadops_risk_level,
        status,
        agent,
        message,
        impact,
        reason,
        command,
        notify_lucas,
        source_alert_ids,
        source_alert_protocols,
        generated_at,
        cooldown_seconds,
        occurrence_count,
        last_seen_at,
        acknowledged_at,
        acknowledged_by_user_id,
        metadata,
        created_at,
        updated_at
      from public.hub_operations_watcher_notifications
      on conflict (dedupe_key) do nothing
    $copy$;
  end if;
end $$;

alter table public.hub_squadops_monitoring_check_runs enable row level security;
alter table public.hub_squadops_monitoring_checks enable row level security;
alter table public.hub_squadops_watcher_notifications enable row level security;

grant select, insert, update, delete on
  public.hub_squadops_monitoring_check_runs,
  public.hub_squadops_monitoring_checks,
  public.hub_squadops_watcher_notifications
to authenticated, service_role;

drop policy if exists "hub squadops monitoring runs admin manage"
  on public.hub_squadops_monitoring_check_runs;
create policy "hub squadops monitoring runs admin manage"
  on public.hub_squadops_monitoring_check_runs
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

drop policy if exists "hub squadops monitoring checks admin manage"
  on public.hub_squadops_monitoring_checks;
create policy "hub squadops monitoring checks admin manage"
  on public.hub_squadops_monitoring_checks
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

drop policy if exists "hub squadops watcher notifications admin manage"
  on public.hub_squadops_watcher_notifications;
create policy "hub squadops watcher notifications admin manage"
  on public.hub_squadops_watcher_notifications
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

alter table public.hub_squadops_monitoring_check_runs replica identity full;
alter table public.hub_squadops_monitoring_checks replica identity full;
alter table public.hub_squadops_watcher_notifications replica identity full;

drop table if exists public.hub_operations_watcher_notifications cascade;
drop table if exists public.hub_operations_monitoring_checks cascade;
drop table if exists public.hub_operations_monitoring_check_runs cascade;

commit;
