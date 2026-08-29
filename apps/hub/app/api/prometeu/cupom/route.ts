import { NextResponse, type NextRequest } from "next/server";

import { lerPlanosDoC2x } from "@/lib/apolo/planos-comerciais-c2x";
import {
  ordenarParaAFolha,
  type PlanoComercial,
  PLANOS_PADRAO_DA_CASA,
} from "@/lib/apolo/planos-comerciais";
import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import {
  autorizarOperacao,
  autorizarOperacaoDeEscrita,
} from "@/lib/prometeu/operador-server";
import { ehIdDeCupom, reservasDoGrupo } from "@/lib/prometeu/reservas-evento";

// O CUPOM BIPADO NA ÁREA DE IMPRESSÃO DA PA (Lucas, 24/08).
//
// GET ?grupoId= → a reserva completa do cupom (cliente + unidades + evento) para montar as
// folhas de PA — UMA POR UNIDADE. POST marca a impressão (pa_impressa_em/vezes): é o que faz
// o segundo bip avisar "já impressa às X" e oferecer 2ª via em vez de duplicar papel calado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Quanto o bip espera pelos planos do C2X antes de seguir com os padrão.
 *
 * ⚠️ ISTO É UM POSTO DE ATENDIMENTO COM FILA. O cliente está de pé na frente do operador, e
 * uma folha que demora dez segundos para sair é pior do que uma folha com o aviso na tela. Se
 * o legado não responder em quatro segundos, a PA sai com os planos padrão e o posto avisa —
 * em vez de o bip ficar pendurado esperando o MySQL.
 */
const ESPERA_PELOS_PLANOS_MS = 4_000;

type PlanosDaFolha = {
  planos: PlanoComercial[];
  /** Nulo = deu tudo certo. Preenchido = a tela do posto TEM que mostrar antes de imprimir. */
  planosAviso: null | string;
  planosSaoPadrao: boolean;
};

/**
 * Os planos que a folha vai imprimir, com a distinção que decide o que a tela mostra.
 *
 * ⚠️ VAZIO E FALHA SÃO COISAS DIFERENTES, e a diferença muda o que o operador faz:
 *   • lançamento sem empreendimento, ou empreendimento sem plano → padrão da casa, aviso de
 *     cadastro faltando;
 *   • C2X fora do ar ou lento → padrão da casa, aviso de que NÃO FOI POSSÍVEL LER, que é um
 *     pedido de conferência antes de entregar o papel.
 * Tratar os dois como "lista vazia" faz a folha sair errada calada no dia em que o banco
 * simplesmente não respondeu.
 */
async function planosDaFolha(code: null | string): Promise<PlanosDaFolha> {
  const padrao = {
    planos: PLANOS_PADRAO_DA_CASA,
    planosSaoPadrao: true,
  };

  if (!code) {
    return {
      ...padrao,
      planosAviso:
        "Este lançamento não tem empreendimento no Setup, então a folha sai com os planos padrão da casa.",
    };
  }

  const leitura = await Promise.race([
    lerPlanosDoC2x([code]),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), ESPERA_PELOS_PLANOS_MS),
    ),
  ]);

  if (leitura === "timeout") {
    return {
      ...padrao,
      planosAviso: `O C2X não respondeu a tempo. A folha saiu com os planos padrão da casa — confira os valores de ${code} antes de entregar.`,
    };
  }

  if (!leitura.ok) {
    return {
      ...padrao,
      planosAviso: `Não consegui ler os planos de ${code} no C2X. A folha saiu com os planos padrão da casa — confira antes de entregar.`,
    };
  }

  const planos = leitura.empreendimentos[0]?.planos ?? [];
  if (planos.length === 0) {
    return {
      ...padrao,
      planosAviso: `O empreendimento ${code} não tem planos comerciais cadastrados no C2X. A folha sai com os planos padrão da casa.`,
    };
  }

  return {
    planos: ordenarParaAFolha(planos),
    planosAviso: null,
    planosSaoPadrao: false,
  };
}

