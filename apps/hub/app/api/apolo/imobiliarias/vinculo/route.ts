import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  listarImobiliariasDasCads,
  salvarMatchImobiliaria,
} from "@/lib/apolo/imobiliaria-match";
import { createApoloAdminClient } from "@/lib/apolo/server";

// DE-PARA das imobiliárias das CADs -> entidade do Apolo (ferramenta interna).
//   GET  = os nomes-texto das CADs, com a contagem de CADs e o match atual.
//   POST = salva/desfaz o casamento de um nome com uma entidade.
// As ENTIDADES candidatas (papel imobiliaria) vêm da rota /api/apolo/imobiliarias.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const lista = await listarImobiliariasDasCads(client);
  const vinculadas = lista.filter((i) => i.entidade).length;

  return NextResponse.json(
    {
      data: {
        imobiliarias: lista,
        resumo: {
          cadsVinculadas: lista.filter((i) => i.entidade).reduce((s, i) => s + i.cads, 0),
          pendentes: lista.length - vinculadas,
          total: lista.length,
          vinculadas,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as {
    entityId?: string | null;
    nomeTexto?: string;
  };
  if (!corpo.nomeTexto?.trim()) {
    return NextResponse.json({ error: "Informe a imobiliária." }, { status: 400 });
  }

  const r = await salvarMatchImobiliaria(client, {
    entityId: corpo.entityId ?? null,
    nomeTexto: corpo.nomeTexto,
    userId: auth.userId,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}
