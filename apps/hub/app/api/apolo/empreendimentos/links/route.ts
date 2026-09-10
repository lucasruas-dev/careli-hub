import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { linksDoEmpreendimento } from "@/lib/hercules/links-do-empreendimento";
import { topoDaArvoreDeAlgum } from "@/lib/hercules/masterplan-do-empreendimento";

// Os links públicos de um empreendimento, para a aba Links da ficha (Apolo).
//
// ⚠️ ROTA AUTENTICADA, ainda que o CONTEÚDO dela seja público. O que ela devolve é o link do
// espelho já assinado — quem tem o link abre o mapa sem login. Deixá-la aberta transformaria a
// rota num emissor de links para qualquer um que soubesse um código de empreendimento, o que é
// exatamente o que o token existe para impedir. Ela NÃO entra em PUBLIC_API_PREFIXES do proxy.ts.
//
// Aceita N códigos (?codes=LBR,LBP,LBF) pelo mesmo motivo da rota de unidades: a linha da tela
// pode ser um produto consolidado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  const codes = (new URL(request.url).searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (!codes.length) {
    return NextResponse.json(
      { error: "Informe ao menos um codigo de empreendimento." },
      { status: 400 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  try {
    const topo = await topoDaArvoreDeAlgum(client, codes);

    return NextResponse.json(
      {
        data: {
          // `doPai` é o que deixa a tela dizer "o mapa é do produto pai" em vez de fingir que o
          // espelho do VOC é um espelho só do VOC.
          doPai: topo?.doPai ?? false,
          links: linksDoEmpreendimento({
            codigoDoTopo: topo?.codigo ?? null,
            nomeDoTopo: topo?.nome ?? null,
            temMapa: topo?.temMapa ?? false,
          }),
        },
      },
      // no-store: a resposta carrega um link assinado. Não é para ficar em cache de CDN.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao montar links", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar os links." },
      { status: 500 },
    );
  }
}
