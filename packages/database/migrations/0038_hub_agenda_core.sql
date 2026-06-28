-- HUB / Agenda (modulo "Meu dia") - Tarefas & Retornos do operador.
-- Modulo compartilhado por todo o HUB (Iris atende a carteira; Hades trabalha a
-- cobranca). Cockpit pessoal: o que EU preciso fazer (tarefa) e quando EU preciso
-- retornar o cliente (retorno). As REUNIOES aparecem na mesma agenda, mas vem do
-- Chronos (chronos_meetings) em leitura -- nao sao duplicadas aqui.
--
-- Tabelas com prefixo neutro hub_* (nivel HUB): o nome de marca do modulo pode
-- mudar sem mexer no schema. Sem FK para client_c2x_id (chave estavel do C2X; o
-- read-model rotaciona no sync, mesmo motivo do 0036).

begin;

create extension if not exists pgcrypto;

-- Item unico da agenda: tarefa (board por status/prioridade) OU retorno (ancorado
-- no tempo, com lembrete). due_at = prazo (tarefa) / hora do retorno (retorno).
create table if not exists public.hub_agenda_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  description text,
  status text not null default 'aberto',
  priority text,
  -- Modulo de origem/contexto (define os links de entrada e filtros por area).
  module text not null default 'hub',
  -- Dono do item (de quem e o "Meu dia"). Pode ser distinto de quem criou.
  assigned_to_user_id uuid references public.hub_users(id) on delete set null,
  -- Vinculo opcional com o cliente do C2X e com o atendimento que originou.
  client_c2x_id bigint,
  client_name text,
  attendance_protocol text,
  -- Tempo: prazo da tarefa ou horario do retorno. Lembrete opcional (1 disparo).
  due_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  -- Como retornar (retorno): whatsapp/ligacao/email/presencial/outro.
  channel text,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  updated_by_user_id uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_agenda_items_kind_check check (kind in ('tarefa', 'retorno')),
  constraint hub_agenda_items_title_not_blank check (btrim(title) <> ''),
  constraint hub_agenda_items_status_check check (
    status in ('aberto', 'em_andamento', 'concluido', 'cancelado')
  ),
  constraint hub_agenda_items_priority_check check (
    priority is null or priority in ('baixa', 'media', 'alta', 'urgente')
  ),
  constraint hub_agenda_items_module_not_blank check (btrim(module) <> ''),
  constraint hub_agenda_items_channel_check check (
    channel is null
    or channel in ('whatsapp', 'ligacao', 'email', 'presencial', 'outro')
  ),
  constraint hub_agenda_items_client_positive check (
    client_c2x_id is null or client_c2x_id > 0
  )
);

comment on table public.hub_agenda_items is
  'Agenda pessoal do HUB (modulo Meu dia): tarefas e retornos do operador. Reunioes vem do Chronos.';
comment on column public.hub_agenda_items.kind is
  'tarefa = item de board (status/prioridade); retorno = compromisso de retornar o cliente (tempo + lembrete).';
comment on column public.hub_agenda_items.due_at is
  'Prazo da tarefa ou horario do retorno. Base do agrupamento Atrasado/Hoje/Em breve e da timeline.';
comment on column public.hub_agenda_items.module is
  'Modulo de origem/contexto (hades/iris/hub). Alimenta os links de entrada e os filtros por area.';
comment on column public.hub_agenda_items.client_c2x_id is
  'Chave estavel do cliente no C2X (sem FK: o read-model rotaciona no sync).';

-- Fila do "Meu dia": itens de um dono por status/prazo.
create index if not exists hub_agenda_items_owner_idx
  on public.hub_agenda_items (assigned_to_user_id, status, due_at);

-- Filtro por area (links de entrada do board/atendimento).
create index if not exists hub_agenda_items_module_idx
  on public.hub_agenda_items (module, status);

create index if not exists hub_agenda_items_client_idx
  on public.hub_agenda_items (client_c2x_id)
  where client_c2x_id is not null;

create index if not exists hub_agenda_items_attendance_idx
  on public.hub_agenda_items (attendance_protocol)
  where attendance_protocol is not null;

-- Cron de lembretes de retorno: pega os pendentes (remind_at vencido, ainda nao
-- disparado, item nao encerrado).
create index if not exists hub_agenda_items_reminder_idx
  on public.hub_agenda_items (remind_at)
  where remind_at is not null and reminded_at is null;

drop trigger if exists set_hub_agenda_items_updated_at on public.hub_agenda_items;
create trigger set_hub_agenda_items_updated_at
before update on public.hub_agenda_items
for each row execute function public.set_hub_updated_at();

-- RLS: o app usa service_role (sessao validada em codigo), mas habilitamos RLS +
-- policias por papel como defesa em profundidade. Leitura: admin/leader/operator/
-- viewer. Escrita: admin/leader/operator (quem opera a carteira).
alter table public.hub_agenda_items enable row level security;

revoke all privileges on table public.hub_agenda_items
  from anon, authenticated, service_role;

grant select, insert, update, delete on table public.hub_agenda_items
  to authenticated, service_role;

drop policy if exists "hub agenda items read" on public.hub_agenda_items;
create policy "hub agenda items read"
  on public.hub_agenda_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator', 'viewer')
    )
  );

drop policy if exists "hub agenda items manage" on public.hub_agenda_items;
create policy "hub agenda items manage"
  on public.hub_agenda_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  )
  with check (
    exists (
      select 1 from public.hub_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and u.role in ('admin', 'leader', 'operator')
    )
  );

alter table public.hub_agenda_items replica identity full;

commit;
