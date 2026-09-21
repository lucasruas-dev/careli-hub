import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { executarVinculoDeUnidades } from "@/lib/apolo/vinculo-de-unidades-servidor";

// VINCULAR A UNIDADE À DIVISÃO E À CATEGORIA — a porta do hub para os três caminhos.
//
// Lucas (21/09/2026): *"eu preciso também vincular as unidades no filho, categoria (quando
// existir), ou seja, eu ainda não tenho esse fluxo pronto e preciso"*.
//
// Os três caminhos batem aqui e na MESMA regra (lib/apolo/vinculo-de-unidades-servidor.ts):
//   • planilha  → `linhas` ou `csv` com Quadra, Lote, Categoria, Divisão;
//   • unitário  → `unidadeIds` com um id só, da ficha da unidade;
//   • em massa  → `unidadeIds` com o que o operador marcou depois de filtrar.
//
// ⚠️ `authorizeApoloWrite` no POST: é escrita em cadastro de estoque. A categoria decide qual minuta
// o lote assina e a divisão decide quem o enxerga no portal — errar aqui sai em contrato.
//
// ⚠️ O GET É LEITURA (`authorizeApoloRead`) e também passa pela mesma função, com `acao: "universo"`:
// a lista que a tela escolhe e a lista que o servidor carimba precisam ser a mesma, senão o operador
// marca um lote que o servidor não vai achar.
//
// ⚠️ ESTA ROTA É DO HUB E NÃO TEM GÊMEA NO PORTAL. Quem opera o portal do incorporador não define
// categoria nem move lote entre glebas: a `/api/incorporador/temis/categorias/unidades` já responde
// 404 na escrita pelo mesmo motivo, e abrir isso é decisão do Lucas, não consequência de uma rota.
//
// Corpo do POST: `{ acao, enterpriseId, codigo?, unidadeIds? | linhas? | csv?, categoriaId?,
// divisaoDestino?, confirmarDivisao?, origem? }`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function responder(resultado: Awaited<ReturnType<typeof executarVinculoDeUnidades>>) {
  if (!resultado.ok) {
    if (resultado.detalhe) {
      console.error("[apolo][unidades/vinculo]", resultado.status, resultado.detalhe);
    }
    return NextResponse.json(
      // ⚠️ O `detalhe` técnico SAI NA RESPOSTA daqui (e não na do portal): quem opera o hub é quem
      // sabe o que fazer com "migration 0181 não aplicada".
      { ...(resultado.detalhe ? { detalhe: resultado.detalhe } : {}), error: resultado.error },
      { headers: { "Cache-Control": "no-store" }, status: resultado.status },
    );
  }
  return NextResponse.json(
    { data: resultado.data },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const resultado = await executarVinculoDeUnidades({
    autor: { id: auth.userId, nome: auth.nome },
    corpo: {
      acao: "universo",
      categoriaId: params.get("categoriaId"),
      codigo: params.get("codigo"),
      enterpriseId: params.get("enterpriseId"),
      filtro: {
        categoria: params.get("categoria") ?? undefined,
        divisoes: (params.get("divisoes") ?? "").split(",").filter(Boolean),
        faixa: params.get("faixa"),
        quadras: (params.get("quadras") ?? "").split(",").filter(Boolean),
        situacoes: (params.get("situacoes") ?? "").split(",").filter(Boolean),
        termo: params.get("termo"),
      },
    },
  });

  return responder(resultado);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const resultado = await executarVinculoDeUnidades({
    autor: { id: auth.userId, nome: auth.nome },
    corpo,
  });

  return responder(resultado);
}
