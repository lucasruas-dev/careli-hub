-- Ensure each active department has a general PulseX announcements channel.
-- People linked to any group/channel in the department inherit access in the app.

begin;

insert into public.pulsex_channels (
  id,
  name,
  description,
  kind,
  department_id,
  status,
  "order",
  metadata
)
select
  department.slug || '-comunicados',
  'Comunicados',
  'Comunicados gerais do departamento.',
  'department',
  department.id,
  'active',
  -100,
  jsonb_build_object('systemRole', 'department_announcements')
from public.hub_departments department
where department.status = 'active'
  and not exists (
    select 1
    from public.pulsex_channels channel
    where channel.department_id = department.id
      and channel.kind = 'department'
      and channel.metadata ->> 'systemRole' = 'department_announcements'
  )
on conflict (id) do nothing;

create or replace function public.ensure_pulsex_department_announcement_channel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'active' then
    insert into public.pulsex_channels (
      id,
      name,
      description,
      kind,
      department_id,
      status,
      "order",
      metadata
    )
    values (
      new.slug || '-comunicados',
      'Comunicados',
      'Comunicados gerais do departamento.',
      'department',
      new.id,
      'active',
      -100,
      jsonb_build_object('systemRole', 'department_announcements')
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_pulsex_department_announcement_channel on public.hub_departments;
create trigger ensure_pulsex_department_announcement_channel
after insert or update of status on public.hub_departments
for each row
execute function public.ensure_pulsex_department_announcement_channel();

commit;
