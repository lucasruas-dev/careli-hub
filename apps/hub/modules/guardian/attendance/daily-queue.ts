import type {
  OperationalTimelineEvent,
  QueueClient,
  WorkflowStage,
} from "@/modules/guardian/attendance/types";

type ManualEventsByClient = Record<
  string,
  {
    events: OperationalTimelineEvent[];
  }
>;

export type QueueMode = "daily" | "general";

export function isDailyQueueClient(client: QueueClient) {
  if (client.atrasoDias < 3) {
    return false;
  }

  const stage = normalizeDailyWorkflowStage(client.workflow.stage);

  return stage !== "Promessa de pagamento" && stage !== "Acordo";
}

export function buildTodayContactClientIds({
  manualOperationsByClient,
  sourceClients,
  timelineEventsByClient,
}: {
  manualOperationsByClient: ManualEventsByClient;
  sourceClients: QueueClient[];
  timelineEventsByClient: Record<string, OperationalTimelineEvent[]>;
}) {
  const ids = new Set<string>();

  sourceClients.forEach((client) => {
    const events = [
      ...(client.timeline ?? []),
      ...(client.workflow.history ?? []),
      ...(timelineEventsByClient[client.id] ?? []),
      ...(manualOperationsByClient[client.id]?.events ?? []),
    ];

    if (events.some(hasTodayContactEvidence)) {
      ids.add(client.id);
    }
  });

  return ids;
}

function normalizeDailyWorkflowStage(stage: WorkflowStage) {
  if (stage === "Promessa realizada" || stage === "Aguardando pagamento") {
    return "Promessa de pagamento";
  }

  if (stage === "Pago") {
    return "Acordo";
  }

  return stage;
}

function hasTodayContactEvidence(event: unknown) {
  const record = event as {
    changedAt?: string;
    occurredAt?: string;
    status?: string;
    type?: string;
  };
  const type = String(record.type ?? "").toLowerCase();
  const status = String(record.status ?? "").toLowerCase();

  if (
    ![
      "ligação realizada",
      "whatsapp enviado",
      "promessa de pagamento",
      "acordo gerado",
      "observação operacional",
    ].some((needle) => type.includes(needle)) &&
    !["realizado", "enviado", "prometido", "gerado", "registrado"].some(
      (needle) => status.includes(needle),
    )
  ) {
    return false;
  }

  return isTodayDateLike(record.occurredAt ?? record.changedAt);
}

function isTodayDateLike(value?: string | null) {
  if (!value) {
    return false;
  }

  const today = new Date();
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

  if (match) {
    return (
      Number(match[1]) === today.getDate() &&
      Number(match[2]) === today.getMonth() + 1 &&
      Number(match[3]) === today.getFullYear()
    );
  }

  const parsed = new Date(value);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getDate() === today.getDate() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getFullYear() === today.getFullYear()
  );
}
