import { NextResponse } from "next/server";

import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import {
  BUCKET_DO_ESPELHO,
  CACHE_IMUTAVEL,
  caminhoDaGeometria,
} from "@/lib/hercules/espelho/pecas-do-espelho";

// A GEOMETRIA DO ESPELHO — os contornos dos lotes e o viewBox, em JSON.
//
// 0,02 a 0,26 MB, contra a arte de 0,56 a 2,77 MB. São duas peças separadas porque têm ciclos
// iguais (as duas imutáveis) mas tamanhos muito diferentes: a tela pode desenhar os contornos e
// pintar as cores antes de a foto terminar de baixar, e no 4G isso é a diferença entre um mapa
// que aparece em um segundo e um que aparece em cinco.
//
// ⚠️ NÃO CARREGA SITUAÇÃO NENHUMA. Só código do lote e o `d` do contorno. A situação vem da rota
// irmã, `no-store` — juntá-las faria o navegador rebaixar os contornos inteiros toda vez que um
// lote fosse vendido.
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

  if (!masterplan) {
    return NextResponse.json(
      { error: "Este empreendimento não tem masterplan publicado." },
      { status: 404 },
    );
  }

  const { data, error } = await client.storage
    .from(BUCKET_DO_ESPELHO)
    .download(caminhoDaGeometria(codigo, masterplan.versao));

  if (error || !data) {
    console.error(
      `[publico][espelho] geometria ausente para ${codigo} v${masterplan.versao}.`,
      "Rode scripts/hercules/preparar-espelho.mts --pai",
      codigo,
      "--gravar",
    );
    return NextResponse.json({ error: "Mapa em preparação." }, { status: 503 });
  }

  // Repassa o JSON como veio: ele foi gravado pronto pelo preparo, e reserializar aqui só gastaria
  // CPU para produzir os mesmos bytes.
  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Cache-Control": CACHE_IMUTAVEL,
      "Content-Type": "application/json",
    },
  });
}
