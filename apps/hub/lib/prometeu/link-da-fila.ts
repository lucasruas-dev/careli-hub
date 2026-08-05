// O LINK QUE O CLIENTE RECEBE NO CHECK-IN — abre no celular dele e mostra a propria posicao.
//
// Para que serve: e' o que tira da recepcao a fila de gente perguntando "falta muito?". Quem
// acabou de ser credenciado ganha um endereco proprio e acompanha sozinho.
//
// POR QUE ASSINADO, e nao um simples "?id=<uuid>": o id do credenciado circula pelo evento
// inteiro (e' exatamente o que vai gravado no QR do cracha, que qualquer um fotografa) e um
// uuid na barra de enderecos e' colavel. Sem assinatura, trocar o id na URL abriria o nome e a
// posicao de outra pessoa. O token e' a prova de que ESTE link foi emitido pelo servidor para
// AQUELE credenciado.
//
// Mesmo desenho do comprovante do Serasa (lib/serasa/comprovante-token.ts): HS256 na mao com
// node:crypto e a mesma SESSAO_CAD_SECRET. Uma dependencia nova para assinar 100 bytes nao se
// justifica, e o formato e' o JWT de sempre.
//
// O TOKEN NAO CARREGA PII: so' dois uuids (credenciado e evento). Por isso pode viajar na query
// string — ao contrario do token de sessao do CAD, que identifica pessoa e por isso e' proibido
// em URL (fica em header). O nome do cliente nunca entra no link.
//
// O evento vai junto para o servidor NAO precisar aceitar `eventoId` da URL: assim um link do
// lancamento passado nao pode ser reapontado para o lancamento de hoje trocando um parametro.
import { createHmac, timingSafeEqual } from "node:crypto";

// Dominio FIXO, pelo mesmo motivo do QR do comprovante: NEXT_PUBLIC_APP_URL vem errada em alguns
// ambientes (no .env.local aponta para a URL do Supabase) e um link gerado com o dominio errado
// simplesmente nao abre no celular do cliente. Se o dominio mudar, e' uma linha.
const BASE_URL = "https://c2x.app.br";

export const CAMINHO_DA_FILA_PUBLICA = "/publico/fila";

export type LinkDaFilaPayload = {
  // credenciadoId
  c: string;
  // eventoId
  e: string;
  iat: number;
};

function segredo(): string | null {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function assinar(conteudo: string, chave: string): string {
  return b64url(createHmac("sha256", chave).update(conteudo).digest());
}

export type EmitirLinkResultado =
  | { error: string; ok: false }
  | { ok: true; token: string };

// SEM `exp`, de proposito. O link vale enquanto o evento roda, e a "revogacao" e' a pessoa sair
// da operacao (`encerrado_em`), que a faz sumir de `listCredenciados` e derruba a pagina sozinha.
// Um prazo curto quebraria justamente o uso previsto — o cliente que deixa a aba aberta a manha
// inteira — e um prazo longo nao protegeria nada que o fim do evento ja nao proteja.
export function emitirTokenDaFila(input: {
  credenciadoId: string;
  eventoId: string;
}): EmitirLinkResultado {
  const chave = segredo();
  if (!chave) {
    // Falha FECHADA: sem segredo nao ha como distinguir link legitimo de forjado. Melhor nao
    // mandar link nenhum do que mandar um que qualquer um consegue reescrever.
    return { error: "Assinatura do link indisponivel.", ok: false };
  }

  const credenciadoId = input.credenciadoId.trim();
  const eventoId = input.eventoId.trim();
  if (!credenciadoId || !eventoId) {
    return { error: "Link exige credenciado e evento.", ok: false };
  }

  const payload: LinkDaFilaPayload = {
    c: credenciadoId,
    e: eventoId,
    iat: Math.floor(Date.now() / 1000),
  };
  const cabecalho = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const corpo = b64url(Buffer.from(JSON.stringify(payload)));
  const conteudo = `${cabecalho}.${corpo}`;

  return { ok: true, token: `${conteudo}.${assinar(conteudo, chave)}` };
}

export type VerificarLinkResultado =
  | { error: string; ok: false }
  | { ok: true; payload: LinkDaFilaPayload };

export function verificarTokenDaFila(
  token: string | null | undefined,
): VerificarLinkResultado {
  const chave = segredo();
  if (!chave) return { error: "Verificacao indisponivel.", ok: false };

  const partes = String(token ?? "").trim().split(".");
  if (partes.length !== 3) return { error: "Link invalido.", ok: false };

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const esperada = assinar(`${cabecalho}.${corpo}`, chave);

  // Comparacao em tempo constante: `===` vazaria pelo relogio quantos bytes do prefixo estao
  // certos, o que permite montar a assinatura byte a byte.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: "Link invalido ou adulterado.", ok: false };
  }

  let payload: LinkDaFilaPayload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as LinkDaFilaPayload;
  } catch {
    return { error: "Link invalido.", ok: false };
  }

  if (!payload?.c || !payload?.e) return { error: "Link invalido.", ok: false };

  return { ok: true, payload };
}

// A URL pronta para mandar no WhatsApp. Devolve "" quando nao da' para assinar — quem chama
// decide o que fazer, mas NUNCA recebe um link sem assinatura para enviar por engano.
export function linkDaFilaDoCliente(input: {
  credenciadoId: string;
  eventoId: string;
}): string {
  const emitido = emitirTokenDaFila(input);
  if (!emitido.ok) return "";

  return `${BASE_URL}${CAMINHO_DA_FILA_PUBLICA}?t=${encodeURIComponent(emitido.token)}`;
}
