import { type NextRequest } from "next/server";

import {
  authorizeHubItTicketRequest,
  createHubItTicket,
  listHubItTickets,
  updateHubItTicket,
} from "@/lib/hub-it-tickets/server";
import type { HubItTicketListScope } from "@/lib/hub-it-tickets/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const scope = getScope(request);
  const authorization = await authorizeHubItTicketRequest(request, {
    adminOnly: scope === "all",
  });

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const tickets = await listHubItTickets({
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
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar tickets TI.",
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

    return Response.json(
      { ticket },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel abrir ticket TI.",
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
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel atualizar ticket TI.",
      },
      { status: 400 },
    );
  }
}

function getScope(request: NextRequest): HubItTicketListScope {
  const scope = new URL(request.url).searchParams.get("scope");

  return scope === "all" ? "all" : "mine";
}
