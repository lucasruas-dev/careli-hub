import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  getPermissionsForRole,
  type HubPermission,
  type HubUserRole,
} from "@repo/shared";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type {
  AresApprovalStatus,
  AresAssignableUser,
  AresBankAccount,
  AresBankStatementImport,
  AresBankStatementLine,
  AresCounterpartyKind,
  AresDimension,
  AresDimensionKind,
  AresDimensionStatus,
  AresEntryKind,
  AresFinancialBase,
  AresFinancialBaseStatus,
  AresFinancialEntry,
  AresLifecycleStatus,
  AresPaymentBatch,
  AresPriority,
  AresSnapshot,
  AresSummary,
  CreateAresDimensionInput,
  CreateAresEntryInput,
  CreateAresFinancialBaseInput,
  UpdateAresDimensionInput,
  UpdateAresFinancialBaseInput,
} from "./types";

type HubAccessUserRow = {
  display_name?: string | null;
  email?: string | null;
  id: string;
  role: HubUserRole;
  status: string;
};

type HubUserPermissionRow = {
  permission_id: string;
  revoked_at?: string | null;
  user_id: string;
};

type NumericValue = number | string | null;

type AresFinancialBaseRow = {
  accent_color: string;
  code?: string | null;
  id: string;
  name: string;
  status: AresFinancialBaseStatus;
};

type AresFinancialBaseInsertRow = {
  accent_color: string;
  code: string;
  created_by_user_id: string;
  name: string;
  status: AresFinancialBaseStatus;
  updated_by_user_id: string;
};

type AresFinancialBaseUpdateRow = {
  accent_color?: string;
  name?: string;
  status?: AresFinancialBaseStatus;
  updated_by_user_id: string;
};

type AresFinancialBaseUserRow = {
  financial_base_id: string;
  status: string;
  user_id: string;
};

type AresFinancialBaseUserInsertRow = {
  created_by_user_id: string;
  financial_base_id: string;
  status: string;
  updated_by_user_id: string;
  user_id: string;
};

type AresAssignableUserRow = {
  display_name?: string | null;
  email?: string | null;
  id: string;
  role: HubUserRole;
  status: string;
};

type AresFinancialDimensionRow = {
  code?: string | null;
  dimension_kind: AresDimensionKind;
  financial_base_id: string;
  id: string;
  name: string;
  parent_id?: string | null;
  status: AresDimensionStatus;
};

type AresFinancialDimensionInsertRow = {
  code?: string | null;
  created_by_user_id: string;
  dimension_kind: AresDimensionKind;
  financial_base_id: string;
  name: string;
  parent_id?: string | null;
  status: AresDimensionStatus;
  updated_by_user_id: string;
};

type AresFinancialDimensionUpdateRow = {
  parent_id?: string | null;
  updated_by_user_id: string;
};

type AresBankAccountRow = {
  account_kind: string;
  account_label?: string | null;
  bank_name?: string | null;
  current_balance?: NumericValue;
  financial_base_id?: string | null;
  id: string;
  last_balance_at?: string | null;
  name: string;
  projected_balance?: NumericValue;
  status: string;
};

type AresFinancialEntryRow = {
  amount_gross: NumericValue;
  amount_open: NumericValue;
  amount_paid: NumericValue;
  apolo_entity_id?: string | null;
  approval_status: AresApprovalStatus;
  bank_account_id?: string | null;
  bank_account_label_snapshot?: string | null;
  category_id?: string | null;
  category_name_snapshot?: string | null;
  cost_center_id?: string | null;
  cost_center_name_snapshot?: string | null;
  counterparty_kind?: AresCounterpartyKind | null;
  department_id?: string | null;
  department_name_snapshot?: string | null;
  document_number?: string | null;
  due_date?: string | null;
  entry_kind: AresEntryKind;
  financial_base_id: string;
  financial_base_name_snapshot?: string | null;
  forecast_date?: string | null;
  id: string;
  lifecycle_status: AresLifecycleStatus;
  next_action?: string | null;
  party_name_snapshot?: string | null;
  payment_method?: string | null;
  priority?: AresPriority | null;
  project_id?: string | null;
  project_name_snapshot?: string | null;
  registered_at?: string | null;
  responsible_name_snapshot?: string | null;
  responsible_user_id?: string | null;
  result_center_id?: string | null;
  result_center_name_snapshot?: string | null;
  source_system?: string | null;
  title: string;
  updated_at: string;
};

type AresFinancialEntryInsertRow = {
  amount_gross: number;
  amount_open: number;
  amount_paid: number;
  apolo_entity_id?: string | null;
  approval_status: AresApprovalStatus;
  bank_account_label_snapshot: string;
  category_id?: string | null;
  category_name_snapshot: string;
  cost_center_id?: string | null;
  cost_center_name_snapshot: string;
  counterparty_kind: AresCounterpartyKind;
  created_by_user_id: string;
  department_id?: string | null;
  department_name_snapshot: string;
  document_number: string;
  due_date: string;
  entry_kind: "payable" | "receivable";
  financial_base_id: string;
  financial_base_name_snapshot: string;
  forecast_date: string;
  lifecycle_status: AresLifecycleStatus;
  next_action: string;
  notes?: string | null;
  party_name_snapshot: string;
  payment_method: string;
  priority: AresPriority;
  project_id?: string | null;
  project_name_snapshot: string;
  registered_at: string;
  responsible_name_snapshot: string;
  responsible_user_id: string;
  result_center_id?: string | null;
  result_center_name_snapshot: string;
  source_system: string;
  title: string;
  updated_by_user_id: string;
};

type AresBankStatementImportRow = {
  bank_account_id?: string | null;
  financial_base_id?: string | null;
  id: string;
  imported_at: string;
  line_count: number;
  matched_count: number;
  period_end?: string | null;
  period_start?: string | null;
  source_type: string;
  status: string;
  unmatched_count: number;
};

type AresBankStatementLineRow = {
  amount: NumericValue;
  bank_account_id?: string | null;
  description: string;
  document_number?: string | null;
  financial_base_id?: string | null;
  id: string;
  match_status: AresBankStatementLine["matchStatus"];
  matched_entry_id?: string | null;
  transaction_date: string;
};

type AresPaymentBatchRow = {
  batch_kind: string;
  entry_count: number;
  financial_base_id?: string | null;
  id: string;
  scheduled_for?: string | null;
  status: string;
  title: string;
  total_amount: NumericValue;
};

type HubAccessDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_user_permissions: {
        Insert: never;
        Relationships: [];
        Row: HubUserPermissionRow;
        Update: never;
      };
      ares_financial_base_users: {
        Insert: never;
        Relationships: [];
        Row: AresFinancialBaseUserRow;
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubAccessUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type AresDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      ares_bank_accounts: {
        Insert: never;
        Relationships: [];
        Row: AresBankAccountRow;
        Update: never;
      };
      ares_bank_statement_imports: {
        Insert: never;
        Relationships: [];
        Row: AresBankStatementImportRow;
        Update: never;
      };
      ares_bank_statement_lines: {
        Insert: never;
        Relationships: [];
        Row: AresBankStatementLineRow;
        Update: never;
      };
      ares_financial_base_users: {
        Insert: AresFinancialBaseUserInsertRow;
        Relationships: [];
        Row: AresFinancialBaseUserRow;
        Update: Partial<AresFinancialBaseUserInsertRow>;
      };
      ares_financial_bases: {
        Insert: AresFinancialBaseInsertRow;
        Relationships: [];
        Row: AresFinancialBaseRow;
        Update: AresFinancialBaseUpdateRow;
      };
      ares_financial_dimensions: {
        Insert: AresFinancialDimensionInsertRow;
        Relationships: [];
        Row: AresFinancialDimensionRow;
        Update: AresFinancialDimensionUpdateRow;
      };
      ares_financial_entries: {
        Insert: AresFinancialEntryInsertRow;
        Relationships: [];
        Row: AresFinancialEntryRow;
        Update: never;
      };
      ares_payment_batches: {
        Insert: never;
        Relationships: [];
        Row: AresPaymentBatchRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type AuthorizedAresContext =
  | {
      ok: false;
      response: NextResponse;
    }
  | {
      accessToken: string;
      ok: true;
      permissions: {
        canManage: boolean;
        canManageSetup: boolean;
        canView: boolean;
      };
      user: HubAccessUserRow;
    };

type AresSnapshotResult =
  | { data: AresSnapshot; ok: true }
  | { code: string; error: string; ok: false; status: number };

type AresEntryMutationResult =
  | { data: AresFinancialEntry; ok: true }
  | { code: string; error: string; ok: false; status: number };

type AresDimensionMutationResult =
  | { data: AresDimension; ok: true }
  | { code: string; error: string; ok: false; status: number };

type AresFinancialBaseMutationResult =
  | { data: AresFinancialBase; ok: true }
  | { code: string; error: string; ok: false; status: number };

type QueryResult<Row> = {
  data: Row[] | null;
  error: { message?: string } | null;
};

const ARES_ENTRIES_LIMIT = 250;
const ARES_STATEMENT_LINES_LIMIT = 250;
const ARES_TABLES = [
  "ares_financial_bases",
  "ares_financial_base_users",
  "ares_financial_dimensions",
  "ares_bank_accounts",
  "ares_financial_entries",
  "ares_bank_statement_imports",
  "ares_bank_statement_lines",
  "ares_payment_batches",
  "ares_payment_batch_items",
  "ares_entry_events",
] as const;
const SETTLED_STATUSES = new Set<AresLifecycleStatus>([
  "cancelled",
  "paid",
  "received",
  "reconciled",
]);
const ARES_BASE_SELECT = "id,code,name,accent_color,status";
const ARES_BASE_USER_SELECT = "financial_base_id,user_id,status";
const ARES_DIMENSION_SELECT =
  "id,financial_base_id,dimension_kind,code,name,parent_id,status";
const ARES_ENTRY_SELECT =
  "id,financial_base_id,financial_base_name_snapshot,entry_kind,lifecycle_status,approval_status,title,document_number,party_name_snapshot,counterparty_kind,apolo_entity_id,bank_account_id,bank_account_label_snapshot,category_id,category_name_snapshot,project_id,project_name_snapshot,cost_center_id,cost_center_name_snapshot,result_center_id,result_center_name_snapshot,department_id,department_name_snapshot,responsible_user_id,responsible_name_snapshot,amount_gross,amount_paid,amount_open,due_date,forecast_date,registered_at,payment_method,priority,next_action,source_system,updated_at";

export async function createAuthorizedAresContext(
  request: NextRequest,
): Promise<AuthorizedAresContext> {
  const { anonKey, serviceRoleKey, url: supabaseUrl } =
    getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure as chaves server-side do Hub para carregar o Ares." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Hub ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<HubAccessDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Hub invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubAccessUserRow>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hub." },
        { status: 403 },
      ),
    };
  }

  const explicitPermissionIds = await loadExplicitPermissionIds(
    adminClient,
    user.id,
  );
  const hasBaseAssignment = await loadHasAresFinancialBaseAssignment(
    adminClient,
    user.id,
  );
  const canView =
    hasRolePermission(user.role, "financeiro:view") ||
    explicitPermissionIds.has("financeiro-view") ||
    explicitPermissionIds.has("financeiro-manage") ||
    hasBaseAssignment;
  const canManage =
    hasRolePermission(user.role, "financeiro:manage") ||
    explicitPermissionIds.has("financeiro-manage") ||
    hasBaseAssignment;
  const canManageSetup = user.role === "admin" || user.role === "leader";

  if (!canView) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem permissao para acessar o Ares." },
        { status: 403 },
      ),
    };
  }

  return {
    accessToken,
    ok: true,
    permissions: {
      canManage,
      canManageSetup,
      canView,
    },
    user,
  };
}

