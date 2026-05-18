-- SquadOps Center persistence.
-- Adds shared homologation reviews, monitoring history and watcher notifications.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_squadops_homologation_status') then
    create type public.hub_squadops_homologation_status as enum (
      'aguardando_teste',
      'em_teste',
      'aprovado',
      'reprovado',
      'bloqueado'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'hub_operations_monitoring_status') then
    create type public.hub_operations_monitoring_status as enum (
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
  if not exists (select 1 from pg_type where typname = 'hub_operations_risk_level') then
    create type public.hub_operations_risk_level as enum (
      'baixo',
      'medio',
      'alto',
      'critico'
    );
  end if;
end $$;

create table if not exists public.hub_squadops_homologation_reviews (
  id uuid primary key default gen_random_uuid(),
  release_protocol text not null,
  item_protocol text not null,
  item_kind text not null default 'atividade',
  item_title text not null default 'nao informado',
  module text not null default 'nao informado',
  item_type text not null default 'nao informado',
  status public.hub_squadops_homologation_status not null default 'aguardando_teste',
  note text not null default '',
  reviewed_by_user_id uuid references public.hub_users(id) on delete set null,
  reviewed_at timestamptz,
  source text not null default 'squadops-center',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_squadops_homologation_reviews_unique_item unique (release_protocol, item_protocol),
  constraint hub_squadops_homologation_reviews_release_not_blank check (btrim(release_protocol) <> ''),
  constraint hub_squadops_homologation_reviews_item_not_blank check (btrim(item_protocol) <> ''),
  constraint hub_squadops_homologation_reviews_kind_check check (
    item_kind in ('deploy', 'atividade', 'alerta', 'ticket')
  )
);

comment on table public.hub_squadops_homologation_reviews is
  'Validacoes item a item feitas por Lucas no SquadOps antes de autorizar producao.';

comment on column public.hub_squadops_homologation_reviews.release_protocol is
  'Protocolo DP-* que agrupa a homologacao.';

comment on column public.hub_squadops_homologation_reviews.item_protocol is
  'Protocolo validado dentro do DP, como AT-*, AL-*, TK-* ou o proprio DP-*.';

create table if not exists public.hub_operations_monitoring_check_runs (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  source text not null default 'squadops-center',
  status public.hub_operations_monitoring_status not null default 'aguardando',
  total_checks integer not null default 0,
  alert_count integer not null default 0,
  highest_risk public.hub_operations_risk_level,
  critical_alerts integer not null default 0,
  high_alerts integer not null default 0,
  slow_checks integer not null default 0,
  payload_critical integer not null default 0,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_operations_monitoring_check_runs_counts_check check (
    total_checks >= 0
    and alert_count >= 0
    and critical_alerts >= 0
    and high_alerts >= 0
    and slow_checks >= 0
    and payload_critical >= 0
  )
);

comment on table public.hub_operations_monitoring_check_runs is
  'Execucoes do Database Monitoring do SquadOps, persistidas para historico operacional.';

create table if not exists public.hub_operations_monitoring_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hub_operations_monitoring_check_runs(id) on delete cascade,
  check_id text not null,
  origin text not null,
  module text not null default 'nao informado',
  endpoint text,
  status_code integer,
  response_ms integer not null default 0,
  payload_bytes integer not null default 0,
  risk public.hub_operations_risk_level not null default 'baixo',
  time_risk text not null default 'bom',
  payload_risk text not null default 'bom',
  expected_result text,
  received_result text,
  alert_generated boolean not null default false,
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_operations_monitoring_checks_response_check check (response_ms >= 0),
  constraint hub_operations_monitoring_checks_payload_check check (payload_bytes >= 0)
);

comment on table public.hub_operations_monitoring_checks is
  'Checks individuais de banco, APIs, Supabase, Guardian Queue, Vercel e endpoints monitorados pelo SquadOps.';

