begin;

with department_seed(slug, name, description) as (
  values
    ('operacao', 'Operacao', 'Rotinas operacionais, cobranca e atendimento diario.'),
    ('tecnologia', 'Tecnologia', 'Produto, infraestrutura e automacoes internas.'),
    ('relacao', 'Relacao', 'Relacionamento, atendimento e comunicacao com clientes.'),
    ('administrativo', 'Administrativo', 'Apoio administrativo e organizacao interna.'),
    ('diretoria', 'Diretoria', 'Governanca executiva e decisoes estrategicas.')
)
insert into public.hub_departments (
  slug,
  name,
  description,
  status
)
select
  slug,
  name,
  description,
  'active'
from department_seed
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

with sector_seed(department_slug, slug, name, description) as (
  values
    ('operacao', 'cobranca', 'Cobranca', 'Esteira operacional de cobranca.'),
    ('operacao', 'desk', 'Desk', 'Mesa de atendimento e retornos.'),
    ('operacao', 'workflow', 'Workflow', 'Fluxos e rotinas operacionais.'),
    ('relacao', 'suporte', 'Suporte', 'Suporte e relacionamento operacional.'),
    ('tecnologia', 'infraestrutura', 'Infraestrutura', 'Ambientes, acessos e monitoramento.'),
    ('tecnologia', 'produto', 'Produto', 'Evolucao dos modulos e experiencia interna.'),
    ('diretoria', 'diretoria', 'Diretoria', 'Alinhamentos executivos.')
)
insert into public.hub_sectors (
  department_id,
  slug,
  name,
  description,
  status
)
select
  department.id,
  sector.slug,
  sector.name,
  sector.description,
  'active'
from sector_seed sector
join public.hub_departments department on department.slug = sector.department_slug
on conflict (slug) do update set
  department_id = excluded.department_id,
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.hub_department_modules (
  department_id,
  module_id,
  status
)
select
  department.id,
  module_id,
  'enabled'::hub_department_module_status
from public.hub_departments department
cross join (
  values
    ('pulsex'),
    ('setup')
) as module_access(module_id)
where department.slug in ('operacao', 'tecnologia', 'relacao', 'administrativo', 'diretoria')
on conflict (department_id, module_id) do update set
  status = excluded.status,
  updated_at = now();

with channel_seed(id, name, description, kind, department_slug, sector_slug, order_value) as (
  values
    ('cobranca', 'Cobranca', 'Comunicacao operacional da cobranca Careli.', 'sector', 'operacao', 'cobranca', 10),
    ('desk', 'Desk', 'Fila de atendimento operacional do Desk.', 'sector', 'operacao', 'desk', 20),
    ('workflow', 'Workflow', 'Fluxos, rotinas e automacoes operacionais.', 'sector', 'operacao', 'workflow', 30),
    ('tecnologia', 'Tecnologia', 'Produto, infraestrutura e suporte tecnico interno.', 'department', 'tecnologia', null, 40),
    ('diretoria', 'Diretoria', 'Alinhamentos e decisoes executivas.', 'sector', 'diretoria', 'diretoria', 50)
)
insert into public.pulsex_channels (
  id,
  name,
  description,
  kind,
  department_id,
  sector_id,
  status,
  "order",
  metadata
)
select
  channel.id,
  channel.name,
  channel.description,
  channel.kind::pulsex_channel_kind,
  department.id,
  sector.id,
  'active',
  channel.order_value,
  jsonb_build_object('source', 'seed', 'version', '0002')
from channel_seed channel
join public.hub_departments department on department.slug = channel.department_slug
left join public.hub_sectors sector on sector.slug = channel.sector_slug
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  kind = excluded.kind,
  department_id = excluded.department_id,
  sector_id = excluded.sector_id,
  status = excluded.status,
  "order" = excluded."order",
  metadata = excluded.metadata,
  updated_at = now();

insert into public.pulsex_messages (
  channel_id,
  author_user_id,
  body,
  metadata
)
select
  channel.id,
  null,
  'Canal preparado pelo Setup Central para operacao real no Supabase.',
  jsonb_build_object('source', 'seed', 'version', '0002')
from public.pulsex_channels channel
where not exists (
  select 1
  from public.pulsex_messages message
  where message.channel_id = channel.id
    and message.metadata ->> 'source' = 'seed'
    and message.metadata ->> 'version' = '0002'
);

commit;
