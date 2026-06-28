import { NextResponse, type NextRequest } from "next/server";

import {
  authorizeHadesRead,
  authorizeHadesWrite,
  type HadesAuthUser,
} from "@/lib/guardian/auth";
import {
  createGuardianCompromisso,
  createGuardianMotorClient,
  listGuardianCompromissosByClient,
  type CreateCompromissoInput,
  type CreateParcelaInput,
  type GuardianCompromissoDetail,
  type GuardianCompromissoKind,
  type GuardianCompromissoPriority,
} from "@/lib/guardian/compromissos";
import { createSupabaseAdminClient } from "@/lib/guardian/read-model-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIORITIES: GuardianCompromissoPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export async function GET(request: NextRequest) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const clientC2xId = parseClientC2xId(
    request.nextUrl.searchParams.get("clientId") ??
      request.nextUrl.searchParams.get("clientC2xId"),
  );

  if (!clientC2xId) {
    return NextResponse.json(
      { error: "Cliente nao informado." },
      { status: 400 },
    );
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para acessar a cobranca." },
      { status: 503 },
    );
  }

  const compromissos = await listGuardianCompromissosByClient(
    client,
    clientC2xId,
  );

  return NextResponse.json({ data: compromissos });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const parsed = parseCreatePayload(await request.json().catch(() => null));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para registrar a cobranca." },
      { status: 503 },
    );
  }

  // Denormaliza quem enviou (a Central do gestor mostra "enviado por" sem join).
  const inputWithAuthor: typeof parsed.input = {
    ...parsed.input,
    metadata: {
      ...(parsed.input.metadata ?? {}),
      submitted_by_name: operatorName(auth.user),
    },
  };

  const result = await createGuardianCompromisso(
    client,
    inputWithAuthor,
    auth.user.id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Timeline humana (best-effort): o motor e a fonte estruturada, mas o operador
  // le a linha do tempo do cliente. Espelha o evento manual existente.
  await emitCompromissoTimelineNote({
    clientId: parsed.clientId,
    clientName: parsed.clientName,
    compromisso: result.compromisso,
    user: auth.user,
  });

  return NextResponse.json({ data: result.compromisso }, { status: 201 });
}

export function parseCreatePayload(input: unknown):
  | {
      clientId: string | null;
      clientName: string | null;
      input: CreateCompromissoInput;
      ok: true;
    }
  | { error: string; ok: false } {
  if (!input || typeof input !== "object") {
    return { error: "Payload ausente.", ok: false };
  }

  const payload = input as Record<string, unknown>;
  const kind = payload.kind;

  if (kind !== "promessa" && kind !== "acordo") {
    return { error: "Tipo de compromisso invalido.", ok: false };
  }

  const clientRecord = recordFrom(payload.client);
  const clientC2xId =
    numberFrom(payload.clientC2xId) ??
    numberFrom(clientRecord?.c2xId) ??
    parseClientC2xId(stringFrom(clientRecord?.id));

  if (!clientC2xId) {
    return { error: "Cliente do C2X nao informado.", ok: false };
  }

  const rawParcelas = Array.isArray(payload.parcelas) ? payload.parcelas : [];
  const parcelas: CreateParcelaInput[] = rawParcelas
    .map((item, index): CreateParcelaInput | null => {
      const record = recordFrom(item);

      if (!record) {
        return null;
      }

      const dueDate = stringFrom(record.dueDate);
      const amount = numberFrom(record.amount);

      if (!dueDate || amount === null) {
        return null;
      }

      return {
        amount,
        boletoUrl: stringFrom(record.boletoUrl),
        dueDate,
        metadata: recordFrom(record.metadata) ?? undefined,
        paymentC2xId: numberFrom(record.paymentC2xId),
        sequence: numberFrom(record.sequence) ?? index + 1,
      };
    })
    .filter((parcela): parcela is CreateParcelaInput => parcela !== null);

  if (parcelas.length === 0) {
    return {
      error: "Informe ao menos uma parcela com vencimento e valor.",
      ok: false,
    };
  }

  const priorityRaw = stringFrom(payload.priority);
  const priority = PRIORITIES.includes(priorityRaw as GuardianCompromissoPriority)
    ? (priorityRaw as GuardianCompromissoPriority)
    : null;

  const compromissoInput: CreateCompromissoInput = {
    acquisitionRequestC2xId: numberFrom(payload.acquisitionRequestC2xId),
    attendanceProtocol: stringFrom(payload.attendanceProtocol),
    channel: stringFrom(payload.channel) ?? undefined,
    clientC2xId,
    cobrancaProtocol: stringFrom(payload.cobrancaProtocol),
    firstDueDate: stringFrom(payload.firstDueDate),
    kind: kind as GuardianCompromissoKind,
    metadata: recordFrom(payload.metadata) ?? undefined,
    notes: stringFrom(payload.notes),
    parcelas,
    priority,
    promisedDate: stringFrom(payload.promisedDate),
    riskScore: numberFrom(payload.riskScore),
  };

  return {
    clientId: stringFrom(clientRecord?.id),
    clientName: stringFrom(clientRecord?.name),
    input: compromissoInput,
    ok: true,
  };
}

async function emitCompromissoTimelineNote({
  clientId,
  clientName,
  compromisso,
  user,
}: {
  clientId: string | null;
  clientName: string | null;
  compromisso: GuardianCompromissoDetail;
  user: HadesAuthUser;
}) {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return;
  }

  const operator = operatorName(user);
  const isAcordo = compromisso.kind === "acordo";
  const occurredAt = new Date().toISOString();
  const commitment = {
    firstDueDate: compromisso.firstDueDate,
    installmentsCount: compromisso.installmentsCount,
    note: compromisso.notes ?? "",
    operator,
    promisedDate: compromisso.promisedDate,
    protocol: compromisso.protocol,
    source: "guardian-motor",
    timelineStatus: isAcordo ? "Gerado" : "Prometido",
    timelineType: isAcordo ? "Acordo gerado" : "Promessa de pagamento",
    title: isAcordo ? "Acordo registrado" : "Promessa registrada",
    totalAmount: compromisso.totalAmount,
    type: isAcordo ? "Acordo" : "Promessa de pagamento",
  };

  try {
    await adminClient.from("caredesk_ticket_events").insert({
      actor_type: "user",
      actor_user_id: user.id,
      description: compromisso.notes ?? null,
      event_type: "guardian_manual_commitment",
      metadata: {
        client_id: clientId ?? `c2x-client-${compromisso.clientC2xId}`,
        client_name: clientName ?? undefined,
        commitment,
        compromisso_id: compromisso.id,
        history: [
          {
            action: "Registro do motor",
            actorName: operator,
            actorUserId: user.id,
            occurredAt,
            protocol: compromisso.protocol,
          },
        ],
        kind: "commitment",
        protocol: compromisso.protocol,
        source_module: "guardian",
      },
      title: commitment.title,
    });
  } catch {
    // Nota de timeline e auxiliar; o compromisso ja esta gravado no motor.
  }
}

function operatorName(user: HadesAuthUser) {
  return user.displayName?.trim() || user.email?.trim() || "Operador Hades";
}

function parseClientC2xId(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+)/g);

  if (!match) {
    return null;
  }

  const parsed = Number(match[match.length - 1]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
