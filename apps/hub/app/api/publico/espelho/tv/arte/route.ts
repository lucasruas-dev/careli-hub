import { NextResponse } from "next/server";

import { abrirTelaDeTv } from "@/lib/hercules/espelho/abrir-tela-de-tv";
import { BUCKET_DO_ESPELHO, CACHE_IMUTAVEL, caminhoDaArte } from "@/lib/hercules/espelho/pecas-do-espelho";

// A ARTE DO MAPA NA TV DO STAND — a foto aérea do loteamento, em WebP.
//
// ⚠️ ENDEREÇADA POR SLUG (`?t=garden&v=1`), pelo mesmo motivo da rota irmã de situação: o token do
// espelho não pode aparecer no `src` de uma imagem numa página que qualquer um abre digitando 20
// caracteres. Ver o cabeçalho de `abrir-tela-de-tv.ts`.
//
// ⚠️ OS BYTES PASSAM POR AQUI; A URL DO STORAGE NÃO SAI. `apolo-documents` é privado e guarda
// documento de cliente. URL assinada daria ao visitante uma credencial de leitura no bucket, e ela
// vaza no histórico, no Referer e em qualquer print. Fazer proxy custa banda, e a banda está paga:
// com `immutable`, a CDN serve o arquivo e esta função roda uma vez por versão.
//
// ⚠️ O `v` NÃO ESCOLHE A VERSÃO — ELE É A CHAVE DE CACHE, e existe porque `immutable` sem ele
// mente. O caminho no bucket tem a versão (`GDN/v1-arte.webp`), mas a URL não teria: publicar um
// masterplan v2 deixaria a CDN servindo o desenho v1 por UM ANO, e a única saída seria trocar a URL
// na mão. Com `v` na querystring, a página emite `?v=2` no dia da publicação e o endereço muda
// sozinho. A rota serve SEMPRE a versão publicada hoje, mesmo que chegue um `v` velho: a TV que
// ficou dias com a página aberta tem de ver o mapa novo, não um 404 no meio do stand.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("t");
  const aberto = await abrirTelaDeTv(slug);

  if (!aberto.ok) {
    return NextResponse.json(
      { error: aberto.erro === "sem_tela" ? "Tela não encontrada." : "Indisponível no momento." },
      { status: aberto.erro === "sem_tela" ? 404 : 503 },
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
    .download(caminhoDaArte(codigo, masterplan.versao));

  if (error || !data) {
    // Acontece quando o masterplan foi publicado mas o espelho não foi preparado. A mensagem tem
    // de dizer o conserto, senão vira caça ao fantasma com a TV apagada no stand.
    console.error(
      `[publico][tv] arte ausente para ${codigo} v${masterplan.versao}.`,
      "Rode scripts/hercules/preparar-espelho.mts --pai",
      codigo,
      "--gravar",
    );
    return NextResponse.json({ error: "Mapa em preparação." }, { status: 503 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Cache-Control": CACHE_IMUTAVEL,
      "Content-Type": "image/webp",
    },
  });
}