export async function loadAresSnapshot(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  requestedFinancialBaseId?: string | null,
): Promise<AresSnapshotResult> {
  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para leitura Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const financialBasesResult = await loadAresFinancialBases(client);

  if (!financialBasesResult.ok) {
    return financialBasesResult;
  }

  const financialBases = financialBasesResult.data;
  const activeBaseResult = resolveAresActiveFinancialBase(
    financialBases,
    requestedFinancialBaseId,
  );

  if (!activeBaseResult.ok) {
    return activeBaseResult;
  }

  const activeFinancialBase = activeBaseResult.data;
  const assignableUsers = context.permissions.canManageSetup
    ? await loadAresAssignableUsers(context)
    : [];

  if (!activeFinancialBase) {
    return {
      data: {
        activeFinancialBaseId: null,
        assignableUsers,
        bankAccounts: [],
        dimensions: [],
        entries: [],
        financialBases,
        generatedAt: new Date().toISOString(),
        limits: {
          entriesLimit: ARES_ENTRIES_LIMIT,
          entriesLoaded: 0,
        },
        paymentBatches: [],
        permissions: context.permissions,
        source: {
          mode: "rls-read",
          schema: "public",
          tables: [...ARES_TABLES],
        },
        statementImports: [],
        statementLines: [],
        summary: createAresSummary([], [], []),
      },
      ok: true,
    };
  }

  const [
    dimensionsResult,
    bankAccountsResult,
    entriesResult,
    statementImportsResult,
    statementLinesResult,
    paymentBatchesResult,
  ] = await Promise.all([
    client
      .from("ares_financial_dimensions")
      .select(ARES_DIMENSION_SELECT)
      .eq("financial_base_id", activeFinancialBase.id)
      .order("dimension_kind", { ascending: true })
      .order("name", { ascending: true }),
    client
      .from("ares_bank_accounts")
      .select(
        "id,financial_base_id,name,account_kind,bank_name,account_label,status,current_balance,projected_balance,last_balance_at",
      )
      .eq("financial_base_id", activeFinancialBase.id)
      .order("name", { ascending: true }),
    client
      .from("ares_financial_entries")
      .select(ARES_ENTRY_SELECT)
      .eq("financial_base_id", activeFinancialBase.id)
      .order("due_date", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(ARES_ENTRIES_LIMIT),
    client
      .from("ares_bank_statement_imports")
      .select(
        "id,bank_account_id,source_type,status,period_start,period_end,imported_at,line_count,matched_count,unmatched_count",
      )
      .eq("financial_base_id", activeFinancialBase.id)
      .order("imported_at", { ascending: false })
      .limit(50),
    client
      .from("ares_bank_statement_lines")
      .select(
        "id,bank_account_id,transaction_date,description,document_number,amount,match_status,matched_entry_id",
      )
      .eq("financial_base_id", activeFinancialBase.id)
      .order("transaction_date", { ascending: false })
      .limit(ARES_STATEMENT_LINES_LIMIT),
    client
      .from("ares_payment_batches")
      .select("id,batch_kind,status,title,scheduled_for,total_amount,entry_count")
      .eq("financial_base_id", activeFinancialBase.id)
      .order("scheduled_for", { ascending: true })
      .limit(80),
  ]);

  const failedTables = [
    getFailedTable("ares_financial_dimensions", dimensionsResult),
    getFailedTable("ares_bank_accounts", bankAccountsResult),
    getFailedTable("ares_financial_entries", entriesResult),
    getFailedTable("ares_bank_statement_imports", statementImportsResult),
    getFailedTable("ares_bank_statement_lines", statementLinesResult),
    getFailedTable("ares_payment_batches", paymentBatchesResult),
  ].filter(Boolean);

  if (failedTables.length > 0) {
    return {
      code: "ares_snapshot_failed",
      error: `Nao foi possivel carregar o snapshot Ares: ${failedTables.join(", ")}.`,
      ok: false,
      status: 503,
    };
  }

  const dimensions = mapDimensions(dimensionsResult.data ?? []);
  const bankAccounts = mapBankAccounts(bankAccountsResult.data ?? []);
  const entries = mapEntries(entriesResult.data ?? []);
  const statementImports = mapStatementImports(
    statementImportsResult.data ?? [],
  );
  const statementLines = mapStatementLines(statementLinesResult.data ?? []);
  const paymentBatches = mapPaymentBatches(paymentBatchesResult.data ?? []);

  return {
    data: {
      activeFinancialBaseId: activeFinancialBase.id,
      assignableUsers,
      bankAccounts,
      dimensions,
      entries,
      financialBases,
      generatedAt: new Date().toISOString(),
      limits: {
        entriesLimit: ARES_ENTRIES_LIMIT,
        entriesLoaded: entries.length,
      },
      paymentBatches,
      permissions: context.permissions,
      source: {
        mode: "rls-read",
        schema: "public",
        tables: [...ARES_TABLES],
      },
      statementImports,
      statementLines,
      summary: createAresSummary(entries, bankAccounts, statementLines),
    },
    ok: true,
  };
}

export async function createAresFinancialDimension(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  input: unknown,
): Promise<AresDimensionMutationResult> {
  if (!context.permissions.canManageSetup) {
    return {
      code: "ares_manage_forbidden",
      error: "Usuario sem permissao para cadastrar setup financeiro no Ares.",
      ok: false,
      status: 403,
    };
  }

  const normalizedInput = normalizeCreateAresDimensionInput(input);

  if (!normalizedInput.ok) {
    return normalizedInput;
  }

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para cadastrar setup Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const financialBaseResult = await loadAresFinancialBaseForSetup(
    client,
    normalizedInput.data.financialBaseId,
  );

  if (!financialBaseResult.ok) {
    return financialBaseResult;
  }

  const parentResult = await validateAresDimensionParent(
    client,
    financialBaseResult.data.id,
    normalizedInput.data.kind,
    normalizedInput.data.parentId,
  );

  if (!parentResult.ok) {
    return parentResult;
  }

  const existingDimension = await findAresDimensionByName(
    client,
    financialBaseResult.data.id,
    normalizedInput.data.kind,
    normalizedInput.data.name,
    parentResult.data.parentId,
  );

  if (existingDimension.error) {
    return {
      code: "ares_dimension_lookup_failed",
      error: "Nao foi possivel verificar o setup financeiro do Ares.",
      ok: false,
      status: 502,
    };
  }

  if (existingDimension.data) {
    return {
      data: mapDimension(existingDimension.data),
      ok: true,
    };
  }

  const codeResult = await resolveAresDimensionCode(
    client,
    normalizedInput.data.code,
  );

  if (!codeResult.ok) {
    return codeResult;
  }

  const insertRow: AresFinancialDimensionInsertRow = {
    code: codeResult.data,
    created_by_user_id: context.user.id,
    dimension_kind: normalizedInput.data.kind,
    financial_base_id: financialBaseResult.data.id,
    name: normalizedInput.data.name,
    parent_id: parentResult.data.parentId,
    status: normalizedInput.data.status,
    updated_by_user_id: context.user.id,
  };
  const { data, error } = await client
    .from("ares_financial_dimensions")
    .insert(insertRow)
    .select(ARES_DIMENSION_SELECT)
    .single<AresFinancialDimensionRow>();

  if (error || !data) {
    return {
      code: "ares_dimension_create_failed",
      error: "Nao foi possivel gravar o setup financeiro do Ares.",
      ok: false,
      status: 502,
    };
  }

  return {
    data: mapDimension(data),
    ok: true,
  };
}

export async function updateAresFinancialDimension(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  input: unknown,
): Promise<AresDimensionMutationResult> {
  if (!context.permissions.canManageSetup) {
    return {
      code: "ares_manage_forbidden",
      error: "Usuario sem permissao para atualizar setup financeiro no Ares.",
      ok: false,
      status: 403,
    };
  }

  const normalizedInput = normalizeUpdateAresDimensionInput(input);

  if (!normalizedInput.ok) {
    return normalizedInput;
  }

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para atualizar setup Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const { data: currentDimension, error: currentError } = await client
    .from("ares_financial_dimensions")
    .select(ARES_DIMENSION_SELECT)
    .eq("id", normalizedInput.data.id)
    .maybeSingle<AresFinancialDimensionRow>();

  if (currentError || !currentDimension) {
    return {
      code: "ares_dimension_not_found",
      error: "Dimensao do Setup Ares nao encontrada.",
      ok: false,
      status: 404,
    };
  }

  const financialBaseResult = await loadAresFinancialBaseForSetup(
    client,
    currentDimension.financial_base_id,
  );

  if (!financialBaseResult.ok) {
    return financialBaseResult;
  }

  const parentResult = await validateAresDimensionParent(
    client,
    currentDimension.financial_base_id,
    currentDimension.dimension_kind,
    normalizedInput.data.parentId,
  );

  if (!parentResult.ok) {
    return parentResult;
  }

  const { data, error } = await client
    .from("ares_financial_dimensions")
    .update({
      parent_id: parentResult.data.parentId,
      updated_by_user_id: context.user.id,
    })
    .eq("id", currentDimension.id)
    .select(ARES_DIMENSION_SELECT)
    .single<AresFinancialDimensionRow>();

  if (error || !data) {
    return {
      code: "ares_dimension_update_failed",
      error: "Nao foi possivel atualizar o vinculo do Setup Ares.",
      ok: false,
      status: 502,
    };
  }

  return {
    data: mapDimension(data),
    ok: true,
  };
}

export async function createAresFinancialBase(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  input: unknown,
): Promise<AresFinancialBaseMutationResult> {
  if (!context.permissions.canManageSetup) {
    return {
      code: "ares_setup_forbidden",
      error: "Somente admin e coordenador podem cadastrar empresas no Ares.",
      ok: false,
      status: 403,
    };
  }

  const normalizedInput = normalizeCreateAresFinancialBaseInput(input);

  if (!normalizedInput.ok) {
    return normalizedInput;
  }

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para cadastrar empresa Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const codeResult = await resolveAresFinancialBaseCode(client);

  if (!codeResult.ok) {
    return codeResult;
  }

  const { data, error } = await client
    .from("ares_financial_bases")
    .insert({
      accent_color: normalizedInput.data.accentColor,
      code: codeResult.data,
      created_by_user_id: context.user.id,
      name: normalizedInput.data.name,
      status: normalizedInput.data.status,
      updated_by_user_id: context.user.id,
    })
    .select(ARES_BASE_SELECT)
    .single<AresFinancialBaseRow>();

  if (error || !data) {
    return {
      code: "ares_financial_base_create_failed",
      error: "Nao foi possivel cadastrar a empresa no Ares.",
      ok: false,
      status: 502,
    };
  }

  const assignmentsResult = await replaceAresFinancialBaseAssignments(
    client,
    data.id,
    normalizedInput.data.assignedUserIds,
    context.user.id,
  );

  if (!assignmentsResult.ok) {
    return assignmentsResult;
  }

  return {
    data: mapFinancialBase(data, assignmentsResult.data),
    ok: true,
  };
}

export async function updateAresFinancialBase(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  input: unknown,
): Promise<AresFinancialBaseMutationResult> {
  if (!context.permissions.canManageSetup) {
    return {
      code: "ares_setup_forbidden",
      error: "Somente admin e coordenador podem atualizar empresas no Ares.",
      ok: false,
      status: 403,
    };
  }

  const normalizedInput = normalizeUpdateAresFinancialBaseInput(input);

  if (!normalizedInput.ok) {
    return normalizedInput;
  }

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para atualizar empresa Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const updateRow: AresFinancialBaseUpdateRow = {
    updated_by_user_id: context.user.id,
  };

  if (normalizedInput.data.name) {
    updateRow.name = normalizedInput.data.name;
  }

  if (normalizedInput.data.accentColor) {
    updateRow.accent_color = normalizedInput.data.accentColor;
  }

  if (normalizedInput.data.status) {
    updateRow.status = normalizedInput.data.status;
  }

  const { data, error } = await client
    .from("ares_financial_bases")
    .update(updateRow)
    .eq("id", normalizedInput.data.id)
    .select(ARES_BASE_SELECT)
    .single<AresFinancialBaseRow>();

  if (error || !data) {
    return {
      code: "ares_financial_base_update_failed",
      error: "Nao foi possivel atualizar a empresa no Ares.",
      ok: false,
      status: 502,
    };
  }

  const assignmentsResult = Array.isArray(normalizedInput.data.assignedUserIds)
    ? await replaceAresFinancialBaseAssignments(
        client,
        data.id,
        normalizedInput.data.assignedUserIds,
        context.user.id,
      )
    : await loadAresFinancialBaseAssignments(client, [data.id]);

  if (!assignmentsResult.ok) {
    return assignmentsResult;
  }

  return {
    data: mapFinancialBase(data, assignmentsResult.data),
    ok: true,
  };
}

export async function createAresFinancialEntry(
  context: Extract<AuthorizedAresContext, { ok: true }>,
  input: unknown,
): Promise<AresEntryMutationResult> {
  if (!context.permissions.canManage) {
    return {
      code: "ares_manage_forbidden",
      error: "Usuario sem permissao para realizar lancamento no Ares.",
      ok: false,
      status: 403,
    };
  }

  const normalizedInput = normalizeCreateAresEntryInput(input);

  if (!normalizedInput.ok) {
    return normalizedInput;
  }

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !anonKey) {
    return {
      code: "ares_env_missing",
      error: "Config do Supabase Hub ausente para realizar lancamento Ares.",
      ok: false,
      status: 503,
    };
  }

  const client = createClient<AresDatabase>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  });
  const financialBaseResult = await loadAresFinancialBaseForEntry(
    client,
    normalizedInput.data.financialBaseId,
  );

  if (!financialBaseResult.ok) {
    return financialBaseResult;
  }

  const dimensions = await loadAresEntryDimensions(
    client,
    normalizedInput.data,
  );

  if (!dimensions.ok) {
    return dimensions;
  }

  const nextStatus: AresLifecycleStatus =
    normalizedInput.data.approvalStatus === "pending"
      ? "approval_pending"
      : "pending";
  const insertRow: AresFinancialEntryInsertRow = {
    amount_gross: normalizedInput.data.amount,
    amount_open: normalizedInput.data.amount,
    amount_paid: 0,
    apolo_entity_id: normalizedInput.data.apoloEntityId,
    approval_status: normalizedInput.data.approvalStatus,
    bank_account_label_snapshot: normalizedInput.data.bankAccountLabel,
    category_id: dimensions.data.categoryId,
    category_name_snapshot: dimensions.data.categoryName,
    cost_center_id: dimensions.data.costCenterId,
    cost_center_name_snapshot: dimensions.data.costCenterName,
    counterparty_kind: normalizedInput.data.counterpartyKind,
    created_by_user_id: context.user.id,
    department_id: dimensions.data.departmentId,
    department_name_snapshot: dimensions.data.departmentName,
    document_number: normalizedInput.data.documentNumber,
    due_date: normalizedInput.data.dueDate,
    entry_kind: normalizedInput.data.entryKind,
    financial_base_id: financialBaseResult.data.id,
    financial_base_name_snapshot: financialBaseResult.data.name,
    forecast_date: normalizedInput.data.forecastDate,
    lifecycle_status: nextStatus,
    next_action: normalizedInput.data.nextAction,
    notes: normalizedInput.data.notes,
    party_name_snapshot: normalizedInput.data.partyName,
    payment_method: normalizedInput.data.paymentMethod,
    priority: normalizedInput.data.priority,
    project_id: dimensions.data.projectId,
    project_name_snapshot: dimensions.data.projectName,
    registered_at: getTodayDateKey(),
    responsible_name_snapshot: normalizedInput.data.responsibleName,
    responsible_user_id: context.user.id,
    result_center_id: dimensions.data.resultCenterId,
    result_center_name_snapshot: dimensions.data.resultCenterName,
    source_system: normalizedInput.data.sourceSystem,
    title: normalizedInput.data.title,
    updated_by_user_id: context.user.id,
  };
  const { data, error } = await client
    .from("ares_financial_entries")
    .insert(insertRow)
    .select(ARES_ENTRY_SELECT)
    .single<AresFinancialEntryRow>();

  if (error || !data) {
    return {
      code: "ares_entry_create_failed",
      error: "Nao foi possivel gravar o lancamento Ares.",
      ok: false,
      status: 502,
    };
  }

  return {
    data: mapEntry(data),
    ok: true,
  };
}

