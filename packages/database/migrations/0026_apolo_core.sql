-- Apolo Core - cadastro mestre do Panteon.
-- Esta migration define as tabelas proprias do Apolo, mas nao deve ser aplicada
-- em ambiente real sem autorizacao expressa do Lucas.

create extension if not exists pgcrypto;

create table if not exists public.apolo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  status text not null default 'queued',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scanned_count integer not null default 0,
  upserted_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  cursor_value text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_sync_runs_status_check check (
    status in ('queued', 'running', 'completed', 'failed', 'blocked')
  )
);

create table if not exists public.apolo_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  entity_kind text not null,
  display_name text not null,
  legal_name text,
  trade_name text,
  document_kind text,
  document_hash text,
  document_masked text,
  status text not null default 'review',
  quality_score integer not null default 0,
  owner_user_id uuid,
  primary_city text,
  primary_state text,
  next_action text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_entities_kind_check check (
    entity_kind in ('pf', 'pj', 'internal', 'organization')
  ),
  constraint apolo_entities_status_check check (
    status in ('active', 'review', 'attention', 'blocked', 'archived')
  ),
  constraint apolo_entities_quality_score_check check (
    quality_score >= 0 and quality_score <= 100
  )
);

drop index if exists apolo_entities_document_hash_uidx;

create index if not exists apolo_entities_document_hash_idx
  on public.apolo_entities (document_hash)
  where document_hash is not null;

create index if not exists apolo_entities_display_name_idx
  on public.apolo_entities using gin (to_tsvector('portuguese', coalesce(display_name, '')));

create table if not exists public.apolo_entity_profiles (
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  profile text not null,
  status text not null default 'active',
  required_fields jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_id, profile),
  constraint apolo_entity_profiles_profile_check check (
    profile in (
      'usuario',
      'incorporador',
      'imobiliaria',
      'corretor',
      'fornecedor',
      'parceiro',
      'colaborador',
      'acesso_incorporador',
      'pessoa_fisica',
      'pessoa_juridica'
    )
  ),
  constraint apolo_entity_profiles_status_check check (
    status in ('active', 'review', 'blocked', 'archived')
  )
);

create table if not exists public.apolo_entity_identifiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  identifier_type text not null,
  value_hash text not null,
  value_masked text,
  source_system text not null default 'apolo',
  confidence_score integer not null default 100,
  is_primary boolean not null default false,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_entity_identifiers_type_check check (
    identifier_type in (
      'cpf',
      'cnpj',
      'email',
      'phone',
      'legacy_id',
      'external_id',
      'contract_id',
      'unit_id'
    )
  ),
  constraint apolo_entity_identifiers_confidence_check check (
    confidence_score >= 0 and confidence_score <= 100
  )
);

create unique index if not exists apolo_entity_identifiers_unique_idx
  on public.apolo_entity_identifiers (entity_id, identifier_type, value_hash);

create index if not exists apolo_entity_identifiers_lookup_idx
  on public.apolo_entity_identifiers (identifier_type, value_hash);

create index if not exists apolo_entity_identifiers_entity_idx
  on public.apolo_entity_identifiers (entity_id);

create table if not exists public.apolo_contacts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  contact_type text not null,
  label text,
  value text not null,
  normalized_value text,
  is_primary boolean not null default false,
  status text not null default 'pending',
  consent_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_contacts_type_check check (
    contact_type in ('email', 'phone', 'whatsapp')
  ),
  constraint apolo_contacts_status_check check (
    status in ('verified', 'pending', 'attention', 'blocked')
  )
);

create index if not exists apolo_contacts_entity_idx
  on public.apolo_contacts (entity_id);

create index if not exists apolo_contacts_normalized_idx
  on public.apolo_contacts (normalized_value)
  where normalized_value is not null;

create table if not exists public.apolo_addresses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  label text,
  postal_code text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  country text not null default 'BR',
  is_primary boolean not null default false,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_addresses_status_check check (
    status in ('verified', 'pending', 'attention', 'blocked')
  )
);

create index if not exists apolo_addresses_entity_idx
  on public.apolo_addresses (entity_id);

create table if not exists public.apolo_relationships (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  related_entity_id uuid references public.apolo_entities(id) on delete set null,
  relationship_type text not null,
  label text not null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_relationships_status_check check (
    status in ('verified', 'pending', 'attention', 'blocked', 'archived')
  )
);

