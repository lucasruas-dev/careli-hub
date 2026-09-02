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
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";

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

// A TERCEIRA VIA: o coordenador do portal COMERCIAL (o Hércules da Gurgel).
//
// Pedido do Lucas (02/09/2026): *"há outra tela que vou colocar para eles e a tela de lançamento
// (a tela do prometeu) só com a fila e a central"*.
//
// ⚠️ SÓ O PORTAL DE TIPO `comercial`. O cookie do incorporador (o dono do loteamento) é o mesmo
// formato, e aceitar qualquer sessão do portal aqui abriria a fila do lançamento para o Cecílio.
// O tipo vem de dentro do cookie assinado, não da URL.
//
// ⚠️ E O RECORTE VIAJA JUNTO (`escopo`). O hub enxerga todos os lançamentos; o coordenador só os
// dos empreendimentos dele. Quem lê `escopo` ausente entende "sem recorte" (hub ou operador do
// posto, que já está preso ao próprio evento pelo cookie dele).
//
// ⚠️ O ESCOPO SAI EXPANDIDO, não cru. O vínculo pode estar gravado como `group:Lagoa Bonita`
// (1 de 151 linhas em 17/08/2026) e o evento carrega o `enterprise_id` NUMÉRICO da divisão: comparar
// o literal do cookie com o do evento deixava o dono do grupo sem nenhum lançamento — restritivo,
// mas diferente da aba Contratos, que já expandia. `idsDaSessao` mantém a assimetria validada em
// escopo.ts: grupo abre as divisões, divisão vale só por ela.
type Coordenador = { escopo: string[]; usuarioId: string };

async function lerCoordenadorDoPortal(request: Request): Promise<Coordenador | null> {
  const sessao = sessaoDoRequest(request);
  if (!sessao || !ehPortalComercial(sessao.tipo)) return null;
  return { escopo: await idsDaSessao(sessao), usuarioId: sessao.usuarioId };
}

export type AutorizarOperacaoResult =
  | { ok: true; operadorId?: string; escopo?: string[]; userId?: string }
  | { ok: false; response: NextResponse };

export type AutorizarEscritaResult =
  | { ok: true; operadorId?: string; escopo?: string[]; userId?: string }
  | { ok: false; response: NextResponse };

/**
 * O evento está dentro do que esta autorização enxerga? Sem `escopo`, tudo; com ele, só os
 * lançamentos dos empreendimentos do coordenador. `enterpriseId` nulo (lançamento sem
 * empreendimento vinculado) fica de fora do recorte: não dá para provar que é dele.
 */
export function eventoNoEscopo(
  auth: { escopo?: string[] },
  evento: { enterpriseId: null | string },
): boolean {
  if (!auth.escopo) return true;
  return evento.enterpriseId !== null && auth.escopo.includes(String(evento.enterpriseId));
}

export function respostaForaDoEscopo(): NextResponse {
  return NextResponse.json(
    { error: "Este lançamento não está entre os seus empreendimentos." },
    { status: 403 },
  );
}

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

// ⚠️ O COORDENADOR NÃO ENTRA NAS AUTORIZAÇÕES GENÉRICAS (`autorizarOperacao` /
// `autorizarOperacaoDeEscrita`). Elas são usadas por uma dúzia de rotas (reservas, reserva-touch,
// cupom, jornada, pa, link-fila, mesa, palco, relatorios, telao…) que NÃO leem `escopo`: pôr o
// cookie do portal ali dentro deixaria o coordenador com vínculo só no Garden ler CPF de reserva,
// cancelar cupom e trocar o vídeo do telão de QUALQUER lançamento — foi o achado da revisão de
// 02/09/2026. Por isso o coordenador só passa pelas variantes `...ComCoordenador` abaixo, e uma
// rota só pode adotá-las depois de aplicar `eventoNoEscopo`. Sem isso, o cookie do portal é
// recusado (fail-closed) até a rota ganhar o recorte.

/**
 * `autorizarOperacaoDeEscrita` + o COORDENADOR do portal comercial, com `escopo`.
 *
 * O coordenador opera a mesa e a fila como o time interno: é gente da Careli, não freela de posto.
 * `userId` leva o id da conta do portal para a auditoria (`chamado_por`/`por`).
 */
export async function autorizarEscritaComCoordenador(
  request: Request,
): Promise<AutorizarEscritaResult> {
  const base = await autorizarOperacaoDeEscrita(request);
  if (base.ok) return base;

  const coordenador = await lerCoordenadorDoPortal(request);
  if (coordenador) {
    return { escopo: coordenador.escopo, ok: true, userId: coordenador.usuarioId };
  }

  return base;
}

/**
 * Escrita do HUB ou do COORDENADOR — e NÃO do operador de posto. É a régua das ações que mexem na
 * fila (mover, ordem, excluir): o freela não fura fila, o coordenador da Careli sim.
 */
export async function autorizarEscritaDoHubOuDoCoordenador(
  request: Request,
): Promise<AutorizarEscritaResult> {
  const hub = await authorizePrometeuWrite(request);
  if (hub.ok) return { ok: true, userId: hub.userId };

  const coordenador = await lerCoordenadorDoPortal(request);
  if (coordenador) {
    return { escopo: coordenador.escopo, ok: true, userId: coordenador.usuarioId };
  }

  return { ok: false, response: hub.response };
}

/**
 * Leitura do HUB ou do COORDENADOR — e NÃO do operador de posto. Para o que é administração do
 * lançamento (a lista de postos de credenciamento, por exemplo) e o freela não precisa ver.
 */
export async function autorizarLeituraDoHubOuDoCoordenador(
  request: Request,
): Promise<AutorizarOperacaoResult> {
  const hub = await authorizePrometeuRead(request);
  if (hub.ok) return { ok: true };

  const coordenador = await lerCoordenadorDoPortal(request);
  if (coordenador) {
    return { escopo: coordenador.escopo, ok: true, userId: coordenador.usuarioId };
  }

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

/**
 * `autorizarOperacao` + o COORDENADOR do portal comercial, com `escopo`. Ver o aviso acima: só
 * para rota que confere `eventoNoEscopo` antes de responder.
 */
export async function autorizarOperacaoComCoordenador(
  request: Request,
): Promise<AutorizarOperacaoResult> {
  const base = await autorizarOperacao(request);
  if (base.ok) return base;

  const coordenador = await lerCoordenadorDoPortal(request);
  if (coordenador) {
    return { escopo: coordenador.escopo, ok: true, userId: coordenador.usuarioId };
  }

  return base;
}
