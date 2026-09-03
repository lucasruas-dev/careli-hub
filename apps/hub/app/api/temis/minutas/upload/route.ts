import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { APOLO_DOCS_BUCKET, MENSAGEM_DOCUMENTO_GRANDE } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  caminhoDeMidiaValido,
  ehTipoAceitoMidia,
  LIMITE_MIDIA_BYTES,
  type MidiaConfirmada,
  PREFIXO_MIDIA,
  sanitizarNomeDeMidia,
  type UrlAssinadaDeUpload,
} from "@/lib/temis/upload-midia";

// MÍDIA DO EDITOR DE MINUTAS (Têmis). Pedido do Lucas (02/09/2026): o editor com o Plate UI
// completo, "mídia com upload". Bucket PRIVADO `apolo-documents`, prefixo `temis-minutas/<minutaId>/`.
//
// Esta rota NÃO recebe bytes. Três verbos, o mesmo padrão do documento grande do CAD
// (app/api/apolo/cadastro/upload-url) e do anexo do Hub IT:
//   POST  { minutaId, fileName, contentType, size } → { bucket, path, token }  URL assinada de UPLOAD
//   PATCH { path }                                  → { url, path, size, type, name }  confirmação
//   GET   ?path=                                    → 302 para uma signed URL de leitura curta
//   GET   ?path=&json=1                             → { url, path } re-assinatura (a tela, ao abrir)
//
// ⚠️ A URL GRAVADA NO NÓ do documento é uma signed URL de leitura, e ELA EXPIRA (7 dias). Motivo de
// ser signed URL: `<img src>` não manda Bearer e a auth do hub é só Bearer (o proxy.ts só tem cookie
// para Prometeu/Incorporador), então a URL precisa abrir sozinha. Motivo de expirar: a primeira
// versão assinava por 10 ANOS, e isso tornava o objeto público para quem tivesse o link — sem
// sessão, por uma década, em toda cópia do HTML/PDF do contrato, export, log ou e-mail; revogar
// exigiria apagar o arquivo. Um .docx anexo com dados do comprador ficava acessível por link.
// Agora a URL viva só existe enquanto alguém autenticado a pediu: a tela re-assina cada mídia ao
// abrir a minuta (`lib/temis/reassinar-midias.ts` → GET ?json=1), e o futuro gerador de contrato
// faz o mesmo via `resolverMidia`. O `path` (a chave duradoura) é recuperável da própria URL
// (`/object/sign/apolo-documents/<path>?token=`). Alternativa rejeitada: bucket público (o bucket
// tem CAD de cliente).
//
// ⚠️ O caminho é escolhido AQUI, pelo servidor, e amarrado à minuta que existe no banco: um corpo
// forjado não grava em cima de outra pasta. O PATCH/GET só aceitam caminho dentro do prefixo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 7 dias: cobre a sessão de edição mais longa e o `conteudo_html` de rascunho entre um salvar e o
// próximo abrir (que re-assina). Curto o bastante para um link vazado morrer sozinho.
export const TTL_LEITURA_MIDIA = 7 * 24 * 60 * 60;
// TTL do GET com redirect (abrir um anexo agora): o mesmo dos documentos do CAD.
const TTL_LEITURA_CURTA = 60 * 10;

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

