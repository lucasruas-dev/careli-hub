import { type NextRequest } from "next/server";

import {
  backfillHubItTicketAttachments,
  type HubItTicketAttachmentBackfillMode,
} from "@/lib/hub-it-tickets/attachment-backfill";
import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sobe arquivo por arquivo; um lote precisa de folga.
export const maxDuration = 300;

// Migra os anexos legados (base64 no Postgres) pro Storage. Roda aqui dentro
// porque a chave de servico ja existe no ambiente: nenhuma credencial precisa
// ser copiada pra maquina de ninguem. Restrito a admin.
export async function POST(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request, {
    adminOnly: true,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      batchSize?: unknown;
      mode?: unknown;
    } | null;
    const result = await backfillHubItTicketAttachments({
      batchSize:
        typeof body?.batchSize === "number" ? body.batchSize : undefined,
      mode: normalizeMode(body?.mode),
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel migrar os anexos.",
      },
      { status: 500 },
    );
  }
}

// Default seguro: sem `mode` explicito ninguem escreve nada.
function normalizeMode(value: unknown): HubItTicketAttachmentBackfillMode {
  if (value === "apply" || value === "purge") {
    return value;
  }

  return "dry-run";
}
