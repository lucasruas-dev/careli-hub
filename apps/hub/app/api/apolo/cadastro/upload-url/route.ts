import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  criarUrlDeUploadApoloDocument,
  donoUploadOperador,
} from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Esta rota NÃO recebe o arquivo: devolve uma URL assinada e o browser grava os bytes DIRETO no
// Storage. É o caminho do documento GRANDE do wizard de cadastro — a Vercel corta o corpo da
// requisição em ~4,5MB e o base64 ainda infla o arquivo em ~33%, então documento acima do teto
// não tem como viajar dentro do JSON de /api/apolo/cadastro/salvar.
//
// Mesmo padrão que já roda em produção na PA do Prometeu e no anexo do Hub IT. O documento PEQUENO
// continua indo por dentro do JSON, sem passar por aqui.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { fileName?: unknown } | null;

  try {
    // O caminho é escolhido AQUI e amarrado ao operador logado: o /salvar só aceita caminho que
    // comece pelo prefixo dele. Assim um corpo forjado não aponta o documento para o arquivo de
    // outra pessoa.
    const assinada = await criarUrlDeUploadApoloDocument({
      adminClient,
      dono: donoUploadOperador(authorization.userId),
      fileName: typeof body?.fileName === "string" ? body.fileName : "",
    });

    return NextResponse.json(assinada, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel preparar o envio do documento." },
      { status: 500 },
    );
  }
}
