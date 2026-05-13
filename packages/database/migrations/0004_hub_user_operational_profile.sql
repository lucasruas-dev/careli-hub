-- Store Careli operational profile roles independently from legacy auth roles.
-- Execute after 0003_setup_operational_access.sql.

begin;

do $$
begin
  create type hub_operational_profile_role as enum ('op1', 'op2', 'op3', 'ldr', 'cdr', 'adm');
exception
  when duplicate_object then null;
end $$;

alter table public.hub_users
  add column if not exists operational_profile hub_operational_profile_role not null default 'op1';

comment on column public.hub_users.operational_profile is
  'Careli operational profile used by Setup Central: op1, op2, op3, ldr, cdr, adm.';

commit;
