-- Iris inbound ticket protocols and demo cleanup.
-- Keeps the technical caredesk_* prefix for compatibility.

begin;

create sequence if not exists public.caredesk_ticket_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  cache 1;

do $$
declare
  max_protocol_number bigint;
  sequence_value bigint;
begin
  select coalesce(max(substring(protocol from '^AT-([0-9]+)$')::bigint), 0)
    into max_protocol_number
  from public.caredesk_tickets
  where protocol ~ '^AT-[0-9]+$';

  select last_value
    into sequence_value
  from public.caredesk_ticket_protocol_seq;

  if max_protocol_number >= sequence_value then
    perform setval(
      'public.caredesk_ticket_protocol_seq',
      greatest(max_protocol_number, 1),
      max_protocol_number > 0
    );
  end if;
end $$;

create or replace function public.next_caredesk_ticket_protocol()
returns text
language plpgsql
set search_path = public
as $$
declare
  next_protocol_number bigint;
begin
  next_protocol_number := nextval('public.caredesk_ticket_protocol_seq');

  return 'AT-' || lpad(next_protocol_number::text, 6, '0');
end;
$$;

comment on function public.next_caredesk_ticket_protocol() is
  'Gera protocolos sequenciais AT-* para tickets operacionais da Iris.';

revoke all on function public.next_caredesk_ticket_protocol() from public;
grant execute on function public.next_caredesk_ticket_protocol() to service_role;
grant usage, select on sequence public.caredesk_ticket_protocol_seq to service_role;

update public.caredesk_channels
set
  status = 'active',
  config = config || jsonb_build_object(
    'webhook_path',
    '/api/iris/meta/webhook',
    'inbound_enabled',
    true,
    'outbound_enabled',
    true,
    'ticket_protocol',
    'AT-sequential'
  ),
  metadata = metadata || jsonb_build_object(
    'provider_product',
    'whatsapp_cloud_api',
    'inbound_processor',
    'iris_meta_whatsapp',
    'prepared_by',
    'iris_core'
  ),
  updated_at = now()
where slug = 'whatsapp-careli'
  and provider = 'meta';

delete from public.caredesk_broadcasts
where name like 'Demo CareDesk%'
   or metadata ->> 'seedTag' = 'caredesk-demo-2026-05-16';

delete from public.caredesk_tickets
where protocol like 'CARE-DEMO-%'
   or source_entity_type = 'demo-seed'
   or metadata ->> 'seedTag' = 'caredesk-demo-2026-05-16';

commit;
