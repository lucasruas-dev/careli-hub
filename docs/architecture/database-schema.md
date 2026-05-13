# Careli Hub Canonical Database Schema

Este documento define o schema canonico inicial do Careli Hub para Supabase, SDKs e adapters. A fonte TypeScript exportavel vive em `packages/database/src/schema`.

## Tabelas Canonicas

| Tabela | Finalidade |
| --- | --- |
| `hub_users` | Usuarios globais do ecossistema, perfil operacional e role base. |
| `hub_workspaces` | Espacos de trabalho onde usuarios, modulos e dados operacionais se encontram. |
| `hub_modules` | Catalogo persistente dos modulos registrados no Hub. |
| `hub_permissions` | Permissoes canonicas por escopo de Hub, modulo, workspace ou sistema. |
| `hub_user_permissions` | Relacao entre usuarios, permissoes e, quando aplicavel, workspace. |
| `hub_activity_events` | Eventos operacionais e realtime emitidos pelo Hub ou por modulos. |
| `hub_notifications` | Notificacoes direcionadas a usuarios. |
| `hub_presence` | Estado de presenca de usuarios por workspace ou modulo. |
| `hub_files` | Arquivos associados a workspaces e, opcionalmente, modulos. |
| `hub_integrations` | Integracoes externas ou internas por workspace/modulo. |

## Relacionamentos Principais

`hub_users.id` referencia `auth.users.id` no Supabase para manter o perfil operacional alinhado ao usuario autenticado.

`hub_workspaces.owner_user_id` referencia `hub_users.id` para identificar o responsavel conceitual pelo workspace.

`hub_permissions.module_id` referencia `hub_modules.id` quando a permissao pertence a um modulo especifico. Permissoes globais usam escopo `hub` ou `system`.

`hub_user_permissions.user_id` referencia `hub_users.id`, `permission_id` referencia `hub_permissions.id` e `workspace_id` referencia `hub_workspaces.id` quando a permissao tem contexto de workspace.

`hub_activity_events` pode referenciar `hub_users`, `hub_workspaces` e `hub_modules`, permitindo registrar eventos globais ou eventos contextualizados por modulo/workspace.

`hub_notifications.recipient_user_id` referencia `hub_users.id`. A notificacao pode tambem apontar para `hub_workspaces.id` e `hub_modules.id`.

`hub_presence.user_id` referencia `hub_users.id` e pode ser segmentada por `workspace_id` e `module_id`.

`hub_files.workspace_id` referencia `hub_workspaces.id`, `created_by_user_id` referencia `hub_users.id` e `module_id` permite associar arquivos a um modulo.

`hub_integrations.workspace_id` e `module_id` permitem configurar integracoes por contexto operacional.

## Diretrizes

Este schema e contrato, nao migration. As migrations futuras devem preservar estes nomes canonicos ou registrar uma decisao arquitetural quando houver divergencia.

Campos `metadata` e `config` sao extensoes controladas para evitar bloquear integracoes futuras, mas nao devem substituir colunas canonicas quando o dominio estiver estabilizado.

## Constraints

Primary keys:

| Tabela | Chave |
| --- | --- |
| `hub_users` | `id` |
| `hub_workspaces` | `id` |
| `hub_modules` | `id` |
| `hub_permissions` | `id` |
| `hub_user_permissions` | `id` |
| `hub_activity_events` | `id` |
| `hub_notifications` | `id` |
| `hub_presence` | `id` |
| `hub_files` | `id` |
| `hub_integrations` | `id` |

Unique constraints:

| Tabela | Colunas |
| --- | --- |
| `hub_users` | `email` |
| `hub_workspaces` | `slug` |
| `hub_modules` | `base_path` |
| `hub_permissions` | `key` |
| `hub_user_permissions` | `user_id`, `permission_id`, `workspace_id` |
| `hub_files` | `storage_path` |
| `hub_integrations` | `workspace_id`, `provider`, `module_id` |

Foreign keys principais:

| Origem | Referencia |
| --- | --- |
| `hub_workspaces.owner_user_id` | `hub_users.id` |
| `hub_users.id` | `auth.users.id` |
| `hub_permissions.module_id` | `hub_modules.id` |
| `hub_user_permissions.user_id` | `hub_users.id` |
| `hub_user_permissions.permission_id` | `hub_permissions.id` |
| `hub_user_permissions.workspace_id` | `hub_workspaces.id` |
| `hub_notifications.recipient_user_id` | `hub_users.id` |

Enum constraints iniciais:

| Campo | Valores |
| --- | --- |
| `hub_users.role` | `admin`, `leader`, `operator`, `viewer` |
| `status` de registros operacionais | valores declarados nos tipos TypeScript do `@repo/database` |
| severidade de eventos/notificacoes | `neutral`, `info`, `success`, `warning`, `danger` |

## Indices

