import { NextResponse } from "next/server";

import {
  aplicarVinculos,
  asanaConfigurado,
  casarComApolo,
  escanearCads,
} from "@/lib/apolo/asana-import";
import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Importação das CADs do Asana para o Board.
//
// GET  = PREVIEW. Read-only, custo ZERO (nenhum documento é lido). Devolve as CADs do
//        empreendimento/seções pedidos já casadas com as entidades do Apolo, separadas em
//        casou / ambíguo / não casou / já importado.
// POST = APLICA. Grava o vínculo de origem e a etapa da esteira SÓ dos itens que vierem na
//        lista — quem decide é a pessoa na tela, não o servidor.
//
// O primeiro lote é a seção "Finalizado" do Vale do Ouro, que já tem cadastro no Apolo: casa
// por nome e marca como credenciado, sem gastar um centavo de iOCR.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A varredura pagina o projeto inteiro do Asana.
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const url = new URL(request.url);
  const empreendimento = url.searchParams.get("empreendimento")?.trim() || "Vale do Ouro";
  const secoes = (url.searchParams.get("secoes") ?? "Finalizado")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { cads, diagnostico, secoesEncontradas } = await escanearCads({
      empreendimento,
      secoes,
    });
    const preview = await casarComApolo(client, cads);

    return NextResponse.json(
      { data: { ...preview, diagnostico, empreendimento, secoes, secoesEncontradas } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    confirmado?: boolean;
    etapa?: "validacao" | "credenciado";
    itens?: { entityId: string; gid: string; secao: string }[];
  };

  if (!body.confirmado) {
    return NextResponse.json(
      { error: "Confirme a importacao na tela antes de aplicar." },
      { status: 428 },
    );
  }

  const itens = (body.itens ?? []).filter((i) => i?.entityId && i?.gid);
  if (itens.length === 0) {
    return NextResponse.json({ error: "Nenhum item para importar." }, { status: 400 });
  }

  const etapa = body.etapa === "validacao" ? "validacao" : "credenciado";

  const resultado = await aplicarVinculos({
    client,
    etapa,
    itens,
    porUsuario: auth.userId,
  });

  return NextResponse.json({ data: resultado });
}
