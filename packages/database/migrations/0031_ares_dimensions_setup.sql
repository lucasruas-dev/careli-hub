-- Ares - setup operacional de dimensoes financeiras.
-- Complementa o lancamento com departamento e reforca indices das dimensoes.
-- Nao define plano de contas, regra fiscal, integracao bancaria ou ERP.

begin;

alter table public.ares_financial_entries
  add column if not exists department_id uuid,
  add column if not exists department_name_snapshot text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ares_financial_entries_department_id_fkey'
      and conrelid = 'public.ares_financial_entries'::regclass
  ) then
    alter table public.ares_financial_entries
      add constraint ares_financial_entries_department_id_fkey
      foreign key (department_id)
      references public.ares_financial_dimensions(id)
      on delete set null;
  end if;
end $$;

alter table public.ares_financial_entries
  drop constraint if exists ares_financial_entries_launch_snapshots_not_blank;

alter table public.ares_financial_entries
  add constraint ares_financial_entries_launch_snapshots_not_blank check (
    (bank_account_label_snapshot is null or btrim(bank_account_label_snapshot) <> '')
    and (category_name_snapshot is null or btrim(category_name_snapshot) <> '')
    and (cost_center_name_snapshot is null or btrim(cost_center_name_snapshot) <> '')
    and (project_name_snapshot is null or btrim(project_name_snapshot) <> '')
    and (result_center_name_snapshot is null or btrim(result_center_name_snapshot) <> '')
    and (department_name_snapshot is null or btrim(department_name_snapshot) <> '')
    and (responsible_name_snapshot is null or btrim(responsible_name_snapshot) <> '')
    and (next_action is null or btrim(next_action) <> '')
  );

comment on column public.ares_financial_entries.department_id is
  'Departamento operacional do lancamento Ares, vinculado ao setup financeiro.';
comment on column public.ares_financial_entries.department_name_snapshot is
  'Snapshot do departamento informado no lancamento para auditoria operacional.';

create index if not exists ares_financial_entries_cost_center_idx
  on public.ares_financial_entries (cost_center_id);

create index if not exists ares_financial_entries_result_center_idx
  on public.ares_financial_entries (result_center_id);

create index if not exists ares_financial_entries_department_idx
  on public.ares_financial_entries (department_id);

commit;
