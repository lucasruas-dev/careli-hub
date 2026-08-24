import { NextResponse, type NextRequest } from "next/server";

import {
  createPrometeuClient,
  eventoOperavelId,
  getEvento,
} from "@/lib/prometeu/data";
import {
  autorizarOperacao,
  autorizarOperacaoDeEscrita,
} from "@/lib/prometeu/operador-server";
import {
  contadoresDoEvento,
  criarReservaDoEvento,
  quadrasDoEvento,
  validarProponentes,
  type ProponenteDaReserva,
  type UnidadeDisponivel,
} from "@/lib/prometeu/reservas-evento";
import { avisarFilaEmRealtime } from "@/lib/prometeu/realtime-fila";

// A POSIÇÃO DE RESERVA DO LANÇAMENTO (tela touch — Lucas, 24/08/2026).
//
// GET  = quadras com os lotes DISPONÍVEIS + mini dash (reservas · propostas · finalizadas).
// POST = confirma a reserva do credenciado bipado (uma linha por unidade, mesmo grupo_id =
//        o cupom) e avisa o realtime para o telão pintar o lote em segundos.
//
// A regra antiga "reserva vem tudo do C2X" (01/08) vale para REFLETIR o que o corretor lança
// lá; a POSIÇÃO DE RESERVA é o caminho novo do evento e grava no Panteon — o C2X recebe por
// sincronização, fora do caminho crítico.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  let eventoId = (params.get("eventoId") ?? "").trim();
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Nenhum evento em andamento." }, { status: 404 });
  }

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json({ error: "Evento nao encontrado." }, { status: 404 });
  }

  // Bip da etiqueta: resolve o credenciado sem carregar a fila inteira. A tela chama com o
  // uuid lido do QR e recebe nome/etapa para a conferência visual antes de reservar.
  const credenciadoId = (params.get("credenciadoId") ?? "").trim();
  if (credenciadoId) {
    const { data: credenciado } = await client
      .from("prometeu_credenciados")
      .select("id, nome, documento, etapa, evento_id, imobiliaria, corretor")
      .eq("id", credenciadoId)
      .maybeSingle<{
        corretor: null | string;
        documento: null | string;
        etapa: string;
        evento_id: string;
        id: string;
        imobiliaria: null | string;
        nome: string;
      }>();
    if (!credenciado || credenciado.evento_id !== eventoId) {
      return NextResponse.json(
        { error: "Etiqueta nao pertence a este lancamento." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        data: {
          credenciado: {
            corretor: credenciado.corretor,
            documento: credenciado.documento,
            etapa: credenciado.etapa,
            id: credenciado.id,
            imobiliaria: credenciado.imobiliaria,
            nome: credenciado.nome,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [{ error, quadras }, contadores] = await Promise.all([
    quadrasDoEvento(client, evento),
    contadoresDoEvento(client, eventoId),
  ]);
  if (error) {
    return NextResponse.json(
      { error },
      { headers: { "Cache-Control": "no-store" }, status: 502 },
    );
  }

  return NextResponse.json(
    { data: { contadores, eventoId, quadras } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

type CorpoDeReserva = {
  credenciadoId?: unknown;
  eventoId?: unknown;
  proponentes?: unknown;
  unidades?: unknown;
};

export async function POST(request: NextRequest) {
  const auth = await autorizarOperacaoDeEscrita(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as CorpoDeReserva | null;
  const credenciadoId = String(corpo?.credenciadoId ?? "").trim();
  let eventoId = String(corpo?.eventoId ?? "").trim();
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";

  const unidades = Array.isArray(corpo?.unidades)
    ? (corpo.unidades as Array<Record<string, unknown>>)
        .map((u) => ({
          area: String(u.area ?? "").trim(),
          c2xId: String(u.c2xId ?? "").trim(),
          codigo: String(u.codigo ?? "").trim(),
          lote: String(u.lote ?? "").trim(),
          preco: u.preco == null ? null : Number(u.preco),
          quadra: String(u.quadra ?? "").trim(),
        }))
        .filter((u): u is UnidadeDisponivel => Boolean(u.codigo))
    : [];

  if (!eventoId || !credenciadoId || unidades.length === 0) {
    return NextResponse.json(
      { error: "Informe o cliente e ao menos um lote." },
      { status: 400 },
    );
  }

  // Proponentes (até 5, soma 100%): o corpo traz o que a tela montou; o servidor revalida
  // TUDO — números e identidades. Sem proponentes no corpo, o titular assume 100%.
  const proponentesCrus = Array.isArray(corpo?.proponentes)
    ? (corpo.proponentes as Array<Record<string, unknown>>).map((p) => ({
        credenciadoId: String(p.credenciadoId ?? "").trim(),
        documento: p.documento == null ? null : String(p.documento),
        nome: String(p.nome ?? "").trim(),
        percentual: Number(p.percentual ?? 0),
      }))
    : [];

  // O credenciado precisa ser DESTE evento — bipar a etiqueta de outro lançamento não reserva.
  // A mesma regra vale para TODOS os proponentes bipados.
  const idsParaConferir = [
    credenciadoId,
    ...proponentesCrus.map((p) => p.credenciadoId).filter(Boolean),
  ];
  const { data: confirmados } = await client
    .from("prometeu_credenciados")
    .select("id, nome, documento, evento_id")
    .in("id", idsParaConferir);
  const porId = new Map(
    ((confirmados ?? []) as Array<{
      documento: null | string;
      evento_id: string;
      id: string;
      nome: string;
    }>).map((c) => [c.id, c]),
  );

  const credenciado = porId.get(credenciadoId);
  if (!credenciado || credenciado.evento_id !== eventoId) {
    return NextResponse.json(
      { error: "Etiqueta nao pertence a este lancamento." },
      { status: 404 },
    );
  }

  const proponentes: ProponenteDaReserva[] = proponentesCrus.length
    ? proponentesCrus.map((p) => {
        const conferido = porId.get(p.credenciadoId);
        return {
          credenciadoId: p.credenciadoId,
          documento: conferido?.documento ?? p.documento,
          nome: conferido?.nome ?? p.nome,
          percentual: p.percentual,
        };
      })
    : [
        {
          credenciadoId,
          documento: credenciado.documento,
          nome: credenciado.nome,
          percentual: 100,
        },
      ];

  const proponenteForaDoEvento = proponentes.find((p) => {
    const conferido = porId.get(p.credenciadoId);
    return !conferido || conferido.evento_id !== eventoId;
  });
  if (proponenteForaDoEvento) {
    return NextResponse.json(
      { error: `Proponente ${proponenteForaDoEvento.nome || "?"} nao pertence a este lancamento.` },
      { status: 400 },
    );
  }

  const erroProponentes = validarProponentes(proponentes);
  if (erroProponentes) {
    return NextResponse.json({ error: erroProponentes }, { status: 400 });
  }

  const resultado = await criarReservaDoEvento(client, {
    credenciadoId,
    criadoPor: ("userId" in auth ? auth.userId : null) ?? ("operadorId" in auth ? auth.operadorId : null) ?? null,
    criadoPorNome: null,
    eventoId,
    proponentes,
    unidades,
  });

  if (resultado.error || !resultado.grupoId) {
    return NextResponse.json(
      { conflitos: resultado.conflitos ?? [], error: resultado.error ?? "Nao consegui reservar." },
      { status: resultado.conflitos?.length ? 409 : 500 },
    );
  }

  // Telão e Central ficam sabendo em segundos; o poll de 15-20s é a rede de segurança.
  await avisarFilaEmRealtime(eventoId);

  return NextResponse.json({
    data: {
      cliente: credenciado.nome,
      grupoId: resultado.grupoId,
      unidades: unidades.map((u) => u.codigo),
    },
  });
}
