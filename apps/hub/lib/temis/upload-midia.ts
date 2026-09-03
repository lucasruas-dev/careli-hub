// Upload de MÍDIA do editor de minutas da Têmis: o contrato que o CLIENTE (hook `useUploadFile`,
// editor) e o SERVIDOR (rota /api/temis/minutas/upload) compartilham. Sem React, sem Supabase,
// sem `next/server`: é importado dos dois lados, então só constantes e funções puras.
//
// Pedido do Lucas (02/09/2026): o editor de minutas com o Plate UI completo, "mídia com upload".
// A mídia vai para o bucket PRIVADO `apolo-documents`, prefixo `temis-minutas/<minutaId>/`, por
// URL assinada de upload direto (o mesmo caminho do documento grande do CAD e do anexo do Hub IT).
// Nunca UploadThing, nunca base64 dentro do JSON da minuta.
//
// ⚠️ O hook do Plate (`media-placeholder-node`) chama `useUploadFile()` SEM argumentos: ele não
// sabe em que minuta está. Por isso a minuta "atual" vive num registro de módulo que o editor
// preenche ao montar (`setMinutaAtualParaUpload`) e limpa ao desmontar. Um editor por tela — se
// um dia houver dois abertos ao mesmo tempo, o último a montar manda.

export const PREFIXO_MIDIA = "temis-minutas/";

// Mesmo teto do documento do CAD ("deixa o padrão 20MB para documentos"). O servidor confere de
// novo com o tamanho REAL do objeto depois do upload; a checagem do cliente é só para o arquivo
// grande nem sair do navegador.
export const LIMITE_MIDIA_BYTES = 20 * 1024 * 1024;
export const LIMITE_MIDIA_ROTULO = "20MB";

// O que a minuta aceita como mídia. Imagem (logo do loteador, planta, carimbo), vídeo/áudio
// (ficam como LINK no contrato, que é papel), PDF e .docx (anexos referenciados no texto).
export const TIPOS_ACEITOS_MIDIA = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type TipoAceitoMidia = (typeof TIPOS_ACEITOS_MIDIA)[number];

export function ehTipoAceitoMidia(contentType: string | null | undefined): contentType is TipoAceitoMidia {
  return (TIPOS_ACEITOS_MIDIA as readonly string[]).includes((contentType ?? "").trim().toLowerCase());
}

// Um caminho devolvido pelo cliente é mesmo um caminho de mídia da Têmis? Sem `..`, sem barra
// inicial e dentro do prefixo. A mesma regra vale no PATCH (confirmação) e no GET (re-assinar).
export function caminhoDeMidiaValido(path: string | null | undefined): boolean {
  const caminho = (path ?? "").trim();
  if (!caminho || caminho.includes("..") || caminho.startsWith("/")) return false;
  if (!caminho.startsWith(PREFIXO_MIDIA)) return false;
  // `temis-minutas/<minutaId>/<arquivo>`: precisa ter a minuta E o arquivo.
  const partes = caminho.slice(PREFIXO_MIDIA.length).split("/");
  return partes.length >= 2 && partes.every((p) => p.length > 0);
}

// Nome de arquivo que entra no caminho do objeto. Mesma regra do `sanitize` de lib/apolo/documentos
// (que é privado lá): só [a-zA-Z0-9._-], 120 chars, nunca vazio.
export function sanitizarNomeDeMidia(nome: string | null | undefined): string {
  return (nome ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "midia";
}

// A signed URL de leitura do Supabase carrega o caminho do objeto:
//   https://<proj>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
// Serve para a tela (ou o futuro gerador de contrato) recuperar o `path` a partir da `url` gravada
// no nó e pedir uma assinatura nova em GET /api/temis/minutas/upload?path=.
export function caminhoDaUrlAssinada(url: string, bucket: string): string | null {
  try {
    const u = new URL(url);
    const marcador = `/object/sign/${bucket}/`;
    const i = u.pathname.indexOf(marcador);
    if (i === -1) return null;
    const path = decodeURIComponent(u.pathname.slice(i + marcador.length));
    return caminhoDeMidiaValido(path) ? path : null;
  } catch {
    return null;
  }
}

// ---- minuta "atual" (só no cliente) ---------------------------------------------------------

let minutaAtual: string | null = null;

export function setMinutaAtualParaUpload(minutaId: string | null): void {
  minutaAtual = minutaId?.trim() || null;
}

export function getMinutaAtualParaUpload(): string | null {
  return minutaAtual;
}

// Corpo do POST (pedir URL assinada) e resposta; corpo do PATCH (confirmar) e resposta.
// Tipados aqui para o hook e a rota não divergirem.
export type PedidoDeUploadMidia = {
  contentType: string;
  fileName: string;
  minutaId: string;
  size: number;
};

export type UrlAssinadaDeUpload = {
  bucket: string;
  path: string;
  token: string;
};

export type MidiaConfirmada = {
  name: string;
  path: string;
  size: number;
  type: string;
  // Signed URL de leitura: é a URL que fica gravada no nó do documento, e ela é VOLÁTIL (7 dias).
  // Motivo de ser signed URL: `<img src>` não manda Bearer, então a URL precisa abrir sozinha; o
  // token só dá leitura daquele objeto. Motivo do prazo curto: a URL vai parar em toda cópia do
  // HTML do contrato, e 10 anos a tornavam pública para quem tivesse o link. A chave duradoura é o
  // `path` (recuperável pela `caminhoDaUrlAssinada`); a tela re-assina ao abrir a minuta via
  // GET /api/temis/minutas/upload?path=&json=1 (`lib/temis/reassinar-midias.ts`).
  url: string;
};
