-- Iris Meta WhatsApp integration foundation.
-- This migration stores verified inbound webhook events without storing secrets.
-- The table prefix remains caredesk_* as a compatibility layer from the previous module name.

begin;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'caredesk_meta_webhook_event_status'
  ) then
    create type public.caredesk_meta_webhook_event_status as enum (
      'received',
      'processed',
      'ignored',
      'failed'
    );
  end if;
end $$;

create table if not exists public.caredesk_meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  event_object text not null default 'whatsapp_business_account',
  entry_id text,
  change_field text,
  phone_number_id text,
  display_phone_number text,
  whatsapp_business_account_id text,
  provider_event_type text not null default 'unknown',
  provider_message_id text,
  provider_status_id text,
  contact_wa_id text,
  contact_name text,
  payload jsonb not null,
  raw_body_sha256 text not null,
  signature_sha256 text,
  signature_valid boolean not null default false,
  status public.caredesk_meta_webhook_event_status not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_meta_webhook_events_object_not_blank check (btrim(event_object) <> ''),
  constraint caredesk_meta_webhook_events_type_not_blank check (btrim(provider_event_type) <> ''),
  constraint caredesk_meta_webhook_events_body_hash_hex check (raw_body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint caredesk_meta_webhook_events_signature_hash_hex check (
    signature_sha256 is null or signature_sha256 ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.caredesk_meta_webhook_events is 'Eventos recebidos do webhook Meta WhatsApp apos validacao de assinatura.';
comment on column public.caredesk_meta_webhook_events.payload is 'Payload bruto do webhook Meta, usado como trilha de auditoria e fila de processamento.';
comment on column public.caredesk_meta_webhook_events.raw_body_sha256 is 'Hash SHA-256 do corpo bruto recebido, sem armazenar segredo.';
comment on column public.caredesk_meta_webhook_events.signature_sha256 is 'Assinatura Meta normalizada sem prefixo sha256=, usada apenas para auditoria tecnica.';

create table if not exists public.caredesk_whatsapp_message_refs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.caredesk_messages(id) on delete cascade,
  webhook_event_id uuid references public.caredesk_meta_webhook_events(id) on delete set null,
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  provider text not null default 'meta',
  phone_number_id text,
  wa_message_id text not null,
  wa_contact_id text,
  direction public.caredesk_direction not null,
  delivery_status public.caredesk_delivery_status,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_whatsapp_message_refs_provider_not_blank check (btrim(provider) <> ''),
  constraint caredesk_whatsapp_message_refs_id_not_blank check (btrim(wa_message_id) <> '')
);

comment on table public.caredesk_whatsapp_message_refs is 'Mapa entre mensagens Iris e IDs de mensagens WhatsApp Meta.';

create index if not exists caredesk_meta_webhook_events_received_idx
  on public.caredesk_meta_webhook_events (received_at desc);

create index if not exists caredesk_meta_webhook_events_status_idx
  on public.caredesk_meta_webhook_events (status, received_at);

create index if not exists caredesk_meta_webhook_events_phone_idx
  on public.caredesk_meta_webhook_events (phone_number_id, received_at desc)
  where phone_number_id is not null;

create index if not exists caredesk_meta_webhook_events_provider_message_idx
  on public.caredesk_meta_webhook_events (provider_message_id)
  where provider_message_id is not null;

create index if not exists caredesk_meta_webhook_events_provider_status_idx
  on public.caredesk_meta_webhook_events (provider_status_id)
  where provider_status_id is not null;

create unique index if not exists caredesk_whatsapp_message_refs_provider_message_key
  on public.caredesk_whatsapp_message_refs (provider, wa_message_id);

create index if not exists caredesk_whatsapp_message_refs_contact_idx
  on public.caredesk_whatsapp_message_refs (provider, wa_contact_id, created_at desc)
  where wa_contact_id is not null;

drop trigger if exists set_caredesk_meta_webhook_events_updated_at
  on public.caredesk_meta_webhook_events;
create trigger set_caredesk_meta_webhook_events_updated_at
before update on public.caredesk_meta_webhook_events
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_whatsapp_message_refs_updated_at
  on public.caredesk_whatsapp_message_refs;
create trigger set_caredesk_whatsapp_message_refs_updated_at
before update on public.caredesk_whatsapp_message_refs
for each row execute function public.set_hub_updated_at();

alter table public.caredesk_meta_webhook_events enable row level security;
alter table public.caredesk_whatsapp_message_refs enable row level security;

grant select on
  public.caredesk_meta_webhook_events,
  public.caredesk_whatsapp_message_refs
to authenticated, service_role;

grant insert, update on
  public.caredesk_meta_webhook_events,
  public.caredesk_whatsapp_message_refs
to service_role;

drop policy if exists "caredesk meta webhook authenticated read"
  on public.caredesk_meta_webhook_events;
create policy "caredesk meta webhook authenticated read"
  on public.caredesk_meta_webhook_events
  for select
  to authenticated
  using (true);

drop policy if exists "caredesk whatsapp refs authenticated read"
  on public.caredesk_whatsapp_message_refs;
create policy "caredesk whatsapp refs authenticated read"
  on public.caredesk_whatsapp_message_refs
  for select
  to authenticated
  using (true);

update public.caredesk_channels
set
  config = config || jsonb_build_object(
    'webhook_path',
    '/api/iris/meta/webhook',
    'inbound_enabled',
    false,
    'outbound_enabled',
    false
  ),
  metadata = metadata || jsonb_build_object(
    'provider_product',
    'whatsapp_cloud_api',
    'prepared_by',
    'iris_core'
  ),
  updated_at = now()
where slug = 'whatsapp-careli'
  and provider = 'meta';

alter table public.caredesk_meta_webhook_events replica identity full;
alter table public.caredesk_whatsapp_message_refs replica identity full;

commit;
