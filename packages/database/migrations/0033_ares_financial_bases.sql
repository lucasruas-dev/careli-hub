-- Ares Core - bases financeiras multiempresa.
-- Cria empresas geridas, vinculos de usuario e amarra lancamentos/setup
-- ao contexto financeiro selecionado. Sem integracao bancaria/fiscal.

begin;

create extension if not exists pgcrypto;

create table if not exists public.ares_financial_bases (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  legal_name text,
  apolo_entity_id uuid,
  accent_color text not null default '#A07C3B',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_financial_bases_name_not_blank check (btrim(name) <> ''),
  constraint ares_financial_bases_color_check check (
    accent_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  constraint ares_financial_bases_status_check check (
    status in ('active', 'inactive', 'archived')
  )
);

comment on table public.ares_financial_bases is
  'Empresas/bases financeiras geridas pelo Ares. Separa contexto operacional, permissoes e cor de destaque.';

create unique index if not exists ares_financial_bases_code_uidx
  on public.ares_financial_bases (lower(code))
  where code is not null;

create unique index if not exists ares_financial_bases_name_uidx
  on public.ares_financial_bases (lower(name))
  where status <> 'archived';

drop trigger if exists set_ares_financial_bases_updated_at
  on public.ares_financial_bases;
create trigger set_ares_financial_bases_updated_at
before update on public.ares_financial_bases
for each row execute function public.set_hub_updated_at();

create table if not exists public.ares_financial_base_users (
  id uuid primary key default gen_random_uuid(),
  financial_base_id uuid not null references public.ares_financial_bases(id) on delete cascade,
  user_id uuid not null references public.hub_users(id) on delete cascade,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ares_financial_base_users_status_check check (
    status in ('active', 'inactive', 'archived')
  )
);

comment on table public.ares_financial_base_users is
  'Vinculo de usuarios do Hub com empresas/bases financeiras do Ares.';

create unique index if not exists ares_financial_base_users_base_user_uidx
  on public.ares_financial_base_users (financial_base_id, user_id);

create index if not exists ares_financial_base_users_user_idx
  on public.ares_financial_base_users (user_id, status);

drop trigger if exists set_ares_financial_base_users_updated_at
  on public.ares_financial_base_users;
create trigger set_ares_financial_base_users_updated_at
before update on public.ares_financial_base_users
for each row execute function public.set_hub_updated_at();

alter table public.ares_financial_dimensions
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

alter table public.ares_bank_accounts
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

alter table public.ares_financial_entries
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict,
  add column if not exists financial_base_name_snapshot text;

alter table public.ares_bank_statement_imports
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

alter table public.ares_bank_statement_lines
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

alter table public.ares_payment_batches
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

alter table if exists public.ares_payment_batch_items
  add column if not exists financial_base_id uuid references public.ares_financial_bases(id) on delete restrict;

do $$
declare
  default_base_id uuid;
begin
  select id
    into default_base_id
  from public.ares_financial_bases
  where lower(name) = lower('Careli')
  order by created_at
  limit 1;

  if default_base_id is null then
    insert into public.ares_financial_bases (
      code,
      name,
      accent_color,
      status
    ) values (
      '00001',
      'Careli',
      '#A07C3B',
      'active'
    )
    returning id into default_base_id;
  end if;

  update public.ares_financial_dimensions
     set financial_base_id = default_base_id
   where financial_base_id is null;

  update public.ares_bank_accounts
     set financial_base_id = default_base_id
   where financial_base_id is null;

  update public.ares_financial_entries
     set financial_base_id = default_base_id,
         financial_base_name_snapshot = coalesce(financial_base_name_snapshot, 'Careli')
   where financial_base_id is null;

  update public.ares_bank_statement_imports
     set financial_base_id = default_base_id
   where financial_base_id is null;

  update public.ares_bank_statement_lines
     set financial_base_id = default_base_id
   where financial_base_id is null;

  update public.ares_payment_batches
     set financial_base_id = default_base_id
   where financial_base_id is null;

  if to_regclass('public.ares_payment_batch_items') is not null then
    update public.ares_payment_batch_items
       set financial_base_id = default_base_id
     where financial_base_id is null;
  end if;
end $$;

alter table public.ares_financial_dimensions
  alter column financial_base_id set not null;

alter table public.ares_bank_accounts
  alter column financial_base_id set not null;

alter table public.ares_financial_entries
  alter column financial_base_id set not null,
  alter column financial_base_name_snapshot set not null;

alter table public.ares_bank_statement_imports
  alter column financial_base_id set not null;

alter table public.ares_bank_statement_lines
  alter column financial_base_id set not null;

alter table public.ares_payment_batches
  alter column financial_base_id set not null;

alter table if exists public.ares_payment_batch_items
  alter column financial_base_id set not null;

drop index if exists public.ares_financial_dimensions_kind_code_uidx;
create unique index if not exists ares_financial_dimensions_base_kind_code_uidx
  on public.ares_financial_dimensions (financial_base_id, dimension_kind, lower(code))
  where code is not null;

create index if not exists ares_financial_dimensions_base_kind_idx
  on public.ares_financial_dimensions (financial_base_id, dimension_kind, status, name);

create index if not exists ares_bank_accounts_base_idx
  on public.ares_bank_accounts (financial_base_id, status, name);

create index if not exists ares_financial_entries_base_kind_due_idx
  on public.ares_financial_entries (financial_base_id, entry_kind, lifecycle_status, due_date);

create index if not exists ares_statement_imports_base_idx
  on public.ares_bank_statement_imports (financial_base_id, imported_at desc);

create index if not exists ares_statement_lines_base_idx
  on public.ares_bank_statement_lines (financial_base_id, transaction_date desc);

create index if not exists ares_payment_batches_base_idx
  on public.ares_payment_batches (financial_base_id, scheduled_for);

grant select, insert, update, delete on
  public.ares_financial_bases,
  public.ares_financial_base_users
to authenticated;

alter table public.ares_financial_bases enable row level security;
alter table public.ares_financial_base_users enable row level security;

drop policy if exists "ares authenticated read financial bases"
  on public.ares_financial_bases;
create policy "ares authenticated read financial bases"
  on public.ares_financial_bases
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_financial_bases.id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
          )
        )
    )
  );

drop policy if exists "ares authenticated manage financial bases"
  on public.ares_financial_bases;
create policy "ares authenticated manage financial bases"
  on public.ares_financial_bases
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  );

drop policy if exists "ares authenticated read financial base users"
  on public.ares_financial_base_users;
create policy "ares authenticated read financial base users"
  on public.ares_financial_base_users
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  );

drop policy if exists "ares authenticated manage financial base users"
  on public.ares_financial_base_users;
create policy "ares authenticated manage financial base users"
  on public.ares_financial_base_users
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  );

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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_financial_dimensions.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_financial_entries.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_financial_entries.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
          user_profile.role in ('admin', 'leader')
          or exists (
            select 1
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_financial_entries.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_bank_accounts.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_bank_statement_imports.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_bank_statement_lines.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
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
            from public.ares_financial_base_users base_user
            where base_user.financial_base_id = ares_payment_batches.financial_base_id
              and base_user.user_id = auth.uid()
              and base_user.status = 'active'
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
        and user_profile.role in ('admin', 'leader')
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  );

alter table public.ares_financial_bases replica identity full;
alter table public.ares_financial_base_users replica identity full;

commit;
