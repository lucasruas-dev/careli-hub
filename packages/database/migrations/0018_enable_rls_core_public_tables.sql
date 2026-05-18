-- Hub core public table RLS hardening.
-- Closes public-schema tables created by the baseline migrations before
-- validating homologation with real persistence.

begin;

alter table if exists public.hub_activity_events enable row level security;
alter table if exists public.hub_department_modules enable row level security;
alter table if exists public.hub_departments enable row level security;
alter table if exists public.hub_files enable row level security;
alter table if exists public.hub_integrations enable row level security;
alter table if exists public.hub_modules enable row level security;
alter table if exists public.hub_notifications enable row level security;
alter table if exists public.hub_permissions enable row level security;
alter table if exists public.hub_presence enable row level security;
alter table if exists public.hub_presence_events enable row level security;
alter table if exists public.hub_sectors enable row level security;
alter table if exists public.hub_user_assignments enable row level security;
alter table if exists public.hub_user_permissions enable row level security;
alter table if exists public.hub_users enable row level security;
alter table if exists public.hub_workspaces enable row level security;
alter table if exists public.pulsex_channel_members enable row level security;
alter table if exists public.pulsex_channels enable row level security;
alter table if exists public.pulsex_messages enable row level security;

commit;
