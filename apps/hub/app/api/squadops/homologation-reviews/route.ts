import { type NextRequest } from "next/server";

import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import {
  buildHomologationReviewState,
  isHomologationReviewStatus,
  isHomologationSchemaMissingError,
  loadSquadOpsHomologationReviews,
  upsertSquadOpsHomologationReview,
  type HomologationReviewItemKind,
} from "@/lib/squadops/homologation-reviews";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const reviews = await loadSquadOpsHomologationReviews();

    return Response.json(
      {
        reviews,
        state: buildHomologationReviewState(reviews),
        status: "sincronizado",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: getHomologationApiErrorMessage(error),
        reviews: [],
        state: {},
        status: "indisponivel",
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
        itemKind?: unknown;
        itemProtocol?: unknown;
        itemTitle?: unknown;
        itemType?: unknown;
        module?: unknown;
        note?: unknown;
        releaseProtocol?: unknown;
        status?: unknown;
      }
    | null;

  const releaseProtocol =
    typeof payload?.releaseProtocol === "string"
      ? payload.releaseProtocol.trim()
      : "";
  const itemProtocol =
    typeof payload?.itemProtocol === "string" ? payload.itemProtocol.trim() : "";
  const status = isHomologationReviewStatus(payload?.status)
    ? payload.status
    : null;

  if (!releaseProtocol || !itemProtocol) {
    return Response.json(
      { error: "Informe o DP e o protocolo do item homologado." },
      { status: 400 },
    );
  }

  if (!status) {
    return Response.json(
      { error: "Informe um status valido para homologacao." },
      { status: 400 },
    );
  }

  try {
    const review = await upsertSquadOpsHomologationReview({
      input: {
        itemKind: parseItemKind(payload?.itemKind),
        itemProtocol,
        itemTitle:
          typeof payload?.itemTitle === "string"
            ? payload.itemTitle
            : "nao informado",
        itemType:
          typeof payload?.itemType === "string"
            ? payload.itemType
            : "nao informado",
        module:
          typeof payload?.module === "string" ? payload.module : "nao informado",
        note: typeof payload?.note === "string" ? payload.note : "",
        releaseProtocol,
        status,
      },
      userId: authorization.userId,
    });

    return Response.json(
      {
        review,
        status: "sincronizado",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: getHomologationApiErrorMessage(error),
        status: "indisponivel",
      },
      { status: 503 },
    );
  }
}

function parseItemKind(value: unknown): HomologationReviewItemKind {
  return value === "alerta" ||
    value === "atividade" ||
    value === "deploy" ||
    value === "ticket"
    ? value
    : "atividade";
}

function getHomologationApiErrorMessage(error: unknown) {
  if (isHomologationSchemaMissingError(error)) {
    return "Persistencia de homologacao pendente: aplicar a migration 0021_squadops_center_persistence no Supabase real.";
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : "Nao foi possivel sincronizar homologacao SquadOps.";
}
