-- C2X mirror and Guardian read-model foundation.
-- The C2X database remains the source of truth. These tables are optimized
-- for fast Hub/Guardian reads and operational snapshots in Supabase.

begin;

do $$
begin
  create type public.c2x_sync_status as enum ('running', 'success', 'failed', 'partial');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.c2x_guardian_priority as enum ('low', 'medium', 'high', 'critical');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.c2x_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'c2x',
  scope text not null,
  status public.c2x_sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_written integer not null default 0 check (rows_written >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint c2x_sync_runs_source_not_blank check (btrim(source) <> ''),
  constraint c2x_sync_runs_scope_not_blank check (btrim(scope) <> ''),
  constraint c2x_sync_runs_finished_after_started check (
    finished_at is null or finished_at >= started_at
  )
);

comment on table public.c2x_sync_runs is 'Auditoria das sincronizacoes do banco legado C2X para o Supabase.';
comment on column public.c2x_sync_runs.scope is 'Escopo sincronizado: full, overview, attendance, payments, client-detail etc.';

create table if not exists public.c2x_enterprises (
  c2x_id bigint primary key,
  code text,
  name text not null,
  display_name text not null,
  group_key text not null,
  grouped_name text not null,
  is_valid_for_hub boolean not null default true,
  c2x_created_at timestamptz,
  c2x_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_enterprises_name_not_blank check (btrim(name) <> ''),
  constraint c2x_enterprises_display_name_not_blank check (btrim(display_name) <> ''),
  constraint c2x_enterprises_group_key_not_blank check (btrim(group_key) <> '')
);

comment on table public.c2x_enterprises is 'Espelho normalizado dos empreendimentos do C2X.';
comment on column public.c2x_enterprises.group_key is 'Agrupamento operacional validado: Lavra, Portal, Rio de Pedras; Lagoa fica separado por sigla valida.';

