// SESSÃO DO INCORPORADOR (o loteador, dono do empreendimento).
//
// Regra do Lucas (10/08/2026): "a ideia e vincular usuarios de sistema a um incorporador e ali
// todos terem acesso somente aos dados dos empreendimentos que aquele incorporador tem com a
// gente". Este arquivo é onde esse "somente" vira algo que o servidor consegue provar.
//
// O QUE ESTE TOKEN CARREGA E POR QUÊ: os `enterpriseIds` viajam DENTRO da sessão, calculados no
// servidor no momento do login. É a mesma escolha do portal de CAD, e pelo mesmo motivo: se o
// empreendimento viesse do request, o incorporador trocaria um id na URL e leria a carteira do
// vizinho. Aqui a lista é assinada; alterá-la quebra a assinatura.
//
// ⚠️ NÃO REUSAR `authorizeApoloRead` NO CAMINHO DO INCORPORADOR. Aquela porta é do CRM interno,
// onde o analista da Careli abre a ficha de qualquer cliente por desenho — é isso que a rota
// /api/apolo/carteira faz ao aceitar `c2xId` da query string. Para quem vem de fora, o escopo
// nasce aqui e em nenhum outro lugar.
//
// POR QUE COOKIE E NÃO HEADER: diferente do formulário de CAD, que é uma tela só, o incorporador
// navega entre Vendas, Carteira, Produtos e o masterplan, e volta no dia seguinte. Cookie
// httpOnly sobrevive a recarregar e abrir aba nova, e não fica legível para script na página.
// Mesmo desenho do operador do Prometeu (lib/prometeu/operador-auth.ts).
import { createHmac, timingSafeEqual } from "node:crypto";

import { type TipoDePortal, tipoDePortal } from "./perfis-de-portal";

export const INCORPORADOR_COOKIE = "apolo_inc";

// 12h cobre um dia de trabalho inteiro sem virar acesso permanente. O operador do evento usa
// 14h porque o dia de lançamento é mais longo; aqui é expediente comum.
export const INCORPORADOR_TTL_MS = 12 * 60 * 60 * 1000;

export type SessaoIncorporador = {
  /** Empreendimentos que este incorporador enxerga (ids do C2X). A permissão em si. */
  enterpriseIds: string[];
  /** Subconjunto de `enterpriseIds` cuja carteira a Careli administra: só neles a aba Carteira aparece. */
  enterpriseIdsComCarteira: string[];
  exp: number;
  incorporadorId: string;
  /** Nome de exibição, para o cabeçalho não precisar de uma ida ao banco a cada tela. */
  incorporadorNome: string;
  slug: string;
  /**
   * `incorporador` (o dono do loteamento lendo a carteira) ou `comercial` (o Hércules: o time da
   * Careli operando). Decide abas, marca e quais rotas aceitam este cookie — o Prometeu, por
   * exemplo, só abre a fila para o comercial. Cookie assinado antes da 0122 não traz o campo, e o
   * leitor o preenche como `incorporador`: perfil antigo continua exatamente como era.
   */
  tipo: TipoDePortal;
  usuarioId: string;
  usuarioNome: string;
};

function segredo(): string {
  const valor = process.env.SESSAO_INCORPORADOR_SECRET?.trim();

  if (!valor) {
    // Falha explícita, nunca silenciosa: sem segredo não dá para distinguir sessão legítima de
    // forjada, e esta sessão dá acesso a dado financeiro de cliente.
    throw new Error(
      "SESSAO_INCORPORADOR_SECRET ausente — acesso do incorporador indisponível.",
    );
  }

  return valor;
}

function assinar(corpo: string): string {
  return createHmac("sha256", segredo()).update(corpo).digest("base64url");
}

/** Emite o token assinado. A expiração é carimbada aqui, não recebida de fora. */
export function criarSessaoIncorporador(
  dados: Omit<SessaoIncorporador, "exp" | "tipo"> & { tipo?: TipoDePortal },
  agoraMs: number,
): string {
  const corpo: SessaoIncorporador = {
    ...dados,
    exp: agoraMs + INCORPORADOR_TTL_MS,
    tipo: tipoDePortal(dados.tipo),
  };
  const parte = Buffer.from(JSON.stringify(corpo)).toString("base64url");

  return `${parte}.${assinar(parte)}`;
}

/**
 * Valida assinatura e validade. Devolve a sessão ou null: token estragado é ausência de sessão,
 * nunca exceção — quem chama não deve precisar de try/catch para tratar visitante deslogado.
 */
export function lerSessaoIncorporador(
  token: string | null | undefined,
  agoraMs: number,
): SessaoIncorporador | null {
  if (!token) return null;

  const ponto = token.indexOf(".");
  if (ponto <= 0) return null;

  const parte = token.slice(0, ponto);
  const recebida = token.slice(ponto + 1);

  let esperada: string;
  try {
    esperada = assinar(parte);
  } catch {
    // Segredo ausente: trata como sem sessão em vez de derrubar a página.
    return null;
  }

  // Tempo constante: comparar com === vaza o prefixo correto pelo relógio.
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let sessao: SessaoIncorporador;
  try {
    sessao = JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as SessaoIncorporador;
  } catch {
    return null;
  }

  if (!sessao?.exp || sessao.exp < agoraMs) return null;
  if (!sessao.incorporadorId || !sessao.usuarioId) return null;
  if (!Array.isArray(sessao.enterpriseIds) || sessao.enterpriseIds.length === 0) {
    // Incorporador sem nenhum empreendimento liberado não tem o que ver: melhor recusar a sessão
    // do que servir telas vazias e deixar a dúvida se é falta de dado ou falta de permissão.
    return null;
  }

  return {
    ...sessao,
    enterpriseIds: sessao.enterpriseIds.map(String),
    enterpriseIdsComCarteira: Array.isArray(sessao.enterpriseIdsComCarteira)
      ? sessao.enterpriseIdsComCarteira.map(String)
      : [],
    tipo: tipoDePortal(sessao.tipo),
  };
}

/** Lê a sessão do cookie da requisição. */
export function sessaoDoRequest(
  request: Request,
  agoraMs = Date.now(),
): SessaoIncorporador | null {
  const cru = request.headers.get("cookie") ?? "";
  const alvo = cru
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${INCORPORADOR_COOKIE}=`));

  return lerSessaoIncorporador(alvo?.slice(INCORPORADOR_COOKIE.length + 1), agoraMs);
}

/**
 * O filtro de empreendimento de QUALQUER consulta do portal. Recebe o que a tela pediu e devolve
 * só o que a sessão autoriza.
 *
 * A tela pode pedir um empreendimento específico (o cliente clicou num card) ou não pedir nada
 * (visão consolidada). Em ambos os casos o resultado é sempre subconjunto da sessão — pedir um
 * id de fora não dá erro nem vaza: some da lista. Pedido que não sobra nada devolve vazio, e a
 * rota responde 403, nunca a carteira inteira.
 */
export function empreendimentosPermitidos(
  sessao: SessaoIncorporador,
  pedido?: string | string[] | null,
): string[] {
  const autorizados = new Set(sessao.enterpriseIds);

  if (pedido == null || pedido === "") return [...autorizados];

  const lista = (Array.isArray(pedido) ? pedido : String(pedido).split(","))
    .map((id) => String(id).trim())
    .filter(Boolean);

  return lista.filter((id) => autorizados.has(id));
}
