-- Careli Hub core schema draft.
-- This file is a migration draft only. Do not run against production before
-- reviewing RLS, auth integration, retention policies, and seed strategy.

create extension if not exists pgcrypto;

do $$
begin
  create type hub_record_status as enum ('active', 'archived', 'disabled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_user_role as enum ('admin', 'leader', 'operator', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_module_status as enum ('active', 'disabled', 'locked', 'planned');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_module_category as enum (
    'core',
    'operations',
    'finance',
    'productivity',
    'relationship',
    'commercial',
    'procurement'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_permission_scope as enum ('hub', 'module', 'workspace', 'system');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_event_severity as enum ('neutral', 'info', 'success', 'warning', 'danger');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_event_type as enum ('system', 'module', 'notification', 'presence', 'sync');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_presence_status as enum ('online', 'away', 'busy', 'offline');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_integration_status as enum ('connected', 'disabled', 'error', 'pending');
exception
  when duplicate_object then null;
end $$;

create or replace function set_hub_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists hub_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  avatar_url text,
  role hub_user_role not null default 'viewer',
  status hub_record_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_users_email_key unique (email)
);

comment on table hub_users is 'Usuarios globais do Careli Hub.';
comment on column hub_users.status is 'Soft delete operacional por status.';

create table if not exists hub_workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  owner_user_id uuid references hub_users(id) on delete set null,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_workspaces_slug_key unique (slug)
);

comment on table hub_workspaces is 'Workspaces operacionais do ecossistema.';
comment on column hub_workspaces.status is 'Soft delete operacional por status.';

create table if not exists hub_modules (
  id text primary key,
  name text not null,
  description text not null,
  category hub_module_category not null,
  status hub_module_status not null default 'planned',
  base_path text not null,
  icon_key text not null,
  realtime_enabled boolean not null default false,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_modules_base_path_key unique (base_path)
);

comment on table hub_modules is 'Catalogo canonico de modulos registrados no Hub.';

create table if not exists hub_permissions (
  id text primary key,
  key text not null,
  scope hub_permission_scope not null,
  module_id text references hub_modules(id) on delete restrict,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_permissions_key_key unique (key)
);

comment on table hub_permissions is 'Permissoes canonicas alinhadas ao @repo/shared.';

create table if not exists hub_user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references hub_users(id) on delete cascade,
  permission_id text not null references hub_permissions(id) on delete cascade,
  workspace_id uuid references hub_workspaces(id) on delete cascade,
  granted_by_user_id uuid references hub_users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table hub_user_permissions is 'Concessoes de permissoes por usuario e workspace opcional.';
comment on column hub_user_permissions.revoked_at is 'Soft delete/auditoria de revogacao.';

create table if not exists hub_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references hub_workspaces(id) on delete cascade,
  module_id text references hub_modules(id) on delete set null,
  user_id uuid references hub_users(id) on delete set null,
  type hub_event_type not null,
  severity hub_event_severity not null default 'neutral',
  title text not null,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table hub_activity_events is 'Eventos operacionais e realtime do Hub.';

create table if not exists hub_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references hub_users(id) on delete cascade,
  workspace_id uuid references hub_workspaces(id) on delete cascade,
  module_id text references hub_modules(id) on delete set null,
  severity hub_event_severity not null default 'neutral',
  title text not null,
  action_href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table hub_notifications is 'Notificacoes direcionadas a usuarios.';

create table if not exists hub_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references hub_users(id) on delete cascade,
  workspace_id uuid references hub_workspaces(id) on delete cascade,
  module_id text references hub_modules(id) on delete set null,
  status hub_presence_status not null default 'offline',
  last_seen_at timestamptz not null default now()
);

comment on table hub_presence is 'Presenca realtime por usuario e contexto opcional.';

create table if not exists hub_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references hub_workspaces(id) on delete cascade,
  module_id text references hub_modules(id) on delete set null,
  created_by_user_id uuid not null references hub_users(id) on delete restrict,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_files_storage_path_key unique (storage_path)
);

comment on table hub_files is 'Arquivos associados a workspaces e modulos.';

create table if not exists hub_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references hub_workspaces(id) on delete cascade,
  module_id text references hub_modules(id) on delete set null,
  provider text not null,
  name text not null,
  status hub_integration_status not null default 'pending',
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table hub_integrations is 'Integracoes externas ou internas por contexto operacional.';
comment on column hub_integrations.status is 'Soft delete operacional via disabled quando aplicavel.';

create unique index if not exists hub_user_permissions_scope_key
  on hub_user_permissions (user_id, permission_id, coalesce(workspace_id::text, 'global'))
  where revoked_at is null;

create unique index if not exists hub_presence_context_key
  on hub_presence (
    user_id,
    coalesce(workspace_id::text, 'global'),
    coalesce(module_id, 'global')
  );

create unique index if not exists hub_integrations_context_provider_key
  on hub_integrations (
    coalesce(workspace_id::text, 'global'),
    provider,
    coalesce(module_id, 'global')
  );

create index if not exists hub_users_status_role_idx
  on hub_users (status, role);

create index if not exists hub_modules_status_order_idx
  on hub_modules (status, "order");

create index if not exists hub_permissions_module_scope_idx
  on hub_permissions (module_id, scope);

create index if not exists hub_user_permissions_user_workspace_idx
  on hub_user_permissions (user_id, workspace_id)
  where revoked_at is null;

create index if not exists hub_activity_events_context_created_at_idx
  on hub_activity_events (workspace_id, module_id, created_at desc);

create index if not exists hub_notifications_recipient_read_created_at_idx
  on hub_notifications (recipient_user_id, read_at, created_at desc);

create index if not exists hub_presence_context_status_idx
  on hub_presence (workspace_id, module_id, status);

create index if not exists hub_files_context_created_at_idx
  on hub_files (workspace_id, module_id, created_at desc);

create index if not exists hub_integrations_context_status_idx
  on hub_integrations (workspace_id, module_id, status);

drop trigger if exists set_hub_users_updated_at on hub_users;
create trigger set_hub_users_updated_at
before update on hub_users
for each row execute function set_hub_updated_at();

drop trigger if exists set_hub_workspaces_updated_at on hub_workspaces;
create trigger set_hub_workspaces_updated_at
before update on hub_workspaces
for each row execute function set_hub_updated_at();

drop trigger if exists set_hub_modules_updated_at on hub_modules;
create trigger set_hub_modules_updated_at
before update on hub_modules
for each row execute function set_hub_updated_at();

drop trigger if exists set_hub_permissions_updated_at on hub_permissions;
create trigger set_hub_permissions_updated_at
before update on hub_permissions
for each row execute function set_hub_updated_at();

drop trigger if exists set_hub_files_updated_at on hub_files;
create trigger set_hub_files_updated_at
before update on hub_files
for each row execute function set_hub_updated_at();

drop trigger if exists set_hub_integrations_updated_at on hub_integrations;
create trigger set_hub_integrations_updated_at
before update on hub_integrations
for each row execute function set_hub_updated_at();
