-- Níveis de acesso da Iris (decisão do Lucas, 15/jul).
--
-- A fila ganha VÍNCULOS (N) com a estrutura da empresa. É N e não 1 porque
-- Grupo/Direct pertencem a DOIS departamentos (Operação + Relação) ao mesmo tempo.
--
-- Semântica de cada vínculo:
--   (departamento, setor)  -> só aquele setor (+ o cdr do departamento)
--   (departamento, NULL)   -> o DEPARTAMENTO INTEIRO (todos os setores dele)
--
-- Régua de quem enxerga (aplicada no código; RLS vem depois):
--   op1/op2/op3, ldr -> vínculo do SEU SETOR, ou vínculo de departamento inteiro
--                       que seja um departamento seu
--   cdr              -> qualquer vínculo do SEU DEPARTAMENTO
--   adm              -> tudo
--   fila SEM vínculo -> só adm (restritivo por padrão)
--
-- Reaproveita o que já existe: hub_departments, hub_sectors, hub_user_assignments
-- e hub_users.operational_profile.

begin;

create table if not exists public.caredesk_queue_scopes (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references public.caredesk_queues(id) on delete cascade,
  department_id uuid not null
    references public.hub_departments(id) on delete cascade,
  -- NULL = departamento inteiro (todos os setores dele).
  sector_id uuid
    references public.hub_sectors(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.caredesk_queue_scopes is
  'Vínculos da fila com departamento/setor. sector_id NULL = departamento inteiro. Define quem enxerga a fila na Iris.';

-- Evita vínculo repetido. Índice parcial porque NULL não conflita em unique.
create unique index if not exists caredesk_queue_scopes_dept_sector_key
  on public.caredesk_queue_scopes (queue_id, department_id, sector_id)
  where sector_id is not null;
create unique index if not exists caredesk_queue_scopes_dept_only_key
  on public.caredesk_queue_scopes (queue_id, department_id)
  where sector_id is null;

create index if not exists caredesk_queue_scopes_queue_idx
  on public.caredesk_queue_scopes (queue_id);

-- RLS igual ao resto do caredesk: leitura pra autenticado, escrita pra
-- operador/líder/admin ativo. (Sem policy a tela não enxergaria nada — foi o
-- erro que cometi na 0045.)
alter table public.caredesk_queue_scopes enable row level security;

drop policy if exists "caredesk authenticated read"
  on public.caredesk_queue_scopes;
create policy "caredesk authenticated read"
  on public.caredesk_queue_scopes
  for select to authenticated using (true);

drop policy if exists "caredesk authenticated operation manage"
  on public.caredesk_queue_scopes;
create policy "caredesk authenticated operation manage"
  on public.caredesk_queue_scopes
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
