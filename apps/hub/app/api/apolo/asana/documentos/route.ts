import { NextResponse } from "next/server";

import { trazerDocumentosDoLote } from "@/lib/apolo/asana-documentos";
import { asanaConfigurado } from "@/lib/apolo/asana-import";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Traz os ANEXOS das CADs já importadas para o Storage do Apolo.
//
// Custo ZERO na MOST: só baixa do Asana e guarda. A leitura por iOCR (cobrada) é outra etapa.
//
// Trabalha em LOTES porque baixar centenas de arquivos não cabe numa requisição só: a tela
// manda um punhado de CADs por vez e vai somando o progresso. Como o dedup é por gid do anexo
// (metadata.asanaAnexoGid), repetir um lote não baixa nada de novo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Teto por chamada. Cada CAD pode ter vários anexos, então o lote é pequeno de propósito.
const MAXIMO_POR_LOTE = 10;

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { gids?: string[] };

  const gids = (body.gids ?? []).filter(Boolean);
  if (gids.length === 0) {
    return NextResponse.json({ error: "Nenhuma CAD no lote." }, { status: 400 });
  }
  if (gids.length > MAXIMO_POR_LOTE) {
    return NextResponse.json(
      { error: `Envie no maximo ${MAXIMO_POR_LOTE} CADs por lote.` },
      { status: 400 },
    );
  }

  // A entidade sai do VÍNCULO já gravado, não de casamento por nome: o documento tem que ir
  // para a ficha que a importação de fato ligou àquela task.
  const { data: vinculos } = await client
    .from("apolo_source_links")
    .select("entity_id, source_id")
    .eq("source_system", "asana")
    .eq("source_table", "cad_task")
    .in("source_id", gids);

  const itens = ((vinculos ?? []) as { entity_id: string; source_id: string }[]).map(
    (linha) => ({
      entityId: linha.entity_id,
      nome: linha.source_id,
      taskGid: linha.source_id,
    }),
  );

  if (itens.length === 0) {
    return NextResponse.json(
      { error: "Estas CADs ainda nao foram importadas: importe antes de trazer os anexos." },
      { status: 409 },
    );
  }

  const resultado = await trazerDocumentosDoLote({ client, itens });
  return NextResponse.json({
    data: { ...resultado, semVinculo: gids.length - itens.length },
  });
}