type CorpoPost = {
  contentType?: unknown;
  fileName?: unknown;
  minutaId?: unknown;
  size?: unknown;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as CorpoPost | null;
  const minutaId = typeof corpo?.minutaId === "string" ? corpo.minutaId.trim() : "";
  const fileName = typeof corpo?.fileName === "string" ? corpo.fileName : "";
  const contentType =
    typeof corpo?.contentType === "string" ? corpo.contentType.trim().toLowerCase() : "";
  const size = typeof corpo?.size === "number" && Number.isFinite(corpo.size) ? corpo.size : -1;

  if (!minutaId || !/^[A-Za-z0-9-]{8,64}$/.test(minutaId)) {
    return NextResponse.json({ error: "Minuta invalida." }, { status: 400 });
  }
  if (!ehTipoAceitoMidia(contentType)) {
    return NextResponse.json(
      { error: "Tipo de arquivo nao aceito na minuta (imagem, video, audio, PDF ou .docx)." },
      { status: 415 },
    );
  }
  // O teto é cobrado de novo no PATCH com o tamanho REAL; aqui é só para não assinar à toa.
  if (size < 0 || size > LIMITE_MIDIA_BYTES) {
    return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
  }

  // A minuta precisa existir: o prefixo do objeto é o id dela.
  const { data: minuta, error: erroMinuta } = await admin
    .from("temis_minutas")
    .select("id")
    .eq("id", minutaId)
    .maybeSingle<{ id: string }>();
  if (erroMinuta) {
    return NextResponse.json({ error: "Nao foi possivel conferir a minuta." }, { status: 500 });
  }
  if (!minuta) {
    return NextResponse.json({ error: "Minuta nao encontrada." }, { status: 404 });
  }

  const caminho = `${PREFIXO_MIDIA}${minuta.id}/${crypto.randomUUID()}-${sanitizarNomeDeMidia(fileName)}`;
  const assinada = await admin.storage.from(APOLO_DOCS_BUCKET).createSignedUploadUrl(caminho);
  if (assinada.error || !assinada.data) {
    console.warn("[temis/upload] createSignedUploadUrl falhou:", assinada.error?.message);
    return NextResponse.json(
      { error: "Nao foi possivel preparar o envio da midia." },
      { status: 500 },
    );
  }

  const resposta: UrlAssinadaDeUpload = {
    bucket: APOLO_DOCS_BUCKET,
    path: assinada.data.path,
    token: assinada.data.token,
  };
  return NextResponse.json(resposta, { headers: SEM_CACHE });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof corpo?.path === "string" ? corpo.path.trim() : "";
  if (!caminhoDeMidiaValido(path)) {
    return NextResponse.json({ error: "Caminho de midia invalido." }, { status: 400 });
  }

  const bucket = admin.storage.from(APOLO_DOCS_BUCKET);

  // Tamanho REAL do objeto. A trava do cliente pode ser burlada; esta não.
  const info = await bucket.info(path);
  if (info.error || !info.data) {
    return NextResponse.json(
      { error: "Arquivo enviado nao foi encontrado no armazenamento." },
      { status: 404 },
    );
  }
  const tamanho = typeof info.data.size === "number" ? info.data.size : -1;
  if (tamanho < 0) {
    return NextResponse.json(
      { error: "Arquivo enviado nao foi encontrado no armazenamento." },
      { status: 404 },
    );
  }
  if (tamanho > LIMITE_MIDIA_BYTES) {
    await bucket.remove([path]);
    return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
  }

  const assinada = await bucket.createSignedUrl(path, TTL_LEITURA_MIDIA);
  if (assinada.error || !assinada.data?.signedUrl) {
    console.warn("[temis/upload] createSignedUrl falhou:", assinada.error?.message);
    return NextResponse.json({ error: "Nao foi possivel gerar o link da midia." }, { status: 500 });
  }

  const nome = path.slice(path.lastIndexOf("/") + 1).replace(/^[0-9a-f-]{36}-/i, "");
  const resposta: MidiaConfirmada = {
    name: nome,
    path,
    size: tamanho,
    type: typeof info.data.contentType === "string" ? info.data.contentType : "",
    url: assinada.data.signedUrl,
  };
  return NextResponse.json(resposta, { headers: SEM_CACHE });
}

// Re-assinatura sob demanda (leitura). É a "rota autenticada" para quem tem o `path` e precisa
// de um link novo: a tela ao abrir a minuta (`?json=1`, porque `<img>` não segue um 302 com Bearer
// — quem pede é o `fetch` da tela, que troca a URL no nó) e o futuro gerador de contrato
// (`resolverMidia`). Sem `json`, é o 302 curto para abrir um anexo no navegador.
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const parametros = new URL(request.url).searchParams;
  const path = (parametros.get("path") ?? "").trim();
  const emJson = parametros.get("json") === "1";
  if (!caminhoDeMidiaValido(path)) {
    return NextResponse.json({ error: "Caminho de midia invalido." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // A URL que vai para o nó do documento tem o prazo da mídia; a do redirect é só para abrir agora.
  const assinada = await admin.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUrl(path, emJson ? TTL_LEITURA_MIDIA : TTL_LEITURA_CURTA);
  if (assinada.error || !assinada.data?.signedUrl) {
    return NextResponse.json({ error: "Midia nao encontrada." }, { status: 404 });
  }

  if (emJson) {
    return NextResponse.json({ path, url: assinada.data.signedUrl }, { headers: SEM_CACHE });
  }
  return NextResponse.redirect(assinada.data.signedUrl, { headers: SEM_CACHE, status: 302 });
}
