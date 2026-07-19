-- Menção (@) nos grupos: pra oferecer a lista de quem mencionar, precisamos dos
-- PARTICIPANTES — hoje só guardamos a quantidade (participants_count).
--
-- Detalhe que manda no design: a lista que o WhatsApp devolve (findGroupInfos)
-- traz só o NÚMERO, sem nome. O nome a gente só conhece de quem já falou no
-- grupo (o pushName que guardamos em provider_payload.groupParticipantName).
-- Por isso o display_name aqui é opcional e vai sendo preenchido/atualizado
-- conforme as pessoas falam.

begin;

create table if not exists public.caredesk_whatsapp_group_participants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null
    references public.caredesk_whatsapp_groups(id) on delete cascade,
  -- Número em dígitos (sem @s.whatsapp.net). É o que vai na menção.
  phone text not null,
  -- Nome conhecido (pushName de quando a pessoa falou). Pode ser null.
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_group_participants_phone_not_blank check (btrim(phone) <> ''),
  constraint caredesk_group_participants_key unique (group_id, phone)
);

comment on table public.caredesk_whatsapp_group_participants is
  'Participantes de cada grupo de WhatsApp. Alimenta o seletor de menção (@). O nome vem do pushName de quem já falou — o WhatsApp não devolve nome na lista de participantes.';

create index if not exists caredesk_group_participants_group_idx
  on public.caredesk_whatsapp_group_participants (group_id);

-- RLS igual ao resto do caredesk (a policy que faltou na 0045 e cegou a tela).
alter table public.caredesk_whatsapp_group_participants enable row level security;

drop policy if exists "caredesk authenticated read"
  on public.caredesk_whatsapp_group_participants;
create policy "caredesk authenticated read"
  on public.caredesk_whatsapp_group_participants
  for select to authenticated using (true);

drop policy if exists "caredesk authenticated operation manage"
  on public.caredesk_whatsapp_group_participants;
create policy "caredesk authenticated operation manage"
  on public.caredesk_whatsapp_group_participants
  for all to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'::public.hub_record_status
        and u.role = any (array[
          'admin'::public.hub_user_role,
          'leader'::public.hub_user_role,
          'operator'::public.hub_user_role
        ])
    )
  )
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'::public.hub_record_status
        and u.role = any (array[
          'admin'::public.hub_user_role,
          'leader'::public.hub_user_role,
          'operator'::public.hub_user_role
        ])
    )
  );

commit;
