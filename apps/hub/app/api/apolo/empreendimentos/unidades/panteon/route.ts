import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { executarCadastroDeUnidades } from "@/lib/hercules/cadastrar-unidades-panteon-server";

// CADASTRAR UNIDADES NO PANTEON PELO HUB: a porta interna da mesma regra do portal.
//
// Decisão do Lucas (16/09/2026): unidade nova grava no Panteon (`hercules_unidades`), nunca no C2X,
// que é somente leitura. A rota irmã /api/apolo/empreendimentos/unidades/cadastrar continua sendo a
// escrita NO LEGADO (e é de lá que vêm os avisos sobre o destino do C2X); esta aqui não toca no
// legado. A regra inteira (conferir, criar, importar, atualizar) mora em
// lib/hercules/cadastrar-unidades-panteon-server.ts, a MESMA que o portal do incorporador chama
// (/api/incorporador/produto/unidades/cadastrar): o hub e o portal não podem aceitar unidades
// diferentes.
//
// ⚠️ `authorizeApoloWrite` (e não `Read`): é escrita em estoque, e unidade errada aparece no mapa,
// no VGV e na tela Venda. O time da Careli alcança qualquer produto, então não há recorte por
// sessão aqui; o produto, o tipo (loteamento ou prédio) e o código vêm do cadastro do Panteon,
// nunca do corpo.
//
// Corpo: `{ acao, enterpriseId, linhas? | csv? | unidade? | unidadeId? + campos? }`. O
// `enterpriseId` é o id do produto ("37", "100001") ou "pai:<uuid>".
//
// ⚠️ O `detalhe` técnico SAI NA RESPOSTA daqui (e não na do portal): quem opera o hub é quem sabe
// o que fazer com "migration 0171 não aplicada".
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const pedido = String(corpo.enterpriseId ?? "").trim();
  if (!pedido) {
    return NextResponse.json({ error: "Empreendimento não informado." }, { status: 400 });
  }

  const resultado = await executarCadastroDeUnidades({
    autor: { id: auth.userId, nome: auth.nome },
    corpo,
    pedido,
  });

  if (!resultado.ok) {
    if (resultado.detalhe) {
      console.error("[apolo][empreendimentos/unidades/panteon]", resultado.status, resultado.detalhe);
    }
    return NextResponse.json(
      {
        ...(resultado.data === undefined ? {} : { data: resultado.data }),
        ...(resultado.detalhe ? { detalhe: resultado.detalhe } : {}),
        error: resultado.error,
      },
      { headers: { "Cache-Control": "no-store" }, status: resultado.status },
    );
  }

  return NextResponse.json(
    { data: resultado.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
