# Hub Users Access Diagnostics

Este roteiro diagnostica quando o Supabase Auth autentica o usuario, mas o Hub Careli nao consegue carregar o perfil operacional em `public.hub_users`.

## Query Do App

O adapter do Hub busca o perfil somente por UUID do usuario autenticado:

```sql
select id, email, display_name, avatar_url, role, status
from public.hub_users
where id = auth.uid();
```

No codigo, o filtro equivalente e `id = session.user.id`. A busca nao deve usar email.

## Verificar O Perfil

Execute no Supabase SQL Editor substituindo o UUID pelo `auth.user.id` exibido no console de desenvolvimento:

```sql
select id, email, display_name, role, status
from public.hub_users
where id = '00000000-0000-0000-0000-000000000000';
```

O `id` precisa ser exatamente igual ao UUID em `auth.users.id`, e `status` deve ser `active`.

## Verificar RLS

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'hub_users';
```

Se `rls_enabled` estiver `true` e nao houver policy de leitura propria, o client autenticado pode receber resultado vazio mesmo com o perfil existente.

## Policy Minima Segura

Use esta policy apenas para permitir que cada usuario autenticado leia o proprio perfil operacional:

```sql
alter table public.hub_users enable row level security;

drop policy if exists "Users can read own hub profile"
on public.hub_users;

create policy "Users can read own hub profile"
on public.hub_users
for select
to authenticated
using (id = auth.uid());
```

Esta policy nao libera listagem ampla de usuarios e nao permite leitura de perfis de terceiros.

## Checklist

- `auth.users.id` e `public.hub_users.id` sao iguais.
- `public.hub_users.status` esta como `active`.
- `public.hub_users.role` usa uma role valida: `admin`, `leader`, `operator` ou `viewer`.
- Se RLS estiver habilitado, a policy `Users can read own hub profile` existe.
- O console local mostra `hub user profile query`, `hub user profile loaded`, `hub user profile missing` ou `auth error`.
