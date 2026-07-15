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
  installments?: ApoloInstallment[];
  lot?: string;
  referenceLabel: string;
  role: string;
  stage: string;
  tableValue?: string;
  unit: string;
  unitCode?: string;
  unitId?: string;
};

export type ApoloInstallment = {
  acquisitionRequestId: string;
  asaasPaymentId?: string;
  dueDate: string;
  id: string;
  invoiceUrl?: string;
  number: string;
  overdueDays: number;
  paidAt?: string;
  paymentUrl?: string;
  reference: string;
  status: "A vencer" | "Liquidada" | "Vencida";
  value: string;
  valueNumber: number;
};

export type ApoloFinancialSnapshot = {
  overdueAmount: string;
  overdueInstallments: number;
  paidAmount: string;
  paymentBehavior: string;
  risk: "baixo" | "medio" | "alto" | "critico";
  totalPortfolio: string;
};

// Ficha cadastral vinda AO VIVO do C2X (enricher read-only). Valores já resolvidos
// (lookups de sexo/estado civil/regime/profissão/etc.) e datas em DD/MM/AAAA.
export type ApoloC2xCadastro = {
  age: string | null;
  birthday: string | null;
  city: string | null;
  civilState: string | null;
  cnpj: string | null;
  complement: string | null;
  cpf: string | null;
  creciNumber: string | null;
  creciValidate: string | null;
  district: string | null;
  fantasyName: string | null;
  isCompany: boolean;
  motherName: string | null;
  municipalInscription: string | null;
  nacionality: string | null;
  naturalness: string | null;
  nire: string | null;
  number: string | null;
  openCompanyDate: string | null;
  profession: string | null;
  propertyRegime: string | null;
  rg: string | null;
  salaryRange: string | null;
  schooling: string | null;
  sex: string | null;
  socialContractUpdatedAt: string | null;
  socialName: string | null;
  spouse: ApoloC2xSpouse | null;
  state: string | null;
  street: string | null;
  zipcode: string | null;
};

// Cônjuge (tabela `spouses` do C2X). Além de aparecer no cadastro, o cônjuge
// vira um relacionamento de "contato" na aba Relacionamentos.
export type ApoloC2xSpouse = {
  birthday: string | null;
  cpf: string | null;
  document: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  profession: string | null;
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
  // Padrão do relacionamento: nome (label) · telefone · e-mail · nível (relation).
  phone?: string | null;
  email?: string | null;
  // Quando o relacionamento é uma entidade Apolo, o card é clicável e leva pro cadastro.
  entityId?: string | null;
  // "trabalho" (edge) ou "contato" (pessoa leve). Preenchido no que é criado no Apolo;
  // no que vem do sync/C2X fica vazio e a classificação sai do texto do nível.
  kind?: "trabalho" | "contato" | null;
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
  // Ficha cadastral ao vivo do C2X (enricher); ausente quando não pôde carregar.
  c2xCadastro?: ApoloC2xCadastro;
  commercialLinks: ApoloCommercialLink[];
  confidenceScore: number;
  contacts: ApoloContactPoint[];
  createdAt: string;
  displayName: string;
  documents: ApoloDocumentSignal[];
  documentMasked: string;
  hadesClientId?: string;
  // True quando o cliente está na CARTEIRA do C2X (faturado vigente com pagamento) —
  // a definição oficial de Comprador. Setado no loader; ausente = usar heurística.
  isBuyer?: boolean;
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
