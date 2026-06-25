const EMPTY_FIELD = "-";

const IRIS_OPT_IN_TEMPLATE = {
  language: "pt_BR",
  name: "iris_opt_in_teste_v1",
};

export type IrisTicketPriority = "low" | "medium" | "high" | "critical";

export type IrisTicketProfileOption = {
  category: string;
  description?: string | null;
  id: string;
  name: string;
  priority: IrisTicketPriority;
  queueId?: string | null;
  queueLabel?: string | null;
  requiredFields: string[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

export type IrisTicketChannelOption = {
  id: string;
  kind?: string | null;
  name: string;
  provider?: string | null;
  slug?: string | null;
  status: string;
};

export type IrisTicketQueueOption = {
  defaultPriority: IrisTicketPriority;
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type IrisTicketTemplateOption = {
  body?: string | null;
  category?: string | null;
  id: string;
  language: string;
  metaStatus: string;
  name: string;
  slug?: string | null;
  templateName: string;
};

export type IrisTicketOptions = {
  channels: IrisTicketChannelOption[];
  operator: {
    avatarUrl?: string | null;
    label: string;
  };
  profiles: IrisTicketProfileOption[];
  queues: IrisTicketQueueOption[];
  templates: IrisTicketTemplateOption[];
};

export function mapIrisTicketOptions(payload: unknown): IrisTicketOptions {
  const payloadRecord = toRecord(payload);
  const rawQueues = Array.isArray(payloadRecord.queues)
    ? payloadRecord.queues
    : [];
  const queues: IrisTicketQueueOption[] = rawQueues.map(
    (queue): IrisTicketQueueOption => {
      const record = toRecord(queue);

      return {
        defaultPriority: normalizeIrisPriority(record.default_priority),
        id: String(record.id ?? ""),
        name: String(record.name ?? "Iris"),
        slug: String(record.slug ?? ""),
        status: String(record.status ?? "active"),
      };
    },
  );
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));
  const rawChannels = Array.isArray(payloadRecord.channels)
    ? payloadRecord.channels
    : [];
  const channels: IrisTicketChannelOption[] = rawChannels.map(
    (channel): IrisTicketChannelOption => {
      const record = toRecord(channel);

      return {
        id: String(record.id ?? ""),
        kind: optionalPayloadString(record.kind),
        name: String(record.name ?? "WhatsApp Iris"),
        provider: optionalPayloadString(record.provider),
        slug: optionalPayloadString(record.slug),
        status: String(record.status ?? "active"),
      };
    },
  );
  const rawProfiles = Array.isArray(payloadRecord.profiles)
    ? payloadRecord.profiles
    : [];
  const profiles: IrisTicketProfileOption[] = rawProfiles.map(
    (profile): IrisTicketProfileOption => {
      const record = toRecord(profile);
      const queue = record.queue_id
        ? queueById.get(String(record.queue_id))
          : null;

      return {
        category: String(record.category ?? "Atendimento"),
        description:
          typeof record.description === "string" ? record.description : null,
        id: String(record.id ?? ""),
        name: String(record.name ?? "Assunto Iris"),
        priority: normalizeIrisPriority(record.priority),
        queueId: record.queue_id ? String(record.queue_id) : null,
        queueLabel: queue?.name ?? null,
        requiredFields: normalizeRequiredFields(record.required_fields),
        slaFirstResponseMinutes: Number(
          record.sla_first_response_minutes ?? 60,
        ),
        slaResolutionMinutes: Number(record.sla_resolution_minutes ?? 480),
        slug: String(record.slug ?? ""),
        status: String(record.status ?? "active"),
      };
    },
  );
  const rawTemplates = Array.isArray(payloadRecord.templates)
    ? payloadRecord.templates
    : [];
  const templates: IrisTicketTemplateOption[] = rawTemplates.map(
    (template): IrisTicketTemplateOption => {
      const record = toRecord(template);

      return {
        body: typeof record.body === "string" ? record.body : null,
        category: optionalPayloadString(record.category),
        id: String(record.id ?? ""),
        language: String(record.language ?? IRIS_OPT_IN_TEMPLATE.language),
        metaStatus: String(record.metaStatus ?? "APPROVED"),
        name: String(record.name ?? "Template Iris"),
        slug: optionalPayloadString(record.slug),
        templateName: String(
          record.templateName ?? record.slug ?? IRIS_OPT_IN_TEMPLATE.name,
        ),
      };
    },
  );
  const operator = toRecord(payloadRecord.operator);

  return {
    channels: channels.filter((channel) => channel.id),
    operator: {
      avatarUrl: optionalPayloadString(operator.avatarUrl),
      label: String(operator.label ?? EMPTY_FIELD),
    },
    profiles: profiles.filter((profile) => profile.id),
    queues: queues.filter((queue) => queue.id),
    templates: templates.filter((template) => template.id),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function optionalPayloadString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

export function findPreferredQueueId(
  queues: IrisTicketQueueOption[],
  profiles: IrisTicketProfileOption[],
) {
  const queue =
    queues.find((item) => isCollectionText(item.slug)) ??
    queues.find((item) => isCollectionText(item.name)) ??
    null;

  if (queue?.id) return queue.id;

  return (
    profiles.find((profile) => isCollectionText(profile.category))?.queueId ??
    null
  );
}

export function findDefaultProfileId(
  profiles: IrisTicketProfileOption[],
  queueId?: string | null,
) {
  const scopedProfiles = queueId
    ? profiles.filter((profile) => profile.queueId === queueId)
    : profiles;

  return (
    scopedProfiles.find((profile) => profile.slug === "cobranca")?.id ??
    scopedProfiles.find((profile) => isCollectionText(profile.name))?.id ??
    scopedProfiles[0]?.id ??
    null
  );
}

export function mapIrisPriority(priority: IrisTicketPriority) {
  if (priority === "critical") return "Crítica";
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baixa";
  return "Média";
}

export function requiresIrisUnit(
  profile?: IrisTicketProfileOption | null,
) {
  if (!profile) return false;

  return (
    profile.requiredFields.includes("source_entity_id") ||
    [
      "enviar-boleto-c2x",
      "negociacao",
      "formalizacao-acordo",
      "duvida-contratual",
    ].includes(profile.slug)
  );
}

export function requiresIrisInstallment(
  profile?: IrisTicketProfileOption | null,
) {
  if (!profile) return false;

  return [
    "cobranca",
    "enviar-boleto-c2x",
    "negociacao",
    "promessa-pagamento",
    "formalizacao-acordo",
    "quebra-promessa",
  ].includes(profile.slug);
}

export function createsIrisSla(profile?: IrisTicketProfileOption | null) {
  return Boolean(profile && profile.slaFirstResponseMinutes > 0);
}

export function formatSlaMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "Sem SLA";
  if (minutes < 60) return `${minutes} min`;

  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} horas` : `${minutes} min`;
}

export function templateStatusLabel(status?: string | null) {
  if (!status) return "Nao localizado";
  if (status === "APPROVED") return "Aprovado";
  if (status === "PENDING") return "Pendente";
  if (status === "REJECTED") return "Rejeitado";
  if (status === "PAUSED") return "Pausado";
  return status;
}

function normalizeRequiredFields(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeRequiredFields(parsed);
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeIrisPriority(value: unknown): IrisTicketPriority {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }

  return "medium";
}

function isCollectionText(value?: string | null) {
  const normalized = normalizeOptionText(value);

  return normalized.includes("cobranca");
}

function normalizeOptionText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