async function loadExplicitPermissionIds(
  client: ReturnType<typeof createClient<HubAccessDatabase>>,
  userId: string,
) {
  const { data, error } = await client
    .from("hub_user_permissions")
    .select("permission_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .in("permission_id", ["financeiro-view", "financeiro-manage"]);

  if (error) {
    return new Set<string>();
  }

  return new Set((data ?? []).map((row) => row.permission_id));
}

async function loadHasAresFinancialBaseAssignment(
  client: ReturnType<typeof createClient<HubAccessDatabase>>,
  userId: string,
) {
  const { data, error } = await client
    .from("ares_financial_base_users")
    .select("financial_base_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);

  if (error) {
    return false;
  }

  return Boolean(data?.length);
}

async function loadAresFinancialBases(
  client: ReturnType<typeof createClient<AresDatabase>>,
): Promise<
  | { data: AresFinancialBase[]; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  const [basesResult, assignmentsResult] = await Promise.all([
    client
      .from("ares_financial_bases")
      .select(ARES_BASE_SELECT)
      .eq("status", "active")
      .order("name", { ascending: true }),
    client
      .from("ares_financial_base_users")
      .select(ARES_BASE_USER_SELECT)
      .eq("status", "active"),
  ]);

  if (basesResult.error || assignmentsResult.error) {
    return {
      code: "ares_financial_bases_failed",
      error: "Nao foi possivel carregar as empresas do Ares.",
      ok: false,
      status: 503,
    };
  }

  return {
    data: (basesResult.data ?? []).map((row) =>
      mapFinancialBase(row, assignmentsResult.data ?? []),
    ),
    ok: true,
  };
}

async function loadAresFinancialBaseAssignments(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseIds: string[],
): Promise<
  | { data: AresFinancialBaseUserRow[]; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  if (financialBaseIds.length === 0) {
    return {
      data: [],
      ok: true,
    };
  }

  const { data, error } = await client
    .from("ares_financial_base_users")
    .select(ARES_BASE_USER_SELECT)
    .in("financial_base_id", financialBaseIds)
    .eq("status", "active");

  if (error) {
    return {
      code: "ares_financial_base_users_failed",
      error: "Nao foi possivel carregar usuarios vinculados a empresa Ares.",
      ok: false,
      status: 503,
    };
  }

  return {
    data: data ?? [],
    ok: true,
  };
}

async function loadAresAssignableUsers(
  context: Extract<AuthorizedAresContext, { ok: true }>,
): Promise<AresAssignableUser[]> {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  const adminClient = createClient<HubAccessDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await adminClient
    .from("hub_users")
    .select("id,display_name,email,role,status")
    .eq("status", "active")
    .order("display_name", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? [])
    .filter((row) => row.id !== context.user.id || context.user.role === "admin")
    .map(mapAssignableUser);
}

function resolveAresActiveFinancialBase(
  financialBases: AresFinancialBase[],
  requestedFinancialBaseId?: string | null,
):
  | { data: AresFinancialBase | null; ok: true }
  | { code: string; error: string; ok: false; status: number } {
  if (financialBases.length === 0) {
    return {
      data: null,
      ok: true,
    };
  }

  if (!requestedFinancialBaseId) {
    const firstFinancialBase = financialBases[0];

    return {
      data: firstFinancialBase ?? null,
      ok: true,
    };
  }

  const financialBase = financialBases.find(
    (base) => base.id === requestedFinancialBaseId,
  );

  if (!financialBase) {
    return {
      code: "ares_financial_base_forbidden",
      error: "Empresa Ares indisponivel para este usuario.",
      ok: false,
      status: 403,
    };
  }

  return {
    data: financialBase,
    ok: true,
  };
}

async function loadAresFinancialBaseForEntry(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseId: string,
): Promise<
  | { data: AresFinancialBaseRow; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  const { data, error } = await client
    .from("ares_financial_bases")
    .select(ARES_BASE_SELECT)
    .eq("id", financialBaseId)
    .eq("status", "active")
    .maybeSingle<AresFinancialBaseRow>();

  if (error || !data) {
    return {
      code: "ares_financial_base_forbidden",
      error: "Selecione uma empresa ativa do Ares.",
      ok: false,
      status: 403,
    };
  }

  return {
    data,
    ok: true,
  };
}

async function loadAresFinancialBaseForSetup(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseId: string,
): Promise<
  | { data: AresFinancialBaseRow; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  return loadAresFinancialBaseForEntry(client, financialBaseId);
}

async function replaceAresFinancialBaseAssignments(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseId: string,
  assignedUserIds: string[],
  actorUserId: string,
): Promise<
  | { data: AresFinancialBaseUserRow[]; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  const normalizedUserIds = Array.from(new Set(assignedUserIds.filter(isUuid)));
  const { error: archiveError } = await client
    .from("ares_financial_base_users")
    .update({
      status: "inactive",
      updated_by_user_id: actorUserId,
    })
    .eq("financial_base_id", financialBaseId);

  if (archiveError) {
    return {
      code: "ares_financial_base_assignment_failed",
      error: "Nao foi possivel atualizar os usuarios da empresa Ares.",
      ok: false,
      status: 502,
    };
  }

  if (normalizedUserIds.length === 0) {
    return {
      data: [],
      ok: true,
    };
  }

  const rows = normalizedUserIds.map((userId) => ({
    created_by_user_id: actorUserId,
    financial_base_id: financialBaseId,
    status: "active",
    updated_by_user_id: actorUserId,
    user_id: userId,
  }));
  const { data, error } = await client
    .from("ares_financial_base_users")
    .upsert(rows, {
      onConflict: "financial_base_id,user_id",
    })
    .select(ARES_BASE_USER_SELECT);

  if (error) {
    return {
      code: "ares_financial_base_assignment_failed",
      error: "Nao foi possivel salvar os usuarios da empresa Ares.",
      ok: false,
      status: 502,
    };
  }

  return {
    data: data ?? [],
    ok: true,
  };
}

async function loadAresEntryDimensions(
  client: ReturnType<typeof createClient<AresDatabase>>,
  input: NormalizedCreateAresEntryInput,
): Promise<
  | {
      data: {
        categoryId: string;
        categoryName: string;
        costCenterId: string;
        costCenterName: string;
        departmentId: string;
        departmentName: string;
        projectId: string;
        projectName: string;
        resultCenterId: string;
        resultCenterName: string;
      };
      ok: true;
    }
  | { code: string; error: string; ok: false; status: number }
> {
  const dimensions = [
    {
      key: "categoryId",
      kind: "category",
      id: input.categoryId,
      label: "categoria",
      nameKey: "categoryName",
    },
    {
      key: "costCenterId",
      kind: "cost_center",
      id: input.costCenterId,
      label: "centro de custo",
      nameKey: "costCenterName",
    },
    {
      key: "departmentId",
      kind: "department",
      id: input.departmentId,
      label: "departamento",
      nameKey: "departmentName",
    },
    {
      key: "projectId",
      kind: "project",
      id: input.projectId,
      label: "projeto",
      nameKey: "projectName",
    },
    {
      key: "resultCenterId",
      kind: "result_center",
      id: input.resultCenterId,
      label: "centro de resultado",
      nameKey: "resultCenterName",
    },
  ] as const satisfies readonly {
    id: string;
    key:
      | "categoryId"
      | "costCenterId"
      | "departmentId"
      | "projectId"
      | "resultCenterId";
    label: string;
    kind: AresDimensionKind;
    nameKey:
      | "categoryName"
      | "costCenterName"
      | "departmentName"
      | "projectName"
      | "resultCenterName";
  }[];
  const resolvedDimensions = {
    categoryId: "",
    categoryName: "",
    costCenterId: "",
    costCenterName: "",
    departmentId: "",
    departmentName: "",
    projectId: "",
    projectName: "",
    resultCenterId: "",
    resultCenterName: "",
  };
  const { data, error } = await client
    .from("ares_financial_dimensions")
    .select(ARES_DIMENSION_SELECT)
    .eq("financial_base_id", input.financialBaseId)
    .in(
      "id",
      dimensions.map((dimension) => dimension.id),
    );

  if (error) {
    return {
      code: "ares_dimension_lookup_failed",
      error: "Nao foi possivel verificar as dimensoes financeiras do Ares.",
      ok: false,
      status: 502,
    };
  }

  const dimensionById = new Map((data ?? []).map((row) => [row.id, row]));

  for (const dimension of dimensions) {
    const row = dimensionById.get(dimension.id);

    if (
      !row ||
      row.dimension_kind !== dimension.kind ||
      row.status !== "active"
    ) {
      return {
        code: "ares_entry_dimension_invalid",
        error: `Selecione ${dimension.label} cadastrado no Setup do Ares.`,
        ok: false,
        status: 400,
      };
    }

    resolvedDimensions[dimension.key] = row.id;
    resolvedDimensions[dimension.nameKey] = row.name;
  }

  const category = dimensionById.get(resolvedDimensions.categoryId);
  const costCenter = dimensionById.get(resolvedDimensions.costCenterId);
  const department = dimensionById.get(resolvedDimensions.departmentId);
  const project = dimensionById.get(resolvedDimensions.projectId);
  const resultCenter = dimensionById.get(resolvedDimensions.resultCenterId);

  if (
    !department ||
    costCenter?.parent_id !== department.id ||
    resultCenter?.parent_id !== department.id
  ) {
    return {
      code: "ares_entry_dimension_hierarchy_invalid",
      error:
        "Selecione centros vinculados ao departamento escolhido no Setup do Ares.",
      ok: false,
      status: 400,
    };
  }

  if (
    !category?.parent_id ||
    ![costCenter.id, resultCenter.id].includes(category.parent_id)
  ) {
    return {
      code: "ares_entry_dimension_hierarchy_invalid",
      error:
        "Selecione uma categoria vinculada aos centros escolhidos no Setup do Ares.",
      ok: false,
      status: 400,
    };
  }

  if (project?.parent_id !== category.id) {
    return {
      code: "ares_entry_dimension_hierarchy_invalid",
      error:
        "Selecione um projeto vinculado a categoria escolhida no Setup do Ares.",
      ok: false,
      status: 400,
    };
  }

  return {
    data: resolvedDimensions,
    ok: true,
  };
}

async function resolveAresDimensionCode(
  client: ReturnType<typeof createClient<AresDatabase>>,
  requestedCode: string | null,
): Promise<
  | { data: string; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  if (requestedCode) {
    return {
      data: requestedCode,
      ok: true,
    };
  }

  const { data, error } = await client
    .from("ares_financial_dimensions")
    .select("code")
    .not("code", "is", null);

  if (error) {
    return {
      code: "ares_dimension_code_failed",
      error: "Nao foi possivel gerar o codigo sequencial do setup Ares.",
      ok: false,
      status: 502,
    };
  }

  const nextCodeNumber =
    (data ?? []).reduce((currentMax, row) => {
      const code = row.code?.trim() ?? "";

      if (!/^\d+$/.test(code)) {
        return currentMax;
      }

      return Math.max(currentMax, Number(code));
    }, 0) + 1;

  return {
    data: String(nextCodeNumber).padStart(5, "0"),
    ok: true,
  };
}

async function resolveAresFinancialBaseCode(
  client: ReturnType<typeof createClient<AresDatabase>>,
): Promise<
  | { data: string; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  const { data, error } = await client
    .from("ares_financial_bases")
    .select("code")
    .not("code", "is", null);

  if (error) {
    return {
      code: "ares_financial_base_code_failed",
      error: "Nao foi possivel gerar o codigo sequencial da empresa Ares.",
      ok: false,
      status: 502,
    };
  }

  const nextCodeNumber =
    (data ?? []).reduce((currentMax, row) => {
      const code = row.code?.trim() ?? "";

      if (!/^\d+$/.test(code)) {
        return currentMax;
      }

      return Math.max(currentMax, Number(code));
    }, 0) + 1;

  return {
    data: String(nextCodeNumber).padStart(5, "0"),
    ok: true,
  };
}

async function findAresDimensionByName(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseId: string,
  kind: AresDimensionKind,
  name: string,
  parentId: string | null,
) {
  const { data, error } = await client
    .from("ares_financial_dimensions")
    .select(ARES_DIMENSION_SELECT)
    .eq("financial_base_id", financialBaseId)
    .eq("dimension_kind", kind)
    .neq("status", "archived");

  if (error) {
    return {
      data: null,
      error,
    };
  }

  const nameKey = normalizeDimensionNameKey(name);

  return {
    data:
      (data ?? []).find(
        (row) =>
          normalizeDimensionNameKey(row.name) === nameKey &&
          (row.parent_id ?? null) === parentId,
      ) ?? null,
    error: null,
  };
}

async function validateAresDimensionParent(
  client: ReturnType<typeof createClient<AresDatabase>>,
  financialBaseId: string,
  kind: AresDimensionKind,
  parentId: string | null,
): Promise<
  | { data: { parentId: string | null }; ok: true }
  | { code: string; error: string; ok: false; status: number }
> {
  if (kind === "department") {
    return {
      data: {
        parentId: null,
      },
      ok: true,
    };
  }

  if (!parentId || !isUuid(parentId)) {
    return {
      code: "ares_dimension_parent_required",
      error: getAresDimensionParentError(kind),
      ok: false,
      status: 400,
    };
  }

  const { data, error } = await client
    .from("ares_financial_dimensions")
    .select(ARES_DIMENSION_SELECT)
    .eq("id", parentId)
    .eq("financial_base_id", financialBaseId)
    .maybeSingle<AresFinancialDimensionRow>();

  if (error) {
    return {
      code: "ares_dimension_parent_lookup_failed",
      error: "Nao foi possivel verificar o vinculo do setup Ares.",
      ok: false,
      status: 502,
    };
  }

  if (!data || data.status !== "active") {
    return {
      code: "ares_dimension_parent_invalid",
      error: getAresDimensionParentError(kind),
      ok: false,
      status: 400,
    };
  }

  const expectedParentKinds = getAresExpectedParentKinds(kind);

  if (!expectedParentKinds.includes(data.dimension_kind)) {
    return {
      code: "ares_dimension_parent_invalid",
      error: getAresDimensionParentError(kind),
      ok: false,
      status: 400,
    };
  }

  return {
    data: {
      parentId: data.id,
    },
    ok: true,
  };
}

function getAresExpectedParentKinds(kind: AresDimensionKind): AresDimensionKind[] {
  if (kind === "cost_center" || kind === "result_center") {
    return ["department"];
  }

  if (kind === "category") {
    return ["cost_center", "result_center"];
  }

  if (kind === "project") {
    return ["category"];
  }

  return [];
}

function getAresDimensionParentError(kind: AresDimensionKind) {
  if (kind === "cost_center" || kind === "result_center") {
    return "Vincule o centro a um departamento cadastrado no Setup do Ares.";
  }

  if (kind === "category") {
    return "Vincule a categoria a um centro cadastrado no Setup do Ares.";
  }

  if (kind === "project") {
    return "Vincule o projeto a uma categoria cadastrada no Setup do Ares.";
  }

  return "Vinculo de setup financeiro invalido.";
}

function normalizeDimensionNameKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

type NormalizedCreateAresEntryInput = Omit<CreateAresEntryInput, "amount"> & {
  amount: number;
  apoloEntityId: string | null;
  notes: string | null;
};

function normalizeCreateAresEntryInput(input: unknown):
  | {
      data: NormalizedCreateAresEntryInput;
      ok: true;
    }
  | {
      code: string;
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return createInvalidEntryInput("Payload de lancamento invalido.");
  }

  const candidate = input as Partial<CreateAresEntryInput>;
  const requiredTextFields = [
    ["bankAccountLabel", "conta"],
    ["categoryId", "categoria"],
    ["costCenterId", "centro de custo"],
    ["departmentId", "departamento"],
    ["documentNumber", "documento/boleto/NSU"],
    ["dueDate", "vencimento"],
    ["financialBaseId", "empresa"],
    ["forecastDate", "previsao"],
    ["nextAction", "proxima acao"],
    ["partyName", "cliente/fornecedor"],
    ["paymentMethod", "forma de pagamento"],
    ["projectId", "projeto"],
    ["responsibleName", "responsavel"],
    ["resultCenterId", "centro de resultado"],
    ["sourceSystem", "origem"],
    ["title", "descricao"],
  ] as const satisfies readonly [keyof CreateAresEntryInput, string][];
  const missingField = requiredTextFields.find(
    ([field]) => !readRequiredText(candidate[field]),
  );

  if (missingField) {
    return createInvalidEntryInput(`Informe ${missingField[1]}.`);
  }

  const amount = normalizeNumber(candidate.amount ?? null);

  if (!amount || amount <= 0) {
    return createInvalidEntryInput("Informe um valor maior que zero.");
  }

  if (
    candidate.entryKind !== "payable" &&
    candidate.entryKind !== "receivable"
  ) {
    return createInvalidEntryInput("Escolha contas a pagar ou contas a receber.");
  }

  if (!isAresCounterpartyKind(candidate.counterpartyKind)) {
    return createInvalidEntryInput("Escolha o tipo de cliente/fornecedor.");
  }

  if (!isAresPriority(candidate.priority)) {
    return createInvalidEntryInput("Escolha a prioridade.");
  }

  if (!isAresApprovalStatus(candidate.approvalStatus)) {
    return createInvalidEntryInput("Escolha o status de aprovacao.");
  }

  const apoloEntityId = readOptionalText(candidate.apoloEntityId);

  if (apoloEntityId && !isUuid(apoloEntityId)) {
    return createInvalidEntryInput("Selecione um cadastro valido do Apolo.");
  }

  const dimensionIds = [
    ["categoryId", "categoria"],
    ["costCenterId", "centro de custo"],
    ["departmentId", "departamento"],
    ["projectId", "projeto"],
    ["resultCenterId", "centro de resultado"],
  ] as const satisfies readonly [keyof CreateAresEntryInput, string][];
  const invalidDimension = dimensionIds.find(
    ([field]) => !isUuid(readRequiredText(candidate[field])),
  );

  if (invalidDimension) {
    return createInvalidEntryInput(
      `Selecione ${invalidDimension[1]} cadastrado no Setup do Ares.`,
    );
  }

  if (!isUuid(readRequiredText(candidate.financialBaseId))) {
    return createInvalidEntryInput("Selecione uma empresa do Ares.");
  }

  const dueDate = readRequiredText(candidate.dueDate);
  const forecastDate = readRequiredText(candidate.forecastDate);

  if (!isIsoDate(dueDate) || !isIsoDate(forecastDate)) {
    return createInvalidEntryInput("Use datas validas para vencimento e previsao.");
  }

  return {
    data: {
      amount,
      apoloEntityId,
      approvalStatus: candidate.approvalStatus,
      bankAccountLabel: readRequiredText(candidate.bankAccountLabel),
      categoryId: readRequiredText(candidate.categoryId),
      costCenterId: readRequiredText(candidate.costCenterId),
      counterpartyKind: candidate.counterpartyKind,
      departmentId: readRequiredText(candidate.departmentId),
      documentNumber: readRequiredText(candidate.documentNumber),
      dueDate,
      entryKind: candidate.entryKind,
      financialBaseId: readRequiredText(candidate.financialBaseId),
      forecastDate,
      nextAction: readRequiredText(candidate.nextAction),
      notes: readOptionalText(candidate.notes),
      partyName: readRequiredText(candidate.partyName),
      paymentMethod: readRequiredText(candidate.paymentMethod),
      priority: candidate.priority,
      projectId: readRequiredText(candidate.projectId),
      responsibleName: readRequiredText(candidate.responsibleName),
      resultCenterId: readRequiredText(candidate.resultCenterId),
      sourceSystem: readRequiredText(candidate.sourceSystem),
      title: readRequiredText(candidate.title),
    },
    ok: true,
  };
}

function normalizeCreateAresDimensionInput(input: unknown):
  | {
      data: Required<CreateAresDimensionInput>;
      ok: true;
    }
  | {
      code: string;
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return createInvalidDimensionInput("Payload de setup invalido.");
  }

  const candidate = input as Partial<CreateAresDimensionInput>;
  const name = readRequiredText(candidate.name);
  const code = readOptionalText(candidate.code);
  const parentId = readOptionalText(candidate.parentId);
  const status = candidate.status ?? "active";

  if (!isAresDimensionKind(candidate.kind)) {
    return createInvalidDimensionInput("Escolha o tipo de setup financeiro.");
  }

  if (!name) {
    return createInvalidDimensionInput("Informe o nome do setup financeiro.");
  }

  if (!isAresDimensionStatus(status)) {
    return createInvalidDimensionInput("Escolha um status valido para o setup.");
  }

  if (!isUuid(readRequiredText(candidate.financialBaseId))) {
    return createInvalidDimensionInput("Selecione a empresa do Setup Ares.");
  }

  return {
    data: {
      code,
      financialBaseId: readRequiredText(candidate.financialBaseId),
      kind: candidate.kind,
      name,
      parentId,
      status,
    },
    ok: true,
  };
}

