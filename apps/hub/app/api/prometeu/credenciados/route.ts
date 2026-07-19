import { NextResponse } from "next/server";

import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  adicionarCredenciado,
  ajustarOrdem,
  createPrometeuClient,
  fazerCheckIn,
  marcarEtiquetaImpressa,
  moverEtapa,
  registrarPagamento,
} from "@/lib/prometeu/data";
import { PROMETEU_ETAPAS, type PrometeuEtapa } from "@/lib/prometeu/types";

// POST  = poe alguem no evento.
// PATCH = age sobre quem ja esta: mover de etapa, confirmar PIX, marcar etiqueta impressa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    corretor?: string;
    documento?: string;
    entityId?: string;
    eventoId?: string;
    imobiliaria?: string;
    nome?: string;
    origem?: string;
    origemRef?: string;
    pagoEm?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  // Unidades (quadra/lote) NAO entram aqui: sao reserva feita no salao, durante o evento.
  const { credenciadoId, error } = await adicionarCredenciado({
    client,
    corretor: body.corretor ?? null,
    documento: body.documento ?? null,
    entityId: body.entityId ?? null,
    eventoId: body.eventoId,
    imobiliaria: body.imobiliaria ?? null,
    nome: body.nome ?? "",
    origem: body.origem ?? "manual",
    origemRef: body.origemRef ?? null,
    pagoEm: body.pagoEm ?? null,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ data: { credenciadoId } });
}

export async function PATCH(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    acao?: "mover" | "pagamento" | "etiqueta" | "checkin" | "ordem";
    credenciadoId?: string;
    etapa?: string;
    eventoId?: string;
    motivo?: string;
    ordemAnterior?: number | null;
    ordemSeguinte?: number | null;
    pagoEm?: string;
  };

  if (!body.credenciadoId) {
    return NextResponse.json({ error: "Informe o credenciadoId." }, { status: 400 });
  }

  if (body.acao === "mover") {
    const etapa = body.etapa ?? "";
    if (!PROMETEU_ETAPAS.some((e) => e.id === etapa)) {
      return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
    }

    const { error, ok } = await moverEtapa({
      client,
      credenciadoId: body.credenciadoId,
      motivo: body.motivo ?? null,
      para: etapa as PrometeuEtapa,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  if (body.acao === "pagamento") {
    const { error, ok } = await registrarPagamento({
      client,
      credenciadoId: body.credenciadoId,
      pagoEm: body.pagoEm,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  // O bip do QR na recepcao. Grava se estava dentro da janela NAQUELE instante.
  if (body.acao === "checkin") {
    if (!body.eventoId) {
      return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
    }

    const { error, naJanela, ok } = await fazerCheckIn({
      client,
      credenciadoId: body.credenciadoId,
      eventoId: body.eventoId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { naJanela, ok: true } });
  }

  // Admin furando a fila: exige motivo e fica auditado.
  if (body.acao === "ordem") {
    const { error, ok, ordem } = await ajustarOrdem({
      client,
      credenciadoId: body.credenciadoId,
      motivo: body.motivo ?? "",
      ordemAnterior: body.ordemAnterior ?? null,
      ordemSeguinte: body.ordemSeguinte ?? null,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true, ordem } });
  }

  if (body.acao === "etiqueta") {
    await marcarEtiquetaImpressa(client, body.credenciadoId);
    return NextResponse.json({ data: { ok: true } });
  }

  return NextResponse.json({ error: "Acao desconhecida." }, { status: 400 });
}
