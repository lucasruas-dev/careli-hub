-- Atlas occurrence justification workflow.
-- Non-destructive extension for controlled occurrence creation and leader review.

begin;

alter table public.atlas_occurrences
  add column if not exists created_by_user_id uuid
    references public.hub_users(id) on delete set null,
  add column if not exists operational_status text not null default 'procedente',
  add column if not exists justification_status text not null default 'none',
  add column if not exists justification_text text,
  add column if not exists justification_submitted_by_user_id uuid
    references public.hub_users(id) on delete set null,
  add column if not exists justification_submitted_at timestamptz,
  add column if not exists justification_reviewed_by_user_id uuid
    references public.hub_users(id) on delete set null,
  add column if not exists justification_reviewed_at timestamptz,
  add column if not exists justification_review_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'atlas_occurrences_operational_status_check'
  ) then
    alter table public.atlas_occurrences
      add constraint atlas_occurrences_operational_status_check
      check (operational_status in ('procedente', 'improcedente'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'atlas_occurrences_justification_status_check'
  ) then
    alter table public.atlas_occurrences
      add constraint atlas_occurrences_justification_status_check
      check (justification_status in ('none', 'pending', 'accepted', 'rejected'));
  end if;
end $$;

comment on column public.atlas_occurrences.created_by_user_id is
  'Usuario Hub que abriu a ocorrencia pelo Atlas no Hub.';

comment on column public.atlas_occurrences.operational_status is
  'Status operacional da ocorrencia: procedente ou improcedente.';

comment on column public.atlas_occurrences.justification_status is
  'Status da justificativa: none, pending, accepted ou rejected.';

comment on column public.atlas_occurrences.justification_text is
  'Justificativa apresentada pelo colaborador ou usuario Hub.';

comment on column public.atlas_occurrences.justification_submitted_by_user_id is
  'Usuario Hub que registrou a justificativa.';

comment on column public.atlas_occurrences.justification_submitted_at is
  'Data e hora em que a justificativa foi registrada.';

comment on column public.atlas_occurrences.justification_reviewed_by_user_id is
  'Lider ou administrador Hub que revisou a justificativa.';

comment on column public.atlas_occurrences.justification_reviewed_at is
  'Data e hora da decisao sobre a justificativa.';

comment on column public.atlas_occurrences.justification_review_note is
  'Observacao do lider ou administrador sobre a decisao da justificativa.';

create index if not exists atlas_occurrences_operational_status_idx
  on public.atlas_occurrences (operational_status, occurrence_date desc);

create index if not exists atlas_occurrences_justification_status_idx
  on public.atlas_occurrences (justification_status, occurrence_date desc);

create index if not exists atlas_occurrences_created_by_idx
  on public.atlas_occurrences (created_by_user_id, occurrence_date desc);

create index if not exists atlas_occurrences_justification_submitter_idx
  on public.atlas_occurrences (justification_submitted_by_user_id, occurrence_date desc);

drop policy if exists "atlas active users insert occurrences"
  on public.atlas_occurrences;
create policy "atlas active users insert occurrences"
  on public.atlas_occurrences
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and operational_status = 'procedente'
    and justification_status = 'none'
    and exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

commit;