| Indice | Uso |
| --- | --- |
| `hub_users_status_role_idx` | Filtrar usuarios ativos por role. |
| `hub_modules_status_order_idx` | Listar catalogo de modulos por status e ordem. |
| `hub_permissions_module_scope_idx` | Resolver permissoes por modulo e escopo. |
| `hub_user_permissions_user_workspace_idx` | Checar permissoes ativas por usuario/workspace. |
| `hub_activity_events_context_created_at_idx` | Alimentar feed operacional por workspace/modulo. |
| `hub_notifications_recipient_read_created_at_idx` | Listar notificacoes e contar nao lidas. |
| `hub_presence_context_status_idx` | Montar stack de presenca realtime. |
| `hub_files_context_created_at_idx` | Listar arquivos por contexto. |
| `hub_integrations_context_status_idx` | Acompanhar integracoes por contexto. |

## Estrategia De Soft Delete E Timestamps

`hub_users`, `hub_workspaces` e `hub_integrations` usam status como estrategia de soft delete operacional.

`hub_user_permissions` usa `revoked_at` para preservar historico de concessoes.

Eventos, notificacoes, presenca e arquivos nao recebem soft delete inicial no contrato. A remocao fisica ou arquivamento deve ser decidido por politica de retencao antes das migrations.

Timestamps padrao:

| Tabela | Timestamps |
| --- | --- |
| `hub_users` | `created_at`, `updated_at`, `last_seen_at` |
| `hub_workspaces` | `created_at`, `updated_at` |
| `hub_modules` | `created_at`, `updated_at` |
| `hub_permissions` | `created_at`, `updated_at` |
| `hub_user_permissions` | `created_at`, `revoked_at` |
| `hub_activity_events` | `created_at` |
| `hub_notifications` | `created_at`, `read_at` |
| `hub_presence` | `last_seen_at` |
| `hub_files` | `created_at`, `updated_at` |
| `hub_integrations` | `created_at`, `updated_at` |

## Workspace E Module Scoping

Tabelas com `workspace_id` devem ser preparadas para isolamento por workspace nas futuras policies do Supabase.

Tabelas com `module_id` devem permitir consultas por modulo e composicao do Hub sem acoplar os modulos reais ao schema central.

`hub_permissions` pode ter `module_id` vazio para permissoes globais como `hub:view` e `hub:manage`.

## Seeds Conceituais

Os seeds exportados em `packages/database/src/schema/seeds.ts` sao derivados do `@repo/shared`:

| Seed | Origem |
| --- | --- |
| `hubModuleSeedDrafts` | `hubModules` do registry compartilhado. |
| `hubPermissionSeedDrafts` | Permissoes presentes na matriz de roles. |
| `hubRoleSeedDrafts` | Roles iniciais `admin`, `leader`, `operator`, `viewer`. |

Os seeds de `hub_workspaces` devem criar o workspace inicial `careli`.

Os seeds de `hub_modules` devem popular Guardian, PulseX, Agenda, Financeiro, Drive, Contatos e Compras com `basePath`, `status`, `category`, `iconKey`, `realtimeEnabled` e `order`.

Os seeds de `hub_permissions` devem preservar as chaves canonicas como `guardian:view`, `guardian:manage`, `hub:view` e `hub:manage`.

Roles ainda nao possuem tabela propria no schema canonico. Elas sao contrato de aplicacao e servem como referencia para gerar permissoes de usuario ou policies futuras.

## Observacoes Para Migrations Supabase

As migrations futuras devem converter estes contratos em DDL revisado, incluindo checks, indexes e foreign keys.

Antes de executar migrations reais, validar nomes snake_case, estrategia de `uuid`, defaults de timestamps e politicas RLS por workspace.

Seeds devem ser idempotentes, preferencialmente via upsert por chaves naturais (`id`, `key`, `base_path` ou `slug`).

## SQL Supabase

Os arquivos SQL versionados ficam no pacote `@repo/database`:

| Arquivo | Papel |
| --- | --- |
| `packages/database/migrations/0001_create_hub_core_schema.sql` | Setup inicial do schema Supabase/Postgres com extensao `pgcrypto`, enums, tabelas, constraints, indexes, defaults, comentarios, auth sync e preparacao realtime. |
| `packages/database/seeds/0001_hub_core_seed.sql` | Seed idempotente para workspace inicial, modulos, permissoes e evento operacional inicial. |

`packages/database/migrations/0001_create_hub_core_schema.sql` agora e o setup SQL pronto para execucao manual em Supabase. Ele cria a relacao `hub_users.id -> auth.users.id`, funcoes de sync de perfil, triggers de `updated_at`, indices e preparacao para realtime futuro.

`packages/database/seeds/0001_hub_core_seed.sql` deve ser executado depois do schema. Ele cria o workspace inicial, os modulos, as permissoes e um evento operacional inicial do PulseX.

RLS ainda nao e habilitada nesse primeiro setup. As policies devem entrar em migration posterior, depois de validar o acesso real do Hub, service/server reads, workspace scoping e estrategia de permissoes.