create table if not exists public.hub_operations_watcher_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  protocol text,
  risk public.hub_operations_risk_level not null default 'baixo',
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
  constraint hub_operations_watcher_notifications_dedupe_key_key unique (dedupe_key),
  constraint hub_operations_watcher_notifications_dedupe_not_blank check (btrim(dedupe_key) <> ''),
  constraint hub_operations_watcher_notifications_message_not_blank check (btrim(message) <> ''),
  constraint hub_operations_watcher_notifications_cooldown_check check (cooldown_seconds >= 0),
  constraint hub_operations_watcher_notifications_occurrence_check check (occurrence_count > 0)
);

comment on table public.hub_operations_watcher_notifications is
  'Notificacoes deduplicadas do Ops Watcher para evitar ruido operacional.';

create index if not exists hub_squadops_homologation_reviews_release_idx
  on public.hub_squadops_homologation_reviews (release_protocol, updated_at desc);

create index if not exists hub_squadops_homologation_reviews_status_idx
  on public.hub_squadops_homologation_reviews (status, updated_at desc);

create index if not exists hub_operations_monitoring_check_runs_created_idx
  on public.hub_operations_monitoring_check_runs (created_at desc);

create index if not exists hub_operations_monitoring_checks_run_idx
  on public.hub_operations_monitoring_checks (run_id, created_at);

create index if not exists hub_operations_monitoring_checks_risk_idx
  on public.hub_operations_monitoring_checks (risk, checked_at desc);

create index if not exists hub_operations_watcher_notifications_last_seen_idx
  on public.hub_operations_watcher_notifications (last_seen_at desc);

create index if not exists hub_operations_watcher_notifications_protocol_idx
  on public.hub_operations_watcher_notifications (protocol)
  where protocol is not null;

drop trigger if exists set_hub_squadops_homologation_reviews_updated_at
  on public.hub_squadops_homologation_reviews;
create trigger set_hub_squadops_homologation_reviews_updated_at
before update on public.hub_squadops_homologation_reviews
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_operations_watcher_notifications_updated_at
  on public.hub_operations_watcher_notifications;
create trigger set_hub_operations_watcher_notifications_updated_at
before update on public.hub_operations_watcher_notifications
for each row execute function public.set_hub_updated_at();

alter table public.hub_squadops_homologation_reviews enable row level security;
alter table public.hub_operations_monitoring_check_runs enable row level security;
alter table public.hub_operations_monitoring_checks enable row level security;
alter table public.hub_operations_watcher_notifications enable row level security;

grant select, insert, update, delete on
  public.hub_squadops_homologation_reviews,
  public.hub_operations_monitoring_check_runs,
  public.hub_operations_monitoring_checks,
  public.hub_operations_watcher_notifications
to authenticated, service_role;

drop policy if exists "hub squadops homologation reviews admin manage"
  on public.hub_squadops_homologation_reviews;
create policy "hub squadops homologation reviews admin manage"
  on public.hub_squadops_homologation_reviews
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

drop policy if exists "hub operations monitoring runs admin manage"
  on public.hub_operations_monitoring_check_runs;
create policy "hub operations monitoring runs admin manage"
  on public.hub_operations_monitoring_check_runs
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

drop policy if exists "hub operations monitoring checks admin manage"
  on public.hub_operations_monitoring_checks;
create policy "hub operations monitoring checks admin manage"
  on public.hub_operations_monitoring_checks
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

drop policy if exists "hub operations watcher notifications admin manage"
  on public.hub_operations_watcher_notifications;
create policy "hub operations watcher notifications admin manage"
  on public.hub_operations_watcher_notifications
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

alter table public.hub_squadops_homologation_reviews replica identity full;
alter table public.hub_operations_monitoring_check_runs replica identity full;
alter table public.hub_operations_monitoring_checks replica identity full;
alter table public.hub_operations_watcher_notifications replica identity full;

commit;
