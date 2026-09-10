import { NextResponse } from "next/server";

import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import {
  BUCKET_DO_ESPELHO,
  CACHE_IMUTAVEL,
  caminhoDaArte,
} from "@/lib/hercules/espelho/pecas-do-espelho";

// A ARTE DO ESPELHO — a planta do loteamento, em WebP.
//
// ⚠️ OS BYTES PASSAM POR AQUI; A URL DO STORAGE NÃO SAI. O bucket `apolo-documents` é privado e
// guarda documento de cliente. Devolver uma URL assinada daria ao visitante uma credencial de
// leitura no mesmo bucket, ainda que apontada para um arquivo — e URL assinada vaza no histórico,
// no Referer e em qualquer print. Fazer proxy custa a banda, e a banda está paga: com
// `immutable`, a CDN serve o arquivo e esta função roda uma vez por versão.
//
// ⚠️ E É A PEÇA QUE JUSTIFICA O RESTO. O SVG de onde ela sai tem 2,8 a 24,9 MB, quase tudo foto;
// esta arte tem 0,56 a 2,77 MB e nunca muda. É por isso que a situação viaja separada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("e");
  const aberto = await abrirEspelho(token);

  if (!aberto.ok) {
    return NextResponse.json(
      { error: ERRO_GENERICO },
      { status: aberto.erro === "sem_token" ? 401 : 503 },
    );
  }

  const { client, codigo, masterplan } = aberto.espelho;

  // Sem masterplan publicado o empreendimento abre na grade — não há arte, e isso é 404 e não
  // erro: a página nem chega a pedir.
  if (!masterplan) {
    return NextResponse.json(
      { error: "Este empreendimento não tem masterplan publicado." },
      { status: 404 },
    );
  }

  const { data, error } = await client.storage
    .from(BUCKET_DO_ESPELHO)
    .download(caminhoDaArte(codigo, masterplan.versao));

  if (error || !data) {
    // ⚠️ ACONTECE QUANDO O MASTERPLAN FOI PUBLICADO MAS O ESPELHO NÃO FOI PREPARADO. O conserto é
    // rodar `scripts/hercules/preparar-espelho.mts --pai <cod> --gravar`, e a mensagem de log tem
    // de dizer isso — senão vira caça ao fantasma.
    console.error(
      `[publico][espelho] arte ausente para ${codigo} v${masterplan.versao}.`,
      "Rode scripts/hercules/preparar-espelho.mts --pai",
      codigo,
      "--gravar",
    );
    return NextResponse.json(
      { error: "Mapa em preparação." },
      { status: 503 },
    );
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      // Imutável por um ano: a versão está no caminho, então nunca serve mapa velho.
      "Cache-Control": CACHE_IMUTAVEL,
      "Content-Type": "image/webp",
    },
  });
}
