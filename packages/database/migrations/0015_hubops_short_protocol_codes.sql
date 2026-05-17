-- HubOps short protocol codes.
-- Normalizes operational activity protocols to AT-0001 and alert protocols to AL-0001.

begin;

create sequence if not exists public.hub_engineering_operation_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1;

create sequence if not exists public.hub_operations_alert_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1;

create or replace function public.next_hub_operations_alert_protocol()
returns text
language sql
set search_path = public
as $$
  select 'AL-' || lpad(nextval('public.hub_operations_alert_protocol_seq')::text, 4, '0')
$$;

revoke all on function public.next_hub_operations_alert_protocol() from public;
grant execute on function public.next_hub_operations_alert_protocol() to service_role;
grant usage, select on sequence public.hub_operations_alert_protocol_seq to service_role;
grant usage, select on sequence public.hub_engineering_operation_protocol_seq
to authenticated, service_role;

alter table if exists public.hub_engineering_operation_records
  alter column protocol set default (
    'AT-' || lpad(nextval('public.hub_engineering_operation_protocol_seq')::text, 4, '0')
  );

alter table if exists public.hub_operations_alert_protocols
  alter column protocol set default (
    'AL-' || lpad(nextval('public.hub_operations_alert_protocol_seq')::text, 4, '0')
  );

with existing_activity_max as (
  select coalesce(
    max(substring(protocol from '^AT-([0-9]+)$')::bigint),
    0
  ) as value
  from public.hub_engineering_operation_records
  where protocol ~ '^AT-[0-9]+$'
),
activity_protocols as (
  select
    id,
    'AT-' || lpad(
      (
        existing_activity_max.value +
        row_number() over (
          order by
            created_at,
            coalesce(local_occurred_at, created_at),
            source_index,
            line_start,
            id
        )
      )::text,
      4,
      '0'
    ) as next_protocol
  from public.hub_engineering_operation_records
  cross join existing_activity_max
  where protocol !~ '^AT-[0-9]+$'
)
update public.hub_engineering_operation_records records
set protocol = activity_protocols.next_protocol
from activity_protocols
where records.id = activity_protocols.id;

with existing_alert_max as (
  select coalesce(
    max(substring(protocol from '^AL-([0-9]+)$')::bigint),
    0
  ) as value
  from public.hub_operations_alert_protocols
  where protocol ~ '^AL-[0-9]+$'
),
alert_protocols as (
  select
    alerts.id,
    alerts.protocol as previous_protocol,
    'AL-' || lpad(
      (existing_alert_max.value + row_number() over (order by alerts.first_seen_at, alerts.created_at, alerts.id))::text,
      4,
      '0'
    ) as next_protocol
  from public.hub_operations_alert_protocols alerts
  cross join existing_alert_max
  where alerts.protocol !~ '^AL-[0-9]+$'
)
update public.hub_operations_alert_protocols alerts
set
  command = replace(alerts.command, alert_protocols.previous_protocol, alert_protocols.next_protocol),
  protocol = alert_protocols.next_protocol
from alert_protocols
where alerts.id = alert_protocols.id;

do $$
declare
  activity_max bigint;
  alert_max bigint;
begin
  select max(substring(protocol from '^AT-([0-9]+)$')::bigint)
    into activity_max
  from public.hub_engineering_operation_records
  where protocol ~ '^AT-[0-9]+$';

  if activity_max is null then
    perform setval('public.hub_engineering_operation_protocol_seq', 1, false);
  else
    perform setval('public.hub_engineering_operation_protocol_seq', activity_max, true);
  end if;

  select max(substring(protocol from '^AL-([0-9]+)$')::bigint)
    into alert_max
  from public.hub_operations_alert_protocols
  where protocol ~ '^AL-[0-9]+$';

  if alert_max is null then
    perform setval('public.hub_operations_alert_protocol_seq', 1, false);
  else
    perform setval('public.hub_operations_alert_protocol_seq', alert_max, true);
  end if;
end $$;

comment on column public.hub_engineering_operation_records.protocol is
  'Codigo curto e sequencial da atividade operacional, no padrao AT-0001.';

comment on column public.hub_operations_alert_protocols.protocol is
  'Codigo curto e sequencial do alerta operacional, no padrao AL-0001.';

commit;
