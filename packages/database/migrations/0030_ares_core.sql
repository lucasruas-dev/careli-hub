-- Ares Core - financeiro operacional do Panteon.
-- Base inicial autorizada por Lucas para homologacao.
-- Nao define plano de contas, regra fiscal, integracao bancaria ou fluxo
-- contabil definitivo. Nao importa dados reais e nao depende do C2X como base.

begin;

create extension if not exists pgcrypto;

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
  'financeiro',
  'Ares',
  'Financeiro operacional, contas, centros, projetos e acompanhamento da Careli.',
  'finance',
  'active',
  '/ares',
  'financeiro',
  false,
  40
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
  ('financeiro-view', 'financeiro:view', 'module', 'financeiro', 'Acessar o Ares.'),
  ('financeiro-manage', 'financeiro:manage', 'module', 'financeiro', 'Gerenciar lancamentos, dimensoes e conciliacao do Ares.')
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
  'financeiro',
  'enabled'::public.hub_department_module_status
from public.hub_departments department
where department.status = 'active'
on conflict (department_id, module_id) do update set
  status = excluded.status,
  updated_at = now();

create table if not exists public.ares_financial_dimensions (
  id uuid primary key default gen_random_uuid(),
  dimension_kind text not null,
  code text,
  name text not null,
  description text,
  parent_id uuid references public.ares_financial_dimensions(id) on delete set null,
  owner_user_id uuid references public.hub_users(id) on delete set null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_financial_dimensions_kind_check check (
    dimension_kind in ('cost_center', 'result_center', 'project', 'category', 'department')
  ),
  constraint ares_financial_dimensions_status_check check (
    status in ('active', 'inactive', 'archived')
  ),
  constraint ares_financial_dimensions_name_not_blank check (btrim(name) <> ''),
  constraint ares_financial_dimensions_code_not_blank check (
    code is null or btrim(code) <> ''
  )
);

comment on table public.ares_financial_dimensions is
  'Dimensoes operacionais do Ares: centro de custo, centro de resultado, projeto, categoria e departamento.';
comment on column public.ares_financial_dimensions.dimension_kind is
  'Tipo conceitual da dimensao financeira. Nao representa plano de contas definitivo.';

create unique index if not exists ares_financial_dimensions_kind_code_uidx
  on public.ares_financial_dimensions (dimension_kind, lower(code))
  where code is not null;

create index if not exists ares_financial_dimensions_kind_status_idx
  on public.ares_financial_dimensions (dimension_kind, status, name);

create index if not exists ares_financial_dimensions_parent_idx
  on public.ares_financial_dimensions (parent_id);

drop trigger if exists set_ares_financial_dimensions_updated_at
  on public.ares_financial_dimensions;
create trigger set_ares_financial_dimensions_updated_at
before update on public.ares_financial_dimensions
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_kind text not null default 'operational',
  bank_name text,
  account_label text,
  status text not null default 'active',
  current_balance numeric(14, 2),
  credit_limit numeric(14, 2),
  projected_balance numeric(14, 2),
  last_balance_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_bank_accounts_name_not_blank check (btrim(name) <> ''),
  constraint ares_bank_accounts_kind_check check (
    account_kind in ('operational', 'investment', 'cash', 'credit', 'other')
  ),
  constraint ares_bank_accounts_status_check check (
    status in ('active', 'inactive', 'archived')
  ),
  constraint ares_bank_accounts_credit_limit_non_negative check (
    credit_limit is null or credit_limit >= 0
  )
);

comment on table public.ares_bank_accounts is
  'Contas correntes operacionais do Ares. Nao armazena credenciais bancarias.';

create index if not exists ares_bank_accounts_status_name_idx
  on public.ares_bank_accounts (status, name);

drop trigger if exists set_ares_bank_accounts_updated_at
  on public.ares_bank_accounts;
