import { NextResponse } from "next/server";

import {
  createApoloAdminClient,
  createApoloUserClient,
} from "@/lib/apolo/server";

// Auth do Prometeu, no mesmo contrato dos outros modulos (Apolo/Hades/Agenda): a pagina manda
// o Bearer da sessao Supabase e o servidor valida identidade + papel.
//
// Leitura: qualquer usuario ativo do hub (no dia do evento, todo mundo acompanha a fila).
// Escrita: quem opera o evento (admin/leader/operator) — viewer so olha.
type HubUserRole = "admin" | "leader" | "operator" | "viewer";

const READ_ROLES: HubUserRole[] = ["admin", "leader", "operator", "viewer"];
const WRITE_ROLES: HubUserRole[] = ["admin", "leader", "operator"];

// DONO DO EVENTO. As operacoes irreversiveis do Prometeu (resetar o ensaio, encerrar o dia)
// NAO sao papel de operacao: sao do Lucas, nominalmente (decisao dele 19/jul, "somente o meu
// usuario pode fazer"). Papel admin NAO basta — um evento de centenas de pessoas nao pode ser
// zerado por quem tem cargo alto, so por quem responde por ele.
// Override por env pra nao travar o sistema se o e-mail mudar; a lista do codigo e o padrao.
const DONOS_PADRAO = ["lucas.ruas@careli.adm.br"];

function donosDoEvento(): string[] {
  const doEnv = (process.env.PROMETEU_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return doEnv.length > 0 ? doEnv : DONOS_PADRAO;
}

export type PrometeuAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? "";
}

async function authorize(
  request: Request,
  papeis: HubUserRole[],
  // Operacao irreversivel: alem do papel, exige ser o DONO do evento (por e-mail) e nunca
  // aceita o atalho de dev.
  exigeDono = false,
): Promise<PrometeuAuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Prometeu ausente." },
        { status: 401 },
      ),
    };
  }

  const client = createApoloAdminClient() ?? createApoloUserClient(token);

  if (!client) {
    // Dev/local sem Supabase server-side: nao ha sessao real pra checar. Isso libera leitura e
    // escrita comum, mas NUNCA operacao de dono — sem identidade verificavel, nao existe dono.
    if (exigeDono) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Operacao restrita ao dono do evento: exige sessao verificada." },
          { status: 403 },
        ),
      };
    }
    return { ok: true, userId: "local-hub-user" };
  }

  const { data: authData, error: authError } = await client.auth.getUser(token);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Prometeu invalida." },
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
        { error: "Usuario sem acesso ao Prometeu." },
        { status: 403 },
      ),
    };
  }

  if (exigeDono) {
    // O e-mail vem do token verificado pelo Supabase, nao do corpo da requisicao.
    const email = (authData.user.email ?? "").trim().toLowerCase();

    if (!email || !donosDoEvento().includes(email)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "Somente o dono do evento pode executar esta acao. Nem papel de admin substitui.",
          },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, userId: user.id };
}

export function authorizePrometeuRead(request: Request) {
  return authorize(request, READ_ROLES);
}

export function authorizePrometeuWrite(request: Request) {
  return authorize(request, WRITE_ROLES);
}

// Para o que nao tem volta: resetar o ensaio e encerrar o dia do evento.
export function authorizePrometeuOwner(request: Request) {
  return authorize(request, ["admin", "leader", "operator"], true);
}
