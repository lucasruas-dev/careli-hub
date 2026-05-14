import type { CanonicalDatabaseTableName } from "./core";

export type DatabaseConstraintKind =
  | "primary_key"
  | "foreign_key"
  | "unique"
  | "enum"
  | "check";

export type DatabaseConstraintDraft = {
  columns: readonly string[];
  description: string;
  kind: DatabaseConstraintKind;
  name: string;
  references?: {
    columns: readonly string[];
    table: CanonicalDatabaseTableName;
  };
  table: CanonicalDatabaseTableName;
  values?: readonly string[];
};

export type DatabaseIndexDraft = {
  columns: readonly string[];
  description: string;
  name: string;
  table: CanonicalDatabaseTableName;
  unique?: boolean;
  where?: string;
};

export type DatabaseTablePolicyDraft = {
  moduleScoped: boolean;
  softDelete: "status" | "revoked_at" | "none";
  table: CanonicalDatabaseTableName;
  timestamps: readonly string[];
  workspaceScoped: boolean;
};

export const databaseConstraintDrafts = [
  {
    columns: ["id"],
    description: "Identificador canonico de usuario.",
    kind: "primary_key",
    name: "hub_users_pkey",
    table: "hub_users",
  },
  {
    columns: ["email"],
    description: "Email unico para autenticacao e identidade operacional.",
    kind: "unique",
    name: "hub_users_email_key",
    table: "hub_users",
  },
  {
    columns: ["role"],
    description: "Roles iniciais suportadas pelo Hub.",
    kind: "enum",
    name: "hub_users_role_check",
    table: "hub_users",
    values: ["admin", "leader", "operator", "viewer"],
  },
  {
    columns: ["id"],
    description: "Identificador canonico de workspace.",
    kind: "primary_key",
    name: "hub_workspaces_pkey",
    table: "hub_workspaces",
  },
  {
    columns: ["slug"],
    description: "Slug unico para enderecamento futuro do workspace.",
    kind: "unique",
    name: "hub_workspaces_slug_key",
    table: "hub_workspaces",
  },
  {
    columns: ["owner_user_id"],
    description: "Responsavel conceitual pelo workspace.",
    kind: "foreign_key",
    name: "hub_workspaces_owner_user_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_users",
    },
    table: "hub_workspaces",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de modulo.",
    kind: "primary_key",
    name: "hub_modules_pkey",
    table: "hub_modules",
  },
  {
    columns: ["base_path"],
    description: "Cada modulo possui uma rota base unica no Hub.",
    kind: "unique",
    name: "hub_modules_base_path_key",
    table: "hub_modules",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de permissao.",
    kind: "primary_key",
    name: "hub_permissions_pkey",
    table: "hub_permissions",
  },
  {
    columns: ["key"],
    description: "Chave de permissao unica, alinhada ao @repo/shared.",
    kind: "unique",
    name: "hub_permissions_key_key",
    table: "hub_permissions",
  },
  {
    columns: ["module_id"],
    description: "Permissoes de modulo apontam para o catalogo de modulos.",
    kind: "foreign_key",
    name: "hub_permissions_module_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_modules",
    },
    table: "hub_permissions",
  },
  {
    columns: ["id"],
    description: "Identificador canonico da concessao de permissao.",
    kind: "primary_key",
    name: "hub_user_permissions_pkey",
    table: "hub_user_permissions",
  },
  {
    columns: ["user_id", "permission_id", "workspace_id"],
    description: "Evita concessoes duplicadas no mesmo escopo.",
    kind: "unique",
    name: "hub_user_permissions_scope_key",
    table: "hub_user_permissions",
  },
  {
    columns: ["user_id"],
    description: "Concessao pertence a um usuario.",
    kind: "foreign_key",
    name: "hub_user_permissions_user_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_users",
    },
    table: "hub_user_permissions",
  },
  {
    columns: ["permission_id"],
    description: "Concessao aponta para uma permissao canonica.",
    kind: "foreign_key",
    name: "hub_user_permissions_permission_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_permissions",
    },
    table: "hub_user_permissions",
  },
  {
    columns: ["workspace_id"],
    description: "Concessao pode ser limitada a um workspace.",
    kind: "foreign_key",
    name: "hub_user_permissions_workspace_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_workspaces",
    },
    table: "hub_user_permissions",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de evento operacional.",
    kind: "primary_key",
    name: "hub_activity_events_pkey",
    table: "hub_activity_events",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de notificacao.",
    kind: "primary_key",
    name: "hub_notifications_pkey",
    table: "hub_notifications",
  },
  {
    columns: ["recipient_user_id"],
    description: "Notificacao pertence ao usuario destinatario.",
    kind: "foreign_key",
    name: "hub_notifications_recipient_user_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_users",
    },
    table: "hub_notifications",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de presenca.",
    kind: "primary_key",
    name: "hub_presence_pkey",
    table: "hub_presence",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de evento de presenca.",
    kind: "primary_key",
    name: "hub_presence_events_pkey",
    table: "hub_presence_events",
  },
  {
    columns: ["user_id"],
    description: "Evento de presenca pertence a um usuario do Hub.",
    kind: "foreign_key",
    name: "hub_presence_events_user_id_fkey",
    references: {
      columns: ["id"],
      table: "hub_users",
    },
    table: "hub_presence_events",
  },
  {
    columns: ["user_id", "workspace_id", "module_id"],
    description: "Uma presenca ativa por usuario em cada contexto operacional.",
    kind: "unique",
    name: "hub_presence_context_key",
    table: "hub_presence",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de arquivo.",
    kind: "primary_key",
    name: "hub_files_pkey",
    table: "hub_files",
  },
  {
    columns: ["storage_path"],
    description: "Caminho de storage unico para evitar colisao de arquivos.",
    kind: "unique",
    name: "hub_files_storage_path_key",
    table: "hub_files",
  },
  {
    columns: ["id"],
    description: "Identificador canonico de integracao.",
    kind: "primary_key",
    name: "hub_integrations_pkey",
    table: "hub_integrations",
  },
  {
    columns: ["workspace_id", "provider", "module_id"],
    description: "Evita integracoes duplicadas por provider no mesmo contexto.",
    kind: "unique",
    name: "hub_integrations_context_provider_key",
    table: "hub_integrations",
  },
] as const satisfies readonly DatabaseConstraintDraft[];