function normalizeUpdateAresDimensionInput(input: unknown):
  | {
      data: {
        id: string;
        parentId: string | null;
      };
      ok: true;
    }
  | {
      code: string;
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return createInvalidDimensionInput("Payload de setup invalido.");
  }

  const candidate = input as Partial<UpdateAresDimensionInput>;
  const id = readRequiredText(candidate.id);
  const parentId = readOptionalText(candidate.parentId);

  if (!id || !isUuid(id)) {
    return createInvalidDimensionInput("Selecione um cadastro valido do Setup.");
  }

  if (parentId && !isUuid(parentId)) {
    return createInvalidDimensionInput("Selecione um vinculo valido do Setup.");
  }

  return {
    data: {
      id,
      parentId,
    },
    ok: true,
  };
}

function normalizeCreateAresFinancialBaseInput(input: unknown):
  | {
      data: {
        accentColor: string;
        assignedUserIds: string[];
        name: string;
        status: AresFinancialBaseStatus;
      };
      ok: true;
    }
  | {
      code: string;
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return createInvalidFinancialBaseInput("Payload de empresa invalido.");
  }

  const candidate = input as Partial<CreateAresFinancialBaseInput>;
  const name = readRequiredText(candidate.name);
  const accentColor = normalizeAccentColor(candidate.accentColor);
  const status = candidate.status ?? "active";

  if (!name) {
    return createInvalidFinancialBaseInput("Informe o nome da empresa.");
  }

  if (!accentColor) {
    return createInvalidFinancialBaseInput("Informe uma cor valida para a empresa.");
  }

  if (!isAresFinancialBaseStatus(status)) {
    return createInvalidFinancialBaseInput("Escolha um status valido para a empresa.");
  }

  return {
    data: {
      accentColor,
      assignedUserIds: normalizeAssignedUserIds(candidate.assignedUserIds),
      name,
      status,
    },
    ok: true,
  };
}

