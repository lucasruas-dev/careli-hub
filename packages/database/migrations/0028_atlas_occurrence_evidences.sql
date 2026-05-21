-- Atlas occurrence evidences.
-- Non-destructive extension for multiple evidences per occurrence.

begin;

create table if not exists public.atlas_occurrence_evidences (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null
    references public.atlas_occurrences(id) on delete cascade,
  occurrence_legacy_id uuid not null
    references public.atlas_occurrences(legacy_id) on delete cascade,
  evidence_url text not null,
  evidence_name text,
  evidence_type text,
  position integer not null default 1,
  legacy_evidence_key text,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_occurrence_evidences_url_not_blank
    check (btrim(evidence_url) <> ''),
  constraint atlas_occurrence_evidences_position_positive
    check (position > 0)
);

comment on table public.atlas_occurrence_evidences is
  'Evidencias multiplas por ocorrencia Atlas. A mesma evidence_url pode ser usada em ocorrencias e colaboradores diferentes.';

comment on column public.atlas_occurrence_evidences.evidence_url is
  'URL ou caminho controlado da evidencia. Nao possui unicidade para permitir repeticao entre colaboradores.';

comment on column public.atlas_occurrence_evidences.legacy_evidence_key is
  'Chave tecnica opcional para idempotencia da evidencia principal importada do legado.';

create index if not exists atlas_occurrence_evidences_occurrence_idx
  on public.atlas_occurrence_evidences (occurrence_legacy_id, position, created_at);

create index if not exists atlas_occurrence_evidences_created_by_idx
  on public.atlas_occurrence_evidences (created_by_user_id, created_at desc);

create unique index if not exists atlas_occurrence_evidences_legacy_key_uidx
  on public.atlas_occurrence_evidences (legacy_evidence_key)
  where legacy_evidence_key is not null;

insert into public.atlas_occurrence_evidences (
  occurrence_id,
  occurrence_legacy_id,
  evidence_url,
  evidence_name,
  evidence_type,
  position,
  legacy_evidence_key,
  metadata
)
select
  occurrence.id,
  occurrence.legacy_id,
  occurrence.evidence_url,
  occurrence.evidence_name,
  occurrence.evidence_type,
  1,
  'legacy:' || occurrence.legacy_id::text || ':primary',
  jsonb_build_object(
    'origin', 'atlas_occurrences.evidence_url',
    'migrated_by', '0028_atlas_occurrence_evidences'
  )
from public.atlas_occurrences occurrence
where occurrence.evidence_url is not null
  and btrim(occurrence.evidence_url) <> ''
  and not exists (
    select 1
    from public.atlas_occurrence_evidences evidence
    where evidence.legacy_evidence_key =
      'legacy:' || occurrence.legacy_id::text || ':primary'
  );

drop trigger if exists set_atlas_occurrence_evidences_updated_at
  on public.atlas_occurrence_evidences;
create trigger set_atlas_occurrence_evidences_updated_at
before update on public.atlas_occurrence_evidences
for each row execute function public.set_hub_updated_at();

alter table public.atlas_occurrence_evidences enable row level security;

grant select, insert, update, delete on
  public.atlas_occurrence_evidences
to authenticated, service_role;

drop policy if exists "atlas authenticated read occurrence evidences"
  on public.atlas_occurrence_evidences;
create policy "atlas authenticated read occurrence evidences"
  on public.atlas_occurrence_evidences
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

drop policy if exists "atlas active users insert occurrence evidences"
  on public.atlas_occurrence_evidences;
create policy "atlas active users insert occurrence evidences"
  on public.atlas_occurrence_evidences
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage occurrence evidences"
  on public.atlas_occurrence_evidences;
create policy "atlas admin manage occurrence evidences"
  on public.atlas_occurrence_evidences
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

alter table public.atlas_occurrence_evidences replica identity full;

commit;