export const databaseIndexDrafts = [
  {
    columns: ["status", "role"],
    description: "Filtragem operacional de usuarios ativos por role.",
    name: "hub_users_status_role_idx",
    table: "hub_users",
  },
  {
    columns: ["status", "order"],
    description: "Listagem ordenada do catalogo de modulos.",
    name: "hub_modules_status_order_idx",
    table: "hub_modules",
  },
  {
    columns: ["module_id", "scope"],
    description: "Resolucao rapida de permissoes por modulo e escopo.",
    name: "hub_permissions_module_scope_idx",
    table: "hub_permissions",
  },
  {
    columns: ["user_id", "workspace_id"],
    description: "Checagem de permissoes do usuario no workspace.",
    name: "hub_user_permissions_user_workspace_idx",
    table: "hub_user_permissions",
    where: "revoked_at is null",
  },
  {
    columns: ["workspace_id", "module_id", "created_at"],
    description: "Feed operacional por workspace/modulo.",
    name: "hub_activity_events_context_created_at_idx",
    table: "hub_activity_events",
  },
  {
    columns: ["recipient_user_id", "read_at", "created_at"],
    description: "Painel de notificacoes e contagem de nao lidas.",
    name: "hub_notifications_recipient_read_created_at_idx",
    table: "hub_notifications",
  },
  {
    columns: ["workspace_id", "module_id", "status"],
    description: "Stack de presenca por contexto realtime.",
    name: "hub_presence_context_status_idx",
    table: "hub_presence",
  },
  {
    columns: ["user_id", "started_at"],
    description: "Linha do tempo de presenca por usuario.",
    name: "hub_presence_events_user_started_at_idx",
    table: "hub_presence_events",
  },
  {
    columns: ["workspace_id", "module_id", "started_at"],
    description: "Auditoria de presenca por contexto operacional.",
    name: "hub_presence_events_context_started_at_idx",
    table: "hub_presence_events",
  },
  {
    columns: ["workspace_id", "module_id", "created_at"],
    description: "Listagem de arquivos por contexto.",
    name: "hub_files_context_created_at_idx",
    table: "hub_files",
  },
  {
    columns: ["workspace_id", "module_id", "status"],
    description: "Status de integracoes por contexto operacional.",
    name: "hub_integrations_context_status_idx",
    table: "hub_integrations",
  },
] as const satisfies readonly DatabaseIndexDraft[];

export const databaseTablePolicyDrafts = [
  {
    moduleScoped: false,
    softDelete: "status",
    table: "hub_users",
    timestamps: ["created_at", "updated_at", "last_seen_at"],
    workspaceScoped: false,
  },
  {
    moduleScoped: false,
    softDelete: "status",
    table: "hub_workspaces",
    timestamps: ["created_at", "updated_at"],
    workspaceScoped: false,
  },
  {
    moduleScoped: false,
    softDelete: "none",
    table: "hub_modules",
    timestamps: ["created_at", "updated_at"],
    workspaceScoped: false,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_permissions",
    timestamps: ["created_at", "updated_at"],
    workspaceScoped: false,
  },
  {
    moduleScoped: false,
    softDelete: "revoked_at",
    table: "hub_user_permissions",
    timestamps: ["created_at", "revoked_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_activity_events",
    timestamps: ["created_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_notifications",
    timestamps: ["created_at", "read_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_presence",
    timestamps: ["last_seen_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_presence_events",
    timestamps: ["created_at", "started_at", "ended_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "none",
    table: "hub_files",
    timestamps: ["created_at", "updated_at"],
    workspaceScoped: true,
  },
  {
    moduleScoped: true,
    softDelete: "status",
    table: "hub_integrations",
    timestamps: ["created_at", "updated_at"],
    workspaceScoped: true,
  },
] as const satisfies readonly DatabaseTablePolicyDraft[];
