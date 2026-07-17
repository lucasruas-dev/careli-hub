-- Níveis de acesso da Iris (decisão do Lucas): a FILA passa a ser vinculada a
-- departamento e setor, e quem vê cada fila sai do perfil do usuário logado:
--   op1/op2/op3 e ldr -> só as filas do SEU SETOR
--   cdr               -> todas as filas do SEU DEPARTAMENTO
--   adm               -> tudo
--   fila SEM vínculo  -> só adm (decisão do Lucas: restritivo por padrão)
--
-- Reaproveita o que JÁ EXISTE no hub (não cria conceito novo):
--   hub_departments (6) -> hub_sectors (11, com department_id)
--   hub_user_assignments (user_id, department_id, sector_id, is_primary, status)
--   hub_users.operational_profile (enum hub_operational_profile_role: op1..adm)
--
-- Aqui só criamos o ELO. A régua de visibilidade é aplicada no código, e a
-- ENFORCEMENT no banco (RLS) vem numa migration separada.

begin;

alter table public.caredesk_queues
  add column if not exists department_id uuid
    references public.hub_departments(id) on delete set null;

alter table public.caredesk_queues
  add column if not exists sector_id uuid
    references public.hub_sectors(id) on delete set null;

comment on column public.caredesk_queues.department_id is
  'Departamento dono da fila. cdr enxerga todas as filas do seu departamento.';
comment on column public.caredesk_queues.sector_id is
  'Setor dono da fila. op*/ldr enxergam só as filas do seu setor.';

create index if not exists caredesk_queues_department_idx
  on public.caredesk_queues (department_id);
create index if not exists caredesk_queues_sector_idx
  on public.caredesk_queues (sector_id);

commit;
