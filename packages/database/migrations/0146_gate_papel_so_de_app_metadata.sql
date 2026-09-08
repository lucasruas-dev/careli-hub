-- 0146 — O PAPEL DO HUB PARA DE VIR DO METADATA QUE O PRÓPRIO USUÁRIO ESCREVE.
--
-- ⚠️ QUALQUER PESSOA PODIA NASCER `admin` NO PANTEON, e isso foi MEDIDO em 08/09/2026, não
-- deduzido: `get_hub_role_from_auth_metadata('{}', '{"role":"admin"}')` devolvia `admin`. A cadeia
-- inteira:
--   1. GET /auth/v1/settings do projeto respondia `disable_signup: false` com `email: true`;
--   2. a chave do bundle é `sb_publishable_…`, pública por definição (vai no navegador);
--   3. `signUp({ options: { data: { role: 'admin' } } })` grava isso em `raw_user_meta_data`;
--   4. o trigger `sync_hub_user_from_auth_insert` criava a linha em `hub_users` com esse papel,
--      e `status` caía no DEFAULT da coluna, que é `active`;
--   5. `authorizeApoloRead` e os 8 gates irmãos só olham papel + status.
-- Alcance medido: 160 rotas de /api e 82 das 174 policies de RLS dependem desse gate.
--
-- ⚠️ NINGUÉM MUDA DE PAPEL COM ESTA MIGRATION. Medido antes de aplicar: os 11 usuários de
-- `auth.users` têm `app_metadata.role` preenchido (é o que `admin.createUser` grava em
-- app/api/setup/users/route.ts:443), e a divergência entre `hub_users.role` e o que a função nova
-- devolve é ZERO em 11 de 11. A fotografia de hoje — admin/active=2, leader/active=5,
-- leader/disabled=2, operator/disabled=2 — tem que sair idêntica do outro lado.
--
-- ⚠️ CREATE OR REPLACE, NUNCA DROP. `sync_hub_user_from_auth()` tem ACL NÃO-DEFAULT (migration
-- 0043 revogou EXECUTE de PUBLIC e concedeu a `supabase_auth_admin` e `service_role`). DROP perde
-- essa ACL, e com CASCADE derruba junto os dois triggers em `auth.users`. CREATE OR REPLACE
-- preserva owner, ACL e oid.
--
-- ⚠️ O HEADER REPETE AS PROPRIEDADES DE PROPÓSITO. CREATE OR REPLACE não herda nada do header: o
-- que não estiver escrito volta ao default. Sem `security definer`, o trigger passaria a rodar
-- como `supabase_auth_admin`, e foi medido que esse role tem INSERT=false e UPDATE=false em
-- `public.hub_users` — ou seja, todo INSERT em `auth.users` quebraria.

begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O papel sai só de `app_metadata`, que apenas o service_role escreve.
--
-- ⚠️ OS DOIS ARGUMENTOS FICAM, mesmo com `user_metadata` agora sem uso. Mudar a lista de
-- argumentos não substitui a função: cria uma SOBRECARGA, a versão (jsonb, jsonb) antiga continua
-- existindo e continua sendo a que o trigger resolve. O deploy "passaria" com o bug vivo.
--
-- ⚠️ O CAST VAI QUALIFICADO (`public.hub_user_role`) porque esta função não tem `search_path`
-- próprio: hoje ela só funciona herdando o do chamador.
create or replace function public.get_hub_role_from_auth_metadata(
  app_metadata jsonb,
  user_metadata jsonb
)
returns public.hub_user_role
language plpgsql
immutable
as $function$
declare
  metadata_role text;
begin
  metadata_role := app_metadata ->> 'role';

  if metadata_role in ('admin', 'leader', 'operator', 'viewer') then
    return metadata_role::public.hub_user_role;
  end if;

  -- O piso passa a ser `viewer`, era `operator`. `metadata_role` nulo faz o IN devolver NULL,
  -- que não é `true`, então cai aqui.
  return 'viewer'::public.hub_user_role;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O usuário nasce FECHADO. Quem cria pela tela ativa no mesmo request
-- (app/api/setup/users/route.ts, tanto o caminho do service_role quanto o fallback).
create or replace function public.sync_hub_user_from_auth()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  insert into public.hub_users (
    id,
    email,
    display_name,
    avatar_url,
    role,
    status,
    last_seen_at
  ) values (
    new.id,
    lower(coalesce(nullif(new.email, ''), new.id::text || '@auth.local')),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'fullName', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Careli User'
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    public.get_hub_role_from_auth_metadata(new.raw_app_meta_data, new.raw_user_meta_data),
    'disabled'::public.hub_record_status,
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    role = excluded.role,
    updated_at = now();
    -- ⚠️ `status` FICA FORA DO DO UPDATE DE PROPÓSITO. O trigger de UPDATE dispara em
    -- `AFTER UPDATE OF email, raw_app_meta_data, raw_user_meta_data`: incluir `status` aqui
    -- desativaria um usuário ativo a cada troca de foto ou edição de perfil.

  return new;
end;
$function$;

commit;
