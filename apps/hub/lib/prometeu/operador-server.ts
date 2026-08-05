import { NextResponse } from "next/server";

import {
  authorizePrometeuRead,
  authorizePrometeuWrite,
} from "@/lib/prometeu/auth";
import {
  PROMETEU_SESSION_COOKIE,
  validarTokenSessao,
  type PrometeuOperadorSessao,
} from "@/lib/prometeu/operador-auth";

// Ponte entre as rotas de OPERACAO do Prometeu (fila/eventos/checkin) e a sessao propria do
// operador do evento. Diferente das rotas /operador/*, que leem o cookie via next/headers
// cookies(), aqui recebemos um Request "solto" — entao fazemos o parse simples do header Cookie.

// Extrai o valor do cookie de sessao do operador do header "Cookie" cru. O token e' base64url +
// "." + base64url (charset seguro de cookie), entao nao precisa de decode; devolvemos o valor cru.
function tokenDoCookieHeader(header: string | null): string | undefined {
  if (!header) return undefined;

  for (const parte of header.split(";")) {
    const eq = parte.indexOf("=");
    if (eq <= 0) continue;

    const nome = parte.slice(0, eq).trim();
    if (nome === PROMETEU_SESSION_COOKIE) {
      return parte.slice(eq + 1).trim();
    }
  }

  return undefined;
}

// Le e valida a sessao do operador a partir do cookie assinado. Devolve a sessao ou null (cookie
// ausente, token malformado, adulterado ou expirado — validarTokenSessao nunca lanca).
export function lerOperadorDaSessao(
  request: Request,
): PrometeuOperadorSessao | null {
  const token = tokenDoCookieHeader(request.headers.get("cookie"));
  return validarTokenSessao(token, Date.now());
}

export type AutorizarOperacaoResult =
  | { ok: true; operadorId?: string }
  | { ok: false; response: NextResponse };

export type AutorizarEscritaResult =
  | { ok: true; operadorId?: string; userId?: string }
  | { ok: false; response: NextResponse };

// Igual a `autorizarOperacao`, MAS pela via do hub exige papel de ESCRITA (admin/leader/operator).
//
// Por que existe: `autorizarOperacao` aceita qualquer usuario do hub — inclusive **viewer**, que
// por definicao "so olha". Isso e' correto para LER a fila e para os bips, mas nao para as acoes
// que mexem na mesa (chamar/atender/liberar): usar `autorizarOperacao` nelas rebaixaria a regra e
// deixaria um viewer ocupar mesa, carimbar atendimento e disparar o WhatsApp real do cliente.
//
// Devolve tambem o `userId` do hub — sem ele, `chamado_por`/`por` gravariam null e a operacao
// perderia a auditoria de quem chamou e quem finalizou.
export async function autorizarOperacaoDeEscrita(
  request: Request,
): Promise<AutorizarEscritaResult> {
  const hub = await authorizePrometeuWrite(request);
  if (hub.ok) return { ok: true, userId: hub.userId };

  const sessao = lerOperadorDaSessao(request);
  if (sessao) return { ok: true, operadorId: sessao.operadorId };

  return { ok: false, response: hub.response };
}

// Autoriza uma operacao do Prometeu por DUAS vias, nesta ordem:
//   1. Bearer da sessao do hub (Lucas e o time, papel de leitura) — authorizePrometeuRead;
//   2. cookie de sessao do operador do evento (conta propria, NAO usuario do hub).
// So devolve erro quando NENHUMA das duas identidades se sustenta; nesse caso reaproveita a
// resposta 401/403 do gate do hub. `operadorId` volta preenchido apenas na via do cookie.
export async function autorizarOperacao(
  request: Request,
): Promise<AutorizarOperacaoResult> {
  const hub = await authorizePrometeuRead(request);
  if (hub.ok) return { ok: true };

  const sessao = lerOperadorDaSessao(request);
  if (sessao) return { ok: true, operadorId: sessao.operadorId };

  return { ok: false, response: hub.response };
}
