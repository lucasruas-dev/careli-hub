import { type NextRequest } from "next/server";

import {
  acknowledgeOperationAlertProtocol,
  ignoreOperationAlertProtocol,
  loadOperationAlertProtocols,
  operationsAlertFeedbackStatuses,
  updateOperationAlertFeedback,
} from "@/lib/operations/alert-protocols";
import type { OperationsAlertFeedbackStatus } from "@/lib/operations/monitoring";
import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(
    Math.max(Number.parseInt(limitParam ?? "40", 10) || 40, 1),
    100,
  );

  try {
    const protocols = await loadOperationAlertProtocols(limit);

    return Response.json(
      { protocols },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: getAlertProtocolApiErrorMessage(
          error,
          "Nao foi possivel carregar protocolos de alertas.",
        ),
      },
      { status: 503 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const payload = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        feedback?: unknown;
        protocol?: unknown;
        status?: unknown;
      }
    | null;
  const protocol = typeof payload?.protocol === "string" ? payload.protocol.trim() : "";
  const action = typeof payload?.action === "string" ? payload.action : "feedback";
  const feedback = typeof payload?.feedback === "string" ? payload.feedback.trim() : "";
  const status = isAlertFeedbackStatus(payload?.status) ? payload.status : null;

  if (!protocol) {
    return Response.json(
      { error: "Informe o protocolo do alerta." },
      { status: 400 },
    );
  }

  if (action === "acknowledge") {
    try {
      const updatedProtocol = await acknowledgeOperationAlertProtocol({
        protocol,
        userId: authorization.userId,
      });

      return Response.json(
        { protocol: updatedProtocol },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (error) {
      return Response.json(
        {
          error: getAlertProtocolApiErrorMessage(
            error,
            "Nao foi possivel confirmar leitura do alerta.",
          ),
        },
        { status: 503 },
      );
    }
  }

  if (action === "ignore") {
    try {
      const updatedProtocol = await ignoreOperationAlertProtocol({
        protocol,
        userId: authorization.userId,
      });

      return Response.json(
        { protocol: updatedProtocol },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (error) {
      return Response.json(
        {
          error: getAlertProtocolApiErrorMessage(
            error,
            "Nao foi possivel ignorar o alerta.",
          ),
        },
        { status: 503 },
      );
    }
  }

  if (!status) {
    return Response.json(
      { error: "Informe o status da devolutiva tecnica." },
      { status: 400 },
    );
  }

  if (!feedback) {
    return Response.json(
      { error: "Informe a devolutiva tecnica do dev." },
      { status: 400 },
    );
  }

  try {
    const updatedProtocol = await updateOperationAlertFeedback({
      feedback,
      protocol,
      status,
      userId: authorization.userId,
    });

    return Response.json(
      { protocol: updatedProtocol },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: getAlertProtocolApiErrorMessage(
          error,
          "Nao foi possivel registrar a devolutiva tecnica.",
        ),
      },
      { status: 503 },
    );
  }
}

function isAlertFeedbackStatus(
  value: unknown,
): value is OperationsAlertFeedbackStatus {
  return (
    typeof value === "string" &&
    operationsAlertFeedbackStatuses.includes(
      value as OperationsAlertFeedbackStatus,
    )
  );
}

function getAlertProtocolApiErrorMessage(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message.trim() ? error.message : fallback;

  if (isMissingAlertProtocolSchemaError(message)) {
    return "Persistencia de protocolos pendente: aplicar a migration 0012_hub_operations_alert_protocols no Supabase real.";
  }

  return message;
}

function isMissingAlertProtocolSchemaError(message: string) {
  const normalizedMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalizedMessage.includes("hub_operations_alert_protocols") &&
    (normalizedMessage.includes("schema cache") ||
      normalizedMessage.includes("could not find the table") ||
      normalizedMessage.includes("tabela"))
  );
}
