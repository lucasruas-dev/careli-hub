import { NextResponse } from "next/server";

import { criarUrlDeUploadDaPa, registrarPa, urlParaVerPa } from "@/lib/prometeu/pa";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";

// A PA (proposta em A4) fotografada no bip da secretaria.
//
// Aceita o OPERADOR do evento, como os bips: quem fotografa e' o organizador de posto, que no
// dia e' freela e nao tem login do hub.
//
// POST  { credenciadoId, eventoId }            -> devolve URL assinada; o celular manda os
//                                                 bytes DIRETO pro Storage (a foto de um A4
//                                                 passa dos 4,5 MB que a Vercel aceita no body)
// PATCH { credenciadoId, path }                -> carimba a PA no credenciado
// GET   ?path=...                              -> URL temporaria pra ABRIR a PA (bucket privado)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    credenciadoId?: string;
    eventoId?: string;
  };

  if (!body.credenciadoId || !body.eventoId) {
    return NextResponse.json(
      { error: "Informe credenciadoId e eventoId." },
      { status: 400 },
    );
  }

  try {
    const upload = await criarUrlDeUploadDaPa({
      credenciadoId: body.credenciadoId,
      eventoId: body.eventoId,
    });

    return NextResponse.json({ data: upload });
  } catch (erro) {
    return NextResponse.json(
      { error: erro instanceof Error ? erro.message : "Falha ao preparar a PA." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    credenciadoId?: string;
    path?: string;
  };

  if (!body.credenciadoId) {
    return NextResponse.json({ error: "Informe o credenciadoId." }, { status: 400 });
  }

  // `path` vazio e' recusado dentro de `registrarPa`: PA sem arquivo nao pode virar registro,
  // senao a tela promete um documento que nao existe pro atendente remoto.
  const { error, ok } = await registrarPa({
    credenciadoId: body.credenciadoId,
    path: body.path ?? "",
    registradaPor: auth.operadorId ?? null,
  });

  if (!ok) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json({ data: { ok: true } });
}

export async function GET(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const path = new URL(request.url).searchParams.get("path") ?? "";

  if (!path) {
    return NextResponse.json({ error: "Informe o caminho da PA." }, { status: 400 });
  }

  const url = await urlParaVerPa(path);

  if (!url) {
    return NextResponse.json({ error: "PA nao encontrada." }, { status: 404 });
  }

  return NextResponse.json(
    { data: { url } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