function normalizeUpdateAresFinancialBaseInput(input: unknown):
  | {
      data: {
        accentColor: string | null;
        assignedUserIds?: string[];
        id: string;
        name: string | null;
        status: AresFinancialBaseStatus | null;
      };
      ok: true;
    }
  | {
      code: string;
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return createInvalidFinancialBaseInput("Payload de empresa invalido.");
  }

  const candidate = input as Partial<UpdateAresFinancialBaseInput>;
  const id = readRequiredText(candidate.id);
  const name = readOptionalText(candidate.name);
  const accentColor =
    candidate.accentColor === undefined
      ? null
      : normalizeAccentColor(candidate.accentColor);
  const status = candidate.status ?? null;

  if (!id || !isUuid(id)) {
    return createInvalidFinancialBaseInput("Selecione uma empresa valida.");
  }

  if (candidate.accentColor !== undefined && !accentColor) {
    return createInvalidFinancialBaseInput("Informe uma cor valida para a empresa.");
  }

  if (status && !isAresFinancialBaseStatus(status)) {
    return createInvalidFinancialBaseInput("Escolha um status valido para a empresa.");
  }

  return {
    data: {
      accentColor,
      assignedUserIds: Array.isArray(candidate.assignedUserIds)
        ? normalizeAssignedUserIds(candidate.assignedUserIds)
        : undefined,
      id,
      name,
      status,
    },
    ok: true,
  };
}