create trigger set_ares_bank_accounts_updated_at
before update on public.ares_bank_accounts
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_financial_entries (
  id uuid primary key default gen_random_uuid(),
  entry_kind text not null,
  lifecycle_status text not null default 'draft',
  approval_status text not null default 'not_required',
  title text not null,
  document_number text,
  installment_label text,
  fiscal_document_number text,
  fiscal_document_kind text,
  party_name_snapshot text,
  counterparty_kind text,
  apolo_entity_id uuid,
  bank_account_id uuid references public.ares_bank_accounts(id) on delete set null,
  bank_account_label_snapshot text,
  category_id uuid references public.ares_financial_dimensions(id) on delete set null,
  category_name_snapshot text,
  project_id uuid references public.ares_financial_dimensions(id) on delete set null,
  project_name_snapshot text,
  cost_center_id uuid references public.ares_financial_dimensions(id) on delete set null,
  cost_center_name_snapshot text,
  result_center_id uuid references public.ares_financial_dimensions(id) on delete set null,
  result_center_name_snapshot text,
  department_id uuid references public.ares_financial_dimensions(id) on delete set null,
  responsible_user_id uuid references public.hub_users(id) on delete set null,
  responsible_name_snapshot text,
  amount_gross numeric(14, 2) not null default 0,
  amount_net numeric(14, 2),
  taxes_withheld numeric(14, 2),
  discount_amount numeric(14, 2),
  interest_amount numeric(14, 2),
  penalty_amount numeric(14, 2),
  amount_paid numeric(14, 2) not null default 0,
  amount_open numeric(14, 2) not null default 0,
  due_date date,
  forecast_date date,
  issued_at date,
  registered_at date,
  last_settlement_at date,
  payment_method text,
  boleto_number text,
  nsu_number text,
  customer_order_number text,
  contract_number text,
  notes text,
  priority text not null default 'normal',
  next_action text,
  source_system text,
  source_record_id text,
  source_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_financial_entries_kind_check check (
    entry_kind in ('payable', 'receivable', 'bank_statement', 'adjustment')
  ),
  constraint ares_financial_entries_lifecycle_status_check check (
    lifecycle_status in (
      'draft',
      'pending',
      'scheduled',
      'approval_pending',
      'approved',
      'paid',
      'received',
      'partially_settled',
      'cancelled',
      'overdue',
      'reconciled',
      'blocked'
    )
  ),
  constraint ares_financial_entries_approval_status_check check (
    approval_status in ('not_required', 'pending', 'approved', 'rejected', 'blocked')
  ),
  constraint ares_financial_entries_counterparty_kind_check check (
    counterparty_kind is null
    or counterparty_kind in ('customer', 'supplier', 'partner', 'other')
  ),
  constraint ares_financial_entries_priority_check check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  constraint ares_financial_entries_title_not_blank check (btrim(title) <> ''),
  constraint ares_financial_entries_launch_snapshots_not_blank check (
    (bank_account_label_snapshot is null or btrim(bank_account_label_snapshot) <> '')
    and (category_name_snapshot is null or btrim(category_name_snapshot) <> '')
    and (cost_center_name_snapshot is null or btrim(cost_center_name_snapshot) <> '')
    and (project_name_snapshot is null or btrim(project_name_snapshot) <> '')
    and (result_center_name_snapshot is null or btrim(result_center_name_snapshot) <> '')
    and (responsible_name_snapshot is null or btrim(responsible_name_snapshot) <> '')
    and (next_action is null or btrim(next_action) <> '')
  ),
  constraint ares_financial_entries_amounts_non_negative check (
    amount_gross >= 0
    and (amount_net is null or amount_net >= 0)
    and (taxes_withheld is null or taxes_withheld >= 0)
    and (discount_amount is null or discount_amount >= 0)
    and (interest_amount is null or interest_amount >= 0)
    and (penalty_amount is null or penalty_amount >= 0)
    and amount_paid >= 0
    and amount_open >= 0
  )
);

alter table public.ares_financial_entries
  add column if not exists counterparty_kind text,
  add column if not exists bank_account_label_snapshot text,
  add column if not exists category_name_snapshot text,
  add column if not exists project_name_snapshot text,
  add column if not exists cost_center_name_snapshot text,
  add column if not exists result_center_name_snapshot text,
  add column if not exists responsible_name_snapshot text,
  add column if not exists priority text not null default 'normal',
  add column if not exists next_action text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ares_financial_entries_counterparty_kind_check'
      and conrelid = 'public.ares_financial_entries'::regclass
  ) then
    alter table public.ares_financial_entries
      add constraint ares_financial_entries_counterparty_kind_check check (
        counterparty_kind is null
        or counterparty_kind in ('customer', 'supplier', 'partner', 'other')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ares_financial_entries_priority_check'
      and conrelid = 'public.ares_financial_entries'::regclass
  ) then
    alter table public.ares_financial_entries
      add constraint ares_financial_entries_priority_check check (
        priority in ('low', 'normal', 'high', 'urgent')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ares_financial_entries_launch_snapshots_not_blank'
      and conrelid = 'public.ares_financial_entries'::regclass
  ) then
    alter table public.ares_financial_entries
      add constraint ares_financial_entries_launch_snapshots_not_blank check (
        (bank_account_label_snapshot is null or btrim(bank_account_label_snapshot) <> '')
        and (category_name_snapshot is null or btrim(category_name_snapshot) <> '')
        and (cost_center_name_snapshot is null or btrim(cost_center_name_snapshot) <> '')
        and (project_name_snapshot is null or btrim(project_name_snapshot) <> '')
        and (result_center_name_snapshot is null or btrim(result_center_name_snapshot) <> '')
        and (responsible_name_snapshot is null or btrim(responsible_name_snapshot) <> '')
        and (next_action is null or btrim(next_action) <> '')
      );
  end if;
