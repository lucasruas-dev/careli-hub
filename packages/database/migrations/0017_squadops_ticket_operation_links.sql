-- SquadOps ticket operation links.
-- Connects TI-* tickets to AT-* operational activity and DP-* release protocols.

alter type public.hub_it_ticket_status add value if not exists 'em_analise';
alter type public.hub_it_ticket_status add value if not exists 'em_tratativa';
alter type public.hub_it_ticket_status add value if not exists 'em_homologacao';
alter type public.hub_it_ticket_status add value if not exists 'em_producao';

create table if not exists public.hub_it_ticket_operation_links (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hub_it_tickets(id) on delete cascade,
  operation_record_id uuid references public.hub_engineering_operation_records(id) on delete set null,
  release_protocol_id uuid references public.hub_release_protocols(id) on delete set null,
  ticket_protocol text not null,
  operation_protocol text,
  release_protocol text,
  link_type text not null default 'tratativa',
  ticket_status_snapshot text not null default 'em_analise',
  sync_status text not null default 'pendente',
  summary text,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_it_ticket_operation_links_ticket_protocol_not_blank check (btrim(ticket_protocol) <> ''),
  constraint hub_it_ticket_operation_links_link_type_check check (
    link_type in (
      'origem',
      'analise',
      'tratativa',
      'homologacao',
      'producao',
      'rollback',
      'encerramento'
    )
  ),
  constraint hub_it_ticket_operation_links_status_check check (
    ticket_status_snapshot in (
      'novo',
      'em_analise',
      'em_triagem',
      'em_tratativa',
      'em_execucao',
      'em_homologacao',
      'em_producao',
      'aguardando_cliente',
      'em_revisao',
      'resolvido',
      'fechado'
    )
  ),
  constraint hub_it_ticket_operation_links_sync_status_check check (
    sync_status in ('pendente', 'sincronizado', 'ignorado', 'bloqueado')
  ),
  constraint hub_it_ticket_operation_links_unique_source unique (
    ticket_id,
    operation_protocol,
    release_protocol,
    link_type
  )
);

comment on table public.hub_it_ticket_operation_links is
  'Vinculos entre Ticket TI, registros AT-* e releases DP-* para sincronizar status do solicitante com o fluxo SquadOps.';

comment on column public.hub_it_ticket_operation_links.ticket_status_snapshot is
  'Ultimo status aplicado ou sugerido para o Ticket TI a partir do vinculo operacional.';

comment on column public.hub_it_ticket_operation_links.sync_status is
  'Controle da sincronizacao automatica: pendente, sincronizado, ignorado ou bloqueado.';

create index if not exists hub_it_ticket_operation_links_ticket_idx
  on public.hub_it_ticket_operation_links (ticket_id, created_at desc);

create index if not exists hub_it_ticket_operation_links_operation_idx
  on public.hub_it_ticket_operation_links (operation_protocol)
  where operation_protocol is not null;

create index if not exists hub_it_ticket_operation_links_release_idx
  on public.hub_it_ticket_operation_links (release_protocol)
  where release_protocol is not null;

drop trigger if exists set_hub_it_ticket_operation_links_updated_at
  on public.hub_it_ticket_operation_links;
create trigger set_hub_it_ticket_operation_links_updated_at
before update on public.hub_it_ticket_operation_links
for each row execute function public.set_hub_updated_at();

alter table public.hub_it_ticket_operation_links enable row level security;

grant select, insert, update, delete on
  public.hub_it_ticket_operation_links
to authenticated, service_role;

drop policy if exists "hub ticket operation links requester read"
  on public.hub_it_ticket_operation_links;
create policy "hub ticket operation links requester read"
  on public.hub_it_ticket_operation_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_it_tickets ticket
      where ticket.id = hub_it_ticket_operation_links.ticket_id
        and ticket.requested_by_user_id = auth.uid()
    )
  );

drop policy if exists "hub ticket operation links admin manage"
  on public.hub_it_ticket_operation_links;
create policy "hub ticket operation links admin manage"
  on public.hub_it_ticket_operation_links
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

alter table public.hub_it_ticket_operation_links replica identity full;
