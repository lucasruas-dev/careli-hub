-- Apolo: ACESSO DO INCORPORADOR (o loteador, dono do empreendimento, cliente da Careli).
--
-- Regra do Lucas (10/08/2026): "a ideia e vincular usuarios de sistema a um incorporador e ali
-- todos terem acesso somente aos dados dos empreendimentos que aquele incorporador tem com a
-- gente". O vinculo e' USUARIO -> INCORPORADOR -> EMPREENDIMENTOS, nessa ordem: varios usuarios
-- cabem no mesmo incorporador, e o que eles enxergam e' a lista de empreendimentos DELE.
--
-- POR QUE O INCORPORADOR VIVE AQUI E NAO NO C2X. O legado tem `enterprises.incorporador_id`, e
-- seria tentador usar como chave. Medido em 10/08 e nao serve: a holding do piloto esta em TRES
-- linhas de `users` (4199, 4734, 4735), todas com o mesmo CNPJ 43.554.123/0001-87, porque a
-- divisao do Vale do Ouro em 02/08 criou um cadastro por carteira para separar recebimento.
-- Nenhum id sozinho entrega "Garden + Vale do Ouro", e dos 25 incorporadores do C2X so' 3 tem o
-- campo `name` preenchido. Entao o vinculo e' NOSSO e explicito; o legado continua sendo so' a
-- fonte dos numeros.
--
-- POR QUE NAO E' hub_users. O incorporador nao vira funcionario: o enum `hub_user_role` tem 4
-- valores fechados e mexer nele alcanca o hub inteiro, e a policy de `hub_users` e'
-- `for select to authenticated using (true)` — um externo autenticado no mesmo projeto Supabase
-- leria a tabela de funcionarios pelo PostgREST. Conta separada, no molde ja' rodando do
-- operador do Prometeu (0070) e do corretor do CAD.
--
-- ⚠️ Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

-- ── O INCORPORADOR ───────────────────────────────────────────────────────────
create table if not exists public.apolo_incorporadores (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  -- Vai na URL da porta de entrada (/incorporador/<slug>) e e' o que decide qual MARCA a tela
  -- de acesso veste. Minusculo, sem acento, sem espaco.
  slug text not null,
  -- Nome de exibicao, que e' como o cliente se reconhece e NAO necessariamente a razao social:
  -- o piloto se chama "Cecilio Rocha" no mercado e "Lino e Cecilio Participacoes" no contrato.
  nome text not null,
  -- Ponte opcional para o grafo do Apolo (apolo_entities). Fica nulo enquanto o incorporador nao
  -- tiver ficha; o acesso nao depende disso para funcionar.
  entity_id uuid,
  -- Caminho da logo no bucket, NAO a URL: signed URL vence em 1h e a tela do cliente fica aberta
  -- a manha toda. Mesmo padrao de apolo_acoes.imagem_path (0078).
  logo_path text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists apolo_incorporadores_slug_uk
  on public.apolo_incorporadores (workspace_id, lower(slug));

create index if not exists apolo_incorporadores_entity_idx
  on public.apolo_incorporadores (entity_id)
  where entity_id is not null;

-- ── O QUE ELE ENXERGA ────────────────────────────────────────────────────────
-- Uma linha por empreendimento liberado. `enterprise_id` e' o id do C2X (texto, mesmo tipo de
-- apolo_enterprise_settings). O MESMO empreendimento pode estar em dois incorporadores: no Vale
-- do Ouro, VOC e' do Cecilio e VOL e' do Lino, e ambos sao a mesma familia comercial.
create table if not exists public.apolo_incorporador_empreendimentos (
  incorporador_id uuid not null
    references public.apolo_incorporadores (id) on delete cascade,
  enterprise_id text not null,
  -- "Carteira (quando tiver)", palavras do Lucas: a aba de recebimento so' aparece para o
  -- empreendimento cuja carteira a Careli administra. Nao da' para derivar do C2X.
  carteira_administrada boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (incorporador_id, enterprise_id)
);

create index if not exists apolo_incorporador_empr_enterprise_idx
  on public.apolo_incorporador_empreendimentos (enterprise_id);

-- ── QUEM LOGA ────────────────────────────────────────────────────────────────
-- Conta propria, com senha, presa a UM incorporador. Login por e-mail (e' gente de empresa, ao
-- contrario do operador do evento, que usa nome.sobrenome).
create table if not exists public.apolo_incorporador_usuarios (
  id uuid primary key default gen_random_uuid(),
  incorporador_id uuid not null
    references public.apolo_incorporadores (id) on delete cascade,
  email text not null,
  nome text not null,
  -- scrypt 'saltHex:hashHex', igual prometeu_operadores. NUNCA a senha crua.
  senha_hash text not null,
  ativo boolean not null default true,
  ultimo_login_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- E-mail unico global e sem depender de caixa: a mesma pessoa nao loga em dois incorporadores.
create unique index if not exists apolo_incorporador_usuarios_email_uk
  on public.apolo_incorporador_usuarios (lower(email));

create index if not exists apolo_incorporador_usuarios_inc_idx
  on public.apolo_incorporador_usuarios (incorporador_id, ativo);

-- ── RLS: DENY-ALL, SO SERVICE ROLE ───────────────────────────────────────────
-- ⚠️ De proposito SEM policy de leitura, diferente das outras apolo_* (que liberam select para
-- `authenticated`). Duas razoes: `senha_hash` nunca pode sair pelo PostgREST, e a lista de
-- empreendimentos por incorporador E' a propria regra de permissao — quem pode ler pode estudar
-- o alcance de cada cliente. RLS ligado sem policy = deny-all para anon e authenticated; as
-- rotas server-side usam service_role, que passa por cima. Mesmo racional da 0075.
alter table public.apolo_incorporadores enable row level security;
alter table public.apolo_incorporador_empreendimentos enable row level security;
alter table public.apolo_incorporador_usuarios enable row level security;

comment on table public.apolo_incorporadores is
  'Incorporador (loteador) com acesso proprio ao Panteon. Vinculo usuario -> incorporador -> empreendimentos, decidido pelo Lucas em 10/08/2026.';
comment on table public.apolo_incorporador_empreendimentos is
  'Os empreendimentos que cada incorporador enxerga. Fonte da permissao; NAO deriva de enterprises.incorporador_id do C2X, que esta duplicado por CNPJ.';
comment on table public.apolo_incorporador_usuarios is
  'Contas de login do incorporador. Nao sao hub_users. Senha em scrypt; sessao por token assinado fora do banco.';