end $$;

comment on table public.ares_financial_entries is
  'Lancamentos operacionais do Ares para contas a pagar, contas a receber, extrato e ajustes controlados.';
comment on column public.ares_financial_entries.apolo_entity_id is
  'UUID conceitual da entidade no Apolo quando a fonte mestre estiver disponivel.';
comment on column public.ares_financial_entries.source_payload is
  'Payload sanitizado da origem. Nao gravar secrets, dados bancarios sensiveis ou documento completo sem regra revisada.';

create index if not exists ares_financial_entries_kind_status_due_idx
  on public.ares_financial_entries (entry_kind, lifecycle_status, due_date);

create index if not exists ares_financial_entries_forecast_idx
  on public.ares_financial_entries (forecast_date, entry_kind);

create index if not exists ares_financial_entries_bank_account_idx
  on public.ares_financial_entries (bank_account_id, due_date);

create index if not exists ares_financial_entries_category_idx
  on public.ares_financial_entries (category_id);

create index if not exists ares_financial_entries_project_idx
  on public.ares_financial_entries (project_id);

create index if not exists ares_financial_entries_apolo_entity_idx
  on public.ares_financial_entries (apolo_entity_id);

create index if not exists ares_financial_entries_source_idx
  on public.ares_financial_entries (source_system, source_record_id)
  where source_system is not null and source_record_id is not null;

drop trigger if exists set_ares_financial_entries_updated_at
  on public.ares_financial_entries;
create trigger set_ares_financial_entries_updated_at
before update on public.ares_financial_entries
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_entry_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.ares_financial_entries(id) on delete cascade,
  event_kind text not null,
  actor_user_id uuid references public.hub_users(id) on delete set null,
  note text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ares_entry_events_kind_check check (
    event_kind in (
      'created',
      'updated',
      'status_changed',
      'approval_requested',
      'approved',
      'rejected',
      'settled',
      'reconciled',
      'comment',
      'attachment_linked',
      'source_sync'
    )
  )
);

comment on table public.ares_entry_events is
  'Trilha de auditoria operacional dos lancamentos Ares.';

create index if not exists ares_entry_events_entry_time_idx
  on public.ares_entry_events (entry_id, occurred_at desc);

create index if not exists ares_entry_events_actor_time_idx
  on public.ares_entry_events (actor_user_id, occurred_at desc);

create or replace function public.create_ares_entry_created_event()
returns trigger
language plpgsql
as $$
begin
  insert into public.ares_entry_events (
    entry_id,
    event_kind,
    actor_user_id,
    note,
    new_values,
    metadata
  ) values (
    new.id,
    'created',
    new.created_by_user_id,
    'Lancamento criado no Ares.',
    jsonb_build_object(
      'approval_status', new.approval_status,
      'entry_kind', new.entry_kind,
      'lifecycle_status', new.lifecycle_status,
      'priority', new.priority
    ),
    jsonb_build_object('source', 'ares_hub_trigger')
  );

  return new;
end;
$$;

revoke all on function public.create_ares_entry_created_event()
from public, anon, authenticated;

drop trigger if exists create_ares_financial_entry_event
  on public.ares_financial_entries;
create trigger create_ares_financial_entry_event
after insert on public.ares_financial_entries
for each row execute function public.create_ares_entry_created_event();

create table if not exists public.ares_bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid references public.ares_bank_accounts(id) on delete set null,
  source_type text not null default 'ofx',
  file_name text,
  file_hash text,
  status text not null default 'imported',
  period_start date,
  period_end date,
  imported_at timestamptz not null default now(),
  line_count integer not null default 0,
  matched_count integer not null default 0,
  unmatched_count integer not null default 0,
  imported_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_bank_statement_imports_source_type_check check (
    source_type in ('ofx', 'manual', 'api')
  ),
  constraint ares_bank_statement_imports_status_check check (
    status in ('imported', 'processing', 'processed', 'failed', 'cancelled')
  ),
  constraint ares_bank_statement_imports_counts_non_negative check (
    line_count >= 0 and matched_count >= 0 and unmatched_count >= 0
  )
);