create index if not exists apolo_relationships_entity_idx
  on public.apolo_relationships (entity_id);

create table if not exists public.apolo_module_records (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  module_key text not null,
  record_type text not null,
  record_id text not null,
  relationship_label text,
  status text not null default 'active',
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_module_records_module_check check (
    module_key in ('apolo', 'c2x', 'hades', 'iris', 'chronos', 'zeus', 'atlas', 'hermes', 'external')
  ),
  constraint apolo_module_records_status_check check (
    status in ('active', 'review', 'blocked', 'archived')
  )
);

create unique index if not exists apolo_module_records_unique_idx
  on public.apolo_module_records (module_key, record_type, record_id);

create index if not exists apolo_module_records_entity_idx
  on public.apolo_module_records (entity_id, module_key, occurred_at desc);

create table if not exists public.apolo_commercial_links (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  enterprise_name text,
  unit_label text,
  relationship_role text,
  stage_label text,
  reference_label text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_commercial_links_status_check check (
    status in ('active', 'review', 'blocked', 'archived')
  )
);

create index if not exists apolo_commercial_links_entity_idx
  on public.apolo_commercial_links (entity_id);

create table if not exists public.apolo_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  snapshot_date date not null default current_date,
  total_portfolio_amount numeric(14, 2),
  paid_amount numeric(14, 2),
  overdue_amount numeric(14, 2),
  overdue_installments integer not null default 0,
  risk_level text not null default 'baixo',
  payment_behavior text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_financial_snapshots_risk_check check (
    risk_level in ('baixo', 'medio', 'alto', 'critico')
  )
);

create index if not exists apolo_financial_snapshots_entity_date_idx
  on public.apolo_financial_snapshots (entity_id, snapshot_date desc);

create table if not exists public.apolo_service_signals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  channel text not null,
  protocol text,
  status text,
  last_event text,
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apolo_service_signals_entity_idx
  on public.apolo_service_signals (entity_id, occurred_at desc);

create table if not exists public.apolo_documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  document_type text not null,
  label text not null,
  status text not null default 'pending_review',
  storage_bucket text,
  storage_path text,
  extracted_payload jsonb not null default '{}'::jsonb,
  review_payload jsonb not null default '{}'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_documents_status_check check (
    status in ('ready', 'pending_review', 'blocked', 'archived')
  )
);

create index if not exists apolo_documents_entity_idx
  on public.apolo_documents (entity_id);

create table if not exists public.apolo_timeline_events (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  status text not null default 'ok',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_timeline_events_status_check check (
    status in ('ok', 'attention', 'blocked')
  )
);

create index if not exists apolo_timeline_events_entity_idx
  on public.apolo_timeline_events (entity_id, occurred_at desc);

create table if not exists public.apolo_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.apolo_entities(id) on delete set null,
  field_name text,
  action text not null,
  status text not null default 'mapped',
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint apolo_audit_events_status_check check (
    status in ('mapped', 'pending', 'blocked')
  )
);

create index if not exists apolo_audit_events_entity_idx
  on public.apolo_audit_events (entity_id, created_at desc);