function createInvalidEntryInput(error: string) {
  return {
    code: "ares_entry_invalid_input",
    error,
    ok: false,
    status: 400,
  } as const;
}

function createInvalidDimensionInput(error: string) {
  return {
    code: "ares_dimension_invalid_input",
    error,
    ok: false,
    status: 400,
  } as const;
}

function createInvalidFinancialBaseInput(error: string) {
  return {
    code: "ares_financial_base_invalid_input",
    error,
    ok: false,
    status: 400,
  } as const;
}

function readRequiredText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalText(value: unknown) {
  const normalizedValue = readRequiredText(value);

  return normalizedValue || null;
}

function normalizeAccentColor(value: unknown) {
  const color = readRequiredText(value) || "#A07C3B";

  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null;
}

function normalizeAssignedUserIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((item): item is string => isUuid(String(item)))),
  );
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAresCounterpartyKind(
  value: unknown,
): value is AresCounterpartyKind {
  return ["customer", "other", "partner", "supplier"].includes(String(value));
}

function isAresPriority(value: unknown): value is AresPriority {
  return ["high", "low", "normal", "urgent"].includes(String(value));
}

function isAresApprovalStatus(value: unknown): value is AresApprovalStatus {
  return ["approved", "not_required", "pending"].includes(String(value));
}

