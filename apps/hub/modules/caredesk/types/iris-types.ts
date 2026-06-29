export type IrisTone = "gold" | "green" | "red" | "blue" | "neutral";

export type IrisPriority = "low" | "medium" | "high" | "critical";

export type IrisStatus =
  | "new"
  | "open"
  | "waiting_customer"
  | "waiting_operator"
  | "pending"
  | "resolved"
  | "closed"
  | "cancelled";

export type IrisMessageDirection = "inbound" | "outbound" | "internal";

export type IrisMessageSenderType =
  | "customer"
  | "operator"
  | "agent"
  | "system";

export type IrisReplyPreview = {
  body: string;
  createdAt?: string | null;
  direction?: IrisMessageDirection | null;
  externalMessageId?: string | null;
  messageId: string;
  senderLabel?: string | null;
};

export type IrisMessageReaction = {
  actorAvatarUrl?: string | null;
  actorLabel?: string | null;
  actorUserId?: string | null;
  createdAt?: string | null;
  emoji: string;
};

export type IrisMessage = {
  audioDurationMs?: number | null;
  audioMimeType?: string | null;
  audioUrl?: string | null;
  body: string;
  createdAt: string;
  deliveryStatus: string;
  direction: IrisMessageDirection;
  editedAt?: string | null;
  externalMessageId?: string | null;
  id: string;
  mediaFileName?: string | null;
  mediaKind?: string | null;
  mediaMimeType?: string | null;
  mediaUrl?: string | null;
  messageType?: string | null;
  operatorAvatarUrl?: string | null;
  readAt?: string | null;
  deliveredAt?: string | null;
  reactions?: IrisMessageReaction[];
  replyTo?: IrisReplyPreview | null;
  senderLabel?: string | null;
  senderType: IrisMessageSenderType;
  sentAt?: string | null;
};

export type IrisCrm360Registration = {
  documentMasked?: string | null;
  entityId?: string;
  entityKind?: string;
  label?: string;
  matchedPhone?: string;
  profileLabel?: string | null;
  profiles?: string[];
  relationLabel?: string | null;
  status: "registered" | "missing" | "unknown";
};

export type IrisTicket = {
  crm360Registration?: IrisCrm360Registration | null;
  assignedToLabel: string;
  channelId?: string | null;
  channelLabel: string;
  contactAvatarUrl?: string | null;
  contactDocument?: string | null;
  contactEmail?: string | null;
  contactId?: string | null;
  contactLabel: string;
  contactPhone?: string | null;
  createdAt: string;
  firstRespondedAt?: string | null;
  firstResponseDueAt?: string | null;
  id: string;
  lastMessageAt?: string | null;
  lastMessagePreview: string;
  metadata?: Record<string, unknown> | null;
  messages: IrisMessage[];
  openedAt: string;
  priority: IrisPriority;
  profileLabel: string;
  protocol: string;
  queueLabel: string;
  queueSlug?: string | null;
  resolutionDueAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  sourceContext?: Record<string, unknown> | null;
  sourceLabel: string;
  status: IrisStatus;
  subject: string;
  unread: boolean;
};