export async function GET(request: NextRequest) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const grupoId = (new URL(request.url).searchParams.get("grupoId") ?? "").trim();
  if (!ehIdDeCupom(grupoId)) {
    return NextResponse.json({ error: "Cupom nao reconhecido." }, { status: 400 });
  }

  const { error, reservas } = await reservasDoGrupo(client, grupoId);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (reservas.length === 0) {
    return NextResponse.json({ error: "Cupom nao encontrado." }, { status: 404 });
  }

  const vivas = reservas.filter((r) => r.situacao === "reservada");
  if (vivas.length === 0) {
    return NextResponse.json({ error: "Esta reserva foi cancelada." }, { status: 410 });
  }

  const [{ data: credenciado }, evento] = await Promise.all([
    client
      .from("prometeu_credenciados")
      .select("id, nome, documento, imobiliaria, corretor, evento_id")
      .eq("id", vivas[0]!.credenciadoId)
      .maybeSingle<{
        corretor: null | string;
        documento: null | string;
        evento_id: string;
        id: string;
        imobiliaria: null | string;
        nome: string;
      }>(),
    (async () => {
      const { data } = await client
        .from("prometeu_reservas")
        .select("evento_id")
        .eq("grupo_id", grupoId)
        .limit(1)
        .maybeSingle<{ evento_id: string }>();
      return data ? getEvento(client, data.evento_id) : null;
    })(),
  ]);

  if (!credenciado) {
    return NextResponse.json({ error: "Cliente da reserva nao encontrado." }, { status: 404 });
  }

  // ⚠️ OS PLANOS SÃO DO EMPREENDIMENTO, e vêm do C2X — que é quem emite o boleto. Até 29/08 eles
  // estavam FIXOS no código com os números do Villa Paris, impressos em qualquer lançamento; a
  // medição mostrou que os 24 empreendimentos cadastrados têm planos distintos, com o NORMAL
  // variando de 37 a 200 parcelas. Uma folha com os planos de outro empreendimento é um
  // documento que o cliente assina prometendo o que o sistema não vai cobrar.
  const dosPlanos = await planosDaFolha(evento?.enterpriseCode ?? null);

  return NextResponse.json(
    {
      data: {
        cliente: {
          corretor: credenciado.corretor,
          documento: credenciado.documento,
          imobiliaria: credenciado.imobiliaria,
          nome: credenciado.nome,
        },
        evento: evento
          ? {
              enterpriseCode: evento.enterpriseCode,
              // O texto da PA fala em nome da incorporadora — configurável por evento no
              // Setup (config.paIncorporadora); sem ela, o nome do lançamento assina.
              incorporadora:
                String(
                  (evento.config as Record<string, unknown> | null)?.paIncorporadora ?? "",
                ).trim() || null,
              id: evento.id,
              nome: evento.nome,
            }
          : null,
        planos: dosPlanos.planos,
        planosAviso: dosPlanos.planosAviso,
        planosSaoPadrao: dosPlanos.planosSaoPadrao,
        reservas: vivas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await autorizarOperacaoDeEscrita(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as {
    acao?: unknown;
    grupoId?: unknown;
    lancadoPor?: unknown;
  } | null;
  const grupoId = String(corpo?.grupoId ?? "").trim();
  const acao = String(corpo?.acao ?? "pa-impressa").trim();
  if (!ehIdDeCupom(grupoId)) {
    return NextResponse.json({ error: "Cupom nao reconhecido." }, { status: 400 });
  }

  const agora = new Date().toISOString();

  // A SECRETÁRIA LANÇA A PROPOSTA bipando o mesmo cupom (Lucas, 24/08: "dentro da secretária
  // eu lanço a proposta") — é este carimbo que o funil conta como "Proposta".
  if (acao === "lancar-proposta") {
    const { data: vivas } = await client
      .from("prometeu_reservas")
      .select("id, proposta_lancada_em")
      .eq("grupo_id", grupoId)
      .eq("situacao", "reservada");
    const linhas = (vivas ?? []) as { id: string; proposta_lancada_em: null | string }[];
    if (linhas.length === 0) {
      return NextResponse.json({ error: "Reserva nao encontrada ou cancelada." }, { status: 404 });
    }
    const jaLancada = linhas.every((l) => l.proposta_lancada_em);
    if (!jaLancada) {
      await client
        .from("prometeu_reservas")
        .update({
          proposta_lancada_em: agora,
          proposta_lancada_por: String(corpo?.lancadoPor ?? "").trim() || null,
          updated_at: agora,
        })
        .eq("grupo_id", grupoId)
        .eq("situacao", "reservada")
        .is("proposta_lancada_em", null);
    }
    return NextResponse.json({ data: { jaLancada, ok: true } });
  }

  // Leitura-modificação simples (sem corrida real: o posto é um só por evento).
  const { data: linhas } = await client
    .from("prometeu_reservas")
    .select("id, pa_impressa_vezes")
    .eq("grupo_id", grupoId)
    .eq("situacao", "reservada");

  for (const linha of (linhas ?? []) as { id: string; pa_impressa_vezes: number }[]) {
    await client
      .from("prometeu_reservas")
      .update({
        pa_impressa_em: agora,
        pa_impressa_vezes: (linha.pa_impressa_vezes ?? 0) + 1,
        updated_at: agora,
      })
      .eq("id", linha.id);
  }

  return NextResponse.json({ data: { ok: true } });
}
