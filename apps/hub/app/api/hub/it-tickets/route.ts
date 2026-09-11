import { after, type NextRequest } from "next/server";

import {
  authorizeHubItTicketRequest,
  createHubItTicket,
  isHubItTicketsSchemaMissingError,
  listHubItTickets,
  updateHubItTicket,
} from "@/lib/hub-it-tickets/server";
import { triarChamadoNovo } from "@/lib/hub-it-tickets/triagem-automatica";
import type { HubItTicketListScope } from "@/lib/hub-it-tickets/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const scope = getScope(request);
  const includeDetails = getDetailsMode(request) === "full";
  const protocol = getProtocol(request);
  const authorization = await authorizeHubItTicketRequest(request, {
    adminOnly: scope === "all",
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const tickets = await listHubItTickets({
      includeDetails,
      protocol,
      scope,
      user: authorization.user,
    });

    return Response.json(
      { tickets },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isHubItTicketsSchemaMissingError(error)) {
      return Response.json(
        {
          error: hubItTicketsMigrationPendingMessage,
          message: hubItTicketsMigrationPendingMessage,
          status: "migration_pendente",
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
          status: 503,
        },
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar HelpDesk.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const input = await request.json();
    const ticket = await createHubItTicket({
      input,
      user: authorization.user,
    });

    // ⚠️ A TRIAGEM RODA DEPOIS DA RESPOSTA, com `after()`, e nunca antes. Ela chama o modelo e
    // leva segundos; colocada no caminho do POST, faria quem abriu o chamado ficar olhando um
    // botão girando por uma análise que não é para ele — é para quem vai atender.
    //
    // ⚠️ E NÃO TEM `await`: o `after` já segura a função viva até terminar. `triarChamadoNovo`
    // nunca lança, então uma falha dela não derruba o chamado que já foi gravado.
    // `createHubItTicket` pode voltar indefinido no caminho de fallback local (sem Supabase),
    // e aí não há protocolo nem o que triar.
    if (ticket?.protocol) {
      const protocolo = ticket.protocol;
      after(() => triarChamadoNovo(protocolo));
    }

    return Response.json(
      { ticket },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isHubItTicketsSchemaMissingError(error)) {
      return Response.json(
        {
          error: hubItTicketsMigrationPendingMessage,
          message: hubItTicketsMigrationPendingMessage,
          status: "migration_pendente",
        },
        { status: 503 },
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel abrir HelpDesk.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const input = await request.json();
    const ticket = await updateHubItTicket({
      input,
      user: authorization.user,
    });

    return Response.json(
      { ticket },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isHubItTicketsSchemaMissingError(error)) {
      return Response.json(
        {
          error: hubItTicketsMigrationPendingMessage,
          message: hubItTicketsMigrationPendingMessage,
          status: "migration_pendente",
        },
        { status: 503 },
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel atualizar HelpDesk.",
      },
      { status: 400 },
    );
  }
}

function getScope(request: NextRequest): HubItTicketListScope {
  const scope = new URL(request.url).searchParams.get("scope");

  return scope === "all" ? "all" : "mine";
}

// `full` hidrata eventos + anexos, e os anexos sao data-URLs base64 (megabytes
// por ticket). Por isso o detalhe e OPT-IN: quem quiser paga, e de preferencia
// pedindo um `protocol` so. O default e a lista leve.
function getDetailsMode(request: NextRequest) {
  const details = new URL(request.url).searchParams.get("details");

  return details === "full" ? "full" : "list";
}

function getProtocol(request: NextRequest) {
  const protocol = new URL(request.url).searchParams.get("protocol")?.trim();

  return protocol || undefined;
}

const hubItTicketsMigrationPendingMessage =
  "HelpDesk aguarda aplicacao das migrations Supabase de tickets no banco de producao. Acione Zeus/Hefesto para aplicar packages/database/migrations/0014_hub_it_tickets.sql e 0017_squadops_ticket_operation_links.sql.";
