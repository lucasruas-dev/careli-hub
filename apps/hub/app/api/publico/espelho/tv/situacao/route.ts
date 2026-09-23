import { NextResponse } from "next/server";

import { abrirTelaDeTv } from "@/lib/hercules/espelho/abrir-tela-de-tv";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { SEM_CACHE } from "@/lib/hercules/espelho/pecas-do-espelho";
import { estadoParaTv } from "@/lib/hercules/espelho/telas-de-tv";

// A SITUAÇÃO DOS LOTES NA TV DO STAND — a única peça desta tela que muda.
//
// ⚠️ ENDEREÇADA POR SLUG (`?t=garden`), E NÃO PELO TOKEN DO ESPELHO. A página `/tv/<slug>` é
// pública e sem selo: o que ela mandar para o navegador, qualquer um lê. O token do espelho abre o
// espelho COMPLETO (preço e área dos 404 lotes, mais o simulador), então ele fica no servidor e o
// que atravessa é o slug. Ver o cabeçalho de `abrir-tela-de-tv.ts`.
//
// ⚠️ E SAEM DAQUI DUAS COISAS POR LOTE: o código do contorno e a cor. `estadoParaTv` é o funil, e
// ele monta objeto novo em vez de espalhar o lote do espelho — sem isso, preço de tabela, área,
// rótulo e quadra sairiam juntos ([[telas-de-tv.test.ts]] prova, e a prova falha se alguém trocar
// por `{ ...lote }`).
//
// ⚠️ `no-store`, PELO MESMO PRECEDENTE CARO DE SEMPRE. A rota irmã do telão do Prometeu rodou com
// `s-maxage=10, stale-while-revalidate=30` e a projeção mostrou um lote VERDE por 40 segundos
// DEPOIS de ele ter sido reservado, na frente do salão. `cache: "no-store"` no fetch do navegador
// não alcança a CDN — quem decide é o header da resposta. Numa TV de stand, ligada o dia todo, o
// estrago é o mesmo: um cliente escolhendo, e um corretor prometendo, um lote que já tem dono.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A régua única lê as linhas do produto, as antigas que apontam para elas e o processo vivo
// (propostas e as duas reservas), em páginas de 1.000. O Garden tem 404 unidades. Folga.
export const maxDuration = 30;

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("t");
  const aberto = await abrirTelaDeTv(slug);

  if (!aberto.ok) {
    return NextResponse.json(
      { error: aberto.erro === "sem_tela" ? "Tela não encontrada." : "Indisponível no momento." },
      { headers: { "Cache-Control": SEM_CACHE }, status: aberto.erro === "sem_tela" ? 404 : 503 },
    );
  }

  const { client, filhosC2xIds, paiC2xId } = aberto.espelho;

  try {
    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: paiC2xId,
      enterpriseIdsDosFilhos: filhosC2xIds,
    });

    return NextResponse.json(
      { data: estadoParaTv(estado) },
      { headers: { "Cache-Control": SEM_CACHE } },
    );
  } catch (error) {
    console.error("[publico][tv] falha ao montar a situacao", error);

    // ⚠️ ERRO É ERRO, E NUNCA `lotes: []` COM 200. Lista vazia faria a tela do stand apagar as
    // cores e ficar só com a foto aérea — que se lê como "o loteamento inteiro está livre". A TV
    // trata o 503 mantendo o último mapa bom desenhado ([[TelaoDeVendas.tsx]]).
    return NextResponse.json(
      { error: "Indisponível no momento." },
      { headers: { "Cache-Control": SEM_CACHE }, status: 503 },
    );
  }
}
