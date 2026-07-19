import { NextResponse } from "next/server";

import {
  createApoloAdminClient,
  createApoloUserClient,
} from "@/lib/apolo/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export type ApoloAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

// Papeis do Hub que podem LER o Apolo (CRM 360 = PII consolidada de cliente).
const APOLO_READ_ROLES: HubUserRole[] = [
  "admin",
  "leader",
  "operator",
  "viewer",
];

// Quem pode ESCREVER (importar CADs, mexer na esteira). `viewer` só olha.
const APOLO_WRITE_ROLES: HubUserRole[] = ["admin", "leader", "operator"];

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? "";
}

// Garante que so um usuario autenticado e ATIVO do Hub leia os dados do Apolo.
// Mesmo contrato do authorizeHadesRead: a pagina envia o Bearer da sessao
// Supabase; aqui o servidor valida identidade + papel. Em dev/local sem Supabase
// server-side, o client e nulo e liberamos (nao ha sessao real para checar).
export async function authorizeApoloRead(
  request: Request,
): Promise<ApoloAuthResult> {
  return authorizeApolo(request, APOLO_READ_ROLES);
}

// Mesmo contrato, recorte de papel menor: usado por quem GRAVA no Apolo.
export async function authorizeApoloWrite(
  request: Request,
): Promise<ApoloAuthResult> {
  return authorizeApolo(request, APOLO_WRITE_ROLES);
}

async function authorizeApolo(
  request: Request,
  papeis: HubUserRole[],
): Promise<ApoloAuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Apolo ausente." },
        { status: 401 },
      ),
    };
  }

  const client = createApoloAdminClient() ?? createApoloUserClient(token);

  if (!client) {
    return { ok: true, userId: "local-hub-user" };
  }

  const { data: authData, error: authError } = await client.auth.getUser(token);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Apolo invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !papeis.includes(user.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Apolo." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id };
}
