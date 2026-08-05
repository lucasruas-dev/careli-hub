-- AÇÕES DE CONTATO EM MASSA (campanhas). A primeira é o "Convite Vale do Ouro": o time liga para
-- os credenciados; quando FALA (telefônico) preenche perfil + unidades na hora; quando NÃO fala,
-- marca WhatsApp e dispara um template, e a resposta (unidades de interesse) volta pelos botões e
-- a Cacá grava aqui. ⚠️ Ação NÃO é atendimento: a resposta é gravada nesta tabela e NÃO abre ticket.
--
-- Duas tabelas: a CAMPANHA (apolo_acoes) e um ALVO por credenciado (apolo_acao_alvos). Assim cada
-- ação futura é uma linha nova em apolo_acoes com seus alvos, sem inventar tabela toda vez.

create table if not exists public.apolo_acoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  empreendimento text,
  -- o template da Meta que a ação dispara (nome aprovado) + o número que dispara (phone_number_id)
  template_meta_name text,
  phone_number_id text,
  -- acesso da TELA PÚBLICA (freela sem conta do hub): slug do link + hash da senha (scrypt)
  publico_slug text unique,
  publico_senha_hash text,
  status text not null default 'ativa', -- ativa | encerrada
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.apolo_acao_alvos (
  id uuid primary key default gen_random_uuid(),
  acao_id uuid not null references public.apolo_acoes(id) on delete cascade,
  entity_id uuid, -- o credenciado (apolo_entities)
  nome text, -- snapshot no momento do carregamento
  telefone text, -- snapshot
  cpf text, -- snapshot (o operador confere na ligação)
  imobiliaria text, -- snapshot
  corretor text, -- snapshot
  -- CANAL do contato: 'telefonico' (falou) | 'whatsapp' (não falou por telefone, disparou o template)
  contato_canal text,
  contato_em timestamptz,
  contato_por text,
  -- PERFIL e UNIDADES: preenchidos pelo operador (telefônico) OU pela resposta do cliente (whatsapp).
  perfil text, -- 'moradia' | 'investimento'
  unidades_interesse text, -- '1' | '2_3' | 'acima_3'
  unidades_origem text, -- 'operador' | 'cliente' (de onde veio a resposta de unidades)
  -- DISPARO do template (caso whatsapp)
  disparo_em timestamptz,
  disparo_status text, -- 'enviado' | 'falhou'
  disparo_wa_message_id text, -- id da Meta, para casar a resposta do botão no inbound
  disparo_erro text,
  resposta_em timestamptz,
  resposta_texto text, -- texto cru do botão que o cliente clicou
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (acao_id, entity_id)
);

create index if not exists idx_apolo_acao_alvos_acao on public.apolo_acao_alvos (acao_id);
create index if not exists idx_apolo_acao_alvos_wamid
  on public.apolo_acao_alvos (disparo_wa_message_id)
  where disparo_wa_message_id is not null;

-- RLS deny-all + service_role: o acesso é SEMPRE pelo servidor (rotas do hub e rotas públicas com
-- token proprio). Sem policy, a anon key (que vai no bundle) nao le nem escreve. Licao da 0075.
alter table public.apolo_acoes enable row level security;
alter table public.apolo_acao_alvos enable row level security;
