-- Careli Hub core seed draft.
-- This file is idempotent and intended for review before any real Supabase run.

insert into hub_modules (
  id,
  name,
  description,
  category,
  status,
  base_path,
  icon_key,
  realtime_enabled,
  "order"
) values
  (
    'guardian',
    'Guardian',
    'Operacao, seguranca e inteligencia operacional do ecossistema.',
    'core',
    'available',
    '/guardian',
    'guardian',
    true,
    10
  ),
  (
    'pulsex',
    'PulseX',
    'Sinais, eventos e pulso realtime das operacoes.',
    'operations',
    'beta',
    '/pulsex',
    'pulsex',
    true,
    20
  ),
  (
    'agenda',
    'Agenda',
    'Calendarios, compromissos e rotinas operacionais.',
    'productivity',
    'planned',
    '/agenda',
    'agenda',
    true,
    30
  ),
  (
    'financeiro',
    'Financeiro',
    'Fluxos financeiros, controle e acompanhamento executivo.',
    'finance',
    'planned',
    '/financeiro',
    'financeiro',
    false,
    40
  ),
  (
    'drive',
    'Drive',
    'Documentos, arquivos e ativos compartilhados.',
    'productivity',
    'planned',
    '/drive',
    'drive',
    false,
    50
  ),
  (
    'contatos',
    'Contatos',
    'Pessoas, organizacoes e relacionamento operacional.',
    'commercial',
    'planned',
    '/contatos',
    'contatos',
    false,
    60
  ),
  (
    'compras',
    'Compras',
    'Solicitacoes, fornecedores e processos de aquisicao.',
    'procurement',
    'planned',
    '/compras',
    'compras',
    false,
    70
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  status = excluded.status,
  base_path = excluded.base_path,
  icon_key = excluded.icon_key,
  realtime_enabled = excluded.realtime_enabled,
  "order" = excluded."order",
  updated_at = now();

insert into hub_permissions (
  id,
  key,
  scope,
  module_id,
  description
) values
  ('hub-view', 'hub:view', 'hub', null, 'Visualizar o Hub Central.'),
  ('hub-manage', 'hub:manage', 'hub', null, 'Gerenciar configuracoes do Hub Central.'),
  ('guardian-view', 'guardian:view', 'module', 'guardian', 'Visualizar Guardian.'),
  ('guardian-manage', 'guardian:manage', 'module', 'guardian', 'Gerenciar Guardian.'),
  ('pulsex-view', 'pulsex:view', 'module', 'pulsex', 'Visualizar PulseX.'),
  ('pulsex-manage', 'pulsex:manage', 'module', 'pulsex', 'Gerenciar PulseX.'),
  ('agenda-view', 'agenda:view', 'module', 'agenda', 'Visualizar Agenda.'),
  ('agenda-manage', 'agenda:manage', 'module', 'agenda', 'Gerenciar Agenda.'),
  ('financeiro-view', 'financeiro:view', 'module', 'financeiro', 'Visualizar Financeiro.'),
  ('financeiro-manage', 'financeiro:manage', 'module', 'financeiro', 'Gerenciar Financeiro.'),
  ('drive-view', 'drive:view', 'module', 'drive', 'Visualizar Drive.'),
  ('drive-manage', 'drive:manage', 'module', 'drive', 'Gerenciar Drive.'),
  ('contatos-view', 'contatos:view', 'module', 'contatos', 'Visualizar Contatos.'),
  ('contatos-manage', 'contatos:manage', 'module', 'contatos', 'Gerenciar Contatos.'),
  ('compras-view', 'compras:view', 'module', 'compras', 'Visualizar Compras.'),
  ('compras-manage', 'compras:manage', 'module', 'compras', 'Gerenciar Compras.')
on conflict (id) do update set
  key = excluded.key,
  scope = excluded.scope,
  module_id = excluded.module_id,
  description = excluded.description,
  updated_at = now();

-- Roles iniciais sao representadas pelo enum hub_user_role:
-- admin, leader, operator, viewer.
-- O schema atual nao possui tabela de roles; a matriz role -> permissions
-- permanece contrato de aplicacao em @repo/shared e @repo/database seeds.ts.
