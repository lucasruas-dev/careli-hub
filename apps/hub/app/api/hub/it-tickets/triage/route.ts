import { type NextRequest } from "next/server";

import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";
import { runHubItTicketTriage } from "@/lib/hub-it-tickets/triage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A chamada de IA pode levar alguns segundos.
export const maxDuration = 60;

// Triagem do Nivel 1 pelo agente. Restrito a admin (Zeus). So LE e analisa:
// nao escreve nada no ticket. Quem manda a devolutiva e o operador, com um
// clique, pela porta normal de update.
export async function POST(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request, {
    adminOnly: true,
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      protocol?: unknown;
    } | null;
    const protocol =
      typeof body?.protocol === "string" ? body.protocol.trim() : "";

    if (!protocol) {
      return Response.json(
        { error: "Informe o protocolo do chamado." },
        { status: 400 },
      );
    }

    const triage = await runHubItTicketTriage({
      protocol,
      user: authorization.user,
    });

    return Response.json(triage, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel rodar a triagem.",
      },
      { status: 500 },
    );
  }
}
