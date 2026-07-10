export const hubItTicketCategories = [
  "erro",
  "bug",
  "melhoria",
  "sugestao",
  "acesso",
  "performance",
  "outro",
] as const;

export const hubItTicketPriorities = [
  "baixa",
  "media",
  "alta",
  "critica",
] as const;

export const hubItTicketStatuses = [
  "novo",
  "em_analise",
  "em_triagem",
  "em_tratativa",
  "em_execucao",
  "em_homologacao",
  "em_producao",
  "aguardando_cliente",
  "em_revisao",
  "resolvido",
  "fechado",
] as const;

export const hubItTicketDeliveryDecisionStatuses = [
  "pendente",
  "aprovada",
  "reprogramada",
] as const;

export const hubItTicketRoadmapTypes = [
  "melhoria",
  "bug",
  "divida_tecnica",
  "automacao_integracao",
] as const;

export const hubItTicketStatusLabels = {
  aguardando_cliente: "Validacao",
  em_analise: "Em tratativa",
  em_execucao: "Em tratativa",
  em_homologacao: "Validacao",
  em_producao: "Validacao",
  em_revisao: "Revisao",
  em_tratativa: "Em tratativa",
  em_triagem: "Em tratativa",
  fechado: "Finalizado",
  novo: "Novo",
  resolvido: "Validacao",
} as const satisfies Record<HubItTicketStatus, string>;

export const hubItTicketCategoryLabels = {
  acesso: "Acesso",
  bug: "Bug",
  erro: "Erro",
  melhoria: "Melhoria",
  outro: "Outro",
  performance: "Performance",
  sugestao: "Sugestao",
} as const satisfies Record<HubItTicketCategory, string>;

export const hubItTicketPriorityLabels = {
  alta: "Alta",
  baixa: "Baixa",
  critica: "Critica",
  media: "Media",
} as const satisfies Record<HubItTicketPriority, string>;

export const hubItTicketRoadmapTypeLabels = {
  automacao_integracao: "Automacao / integracao",
  bug: "Bug",
  divida_tecnica: "Divida tecnica",
  melhoria: "Melhoria",
} as const satisfies Record<HubItTicketRoadmapType, string>;

export type HubItTicketCategory = (typeof hubItTicketCategories)[number];
export type HubItTicketPriority = (typeof hubItTicketPriorities)[number];
export type HubItTicketStatus = (typeof hubItTicketStatuses)[number];
export type HubItTicketDeliveryDecisionStatus =
  (typeof hubItTicketDeliveryDecisionStatuses)[number];
export type HubItTicketRoadmapType =
  (typeof hubItTicketRoadmapTypes)[number];

export type HubItTicketDeliveryDecisionAction =
  | "approve_requested"
  | "reject_with_new_date";

export type HubItTicketRequester = {
  avatarUrl?: string | null;
  email?: string | null;
  id: string;
  name: string;
};

export type HubItTicketUserRef = HubItTicketRequester;

export type HubItTicketRoadmap = {
  active: boolean;
  createdAt?: string | null;
  createdBy?: HubItTicketUserRef | null;
  module: string;
  note?: string | null;
  priority: HubItTicketPriority;
  screen: string;
  type: HubItTicketRoadmapType;
  updatedAt?: string | null;
  updatedBy?: HubItTicketUserRef | null;
};

export type HubItTicketAttachment = {
  capturedAt: string;
  // LEGADO: base64 inline. Só sobrevive nos anexos anteriores ao Storage.
  dataUrl?: string | null;
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
  // Caminho no bucket privado. Tem precedência sobre `dataUrl`.
  storagePath?: string | null;
  type: "audio" | "image" | "video" | "file";
  // URL assinada, gerada na leitura. Nunca persistida.
  url?: string | null;
};

export type HubItTicketAttachmentInput = Omit<
  HubItTicketAttachment,
  "id" | "url"
> & {
  // Amostras reduzidas SÓ para a IA analisar. Não são armazenadas.
  analysisDataUrls?: string[];
};

export type HubItTicketEvent = {
  actor?: HubItTicketUserRef | null;
  createdAt: string;
  id: string;
  message: string;
  type:
    | "created"
    | "triaged"
    | "status_changed"
    | "admin_reply"
    | "resolved"
    | "closed"
    | "attachment_added"
    | "review_requested"
    | "user_comment";
  visibleToRequester: boolean;
};

export type HubItTicket = {
  actualResult?: string | null;
  adminResponse?: string | null;
  approvedDeliveryDate?: string | null;
  assignedTo?: HubItTicketUserRef | null;
  assignedToUserId?: string | null;
  attachments: HubItTicketAttachment[];
  category: HubItTicketCategory;
  createdAt: string;
  deliveryDecisionAt?: string | null;
  deliveryDecisionBy?: HubItTicketUserRef | null;
  deliveryDecisionNote?: string | null;
  deliveryDecisionStatus?: HubItTicketDeliveryDecisionStatus;
  events: HubItTicketEvent[];
  expectedResult?: string | null;
  id: string;
  module: string;
  priority: HubItTicketPriority;
  protocol: string;
  requester: HubItTicketRequester;
  lastResponseBy?: HubItTicketUserRef | null;
  requestedDeliveryDate?: string | null;
  resolutionSummary?: string | null;
  resolvedAt?: string | null;
  roadmap?: HubItTicketRoadmap | null;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  status: HubItTicketStatus;
  technicalSummary: string;
  title: string;
  updatedAt: string;
  userDescription: string;
};

export type HubItTicketBacklogInput = {
  module: string;
  note?: string;
  priority: HubItTicketPriority;
  screen: string;
  type: HubItTicketRoadmapType;
};

export type HubItTicketCreateInput = {
  actualResult?: string;
  attachments?: HubItTicketAttachmentInput[];
  category: HubItTicketCategory;
  expectedResult?: string;
  module: string;
  priority: HubItTicketPriority;
  requestedDeliveryDate: string;
  sourcePath?: string;
  sourceUrl?: string;
  technicalSummary: string;
  title: string;
  userDescription: string;
};

export type HubItTicketEvidenceAnalysisInput = {
  attachments: HubItTicketAttachmentInput[];
  category: HubItTicketCategory;
  module: string;
  pathname: string;
  priority: HubItTicketPriority;
  userDescription: string;
};

export type HubItTicketEvidenceAnalysis = {
  actualResult?: string;
  evidenceInsights: string[];
  expectedResult?: string;
  source: "claude" | "fallback" | "openai";
  technicalSummary: string;
};

export type HubItTicketUpdateInput = {
  action?:
    | "admin_reply"
    | "customer_close"
    | "customer_comment"
    | "customer_review";
  adminResponse?: string;
  attachments?: HubItTicketAttachmentInput[];
  customerResponse?: string;
  approvedDeliveryDate?: string;
  backlog?: HubItTicketBacklogInput;
  deliveryDecision?: HubItTicketDeliveryDecisionAction;
  deliveryDecisionNote?: string;
  protocol: string;
  resolutionSummary?: string;
  status?: HubItTicketStatus;
};

export type HubItTicketListScope = "all" | "mine";