function isAresDimensionKind(value: unknown): value is AresDimensionKind {
  return [
    "category",
    "cost_center",
    "department",
    "project",
    "result_center",
  ].includes(String(value));
}

function isAresDimensionStatus(
  value: unknown,
): value is AresDimensionStatus {
  return ["active", "archived", "inactive"].includes(String(value));
}

function isAresFinancialBaseStatus(
  value: unknown,
): value is AresFinancialBaseStatus {
  return ["active", "archived", "inactive"].includes(String(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function hasRolePermission(role: HubUserRole, permission: HubPermission) {
  return getPermissionsForRole(role).includes(permission);
}

function mapFinancialBase(
  row: AresFinancialBaseRow,
  assignments: AresFinancialBaseUserRow[],
): AresFinancialBase {
  return {
    accentColor: row.accent_color,
    assignedUserIds: assignments
      .filter(
        (assignment) =>
          assignment.financial_base_id === row.id &&
          assignment.status === "active",
      )
      .map((assignment) => assignment.user_id),
    code: row.code ?? null,
    id: row.id,
    name: row.name,
    status: row.status,
  };
}

function mapAssignableUser(row: AresAssignableUserRow): AresAssignableUser {
  const fallbackName = row.email?.split("@")[0] ?? "Usuario Hub";

  return {
    id: row.id,
    name: row.display_name?.trim() || fallbackName,
    role: row.role,
    status: row.status,
  };
}

function mapDimensions(rows: AresFinancialDimensionRow[]): AresDimension[] {
  return rows.map(mapDimension);
}

function mapDimension(row: AresFinancialDimensionRow): AresDimension {
  return {
    code: row.code ?? null,
    financialBaseId: row.financial_base_id,
    id: row.id,
    kind: row.dimension_kind,
    name: row.name,
    parentId: row.parent_id ?? null,
    status: row.status,
  };
}

function mapBankAccounts(rows: AresBankAccountRow[]): AresBankAccount[] {
  return rows.map((row) => ({
    accountKind: row.account_kind,
    accountLabel: row.account_label ?? null,
    bankName: row.bank_name ?? null,
    currentBalance: normalizeNumber(row.current_balance ?? null),
    id: row.id,
    lastBalanceAt: row.last_balance_at ?? null,
    name: row.name,
    projectedBalance: normalizeNumber(row.projected_balance ?? null),
    status: row.status,
  }));
}

function mapEntries(rows: AresFinancialEntryRow[]): AresFinancialEntry[] {
  return rows.map(mapEntry);
}

function mapEntry(row: AresFinancialEntryRow): AresFinancialEntry {
  return {
    amountGross: normalizeNumber(row.amount_gross) ?? 0,
    amountOpen: normalizeNumber(row.amount_open) ?? 0,
    amountPaid: normalizeNumber(row.amount_paid) ?? 0,
    apoloEntityId: row.apolo_entity_id ?? null,
    approvalStatus: row.approval_status,
    bankAccountId: row.bank_account_id ?? null,
    bankAccountLabelSnapshot: row.bank_account_label_snapshot ?? null,
    categoryId: row.category_id ?? null,
    categoryNameSnapshot: row.category_name_snapshot ?? null,
    costCenterId: row.cost_center_id ?? null,
    costCenterNameSnapshot: row.cost_center_name_snapshot ?? null,
    counterpartyKind: row.counterparty_kind ?? null,
    departmentId: row.department_id ?? null,
    departmentNameSnapshot: row.department_name_snapshot ?? null,
    documentNumber: row.document_number ?? null,
    dueDate: row.due_date ?? null,
    entryKind: row.entry_kind,
    financialBaseId: row.financial_base_id,
    financialBaseNameSnapshot: row.financial_base_name_snapshot ?? null,
    forecastDate: row.forecast_date ?? null,
    id: row.id,
    lifecycleStatus: row.lifecycle_status,
    nextAction: row.next_action ?? null,
    partyNameSnapshot: row.party_name_snapshot ?? null,
    paymentMethod: row.payment_method ?? null,
    priority: row.priority ?? "normal",
    projectId: row.project_id ?? null,
    projectNameSnapshot: row.project_name_snapshot ?? null,
    registeredAt: row.registered_at ?? null,
    responsibleNameSnapshot: row.responsible_name_snapshot ?? null,
    responsibleUserId: row.responsible_user_id ?? null,
    resultCenterId: row.result_center_id ?? null,
    resultCenterNameSnapshot: row.result_center_name_snapshot ?? null,
    sourceSystem: row.source_system ?? null,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function mapStatementImports(
  rows: AresBankStatementImportRow[],
): AresBankStatementImport[] {
  return rows.map((row) => ({
    bankAccountId: row.bank_account_id ?? null,
    id: row.id,
    importedAt: row.imported_at,
    lineCount: row.line_count,
    matchedCount: row.matched_count,
    periodEnd: row.period_end ?? null,
    periodStart: row.period_start ?? null,
    sourceType: row.source_type,
    status: row.status,
    unmatchedCount: row.unmatched_count,
  }));
}

function mapStatementLines(
  rows: AresBankStatementLineRow[],
): AresBankStatementLine[] {
  return rows.map((row) => ({
    amount: normalizeNumber(row.amount) ?? 0,
    bankAccountId: row.bank_account_id ?? null,
    description: row.description,
    documentNumber: row.document_number ?? null,
    id: row.id,
    matchStatus: row.match_status,
    matchedEntryId: row.matched_entry_id ?? null,
    transactionDate: row.transaction_date,
  }));
}

function mapPaymentBatches(rows: AresPaymentBatchRow[]): AresPaymentBatch[] {
  return rows.map((row) => ({
    batchKind: row.batch_kind,
    entryCount: row.entry_count,
    id: row.id,
    scheduledFor: row.scheduled_for ?? null,
    status: row.status,
    title: row.title,
    totalAmount: normalizeNumber(row.total_amount) ?? 0,
  }));
}

function createAresSummary(
  entries: AresFinancialEntry[],
  bankAccounts: AresBankAccount[],
  statementLines: AresBankStatementLine[],
): AresSummary {
  const today = getTodayDateKey();
  const openEntries = entries.filter(
    (entry) => !SETTLED_STATUSES.has(entry.lifecycleStatus),
  );
  const openPayables = openEntries.filter(
    (entry) => entry.entryKind === "payable",
  );
  const openReceivables = openEntries.filter(
    (entry) => entry.entryKind === "receivable",
  );

  return {
    approvalPendingCount: entries.filter(
      (entry) =>
        entry.approvalStatus === "pending" ||
        entry.lifecycleStatus === "approval_pending",
    ).length,
    bankAccountsCount: bankAccounts.length,
    entriesCount: entries.length,
    overdueCount: openEntries.filter(
      (entry) => Boolean(entry.dueDate) && entry.dueDate! < today,
    ).length,
    payablesOpenAmount: sumAmounts(openPayables),
    payablesOpenCount: openPayables.length,
    receivablesOpenAmount: sumAmounts(openReceivables),
    receivablesOpenCount: openReceivables.length,
    reconciliationPendingCount: statementLines.filter((line) =>
      ["review", "unmatched"].includes(line.matchStatus),
    ).length,
  };
}

function sumAmounts(entries: AresFinancialEntry[]) {
  return entries.reduce(
    (total, entry) => total + (entry.amountOpen || entry.amountGross || 0),
    0,
  );
}

function normalizeNumber(value: NumericValue) {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function getFailedTable<Row>(
  tableName: string,
  result: QueryResult<Row>,
): string | null {
  return result.error ? tableName : null;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}
