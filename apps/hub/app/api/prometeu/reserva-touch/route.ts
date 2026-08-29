import { NextResponse, type NextRequest } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";

import {
  adicionarCredenciado,
  createPrometeuClient,
  eventoOperavelId,
  getEvento,
} from "@/lib/prometeu/data";
import { identidadeCanonicaDoCredenciado } from "@/lib/prometeu/identidade-do-credenciado";
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
import { origemDoClienteParaExibir } from "@/lib/prometeu/identificacao-do-cliente";
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
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  const params = new URL(request.url).searchParams;
  let eventoId = (params.get("eventoId") ?? "").trim();
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";
  if (!eventoId) {
    return NextResponse.json(
      { error: "Nenhum evento em andamento." },
      { status: 404 },
    );
  }

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json(
      { error: "Evento nao encontrado." },
      { status: 404 },
    );
  }

  // Bip da etiqueta: resolve o credenciado sem carregar a fila inteira. A tela chama com o
  // uuid lido do QR e recebe nome/etapa para a conferência visual antes de reservar.
  const credenciadoId = (params.get("credenciadoId") ?? "").trim();
  if (credenciadoId) {
    const { data: credenciado } = await client
      .from("prometeu_credenciados")
      .select(
        "id, nome, documento, etapa, evento_id, entity_id, imobiliaria, corretor",
      )
      .eq("id", credenciadoId)
      .maybeSingle<{
        corretor: null | string;
        documento: null | string;
        entity_id: null | string;
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
    // ⚠️ O TÓTEM TEM QUE FALAR A MESMA COISA QUE A ETIQUETA: nome e imobiliária saem da ENTIDADE
    // do Apolo, como em `listCredenciados`, e não das colunas cruas — que guardam o retrato do
    // dia do credenciamento e a grafia livre da esteira. Ver lib/prometeu/identidade-do-credenciado.ts.
    const identidade = await identidadeCanonicaDoCredenciado(
      client,
      credenciado,
    );
    return NextResponse.json(
      {
        data: {
          credenciado: {
            corretor: identidade.corretor,
            documento: credenciado.documento,
            etapa: credenciado.etapa,
            id: credenciado.id,
            imobiliaria: identidade.imobiliaria,
            nome: identidade.nome,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ⚠️ BUSCA MANUAL — o mesmo cliente, sem o leitor (Lucas, 29/08/2026: *"não estamos com
  // etiqueta funcionando, vou precisar fazer manual, consegue liberar para eu reservar a
  // unidade direto sem o bip?"*).
  //
  // Devolve uma LISTA para o operador escolher com o dedo, e não o primeiro que casar: no salão
  // existem homônimos e famílias inteiras credenciadas, e reservar no cliente errado é o tipo de
  // engano que só aparece na hora de assinar. Busca por nome OU por CPF (com ou sem pontuação).
  const termo = (params.get("busca") ?? "").trim();
  if (termo) {
    if (termo.length < 3) {
      return NextResponse.json(
        { error: "Digite ao menos 3 letras do nome ou o CPF." },
        { status: 400 },
      );
    }
    const digitos = termo.replace(/\D/g, "");
    // O documento é gravado com pontuação; comparar só os dígitos exigiria varrer tudo, então a
    // busca por CPF usa `like` no formato gravado e nos dígitos crus.
    const filtro = [
      `nome.ilike.%${termo}%`,
      ...(digitos.length >= 3 ? [`documento.ilike.%${digitos}%`, `documento.ilike.%${termo}%`] : []),
    ].join(",");
    const { data: achados } = await client
      .from("prometeu_credenciados")
      .select("id, nome, documento, etapa, evento_id, entity_id, imobiliaria, corretor")
      .eq("evento_id", eventoId)
      .or(filtro)
      .order("nome")
      .limit(25);

    const lista = await Promise.all(
      ((achados ?? []) as {
        corretor: null | string;
        documento: null | string;
        entity_id: null | string;
        etapa: string;
        evento_id: string;
        id: string;
        imobiliaria: null | string;
        nome: string;
      }[]).map(async (c) => {
        const identidade = await identidadeCanonicaDoCredenciado(client, c);
        return {
          corretor: identidade.corretor,
          documento: c.documento,
          etapa: c.etapa,
          id: c.id,
          imobiliaria: identidade.imobiliaria,
          nome: identidade.nome,
        };
      }),
    );
    return NextResponse.json(
      { data: { credenciados: lista } },
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
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  const corpo = (await request
    .json()
    .catch(() => null)) as (CorpoDeReserva & {
    acao?: string;
    corretor?: string;
    documento?: string;
    imobiliaria?: string;
    nome?: string;
  }) | null;

  // ⚠️ REGISTRO SIMPLES NO BALCÃO (Lucas, 29/08/2026: *"provavelmente o cliente não terá
  // cadastro, então vamos fazer um registro simples"*). Cria o credenciado com o mínimo — nome
  // e, quando houver, CPF/imobiliária/corretor — e devolve o id para a tela reservar em
  // seguida. `origem: "balcao"` marca quem entrou por aqui, para o pós-evento saber quais
  // fichas ainda precisam de CAD no Apolo.
  if (corpo?.acao === "criar-credenciado") {
    let ev = String(corpo?.eventoId ?? "").trim();
    if (!ev) ev = (await eventoOperavelId(client)) ?? "";
    const nome = String(corpo?.nome ?? "").trim();
    if (!ev) {
      return NextResponse.json({ error: "Nenhum evento em andamento." }, { status: 404 });
    }
    if (nome.length < 3) {
      return NextResponse.json({ error: "Informe o nome do cliente." }, { status: 400 });
    }
    const { credenciadoId: novoId, error: erroCriar } = await adicionarCredenciado({
      client,
      corretor: String(corpo?.corretor ?? "").trim() || null,
      documento: String(corpo?.documento ?? "").trim() || null,
      eventoId: ev,
      imobiliaria: String(corpo?.imobiliaria ?? "").trim() || null,
      nome,
      origem: "balcao",
      // `origem_ref` único por registro: sem ele, dois cadastros de balcão no mesmo evento
      // colidiriam no índice (evento, origem, origem_ref).
      origemRef: `balcao-${Date.now()}`,
    });
    if (erroCriar || !novoId) {
      return NextResponse.json({ error: erroCriar ?? "Não foi possível cadastrar." }, { status: 400 });
    }
    return NextResponse.json({
      data: {
        credenciado: {
          corretor: String(corpo?.corretor ?? "").trim() || null,
          documento: String(corpo?.documento ?? "").trim() || null,
          etapa: "credenciado",
          id: novoId,
          imobiliaria: String(corpo?.imobiliaria ?? "").trim() || null,
          nome,
        },
      },
    });
  }

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
    .select("id, nome, documento, evento_id, entity_id")
    .in("id", idsParaConferir);
  const porId = new Map(
    (
      (confirmados ?? []) as Array<{
        documento: null | string;
        // A entidade do Apolo da pessoa — vai gravada na reserva para o nome virar link no CRM.
        entity_id: null | string;
        evento_id: string;
        id: string;
        nome: string;
      }>
    ).map((c) => [c.id, c]),
  );

  const credenciado = porId.get(credenciadoId);
  if (!credenciado || credenciado.evento_id !== eventoId) {
    return NextResponse.json(
      { error: "Etiqueta nao pertence a este lancamento." },
      { status: 404 },
    );
  }

  // DE ONDE VEIO O TITULAR — resolvido AQUI e gravado na reserva.
  //
  // ⚠️ Pela cadeia canônica (vínculo do Apolo → de-para → coluna crua), a MESMA que o bip usa
  // para pintar o tótem e o cupom: ler a coluna crua daria resposta diferente das outras telas
  // justamente para quem veio por vínculo. Custa dois round-trips, e só do titular — aqui isso
  // é barato, uma vez por reserva; numa tela que lista cem unidades, não seria.
  //
  // Nunca derruba a reserva: se a identidade falhar, a origem fica nula e o resto segue.
  const origemDoTitular = await (async (): Promise<null | string> => {
    try {
      const apolo = createApoloAdminClient();
      if (!apolo) return null;
      const { data: cru } = await client
        .from("prometeu_credenciados")
        .select("nome, imobiliaria, corretor, entity_id")
        .eq("id", credenciadoId)
        .maybeSingle();
      if (!cru) return null;
      const identidade = await identidadeCanonicaDoCredenciado(apolo, {
        corretor: (cru as Record<string, null | string>).corretor ?? null,
        entity_id: (cru as Record<string, null | string>).entity_id ?? null,
        imobiliaria: (cru as Record<string, null | string>).imobiliaria ?? null,
        nome: (cru as Record<string, string>).nome ?? "",
      });
      return origemDoClienteParaExibir(identidade)?.texto ?? null;
    } catch {
      return null;
    }
  })();

  const proponentes: ProponenteDaReserva[] = proponentesCrus.length
    ? proponentesCrus.map((p, indice) => {
        const conferido = porId.get(p.credenciadoId);
        return {
          credenciadoId: p.credenciadoId,
          documento: conferido?.documento ?? p.documento,
          entityId: conferido?.entity_id ?? null,
          nome: conferido?.nome ?? p.nome,
          // Só o titular carrega a origem: é dele a imobiliária que atendeu.
          origem: indice === 0 ? origemDoTitular : null,
          percentual: p.percentual,
        };
      })
    : [
        {
          credenciadoId,
          documento: credenciado.documento,
          entityId: credenciado.entity_id ?? null,
          nome: credenciado.nome,
          origem: origemDoTitular,
          percentual: 100,
        },
      ];

  const proponenteForaDoEvento = proponentes.find((p) => {
    const conferido = porId.get(p.credenciadoId);
    return !conferido || conferido.evento_id !== eventoId;
  });
  if (proponenteForaDoEvento) {
    return NextResponse.json(
      {
        error: `Proponente ${proponenteForaDoEvento.nome || "?"} nao pertence a este lancamento.`,
      },
      { status: 400 },
    );
  }

  const erroProponentes = validarProponentes(proponentes);
  if (erroProponentes) {
    return NextResponse.json({ error: erroProponentes }, { status: 400 });
  }

  const resultado = await criarReservaDoEvento(client, {
    credenciadoId,
    criadoPor:
      ("userId" in auth ? auth.userId : null) ??
      ("operadorId" in auth ? auth.operadorId : null) ??
      null,
    criadoPorNome: null,
    eventoId,
    proponentes,
    unidades,
  });

  if (resultado.error || !resultado.grupoId) {
    return NextResponse.json(
      {
        conflitos: resultado.conflitos ?? [],
        error: resultado.error ?? "Nao consegui reservar.",
      },
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
