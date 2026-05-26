export type AresEntryKind =
  | "adjustment"
  | "bank_statement"
  | "payable"
  | "receivable";

export type AresLifecycleStatus =
  | "approval_pending"
  | "approved"
  | "blocked"
  | "cancelled"
  | "draft"
  | "overdue"
  | "paid"
  | "partially_settled"
  | "pending"
  | "received"
  | "reconciled"
  | "scheduled";

export type AresApprovalStatus =
  | "approved"
  | "blocked"
  | "not_required"
  | "pending"
  | "rejected";

export type AresDimensionKind =
  | "category"
  | "cost_center"
  | "department"
  | "project"
  | "result_center";

export type AresDimensionStatus = "active" | "archived" | "inactive";

export type AresCounterpartyKind =
  | "customer"
  | "other"
  | "partner"
  | "supplier";

export type AresPriority = "high" | "low" | "normal" | "urgent";

export type AresFinancialBaseStatus = "active" | "archived" | "inactive";

export type AresAssignableUser = {
  id: string;
  name: string;
  role: string;
  status: string;
};

export type AresFinancialBase = {
  accentColor: string;
  assignedUserIds: string[];
  code: string | null;
  id: string;
  name: string;
  status: AresFinancialBaseStatus;
};

export type AresDimension = {
  code: string | null;
  financialBaseId: string;
  id: string;
  kind: AresDimensionKind;
  name: string;
  parentId: string | null;
  status: AresDimensionStatus;
};

export type AresBankAccount = {
  accountKind: string;
  accountLabel: string | null;
  bankName: string | null;
  currentBalance: number | null;
  id: string;
  lastBalanceAt: string | null;
  name: string;
  projectedBalance: number | null;
  status: string;
};

export type AresFinancialEntry = {
  amountGross: number;
  amountOpen: number;
  amountPaid: number;
  apoloEntityId: string | null;
  approvalStatus: AresApprovalStatus;
  bankAccountId: string | null;
  bankAccountLabelSnapshot: string | null;
  categoryId: string | null;
  categoryNameSnapshot: string | null;
  costCenterId: string | null;
  costCenterNameSnapshot: string | null;
  counterpartyKind: AresCounterpartyKind | null;
  departmentId: string | null;
  departmentNameSnapshot: string | null;
  documentNumber: string | null;
  dueDate: string | null;
  entryKind: AresEntryKind;
  financialBaseId: string;
  financialBaseNameSnapshot: string | null;
  forecastDate: string | null;
  id: string;
  lifecycleStatus: AresLifecycleStatus;
  partyNameSnapshot: string | null;
  paymentMethod: string | null;
  priority: AresPriority;
  projectId: string | null;
  projectNameSnapshot: string | null;
  registeredAt: string | null;
  responsibleNameSnapshot: string | null;
  responsibleUserId: string | null;
  resultCenterId: string | null;
  resultCenterNameSnapshot: string | null;
  sourceSystem: string | null;
  title: string;
  nextAction: string | null;
  updatedAt: string;
};

export type CreateAresEntryInput = {
  amount: number | string;
  apoloEntityId?: string | null;
  approvalStatus: AresApprovalStatus;
  bankAccountLabel: string;
  categoryId: string;
  costCenterId: string;
  counterpartyKind: AresCounterpartyKind;
  departmentId: string;
  documentNumber: string;
  dueDate: string;
  entryKind: Extract<AresEntryKind, "payable" | "receivable">;
  financialBaseId: string;
  forecastDate: string;
  nextAction: string;
  notes?: string | null;
  partyName: string;
  paymentMethod: string;
  priority: AresPriority;
  projectId: string;
  responsibleName: string;
  resultCenterId: string;
  sourceSystem: string;
  title: string;
};

export type CreateAresDimensionInput = {
  code?: string | null;
  financialBaseId: string;
  kind: AresDimensionKind;
  name: string;
  parentId?: string | null;
  status?: AresDimensionStatus;
};

export type UpdateAresDimensionInput = {
  id: string;
  parentId?: string | null;
};

export type CreateAresFinancialBaseInput = {
  accentColor?: string | null;
  assignedUserIds?: string[];
  name: string;
  status?: AresFinancialBaseStatus;
};

export type UpdateAresFinancialBaseInput = {
  accentColor?: string | null;
  assignedUserIds?: string[];
  id: string;
  name?: string | null;
  status?: AresFinancialBaseStatus;
};

export type AresBankStatementImport = {
  bankAccountId: string | null;
  id: string;
  importedAt: string;
  lineCount: number;
  matchedCount: number;
  periodEnd: string | null;
  periodStart: string | null;
  sourceType: string;
  status: string;
  unmatchedCount: number;
};

export type AresBankStatementLine = {
  amount: number;
  bankAccountId: string | null;
  description: string;
  documentNumber: string | null;
  id: string;
  matchStatus: "ignored" | "matched" | "review" | "unmatched";
  matchedEntryId: string | null;
  transactionDate: string;
};

export type AresPaymentBatch = {
  batchKind: string;
  entryCount: number;
  id: string;
  scheduledFor: string | null;
  status: string;
  title: string;
  totalAmount: number;
};

export type AresSummary = {
  approvalPendingCount: number;
  bankAccountsCount: number;
  entriesCount: number;
  overdueCount: number;
  payablesOpenAmount: number;
  payablesOpenCount: number;
  receivablesOpenAmount: number;
  receivablesOpenCount: number;
  reconciliationPendingCount: number;
};

export type AresSnapshot = {
  activeFinancialBaseId: string | null;
  assignableUsers: AresAssignableUser[];
  bankAccounts: AresBankAccount[];
  dimensions: AresDimension[];
  entries: AresFinancialEntry[];
  financialBases: AresFinancialBase[];
  generatedAt: string;
  limits: {
    entriesLimit: number;
    entriesLoaded: number;
  };
  paymentBatches: AresPaymentBatch[];
  permissions: {
    canManageSetup: boolean;
    canManage: boolean;
    canView: boolean;
  };
  source: {
    mode: "rls-read";
    schema: "public";
    tables: string[];
  };
  statementImports: AresBankStatementImport[];
  statementLines: AresBankStatementLine[];
  summary: AresSummary;
};