comment on table public.ares_bank_statement_imports is
  'Importacoes de extrato para conciliacao Ares. A integracao bancaria automatica nao esta definida nesta etapa.';

create index if not exists ares_bank_statement_imports_account_period_idx
  on public.ares_bank_statement_imports (bank_account_id, period_start, period_end);

create unique index if not exists ares_bank_statement_imports_file_hash_uidx
  on public.ares_bank_statement_imports (bank_account_id, file_hash)
  where file_hash is not null;

drop trigger if exists set_ares_bank_statement_imports_updated_at
  on public.ares_bank_statement_imports;
create trigger set_ares_bank_statement_imports_updated_at
before update on public.ares_bank_statement_imports
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.ares_bank_statement_imports(id) on delete cascade,
  bank_account_id uuid references public.ares_bank_accounts(id) on delete set null,
  external_line_id text,
  transaction_date date not null,
  posted_at date,
  description text not null,
  document_number text,
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2),
  match_status text not null default 'unmatched',
  matched_entry_id uuid references public.ares_financial_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_bank_statement_lines_description_not_blank check (btrim(description) <> ''),
  constraint ares_bank_statement_lines_match_status_check check (
    match_status in ('unmatched', 'matched', 'ignored', 'review')
  )
);

comment on table public.ares_bank_statement_lines is
  'Linhas de extrato para conciliacao operacional do Ares.';

create index if not exists ares_bank_statement_lines_account_date_idx
  on public.ares_bank_statement_lines (bank_account_id, transaction_date desc);

create index if not exists ares_bank_statement_lines_match_status_idx
  on public.ares_bank_statement_lines (match_status, transaction_date desc);

create unique index if not exists ares_bank_statement_lines_external_uidx
  on public.ares_bank_statement_lines (import_id, external_line_id)
  where external_line_id is not null;

drop trigger if exists set_ares_bank_statement_lines_updated_at
  on public.ares_bank_statement_lines;
create trigger set_ares_bank_statement_lines_updated_at
before update on public.ares_bank_statement_lines
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_payment_batches (
  id uuid primary key default gen_random_uuid(),
  batch_kind text not null default 'payment_week',
  status text not null default 'draft',
  title text not null,
  scheduled_for date,
  bank_account_id uuid references public.ares_bank_accounts(id) on delete set null,
  total_amount numeric(14, 2) not null default 0,
  entry_count integer not null default 0,
  requested_by_user_id uuid references public.hub_users(id) on delete set null,
  approved_by_user_id uuid references public.hub_users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_payment_batches_kind_check check (
    batch_kind in ('payment_week', 'payment_simulation', 'payment_run')
  ),
  constraint ares_payment_batches_status_check check (
    status in ('draft', 'simulated', 'approval_pending', 'approved', 'rejected', 'executed', 'cancelled')
  ),
  constraint ares_payment_batches_title_not_blank check (btrim(title) <> ''),
  constraint ares_payment_batches_totals_non_negative check (
    total_amount >= 0 and entry_count >= 0
  )
);

comment on table public.ares_payment_batches is
  'Agrupamentos operacionais para simulacao, aprovacao e execucao de pagamentos.';

create index if not exists ares_payment_batches_status_date_idx
  on public.ares_payment_batches (status, scheduled_for);

drop trigger if exists set_ares_payment_batches_updated_at
  on public.ares_payment_batches;
create trigger set_ares_payment_batches_updated_at
before update on public.ares_payment_batches
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_payment_batch_items (
  batch_id uuid not null references public.ares_payment_batches(id) on delete cascade,
  entry_id uuid not null references public.ares_financial_entries(id) on delete restrict,
  amount numeric(14, 2) not null,
  status text not null default 'included',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (batch_id, entry_id),
  constraint ares_payment_batch_items_amount_non_negative check (amount >= 0),
  constraint ares_payment_batch_items_status_check check (
    status in ('included', 'removed', 'approved', 'rejected', 'executed')
  )
);

comment on table public.ares_payment_batch_items is
  'Itens de lotes/simulacoes de pagamento Ares.';

