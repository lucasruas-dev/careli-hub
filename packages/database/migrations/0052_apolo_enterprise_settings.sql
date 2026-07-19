-- Apolo: settings do EMPREENDIMENTO (o empreendimento e do C2X/enterprises, nao e uma
-- apolo_entity -- por isso tabela propria, chaveada pelo id do C2X).
--
-- Direcao do Lucas 18/jul: marcar quais empreendimentos ainda estao "na ativa", isto e,
-- recebendo CAD e credenciamento de imobiliaria. O portal de credenciamento so oferece os
-- ATIVOS. E decisao COMERCIAL manual: nao da pra derivar do C2X (ter unidade disponivel nao
-- significa que a Careli quer novos credenciamentos naquele empreendimento).
--
-- O flag mora DENTRO do cadastro do empreendimento (aba Cadastro), ao lado da logo.
-- A logo continua no storage por convencao de path (enterprise-logos/{id}); aqui fica so o
-- que precisa de consulta/filtro.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

create table if not exists public.apolo_enterprise_settings (
  enterprise_id text primary key,
  workspace_id text not null default 'careli',
  -- Sigla do C2X (ex.: VAL). Informativo, ajuda a auditar sem cruzar com o legado.
  code text,
  -- Recebendo CAD / credenciamento de imobiliaria?
  credenciamento_ativo boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apolo_enterprise_settings_ativo_idx
  on public.apolo_enterprise_settings (credenciamento_ativo);

alter table public.apolo_enterprise_settings enable row level security;

-- Leitura pra usuarios autenticados do Hub (mesmo padrao das apolo_*); escrita so via service
-- role (rotas server-side), que bypassa RLS.
drop policy if exists apolo_enterprise_settings_read on public.apolo_enterprise_settings;
create policy apolo_enterprise_settings_read
  on public.apolo_enterprise_settings for select to authenticated using (true);
