import { createHmac, timingSafeEqual } from "node:crypto";

// Sessão da TELA PÚBLICA da ação (freela sem conta do hub). Mesmo espírito do portal de CAD: uma
// senha por campanha troca por um token HMAC curto, e o token (não o corpo) diz QUAL ação é. Vai no
// header `x-acao-sessao`, nunca em query string. Reusa o segredo SESSAO_CAD_SECRET (já em produção).

const SEGREDO = () => process.env.SESSAO_CAD_SECRET ?? "";
const TTL_MS = 8 * 60 * 60 * 1000; // 8h: uma diária de trabalho.

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64url(txt: string): Buffer {
  return Buffer.from(txt.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function emitirSessaoAcao(acaoId: string): string {
  const segredo = SEGREDO();
  if (!segredo) return "";
  const payload = base64url(Buffer.from(JSON.stringify({ acaoId, exp: Date.now() + TTL_MS })));
  const assinatura = base64url(createHmac("sha256", segredo).update(payload).digest());
  return `${payload}.${assinatura}`;
}

export function verificarSessaoAcao(
  token: string | null | undefined,
): { acaoId: string } | null {
  const segredo = SEGREDO();
  if (!token || !segredo) return null;

  const [payload, assinatura] = token.split(".");
  if (!payload || !assinatura) return null;

  const esperada = createHmac("sha256", segredo).update(payload).digest();
  let recebida: Buffer;
  try {
    recebida = deBase64url(assinatura);
  } catch {
    return null;
  }
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    return null;
  }

  try {
    const dados = JSON.parse(deBase64url(payload).toString("utf8")) as {
      acaoId?: unknown;
      exp?: unknown;
    };
    if (
      typeof dados.acaoId !== "string" ||
      typeof dados.exp !== "number" ||
      dados.exp < Date.now()
    ) {
      return null;
    }
    return { acaoId: dados.acaoId };
  } catch {
    return null;
  }
}

export function sessaoDoRequestAcao(request: Request): { acaoId: string } | null {
  return verificarSessaoAcao(request.headers.get("x-acao-sessao"));
}
