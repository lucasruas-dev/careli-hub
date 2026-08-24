// O LINK DOS RELATÓRIOS DO LANÇAMENTO — mesmo desenho do link da TV (link-do-telao.ts):
// HS256 na mão com a SESSAO_CAD_SECRET, sem PII no token, sem exp — o link do gestor/loteador
// vale enquanto o evento existir e morre com o arquivamento.
//
// Dois relatórios (Lucas, 24/08, herdados do Vale do Ouro): "comercial" (vendas/estoque, para
// loteador e gestão comercial) e "performance" (fila e atendimento, para o backoffice).
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://c2x.app.br";

export type TipoDeRelatorio = "comercial" | "performance";

export function normalizarTipoDeRelatorio(valor: unknown): null | TipoDeRelatorio {
  return valor === "comercial" || valor === "performance" ? valor : null;
}

type RelatorioPayload = { e: string; iat: number; r: TipoDeRelatorio };

function segredo(): null | string {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");
const assinar = (conteudo: string, chave: string): string =>
  b64url(createHmac("sha256", chave).update(conteudo).digest());

export function emitirTokenDoRelatorio(
  eventoId: string,
  tipo: TipoDeRelatorio,
): null | string {
  const chave = segredo();
  if (!chave || !eventoId) return null;
  const corpo = b64url(
    Buffer.from(
      JSON.stringify({ e: eventoId, iat: Math.floor(Date.now() / 1000), r: tipo }),
    ),
  );
  return `${corpo}.${assinar(corpo, chave)}`;
}

/** Devolve {eventoId, tipo} autorizados, ou null. */
export function validarTokenDoRelatorio(
  token: null | string | undefined,
): null | { eventoId: string; tipo: TipoDeRelatorio } {
  const chave = segredo();
  if (!chave || !token) return null;
  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return null;
  const esperada = assinar(corpo, chave);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString()) as RelatorioPayload;
    const tipo = normalizarTipoDeRelatorio(payload.r);
    if (typeof payload.e !== "string" || !payload.e || !tipo) return null;
    return { eventoId: payload.e, tipo };
  } catch {
    return null;
  }
}

export function linkDoRelatorio(eventoId: string, tipo: TipoDeRelatorio): null | string {
  const token = emitirTokenDoRelatorio(eventoId, tipo);
  if (!token) return null;
  return `${BASE_URL}/api/publico/prometeu/relatorio?t=${token}`;
}
