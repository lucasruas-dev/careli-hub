export type ApoloProfile =
  | "usuario"
  | "incorporador"
  | "imobiliaria"
  | "corretor"
  | "fornecedor"
  | "parceiro"
  | "colaborador"
  | "acesso_incorporador"
  | "pessoa_fisica"
  | "pessoa_juridica";

export type ApoloEntityStatus =
  | "active"
  | "attention"
  | "blocked"
  | "review";

export type ApoloEntityKind = "pf" | "pj" | "internal" | "organization";

export type ApoloContactPoint = {
  label: string;
  status: "verified" | "pending" | "attention";
  type: "email" | "phone" | "whatsapp";
  value: string;
};

export type ApoloAddress = {
  city: string;
  complement?: string;
  district?: string;
  label: string;
  number?: string;
  postalCode?: string;
  state: string;
  status: "verified" | "pending" | "attention";
  value: string;
};

export type ApoloCommercialLink = {
  acquisitionRequestId?: string;
  area?: string;
  block?: string;
  brokerAgency?: string;
  contractDocumentId?: string;
  contractStatus?: string;
  contractUrl?: string;
  enterprise: string;
  enterpriseCode?: string;
  lot?: string;
  referenceLabel: string;
  role: string;
  stage: string;
  tableValue?: string;
  unit: string;
  unitCode?: string;
  unitId?: string;
};

export type ApoloFinancialSnapshot = {
  overdueAmount: string;
  overdueInstallments: number;
  paidAmount: string;
  paymentBehavior: string;
  risk: "baixo" | "medio" | "alto" | "critico";
  totalPortfolio: string;
};

export type ApoloServiceSignal = {
  channel: string;
  lastEvent: string;
  protocol: string;
  status: string;
};

export type ApoloDocumentSignal = {
  label: string;
  status: "blocked" | "pending_review" | "ready";
  updatedAt: string;
};

export type ApoloRelationship = {
  label: string;
  relation: string;
  status: "verified" | "pending" | "attention";
};

export type ApoloTimelineEvent = {
  date: string;
  description: string;
  status: "ok" | "attention" | "blocked";
  title: string;
};

export type ApoloAuditSignal = {
  field: string;
  status: "mapped" | "pending" | "blocked";
  updatedAt: string;
};

export type ApoloEntity = {
  addresses: ApoloAddress[];
  audit: ApoloAuditSignal[];
  commercialLinks: ApoloCommercialLink[];
  confidenceScore: number;
  contacts: ApoloContactPoint[];
  createdAt: string;
  displayName: string;
  documents: ApoloDocumentSignal[];
  documentMasked: string;
  hadesClientId?: string;
  id: string;
  kind: ApoloEntityKind;
  legalName?: string;
  locationLabel: string;
  nextAction: string;
  profiles: ApoloProfile[];
  relationships: ApoloRelationship[];
  financial: ApoloFinancialSnapshot;
  serviceSignals: ApoloServiceSignal[];
  status: ApoloEntityStatus;
  timeline: ApoloTimelineEvent[];
  tradeName?: string;
  updatedAt: string;
};

export type ApoloProfileSummary = {
  count: number;
  label: string;
  profile: ApoloProfile;
};

export type ApoloDashboardMeta = {
  generatedAt: string;
  message?: string;
  source: "apolo" | "live-c2x" | "unavailable";
  status: "ready" | "sync_pending" | "configuration_pending";
};

export type ApoloDashboardData = {
  buyerUsersCount: number;
  entities: ApoloEntity[];
  linkedUsersCount: number;
  nonBuyerUsersCount: number;
  pendingReviewCount: number;
  portfolioPaymentsCount: number;
  portfolioUnitsCount: number;
  profileSummaries: ApoloProfileSummary[];
  totalCount: number;
  meta: ApoloDashboardMeta;
};