export type IrisQueueConfig = {
  assignmentStrategy: string;
  color: string;
  defaultPriority: IrisPriority;
  id: string;
  name: string;
  routingStrategy: string;
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

export type IrisTicketProfileConfig = {
  category: string;
  description?: string | null;
  id: string;
  name: string;
  priority: IrisPriority;
  queueId?: string | null;
  queueLabel: string;
  requiredFields: string[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

export type IrisTemplate = {
  body?: string | null;
  category: string;
  channelKind: string;
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  slug: string;
  status: string;
  variables?: string[];
};

export type IrisBroadcast = {
  id: string;
  name: string;
  scheduledAt?: string | null;
  status: string;
};

export type IrisChannel = {
  id: string;
  kind: string;
  name: string;
  status: string;
};

export type IrisData = {
  broadcasts: IrisBroadcast[];
  channels: IrisChannel[];
  profiles: IrisTicketProfileConfig[];
  queues: IrisQueueConfig[];
  templates: IrisTemplate[];
  tickets: IrisTicket[];
};

export type IrisSnapshot = {
  aiActions: number;
  averageHandlingTimeLabel: string;
  contacts: number;
  critical: number;
  firstResponseLabel: string;
  followUpsToday: number;
  inbox: number;
  messages: number;
  onlineOperators: number;
  open: number;
  responseTimeLabel: string;
  slaCritical: number;
  topTicket: IrisTicket | null;
  total: number;
  unanswered: number;
  waitingOperator: number;
};

export type IrisApoloClientOption = {
  documentMasked?: string | null;
  firstName: string;
  id: string;
  label: string;
  locationLabel?: string | null;
  phone: string;
  profileLabel: string;
  profiles: string[];
};

export type IrisOrigin = "active" | "passive";

export type IrisApoloContextContact = {
  label?: string | null;
  primary?: boolean;
  status?: string | null;
  type?: string | null;
  value?: string | null;
};

export type IrisApoloContextInstallment = {
  dueDate?: string | null;
  id?: string;
  invoiceUrl?: string | null;
  number?: string;
  paidAt?: string | null;
  paymentUrl?: string | null;
  reference?: string | null;
  status?: string | null;
  value?: string | null;
};

export type IrisApoloContextCommercialLink = {
  contractStatus?: string | null;
  contractUrl?: string | null;
  enterprise?: string | null;
  installments?: IrisApoloContextInstallment[];
  referenceLabel?: string | null;
  role?: string | null;
  stage?: string | null;
  tableValue?: string | null;
  unit?: string | null;
  unitCode?: string | null;
};

export type IrisApoloContextTimelineEvent = {
  date?: string | null;
  description?: string | null;
  status?: "ok" | "attention" | "blocked" | string;
  title?: string | null;
};

export type IrisApoloContextServiceSignal = {
  channel?: string | null;
  lastEvent?: string | null;
  protocol?: string | null;
  status?: string | null;
};

export type IrisApoloContextFinancial = {
  overdueAmount?: string | null;
  overdueInstallments?: number | null;
  paidAmount?: string | null;
  paymentBehavior?: string | null;
  risk?: string | null;
  totalPortfolio?: string | null;
};

export type IrisApoloContextEntity = {
  commercialLinks?: IrisApoloContextCommercialLink[];
  contacts?: IrisApoloContextContact[];
  displayName?: string | null;
  documentMasked?: string | null;
  financial?: IrisApoloContextFinancial | null;
  id: string;
  kind?: string | null;
  locationLabel?: string | null;
  nextAction?: string | null;
  profiles?: string[];
  serviceSignals?: IrisApoloContextServiceSignal[];
  status?: string | null;
  timeline?: IrisApoloContextTimelineEvent[];
};

export type IrisContextModalMode = "client" | "agenda" | null;

export type IrisTicketContextNote = {
  text: string;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
};

export type IrisTicketContextAgendaEvent = {
  createdAt?: string | null;
  createdByLabel?: string | null;
  id: string;
  kind?: string | null;
  notes?: string | null;
  scheduledAt: string;
  status?: string | null;
  title: string;
};

export type IrisAgendaTimelineEntry = {
  createdAt?: string | null;
  createdByLabel?: string | null;
  dateLabel: string;
  dateValue: number;
  description: string;
  id: string;
  kindLabel: string;
  scheduledAt?: string | null;
  source: "apolo" | "ticket";
  title: string;
  tone: "danger" | "gold" | "success";
};

export type IrisInboundNotice = {
  body: string;
  id: string;
  receivedAt: string;
  ticketId: string;
  title: string;
};

export type IrisTemplateFeedbackTone =
  | "error"
  | "neutral"
  | "success"
  | "warning";

export type IrisTemplateFeedback = {
  action?: string | null;
  cause?: string | null;
  message: string;
  metaCode?: string | null;
  metaDetail?: string | null;
  providerMessage?: string | null;
  title?: string | null;
  tone?: IrisTemplateFeedbackTone;
};

export type IrisTemplateHeaderFormat =
  | "DOCUMENT"
  | "IMAGE"
  | "NONE"
  | "VIDEO";

export type IrisTemplateVariable = {
  example: string;
  key: string;
  label: string;
  placeholder: string;
  readiness?: string;
};

export type IrisTemplateForm = {
  bodyText: string;
  buttonsText: string;
  category: string;
  displayName: string;
  headerFileName: string;
  headerFormat: IrisTemplateHeaderFormat;
  headerHandle: string;
  headerMimeType: string;
  headerSendLink: string;
  language: string;
  name: string;
  phoneNumberId: string;
  queueLabel: string;
  subjectLabel: string;
  variables: IrisTemplateVariable[];
};

export type IrisTemplateStatusFilter = {
  id: string;
  label: string;
};

export type IrisTemplateHeaderOption = {
  accept: string;
  description: string;
  id: IrisTemplateHeaderFormat;
  label: string;
};

export type IrisMetaTemplateLibraryPreset = {
  bodyText: string;
  buttonsText: string;
  category: string;
  description: string;
  id: string;
  title: string;
  variableKeys: string[];
};

export type IrisMetaTemplateOption = {
  category?: string | null;
  id?: string | null;
  language?: string | null;
  name?: string | null;
  status?: string | null;
};

export type IrisMetaPhoneNumberOption = {
  codeVerificationStatus?: string | null;
  displayPhoneNumber?: string | null;
  id: string;
  isDefault?: boolean;
  label?: string | null;
  nameStatus?: string | null;
  qualityRating?: string | null;
  verifiedName?: string | null;
  whatsappBusinessAccountId?: string | null;
};

export type IrisMetaPhoneNumberLink = {
  checkStatus?: "checked" | "missing_config" | "unavailable" | string;
  linked?: boolean | null;
  phoneBusinessAccountDetected?: boolean | null;
  phoneCount?: number | null;
  templateBusinessAccountSource?:
    | "configured"
    | "missing_config"
    | "phone"
    | "unavailable"
    | string;
};

export type IrisTemplateSyncSummary = {
  failed?: number;
  imported?: number;
  matched?: number;
  total?: number;
  updated?: number;
};

export type IrisMetaTemplatesResponse = {
  created?: boolean;
  error?: string;
  errorAction?: string | null;
  errorCause?: string | null;
  errorTitle?: string | null;
  ignoredTemplateCount?: number;
  localTemplateSync?: {
    error?: string | null;
    id?: string | null;
    imported?: boolean;
    localStatus?: string | null;
    matched?: boolean;
    metaStatus?: string | null;
    ok?: boolean;
  } | null;
  localTemplateSyncSummary?: IrisTemplateSyncSummary | null;
  metaCode?: string | null;
  metaDetail?: string | null;
  phoneNumberLink?: IrisMetaPhoneNumberLink | null;
  phoneNumbers?: IrisMetaPhoneNumberOption[];
  providerMessage?: string | null;
  selectedPhoneNumberId?: string | null;
  template?: IrisMetaTemplateOption | null;
  templates?: IrisMetaTemplateOption[];
};

export type IrisMetaTemplateMediaUploadResponse = {
  error?: string;
  media?: {
    fileName?: string | null;
    format?: IrisTemplateHeaderFormat | string | null;
    handle?: string | null;
    mimeType?: string | null;
  } | null;
};

export type IrisTemplateArchiveResponse = {
  alreadyArchived?: boolean;
  error?: string;
  linkedTicket?: {
    id?: string | null;
    protocol?: string | null;
    status?: string | null;
  } | null;
};

export type IrisMetaEvent = {
  contactName?: string | null;
  contactWaId?: string | null;
  direction: string;
  id: string;
  messageId?: string | null;
  messageText?: string | null;
  providerEventType: string;
  receivedAt?: string | null;
  signatureValid?: boolean;
  statusDetail?: string | null;
};

export type IrisMetaRef = {
  contactWaId?: string | null;
  createdAt?: string | null;
  deliveryStatus?: string | null;
  direction: string;
  id?: string | null;
  messageId?: string | null;
};

export type IrisMetaEventsSummary = {
  inbound: number;
  refsKnown: number;
  statuses: number;
  total: number;
};

export type IrisMetaEventsResponse = {
  error?: string;
  events?: IrisMetaEvent[];
  refs?: IrisMetaRef[];
  summary?: IrisMetaEventsSummary;
};

export type IrisOptInTemplate = {
  exampleName: string;
  language: string;
  name: string;
};
