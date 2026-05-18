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

export const hubItTicketStatusLabels = {
  aguardando_cliente: "Aguardando cliente",
  em_analise: "Em analise",
  em_execucao: "Em execucao",
  em_homologacao: "Em homologacao",
  em_producao: "Em producao",
  em_revisao: "Em revisao",
  em_tratativa: "Em tratativa",
  em_triagem: "Em triagem",
  fechado: "Fechado",
  novo: "Novo",
  resolvido: "Resolvido",
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

export type HubItTicketCategory = (typeof hubItTicketCategories)[number];
export type HubItTicketPriority = (typeof hubItTicketPriorities)[number];
export type HubItTicketStatus = (typeof hubItTicketStatuses)[number];

export type HubItTicketRequester = {
  avatarUrl?: string | null;
  email?: string | null;
  id: string;
  name: string;
};

export type HubItTicketUserRef = HubItTicketRequester;

export type HubItTicketAttachment = {
  capturedAt: string;
  dataUrl?: string | null;
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
  type: "audio" | "image" | "video" | "file";
};

export type HubItTicketAttachmentInput = Omit<HubItTicketAttachment, "id"> & {
  analysisDataUrls?: string[];
};

export type HubItTicketEvent = {
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
  assignedTo?: HubItTicketUserRef | null;
  assignedToUserId?: string | null;
  attachments: HubItTicketAttachment[];
  category: HubItTicketCategory;
  createdAt: string;
  events: HubItTicketEvent[];
  expectedResult?: string | null;
  id: string;
  module: string;
  priority: HubItTicketPriority;
  protocol: string;
  requester: HubItTicketRequester;
  lastResponseBy?: HubItTicketUserRef | null;
  resolutionSummary?: string | null;
  resolvedAt?: string | null;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  status: HubItTicketStatus;
  technicalSummary: string;
  title: string;
  updatedAt: string;
  userDescription: string;
};

export type HubItTicketCreateInput = {
  actualResult?: string;
  attachments?: HubItTicketAttachmentInput[];
  category: HubItTicketCategory;
  expectedResult?: string;
  module: string;
  priority: HubItTicketPriority;
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
  source: "fallback" | "openai";
  technicalSummary: string;
};

export type HubItTicketUpdateInput = {
  action?: "admin_reply" | "customer_close" | "customer_review";
  adminResponse?: string;
  attachments?: HubItTicketAttachmentInput[];
  customerResponse?: string;
  protocol: string;
  resolutionSummary?: string;
  status?: HubItTicketStatus;
};

export type HubItTicketListScope = "all" | "mine";