create index if not exists ares_payment_batch_items_entry_idx
  on public.ares_payment_batch_items (entry_id);

drop trigger if exists set_ares_payment_batch_items_updated_at
  on public.ares_payment_batch_items;
create trigger set_ares_payment_batch_items_updated_at
before update on public.ares_payment_batch_items
for each row execute function public.set_hub_updated_at();

alter table public.ares_financial_dimensions enable row level security;
alter table public.ares_bank_accounts enable row level security;
alter table public.ares_financial_entries enable row level security;
alter table public.ares_entry_events enable row level security;
alter table public.ares_bank_statement_imports enable row level security;
alter table public.ares_bank_statement_lines enable row level security;
alter table public.ares_payment_batches enable row level security;
alter table public.ares_payment_batch_items enable row level security;

revoke all privileges on table
  public.ares_financial_dimensions,
  public.ares_bank_accounts,
  public.ares_financial_entries,
  public.ares_entry_events,
  public.ares_bank_statement_imports,
  public.ares_bank_statement_lines,
  public.ares_payment_batches,
  public.ares_payment_batch_items
from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.ares_financial_dimensions,
  public.ares_bank_accounts,
  public.ares_financial_entries,
  public.ares_entry_events,
  public.ares_bank_statement_imports,
  public.ares_bank_statement_lines,
  public.ares_payment_batches,
  public.ares_payment_batch_items
to authenticated, service_role;

drop policy if exists "ares authenticated read dimensions"
  on public.ares_financial_dimensions;
create policy "ares authenticated read dimensions"
  on public.ares_financial_dimensions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage dimensions"
  on public.ares_financial_dimensions;
create policy "ares authenticated manage dimensions"
  on public.ares_financial_dimensions
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read bank accounts"
  on public.ares_bank_accounts;
create policy "ares authenticated read bank accounts"
  on public.ares_bank_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage bank accounts"
  on public.ares_bank_accounts;
create policy "ares authenticated manage bank accounts"
  on public.ares_bank_accounts
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read entries"
  on public.ares_financial_entries;
create policy "ares authenticated read entries"
  on public.ares_financial_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage entries"
  on public.ares_financial_entries;
create policy "ares authenticated manage entries"
  on public.ares_financial_entries
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read entry events"
  on public.ares_entry_events;
create policy "ares authenticated read entry events"
  on public.ares_entry_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage entry events"
  on public.ares_entry_events;
create policy "ares authenticated manage entry events"
  on public.ares_entry_events
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read statement imports"
  on public.ares_bank_statement_imports;
create policy "ares authenticated read statement imports"
  on public.ares_bank_statement_imports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage statement imports"
  on public.ares_bank_statement_imports;
create policy "ares authenticated manage statement imports"
  on public.ares_bank_statement_imports
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read statement lines"
  on public.ares_bank_statement_lines;
create policy "ares authenticated read statement lines"
  on public.ares_bank_statement_lines
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage statement lines"
  on public.ares_bank_statement_lines;
create policy "ares authenticated manage statement lines"
  on public.ares_bank_statement_lines
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read payment batches"
  on public.ares_payment_batches;
create policy "ares authenticated read payment batches"
  on public.ares_payment_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage payment batches"
  on public.ares_payment_batches;
create policy "ares authenticated manage payment batches"
  on public.ares_payment_batches
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

drop policy if exists "ares authenticated read payment batch items"
  on public.ares_payment_batch_items;
create policy "ares authenticated read payment batch items"
  on public.ares_payment_batch_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key in ('financeiro:view', 'financeiro:manage')
          )
        )
    )
  );

drop policy if exists "ares authenticated manage payment batch items"
  on public.ares_payment_batch_items;
create policy "ares authenticated manage payment batch items"
  on public.ares_payment_batch_items
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
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
          or exists (
            select 1
            from public.hub_user_permissions user_permission
            join public.hub_permissions permission
              on permission.id = user_permission.permission_id
            where user_permission.user_id = auth.uid()
              and user_permission.revoked_at is null
              and permission.key = 'financeiro:manage'
          )
        )
    )
  );

alter table public.ares_financial_dimensions replica identity full;
alter table public.ares_bank_accounts replica identity full;
alter table public.ares_financial_entries replica identity full;
alter table public.ares_entry_events replica identity full;
alter table public.ares_bank_statement_imports replica identity full;
alter table public.ares_bank_statement_lines replica identity full;
alter table public.ares_payment_batches replica identity full;
alter table public.ares_payment_batch_items replica identity full;

commit;
