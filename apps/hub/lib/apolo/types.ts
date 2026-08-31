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
  | "pessoa_juridica"
  // Papel de nascimento de quem quer adquirir uma unidade (cadastro pelo formulário).
  // Acumula com os outros: um corretor que resolve comprar vira "corretor + prospect".
  | "prospect";

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
  // Porte da empresa como TEXTO ("ME", "EPP", "MEI"...), do jeito que o enriquecimento devolve.
  // Vira `company_size_id` no envio ao C2X (só PJ). Nulo em PF.
  companySize: string | null;
  complement: string | null;
  cpf: string | null;
  creciNumber: string | null;
  creciValidate: string | null;
  district: string | null;
  fantasyName: string | null;
  isCompany: boolean;
  // Quem assina pela empresa (sócio com `representanteLegal`). Numa PJ é ELE que vai em
  // `signers_attributes`, não o cônjuge — a PJ não tem cônjuge. Nulo em PF.
  legalRepresentative: ApoloC2xRepresentante | null;
  motherName: string | null;
  municipalInscription: string | null;
  nacionality: string | null;
  naturalness: string | null;
  nire: string | null;
  number: string | null;
  openCompanyDate: string | null;
  profession: string | null;
  // A profissão que o cliente DECLAROU no cadastro quando não a achou entre as 234 do C2X. É texto
  // livre e vive SÓ no Apolo: `profession` continua sendo o rótulo do catálogo (o legado guarda uma
  // FK). Existe para a ficha do CRM 360 não engolir o dado — sem ela, quem abria a aba Cadastro via
  // "—" e um select vazio, sem sinal de que o cliente tinha declarado alguma coisa.
  // OPCIONAL: quem monta payload para o C2X não preenche nem lê este campo.
  professionDeclared?: null | string;
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

// Representante legal da PJ: o sócio que assina pela empresa. Vive em
// `metadata.cadastro.socios[]` (o que a etapa Sócios do wizard salvou) e, como reserva, no
// relacionamento 'representante_legal' — que sobrevive ao sync do C2X, o metadata não.
// Guarda só o que o contrato precisa: nome, CPF, e-mail e profissão.
export type ApoloC2xRepresentante = {
  cpf: string | null;
  email: string | null;
  name: string | null;
  profession: string | null;
};

// Cônjuge (tabela `spouses` do C2X). Além de aparecer no cadastro, o cônjuge
// vira um relacionamento de "contato" na aba Relacionamentos.
export type ApoloC2xSpouse = {
  birthday: string | null;
  cpf: string | null;
  document: string | null;
  email: string | null;
  name: string | null;
  // ⚠️ O CÔNJUGE ASSINA A ESCRITURA, e o contrato o qualifica igual ao titular: nome,
  // nacionalidade, profissão, CPF. Estes dois campos faltavam aqui enquanto `spouses.nacionality`
  // e `spouses.profession_id` já existiam no C2X — 11 cônjuges do Villa Paris subiram sem eles,
  // 5 em contratos já gerados.
  nationality: string | null;
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
  // Comprador vinculado: true = inadimplente (parcela vencida), false = adimplente.
  overdue?: boolean | null;
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
