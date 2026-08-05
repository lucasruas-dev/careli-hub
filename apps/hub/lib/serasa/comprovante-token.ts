// Token do COMPROVANTE de consulta de crédito — o que o QR code carrega e a página pública
// /publico/verificar confere.
//
// Espelha lib/publico/cad/sessao.ts (HS256 na mão com node:crypto), pela mesma razão: assinar
// algumas dezenas de bytes não justifica uma dependência nova, e o formato é o JWT de sempre.
//
// O QUE ASSINA e por quê:
//  - `id`: o id (uuid) da linha em serasa_consultas. É o protocolo do comprovante e o handle que a
//    verificação usa pra buscar os valores AUTORITATIVOS no banco (nunca confia no que veio no PDF).
//  - `h`: um fingerprint (sha256) dos valores impressos no comprovante. Liga a assinatura ao
//    conteúdo: um PDF adulterado (score/veredito trocado) não bate com o `h` recomputado do banco.
//  - `iat`: emissão. NÃO há `exp` — um comprovante vale pra sempre; a "revogação" é o próprio
//    registro sumir do banco, não expiração.
//
// Reusa a SESSAO_CAD_SECRET (já em produção, mesmo propósito: assinar capability de rota pública).
// O token NÃO carrega PII (só uuid + hash), então pode ir na URL do QR — ao contrário do token de
// sessão do CAD, que identifica pessoa e por isso é proibido em query string.
import { createHmac, timingSafeEqual } from "node:crypto";

function segredo(): string | null {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function assinar(conteudo: string, chave: string): string {
  return b64url(createHmac("sha256", chave).update(conteudo).digest());
}

export type ComprovantePayload = {
  // fingerprint (sha256 hex) dos valores impressos — ver fingerprintComprovante em comprovante.ts.
  h: string;
  // id da serasa_consultas (protocolo).
  id: string;
  iat: number;
};

export type EmitirComprovanteResultado =
  | { error: string; ok: false }
  | { ok: true; token: string };

export function emitirTokenComprovante(input: { h: string; id: string }): EmitirComprovanteResultado {
  const chave = segredo();
  if (!chave) {
    // Falha FECHADA: sem segredo não dá pra emitir um QR verificável. Melhor não imprimir QR do
    // que imprimir um que ninguém consegue validar.
    return { error: "Assinatura de comprovante indisponível.", ok: false };
  }

  const payload: ComprovantePayload = {
    h: input.h,
    iat: Math.floor(Date.now() / 1000),
    id: input.id,
  };
  const cabecalho = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = b64url(Buffer.from(JSON.stringify(payload)));
  const conteudo = `${cabecalho}.${corpo}`;
  return { ok: true, token: `${conteudo}.${assinar(conteudo, chave)}` };
}

export type VerificarComprovanteResultado =
  | { error: string; ok: false }
  | { ok: true; payload: ComprovantePayload };

export function verificarTokenComprovante(
  token: string | null | undefined,
): VerificarComprovanteResultado {
  const chave = segredo();
  if (!chave) return { error: "Verificação indisponível.", ok: false };

  const partes = String(token ?? "").trim().split(".");
  if (partes.length !== 3) return { error: "Comprovante inválido.", ok: false };

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const esperada = assinar(`${cabecalho}.${corpo}`, chave);

  // Comparação em tempo constante: === vazaria o prefixo correto pelo relógio.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: "Comprovante inválido ou adulterado.", ok: false };
  }

  let payload: ComprovantePayload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as ComprovantePayload;
  } catch {
    return { error: "Comprovante inválido.", ok: false };
  }

  if (!payload?.id || !payload?.h) return { error: "Comprovante inválido.", ok: false };

  return { ok: true, payload };
}
