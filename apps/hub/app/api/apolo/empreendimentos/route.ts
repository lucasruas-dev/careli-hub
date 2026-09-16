import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { linhasDoPanteonParaApolo } from "@/lib/apolo/empreendimentos-do-panteon";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";

// Cenário comercial dos empreendimentos (lê o C2X read-only + regra de governança do Hades).
//
// ⚠️ E OS PRODUTOS NASCIDOS NO PANTEON (16/09/2026, achado 27 da onda 2). O prédio cadastrado pelo
// hub ou pelo portal (id a partir de 100000) não existe no C2X, e a lista lia só o C2X: ele ficava
// sem ficha, sem unidades e sem Setup. As linhas dele entram DEPOIS das do C2X, com o cenário zerado
// (ver lib/apolo/empreendimentos-do-panteon.ts).
//
// ⚠️ AS DUAS FONTES CAEM DIFERENTE. C2X fora continua 503, como sempre: é ele que dá os números da
// tela, e uma lista só com os produtos novos esconderia a queda. Cadastro fora = a lista do C2X de
// antes, com aviso no log: perder a linha do produto novo por um instante é melhor que derrubar a
// tela inteira de quem só queria abrir o Garden.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    // Em paralelo: o cadastro é uma leitura curta no Supabase e não deve somar latência à do C2X.
    const [result, cadastro] = await Promise.all([
      loadApoloEnterprises(),
      carregarCadastroDeEmpreendimentos().catch((erro: unknown): LinhaDoCadastro[] | null => {
        console.warn(
          "[apolo][empreendimentos] cadastro do Panteon indisponível; a lista sai só com o C2X",
          erro instanceof Error ? erro.message : erro,
        );
        return null;
      }),
    ]);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    const doPanteon = cadastro ? linhasDoPanteonParaApolo(cadastro, result.data.rows) : [];

    return NextResponse.json(
      {
        data: doPanteon.length
          ? { ...result.data, rows: [...result.data.rows, ...doPanteon] }
          : result.data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar", error);

    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos." },
      { status: 500 },
    );
  }
}
