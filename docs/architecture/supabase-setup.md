# Careli Hub Supabase Setup

Este documento define a preparacao manual do Supabase para o Careli Hub e PulseX. Nada deve ser executado automaticamente pelo app ou pelo deploy atual.

## Arquivos SQL

| Ordem | Arquivo | Papel |
| --- | --- | --- |
| 1 | `packages/database/migrations/0001_create_hub_core_schema.sql` | Cria extensao, enums, tabelas, constraints, indices, triggers, sync com `auth.users` e preparacao realtime. |
| 2 | `packages/database/seeds/0001_hub_core_seed.sql` | Popula workspace inicial, catalogo de modulos, permissoes canonicas e evento inicial do PulseX. |

## Ordem Correta De Execucao

1. Criar ou selecionar o projeto Supabase de producao/staging.
2. Confirmar que Supabase Auth esta habilitado no projeto.
3. Abrir o SQL Editor do Supabase.
4. Executar `packages/database/migrations/0001_create_hub_core_schema.sql`.
5. Confirmar que as tabelas `hub_*` foram criadas no schema `public`.
6. Executar `packages/database/seeds/0001_hub_core_seed.sql`.
7. Criar o primeiro usuario pelo Supabase Auth.
8. Confirmar que o trigger criou o perfil correspondente em `public.hub_users`.
9. Ajustar `app_metadata.role` do primeiro usuario para `admin`, se necessario.
10. Configurar as variaveis de ambiente do Hub.
11. Testar login e leitura do catalogo em ambiente controlado.

## Setup Inicial No Supabase

O schema usa `public.hub_users.id` como o mesmo UUID de `auth.users.id`. Isso permite que as futuras policies RLS usem `auth.uid()` sem tabela intermediaria.

Ao criar ou atualizar um usuario em `auth.users`, o trigger `sync_hub_user_from_auth_*` sincroniza:

- `email`;
- `display_name`, a partir de `full_name`, `fullName`, `name` ou prefixo do email;
- `avatar_url`;
- `role`, a partir de `app_metadata.role` ou `user_metadata.role`.

Se um usuario Auth nao tiver email, o sync gera um email tecnico local no formato `<auth-user-id>@auth.local` para preservar a constraint operacional de perfil.

Roles validas:

- `admin`;
- `leader`;
- `operator`;
- `viewer`.

Quando a role nao estiver definida ou for invalida, o perfil recebe `operator`.

## Variaveis Necessarias

No Hub, configurar:

| Variavel | Escopo | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | URL publica do projeto Supabase usada pelo auth adapter. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Chave anon publica usada pelo auth adapter. |
| `NEXT_PUBLIC_SUPABASE_WORKSPACE_ID` | Browser/server | Workspace padrao usado pelo adapter de auth quando o usuario nao tiver metadata de workspace. Valor inicial recomendado: `careli`. |

Para rotinas server-side futuras, adicionar somente em ambiente seguro:

| Variavel | Escopo | Uso |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Operacoes administrativas, backfills, seeds protegidos e jobs internos. Nunca expor no browser. |
| `SUPABASE_PROJECT_REF` | Server/CI | Referencia do projeto para CLI, deploys e observabilidade. |

## Compatibilidade Com Supabase Auth

O setup pressupoe que usuarios reais sejam criados pelo Supabase Auth, nao via insert direto em `hub_users`.

`hub_users` e perfil operacional. `auth.users` continua sendo a fonte de autenticacao, credenciais e sessoes.

Para promover o primeiro administrador:

1. Criar usuario pelo painel de Auth ou fluxo de cadastro controlado.
2. Atualizar `app_metadata` do usuario com `"role": "admin"`.
3. Salvar o usuario; o trigger de update sincroniza `public.hub_users.role`.

## Compatibilidade Com RLS Futura

RLS nao e habilitada no setup inicial para nao quebrar leituras do Hub durante a primeira conexao real.

As tabelas ja estao preparadas para policies futuras:

- `hub_users.id` referencia `auth.users.id`;
- tabelas operacionais usam `workspace_id` quando precisam de isolamento por workspace;
- tabelas de modulo usam `module_id` quando precisam de isolamento por modulo;
- permissoes ficam em `hub_permissions` e `hub_user_permissions`;
- `revoked_at` preserva historico de permissoes removidas.

A migration de RLS deve ser criada depois de validar:

- quais consultas rodam no browser com anon key;
- quais consultas rodam server-side;
- quais modulos precisam de isolamento por workspace;
- como roles do app se convertem em policies SQL;
- se `service_role` sera usado em jobs ou APIs internas.

## Compatibilidade Com Realtime Futuro

O setup aplica `replica identity full` nas tabelas mais provaveis de realtime:

- `hub_activity_events`;
- `hub_notifications`;
- `hub_presence`;
- `hub_modules`.

Isso prepara payloads mais completos para updates/deletes futuros, mas nao habilita publicacao realtime automaticamente.

Quando o realtime real for ativado, revisar e executar uma migration separada com a estrategia escolhida para `supabase_realtime`, por exemplo adicionando apenas as tabelas necessarias a publicacao.

## Observacoes Importantes

- Executar primeiro em staging ou em um projeto Supabase novo.
- Nao inserir usuarios diretamente em `hub_users`.
- Nao expor `SUPABASE_SERVICE_ROLE_KEY` em `NEXT_PUBLIC_*`.
- Seeds sao idempotentes e podem ser reexecutados, mas devem continuar versionados.
- Guardian permanece apenas catalogado como modulo `locked`; este setup nao altera implementacao do Guardian.
- PulseX fica catalogado como modulo `active` e preparado para sinais realtime futuros.
- RLS e realtime real devem entrar em migrations posteriores, com testes de permissao e fluxo.

## Validacao Manual

Depois de executar schema e seed, validar no SQL Editor:

```sql
select id, name, status, realtime_enabled
from public.hub_modules
order by "order";
```

```sql
select key, scope, module_id
from public.hub_permissions
order by key;
```

```sql
select slug, name, status
from public.hub_workspaces;
```

Apos criar o primeiro usuario no Auth:

```sql
select id, email, display_name, role, status
from public.hub_users;
```

## Proximos Passos Apos Executar

1. Criar primeiro usuario real no Supabase Auth.
2. Promover o usuario inicial para `admin` via `app_metadata.role`.
3. Configurar as variaveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_SUPABASE_WORKSPACE_ID`.
4. Ligar o Hub ao Supabase em ambiente controlado.
5. Validar login, sessao e sincronizacao de perfil.
6. Validar leitura de modulos, permissoes e atividade inicial.
7. Criar migration separada para RLS.
8. Criar migration separada para realtime/publications.
