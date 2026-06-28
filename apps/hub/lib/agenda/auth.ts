import { NextResponse, type NextRequest } from "next/server";

import { createAgendaClient, type AgendaClient, type HubUserRole } from "@/lib/agenda/agenda";

// Auth das rotas da agenda (modulo "Meu dia"). Sessao Bearer validada via
// auth.getUser; acesso operacional = admin/leader/operator ativos. O modulo e do
// HUB inteiro (Iris + Hades), entao nao restringe por area.

export type AgendaAuthUser = {
  displayName: string | null;
  email: string | null;
  id: string;
  role: HubUserRole;
};

type AgendaAuthResult =
  | { client: AgendaClient; ok: true; user: AgendaAuthUser }
  | { ok: false; response: NextResponse };

const OPERATIONAL_ROLES: HubUserRole[] = ["admin", "leader", "operator"];

export async function authorizeAgendaRequest(
  request: NextRequest,
): Promise<AgendaAuthResult> {
  const client = createAgendaClient();

  if (!client) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a chave server-side para a agenda." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao ausente." }, { status: 401 }),
    };
  }

  const { data: authData, error: authError } =
    await client.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status,display_name,email")
    .eq("id", authData.user.id)
    .maybeSingle<{
      display_name: string | null;
      email: string | null;
      id: string;
      role: HubUserRole;
      status: string;
    }>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !OPERATIONAL_ROLES.includes(user.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso operacional." },
        { status: 403 },
      ),
    };
  }

  return {
    client,
    ok: true,
    user: {
      displayName: user.display_name,
      email: user.email,
      id: user.id,
      role: user.role,
    },
  };
}

function getBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? "";
}