create table if not exists public.apolo_source_links (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  source_hash text,
  last_seen_at timestamptz,
  sync_run_id uuid references public.apolo_sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create index if not exists apolo_source_links_entity_idx
  on public.apolo_source_links (entity_id);

create table if not exists public.apolo_search_entries (
  entity_id uuid primary key references public.apolo_entities(id) on delete cascade,
  display_name text not null,
  entity_kind text not null,
  status text not null,
  profile_labels text[] not null default '{}'::text[],
  document_masked text,
  location_label text,
  normalized_text text not null,
  quality_score integer not null default 0,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_search_entries_quality_score_check check (
    quality_score >= 0 and quality_score <= 100
  )
);

create index if not exists apolo_search_entries_text_idx
  on public.apolo_search_entries using gin (to_tsvector('portuguese', normalized_text));

create index if not exists apolo_search_entries_profiles_idx
  on public.apolo_search_entries using gin (profile_labels);

create table if not exists public.apolo_merge_candidates (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  candidate_entity_id uuid not null references public.apolo_entities(id) on delete cascade,
  match_score integer not null,
  match_reasons text[] not null default '{}'::text[],
  status text not null default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apolo_merge_candidates_score_check check (
    match_score >= 0 and match_score <= 100
  ),
  constraint apolo_merge_candidates_status_check check (
    status in ('pending', 'confirmed', 'rejected', 'blocked')
  ),
  constraint apolo_merge_candidates_no_self_check check (
    entity_id <> candidate_entity_id
  )
);

create unique index if not exists apolo_merge_candidates_pair_idx
  on public.apolo_merge_candidates (
    least(entity_id, candidate_entity_id),
    greatest(entity_id, candidate_entity_id)
  );

alter table public.apolo_sync_runs enable row level security;
alter table public.apolo_entities enable row level security;
alter table public.apolo_entity_profiles enable row level security;
alter table public.apolo_entity_identifiers enable row level security;
alter table public.apolo_contacts enable row level security;
alter table public.apolo_addresses enable row level security;
alter table public.apolo_relationships enable row level security;
alter table public.apolo_module_records enable row level security;
alter table public.apolo_commercial_links enable row level security;
alter table public.apolo_financial_snapshots enable row level security;
alter table public.apolo_service_signals enable row level security;
alter table public.apolo_documents enable row level security;
alter table public.apolo_timeline_events enable row level security;
alter table public.apolo_audit_events enable row level security;
alter table public.apolo_source_links enable row level security;
alter table public.apolo_search_entries enable row level security;
alter table public.apolo_merge_candidates enable row level security;

drop policy if exists "apolo authenticated read sync runs"
  on public.apolo_sync_runs;
create policy "apolo authenticated read sync runs"
  on public.apolo_sync_runs for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read entities"
  on public.apolo_entities;
create policy "apolo authenticated read entities"
  on public.apolo_entities for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read profiles"
  on public.apolo_entity_profiles;
create policy "apolo authenticated read profiles"
  on public.apolo_entity_profiles for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read identifiers"
  on public.apolo_entity_identifiers;
create policy "apolo authenticated read identifiers"
  on public.apolo_entity_identifiers for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read contacts"
  on public.apolo_contacts;
create policy "apolo authenticated read contacts"
  on public.apolo_contacts for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read addresses"
  on public.apolo_addresses;
create policy "apolo authenticated read addresses"
  on public.apolo_addresses for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read relationships"
  on public.apolo_relationships;
create policy "apolo authenticated read relationships"
  on public.apolo_relationships for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read module records"
  on public.apolo_module_records;
create policy "apolo authenticated read module records"
  on public.apolo_module_records for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read commercial links"
  on public.apolo_commercial_links;
create policy "apolo authenticated read commercial links"
  on public.apolo_commercial_links for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read financial snapshots"
  on public.apolo_financial_snapshots;
create policy "apolo authenticated read financial snapshots"
  on public.apolo_financial_snapshots for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read service signals"
  on public.apolo_service_signals;
create policy "apolo authenticated read service signals"
  on public.apolo_service_signals for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read documents"
  on public.apolo_documents;
create policy "apolo authenticated read documents"
  on public.apolo_documents for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read timeline"
  on public.apolo_timeline_events;
create policy "apolo authenticated read timeline"
  on public.apolo_timeline_events for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read audit"
  on public.apolo_audit_events;
create policy "apolo authenticated read audit"
  on public.apolo_audit_events for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read source links"
  on public.apolo_source_links;
create policy "apolo authenticated read source links"
  on public.apolo_source_links for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read search entries"
  on public.apolo_search_entries;
create policy "apolo authenticated read search entries"
  on public.apolo_search_entries for select
  to authenticated
  using (true);

drop policy if exists "apolo authenticated read merge candidates"
  on public.apolo_merge_candidates;
create policy "apolo authenticated read merge candidates"
  on public.apolo_merge_candidates for select
  to authenticated
  using (true);

grant select on table
  public.apolo_sync_runs,
  public.apolo_entities,
  public.apolo_entity_profiles,
  public.apolo_entity_identifiers,
  public.apolo_contacts,
  public.apolo_addresses,
  public.apolo_relationships,
  public.apolo_module_records,
  public.apolo_commercial_links,
  public.apolo_financial_snapshots,
  public.apolo_service_signals,
  public.apolo_documents,
  public.apolo_timeline_events,
  public.apolo_audit_events,
  public.apolo_source_links,
  public.apolo_search_entries,
  public.apolo_merge_candidates
to authenticated;
