// O LINK DA TV — o telão abre com um token próprio e NUNCA mais pede login.
//
// Por que existe: a TV logada com o cookie do operador (TTL 14h) expirava no MEIO do evento e o
// telão morria mudo (aconteceu em 02/08: uma TV batendo 401 a cada 20s a tarde inteira). TV é
// vitrine, não usuário — o Lucas mandou tirar o operador dela.
//
// Mesmo desenho do link da fila do cliente (lib/prometeu/link-da-fila.ts): HS256 na mão com
// node:crypto e a mesma SESSAO_CAD_SECRET. O token NÃO carrega PII — só o uuid do evento — e por
// isso pode viajar na query string da TV.
//
// SEM `exp`, de propósito: o link vale enquanto o EVENTO do token for o evento operável. Acabou
// o lançamento (status `encerrado`) ou veio o próximo, o token morre sozinho — a revogação é o
// ciclo de vida do evento, igual ao link da fila.
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://c2x.app.br";

type TelaoPayload = { e: string; iat: number };

function segredo(): string | null {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");
const assinar = (conteudo: string, chave: string): string =>
  b64url(createHmac("sha256", chave).update(conteudo).digest());

export function emitirTokenDoTelao(eventoId: string): string | null {
  const chave = segredo();
  if (!chave || !eventoId) return null;
  const corpo = b64url(
    Buffer.from(JSON.stringify({ e: eventoId, iat: Math.floor(Date.now() / 1000) })),
  );
  return `${corpo}.${assinar(corpo, chave)}`;
}

// Devolve o eventoId autorizado, ou null. A rota compara com o evento operável do dia.
export function validarTokenDoTelao(token: string | null | undefined): string | null {
  const chave = segredo();
  if (!chave || !token) return null;
  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return null;
  const esperada = assinar(corpo, chave);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString()) as TelaoPayload;
    return typeof payload.e === "string" && payload.e ? payload.e : null;
  } catch {
    return null;
  }
}

export function linkDoTelao(eventoId: string, canal: "salao" | "secretaria"): string | null {
  const token = emitirTokenDoTelao(eventoId);
  if (!token) return null;
  return `${BASE_URL}/prometeu/telao.html?canal=${canal}&tv=${token}`;
}
