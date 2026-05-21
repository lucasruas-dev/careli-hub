-- Atlas FPE (Fundo de Participacao) core.
-- Non-destructive extension for annual participation fund entries.

begin;

create table if not exists public.atlas_fpe_entries (
  id uuid primary key default gen_random_uuid(),
  cycle_year integer not null default extract(year from now())::integer,
  entry_date date not null default current_date,
  kind text not null,
  amount numeric(12, 2) not null,
  collaborator_id uuid references public.atlas_collaborators(id) on delete set null,
  collaborator_legacy_id uuid not null
    references public.atlas_collaborators(legacy_id) on delete restrict,
  department_id uuid references public.atlas_departments(id) on delete set null,
  department_legacy_id uuid not null
    references public.atlas_departments(legacy_id) on delete restrict,
  occurrence_id uuid references public.atlas_occurrences(id) on delete set null,
  occurrence_legacy_id uuid references public.atlas_occurrences(legacy_id) on delete set null,
  occurrence_type_id uuid references public.atlas_occurrence_types(id) on delete set null,
  occurrence_type_legacy_id uuid references public.atlas_occurrence_types(legacy_id) on delete set null,
  description text,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_fpe_entries_kind_check
    check (kind in ('bonus', 'loss')),
  constraint atlas_fpe_entries_amount_positive
    check (amount > 0),
  constraint atlas_fpe_entries_cycle_year_valid
    check (cycle_year between 2020 and 2100)
);

comment on table public.atlas_fpe_entries is
  'Lancamentos do Fundo de Participacao Atlas. Cada valor positivo ou negativo impacta 30% do fundo global e 70% do departamento do colaborador.';

comment on column public.atlas_fpe_entries.kind is
  'bonus aumenta o FPE; loss reduz o FPE. O valor fica sempre positivo e o sinal e calculado pela regra operacional.';

comment on column public.atlas_fpe_entries.amount is
  'Valor base informado pelo gestor. A divisao operacional e calculada como 30% global e 70% departamento.';

create index if not exists atlas_fpe_entries_cycle_idx
  on public.atlas_fpe_entries (cycle_year, entry_date desc, created_at desc);

create index if not exists atlas_fpe_entries_department_idx
  on public.atlas_fpe_entries (department_legacy_id, cycle_year, entry_date desc);

create index if not exists atlas_fpe_entries_collaborator_idx
  on public.atlas_fpe_entries (collaborator_legacy_id, cycle_year, entry_date desc);

create index if not exists atlas_fpe_entries_occurrence_idx
  on public.atlas_fpe_entries (occurrence_legacy_id);

drop trigger if exists set_atlas_fpe_entries_updated_at
  on public.atlas_fpe_entries;
create trigger set_atlas_fpe_entries_updated_at
before update on public.atlas_fpe_entries
for each row execute function public.set_hub_updated_at();

alter table public.atlas_fpe_entries enable row level security;

grant select, insert, update, delete on
  public.atlas_fpe_entries
to authenticated, service_role;

drop policy if exists "atlas authenticated read fpe entries"
  on public.atlas_fpe_entries;
create policy "atlas authenticated read fpe entries"
  on public.atlas_fpe_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas leaders insert fpe entries"
  on public.atlas_fpe_entries;
create policy "atlas leaders insert fpe entries"
  on public.atlas_fpe_entries
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role in ('admin', 'leader')
    )
  );

drop policy if exists "atlas admin manage fpe entries"
  on public.atlas_fpe_entries;
create policy "atlas admin manage fpe entries"
  on public.atlas_fpe_entries
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

do $$
declare
  technology_department record;
begin
  select id, legacy_id
  into technology_department
  from public.atlas_departments
  where lower(btrim(name)) = 'tecnologia'
  limit 1;

  if technology_department.id is not null then
    update public.atlas_collaborators
    set
      department_id = technology_department.id,
      department_legacy_id = technology_department.legacy_id,
      metadata = metadata || jsonb_build_object(
        'department_corrected_by', '0029_atlas_fpe',
        'department_corrected_reason', 'Lucas Ruas vinculado ao departamento Tecnologia para regra FPE'
      ),
      updated_at = now()
    where lower(btrim(name)) = 'lucas ruas';
  end if;
end $$;

alter table public.atlas_fpe_entries replica identity full;

commit;
