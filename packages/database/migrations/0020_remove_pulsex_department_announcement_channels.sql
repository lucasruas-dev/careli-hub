-- Remove automatic department-wide PulseX "Comunicados" channels.
-- Communication announcements are no longer created as one channel per department.

begin;

drop trigger if exists ensure_pulsex_department_announcement_channel on public.hub_departments;
drop function if exists public.ensure_pulsex_department_announcement_channel();

update public.pulsex_channels
set
  status = 'archived',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'archivedReason',
    'department_announcements_removed',
    'archivedAt',
    now()
  )
where kind = 'department'
  and metadata ->> 'systemRole' = 'department_announcements'
  and status <> 'archived';

commit;
