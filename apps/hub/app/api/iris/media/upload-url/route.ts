import { NextResponse, type NextRequest } from "next/server";

import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";
import {
  IRIS_MEDIA_BUCKET,
  garantirBucketIrisMedia,
} from "@/lib/iris/meta-media-storage";

// ASSINA o upload direto do anexo para o Storage. NÃO recebe arquivo.
//
// ⚠️ POR QUE ISTO EXISTE: o anexo da Iris viajava em base64 dentro do JSON, e **a Vercel corta o
// corpo de qualquer requisição serverless em 4,5MB** — limite de plataforma, não configurável no
// App Router. Como base64 infla ~33%, o teto real de arquivo era ~3,3MB, e era por isso que a
// tela recusava acima de 3MB: não era escolha, era o que cabia.
//
// Com a URL assinada, o navegador manda o arquivo DIRETO para o Supabase Storage (que não tem
// esse teto) e só a REFERÊNCIA volta para a nossa rota. É o mesmo padrão já em produção no
// Hermes, no Prometeu e no cadastro do Apolo — estratégia do Lucas: "se for um arquivo grande
// ele vai direto, se não segue o fluxo".
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão preservada para o WhatsApp mostrar o ícone certo e o cliente salvar com o nome certo.
function extensaoDe(nome: string): string {
  const limpo = nome.trim().toLowerCase();
  const ponto = limpo.lastIndexOf(".");

  if (ponto <= 0 || ponto === limpo.length - 1) {
    return "";
  }

  const ext = limpo.slice(ponto).replace(/[^a-z0-9.]/g, "");

  return ext.length <= 12 ? ext : "";
}

export async function POST(request: NextRequest) {
  const auth = await authorizeIrisMetaRequest(request);
  if (!auth.ok) return auth.response;

  const client = createIrisMetaAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as { fileName?: unknown };
  const fileName = typeof corpo.fileName === "string" ? corpo.fileName : "";

  await garantirBucketIrisMedia(client);

  // O caminho é montado AQUI, nunca vem do cliente: com o path livre, alguém poderia sobrescrever
  // a mídia de outra conversa. `outbound-direto/` separa do que a rota de envio já grava.
  const caminho = `outbound-direto/${crypto.randomUUID()}${extensaoDe(fileName)}`;
  const assinado = await client.storage
    .from(IRIS_MEDIA_BUCKET)
    .createSignedUploadUrl(caminho);

  if (assinado.error || !assinado.data) {
    return NextResponse.json(
      { error: "Nao foi possivel preparar o envio do anexo." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      path: assinado.data.path,
      token: assinado.data.token,
      url: client.storage.from(IRIS_MEDIA_BUCKET).getPublicUrl(caminho).data.publicUrl,
    },
  });
}