create table if not exists public.c2x_enterprise_units (
  c2x_id bigint primary key,
  enterprise_c2x_id bigint references public.c2x_enterprises(c2x_id) on delete restrict,
  code text,
  name text,
  block text,
  lot text,
  area numeric(14, 2),
  price numeric(14, 2),
  sale_status_id bigint,
  display_label text,
  c2x_created_at timestamptz,
  c2x_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.c2x_enterprise_units is 'Espelho das unidades do C2X usadas pelo Guardian.';
comment on column public.c2x_enterprise_units.code is 'Codigo da unidade vindo de enterprise_unities.name quando existir.';

create table if not exists public.c2x_users (
  c2x_id bigint primary key,
  profile_id bigint,
  name text,
  fantasy_name text,
  social_name text,
  display_name text not null,
  document text,
  email text,
  phone text,
  cellphone text,
  vinculed_by_c2x_id bigint references public.c2x_users(c2x_id) on delete set null,
  c2x_created_at timestamptz,
  c2x_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_users_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.c2x_users is 'Espelho dos cadastros da tabela users do C2X: clientes, imobiliarias, corretores e usuarios internos.';
comment on column public.c2x_users.vinculed_by_c2x_id is 'Vinculo comercial do cliente com imobiliaria/corretor no proprio users do C2X.';
comment on column public.c2x_users.display_name is 'Nome preferencial ja tratado: fantasia quando existir, depois razao/social e por fim name.';

create table if not exists public.c2x_acquisition_requests (
  c2x_id bigint primary key,
  code text,
  client_c2x_id bigint references public.c2x_users(c2x_id) on delete set null,
  enterprise_unit_c2x_id bigint references public.c2x_enterprise_units(c2x_id) on delete set null,
  stage_c2x_id bigint,
  stage_name text,
  type_c2x_id bigint,
  type_name text,
  is_open boolean,
  annual_value numeric(14, 2),
  c2x_created_at timestamptz,
  c2x_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.c2x_acquisition_requests is 'Espelho dos pedidos de aquisicao/vendas do C2X.';

create table if not exists public.c2x_parcel_types (
  c2x_id bigint primary key,
  name text not null,
  normalized_key text not null,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_parcel_types_name_not_blank check (btrim(name) <> ''),
  constraint c2x_parcel_types_normalized_key_not_blank check (btrim(normalized_key) <> '')
);

create table if not exists public.c2x_payment_statuses (
  c2x_id bigint primary key,
  name text not null,
  normalized_key text not null,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_payment_statuses_name_not_blank check (btrim(name) <> ''),
  constraint c2x_payment_statuses_normalized_key_not_blank check (btrim(normalized_key) <> '')
);

create table if not exists public.c2x_payments (
  c2x_id bigint primary key,
  acquisition_request_c2x_id bigint references public.c2x_acquisition_requests(c2x_id) on delete cascade,
  client_c2x_id bigint references public.c2x_users(c2x_id) on delete set null,
  enterprise_c2x_id bigint references public.c2x_enterprises(c2x_id) on delete set null,
  enterprise_unit_c2x_id bigint references public.c2x_enterprise_units(c2x_id) on delete set null,
  parcel_type_c2x_id bigint references public.c2x_parcel_types(c2x_id) on delete set null,
  payment_status_c2x_id bigint references public.c2x_payment_statuses(c2x_id) on delete set null,
  current_total_parcel integer,
  total_parcels integer,
  current_signal_parcel integer,
  total_signal_parcels integer,
  due_date_original date,
  due_date_current date,
  due_date_changed boolean not null default false,
  reference_month date,
  payment_date date,
  initial_value numeric(14, 2) not null default 0,
  interest_value numeric(14, 2) not null default 0,
  mulct_value numeric(14, 2) not null default 0,
  paid_value numeric(14, 2) not null default 0,
  outstanding_value numeric(14, 2) not null default 0,
  payment_url text,
  invoice_url text,
  payment_to_delete boolean not null default false,
  is_overdue boolean not null default false,
  overdue_days integer not null default 0 check (overdue_days >= 0),
  is_monthly_recovery boolean not null default false,
  c2x_created_at timestamptz,
  c2x_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_payments_reference_month_first_day check (
    reference_month is null or reference_month = date_trunc('month', reference_month)::date
  )
);

comment on table public.c2x_payments is 'Espelho das parcelas/pagamentos do C2X com campos derivados para leitura rapida.';
comment on column public.c2x_payments.due_date_original is 'Vencimento original calculado pelo log/historico quando houver alteracao.';
comment on column public.c2x_payments.reference_month is 'Referencia atual provisoria baseada no vencimento original ate o C2X expor o campo referencia.';
comment on column public.c2x_payments.is_monthly_recovery is 'Regra provisoria: pago no mes e payment_date mais de 10 dias apos o vencimento original.';

create table if not exists public.c2x_payment_due_date_events (
  id uuid primary key default gen_random_uuid(),
  payment_c2x_id bigint not null references public.c2x_payments(c2x_id) on delete cascade,
  c2x_log_id bigint,
  previous_due_date date,
  next_due_date date,
  changed_at timestamptz,
  source_table text not null default 'action_logs',
  raw_message text,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.c2x_sync_runs(id) on delete set null
);

comment on table public.c2x_payment_due_date_events is 'Historico extraido do C2X para reconstruir vencimento original das parcelas.';

create table if not exists public.c2x_guardian_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  is_current boolean not null default true,
  source_sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  total_portfolio_amount numeric(16, 2) not null default 0,
  total_portfolio_payments integer not null default 0,
  liquidated_amount numeric(16, 2) not null default 0,
  liquidated_payments integer not null default 0,
  pending_amount numeric(16, 2) not null default 0,
  pending_payments integer not null default 0,
  overdue_amount numeric(16, 2) not null default 0,
  overdue_payments integer not null default 0,
  delinquency_base_amount numeric(16, 2) not null default 0,
  delinquency_rate numeric(8, 4) not null default 0,
  monthly_recovery_amount numeric(16, 2) not null default 0,
  monthly_recovery_payments integer not null default 0,
  monthly_recovery_rate numeric(8, 4) not null default 0,
  overdue_clients integer not null default 0,
  critical_contracts integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.c2x_guardian_financial_snapshots is 'Cards financeiros do Guardian ja calculados para abertura rapida.';
comment on column public.c2x_guardian_financial_snapshots.delinquency_rate is 'Inadimplencia = vencidas / (vencidas + liquidadas), por valor.';
comment on column public.c2x_guardian_financial_snapshots.critical_contracts is 'Contratos com mais de 3 parcelas vencidas.';

create table if not exists public.c2x_guardian_enterprise_performance (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.c2x_guardian_financial_snapshots(id) on delete cascade,
  enterprise_group_key text not null,
  enterprise_name text not null,
  total_portfolio_amount numeric(16, 2) not null default 0,
  total_portfolio_payments integer not null default 0,
  overdue_amount numeric(16, 2) not null default 0,
  overdue_payments integer not null default 0,
  overdue_clients integer not null default 0,
  delinquency_base_amount numeric(16, 2) not null default 0,
  delinquency_rate numeric(8, 4) not null default 0,
  monthly_recovery_amount numeric(16, 2) not null default 0,
  monthly_recovery_payments integer not null default 0,
  monthly_recovery_rate numeric(8, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint c2x_guardian_enterprise_performance_name_not_blank check (btrim(enterprise_name) <> '')
);

create table if not exists public.c2x_guardian_overdue_aging (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.c2x_guardian_financial_snapshots(id) on delete cascade,
  bucket_key text not null,
  label text not null,
  sort_order integer not null,
  payments integer not null default 0,
  amount numeric(16, 2) not null default 0,
  constraint c2x_guardian_overdue_aging_key_not_blank check (btrim(bucket_key) <> ''),
  constraint c2x_guardian_overdue_aging_label_not_blank check (btrim(label) <> '')
);

create table if not exists public.c2x_guardian_billing_composition (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.c2x_guardian_financial_snapshots(id) on delete cascade,
  parcel_type_key text not null,
  label text not null,
  sort_order integer not null,
  payments integer not null default 0,
  amount numeric(16, 2) not null default 0,
  constraint c2x_guardian_billing_composition_key_not_blank check (btrim(parcel_type_key) <> ''),
  constraint c2x_guardian_billing_composition_label_not_blank check (btrim(label) <> '')
);

create table if not exists public.c2x_guardian_attendance_queue (
  id uuid primary key default gen_random_uuid(),
  source_sync_run_id uuid references public.c2x_sync_runs(id) on delete set null,
  client_c2x_id bigint references public.c2x_users(c2x_id) on delete cascade,
  primary_acquisition_request_c2x_id bigint references public.c2x_acquisition_requests(c2x_id) on delete set null,
  client_name text not null,
  document text,
  phone text,
  linked_party_name text,
  enterprise_name text,
  unit_label text,
  overdue_days integer not null default 0 check (overdue_days >= 0),
  overdue_payments integer not null default 0 check (overdue_payments >= 0),
  overdue_amount numeric(16, 2) not null default 0,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  priority public.c2x_guardian_priority not null default 'low',
  workflow_status text not null default 'Novo atraso',
  responsible_user_id uuid references public.hub_users(id) on delete set null,
  is_current boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint c2x_guardian_attendance_queue_client_name_not_blank check (btrim(client_name) <> ''),
  constraint c2x_guardian_attendance_queue_workflow_not_blank check (btrim(workflow_status) <> '')
);

comment on table public.c2x_guardian_attendance_queue is 'Fila operacional pre-calculada do Guardian a partir do C2X.';

create table if not exists public.c2x_guardian_attendance_installments (
  id uuid primary key default gen_random_uuid(),
  queue_item_id uuid not null references public.c2x_guardian_attendance_queue(id) on delete cascade,
  payment_c2x_id bigint references public.c2x_payments(c2x_id) on delete set null,
  acquisition_request_c2x_id bigint references public.c2x_acquisition_requests(c2x_id) on delete set null,
  parcel_label text not null,
  reference_month date,
  due_date_original date,
  due_date_current date,
  payment_date date,
  status_name text not null,
  value numeric(14, 2) not null default 0,
  overdue_days integer not null default 0 check (overdue_days >= 0),
  payment_url text,
  invoice_url text,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint c2x_guardian_attendance_installments_label_not_blank check (btrim(parcel_label) <> ''),
  constraint c2x_guardian_attendance_installments_status_not_blank check (btrim(status_name) <> '')
);

comment on table public.c2x_guardian_attendance_installments is 'Parcelas detalhadas carregadas pelo atendimento sem consultar o C2X ao abrir.';

create unique index if not exists c2x_guardian_financial_snapshots_current_key
  on public.c2x_guardian_financial_snapshots (is_current)
  where is_current;

create unique index if not exists c2x_guardian_enterprise_snapshot_key
  on public.c2x_guardian_enterprise_performance (snapshot_id, enterprise_group_key);

create unique index if not exists c2x_guardian_overdue_aging_snapshot_bucket_key
  on public.c2x_guardian_overdue_aging (snapshot_id, bucket_key);

create unique index if not exists c2x_guardian_billing_snapshot_type_key
  on public.c2x_guardian_billing_composition (snapshot_id, parcel_type_key);

create unique index if not exists c2x_guardian_attendance_queue_current_client_key
  on public.c2x_guardian_attendance_queue (client_c2x_id)
  where is_current;

create index if not exists c2x_sync_runs_scope_started_idx
  on public.c2x_sync_runs (scope, started_at desc);

create index if not exists c2x_enterprises_group_valid_idx
  on public.c2x_enterprises (group_key, is_valid_for_hub);

create index if not exists c2x_enterprise_units_enterprise_idx
  on public.c2x_enterprise_units (enterprise_c2x_id);

create index if not exists c2x_users_vinculed_idx
  on public.c2x_users (vinculed_by_c2x_id);

create index if not exists c2x_acquisition_requests_client_idx
  on public.c2x_acquisition_requests (client_c2x_id);

create index if not exists c2x_acquisition_requests_unit_idx
  on public.c2x_acquisition_requests (enterprise_unit_c2x_id);

create index if not exists c2x_payments_request_status_due_idx
  on public.c2x_payments (acquisition_request_c2x_id, payment_status_c2x_id, due_date_current);

create index if not exists c2x_payments_client_overdue_idx
  on public.c2x_payments (client_c2x_id, is_overdue, overdue_days desc)
  where payment_to_delete = false;

create index if not exists c2x_payments_enterprise_status_idx
  on public.c2x_payments (enterprise_c2x_id, payment_status_c2x_id);

create index if not exists c2x_payments_reference_month_idx
  on public.c2x_payments (reference_month);

create index if not exists c2x_payment_due_date_events_payment_changed_idx
  on public.c2x_payment_due_date_events (payment_c2x_id, changed_at);

create index if not exists c2x_guardian_attendance_queue_priority_idx
  on public.c2x_guardian_attendance_queue (priority, overdue_days desc, overdue_amount desc)
  where is_current;

create index if not exists c2x_guardian_attendance_queue_enterprise_idx
  on public.c2x_guardian_attendance_queue (enterprise_name, overdue_days desc)
  where is_current;

create index if not exists c2x_guardian_attendance_installments_queue_idx
  on public.c2x_guardian_attendance_installments (queue_item_id, due_date_original, payment_c2x_id);

drop trigger if exists set_c2x_guardian_attendance_queue_updated_at on public.c2x_guardian_attendance_queue;
create trigger set_c2x_guardian_attendance_queue_updated_at
before update on public.c2x_guardian_attendance_queue
for each row execute function public.set_hub_updated_at();

alter table public.c2x_sync_runs enable row level security;
alter table public.c2x_enterprises enable row level security;
alter table public.c2x_enterprise_units enable row level security;
alter table public.c2x_users enable row level security;
alter table public.c2x_acquisition_requests enable row level security;
alter table public.c2x_parcel_types enable row level security;
alter table public.c2x_payment_statuses enable row level security;
alter table public.c2x_payments enable row level security;
alter table public.c2x_payment_due_date_events enable row level security;
alter table public.c2x_guardian_financial_snapshots enable row level security;
alter table public.c2x_guardian_enterprise_performance enable row level security;
alter table public.c2x_guardian_overdue_aging enable row level security;
alter table public.c2x_guardian_billing_composition enable row level security;
alter table public.c2x_guardian_attendance_queue enable row level security;
alter table public.c2x_guardian_attendance_installments enable row level security;

alter table public.c2x_sync_runs replica identity full;
alter table public.c2x_guardian_financial_snapshots replica identity full;
alter table public.c2x_guardian_attendance_queue replica identity full;

commit;
