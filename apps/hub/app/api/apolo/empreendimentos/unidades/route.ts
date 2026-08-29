import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";
import { createPrometeuClient, eventoOperavelId } from "@/lib/prometeu/data";
import { topicoDaFila } from "@/lib/prometeu/fila-topic";

// Unidades de um empreendimento. Aceita N códigos (?codes=LBR,LBP,LBF) porque a linha da
// tela pode ser um produto consolidado (regra ENTERPRISE_GROUPS).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

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

  try {
    const result = await loadApoloEnterpriseUnits(codes);

    // EM QUAL CANAL A TELA ESCUTA para saber que uma reserva aconteceu no salão.
    //
    // ⚠️ Realtime, e não poll: a regra de custo do Panteon é explícita depois do incidente de
    // fatura do Hermes — não aumentar polling, preferir broadcast. Uma tela de backoffice fica
    // aberta o dia inteiro; um poll de minuto nela custaria uma consulta ao C2X por minuto por
    // pessoa, o dia todo, para uma mudança que acontece algumas vezes por hora e só durante o
    // evento.
    //
    // Sem evento operável, não há canal e a tela simplesmente não escuta nada.
    const topico = await (async (): Promise<null | string> => {
      try {
        const prometeu = createPrometeuClient();
        if (!prometeu) return null;
        const eventoId = await eventoOperavelId(prometeu);
        return eventoId ? topicoDaFila(eventoId) : null;
      } catch {
        return null;
      }
    })();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: { realtime: { topico }, units: result.units } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar unidades", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar as unidades." },
      { status: 500 },
    );
  }
}
