import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  type CanalDoTrabalho,
  abrirTrabalho,
  marcarAtividade,
  trabalhosDoBoard,
} from "@/lib/temis/trabalhos-db";
import { ATIVIDADES, ESTAGIOS, NOME_DO_TIPO, type TipoDeTrabalho } from "@/lib/temis/trabalhos";

// OS TRABALHOS DO BOARD DA TÊMIS — listar, abrir e marcar atividade.
//
// ⚠️ O CATÁLOGO VIAJA JUNTO COM OS CARDS. A tela precisa das atividades e dos prazos de cada tipo
// para desenhar o checklist, e duplicar essa lista no cliente faria as duas divergirem no dia em que
// alguém acrescentasse uma atividade — a tela mostraria quatro itens e o servidor exigiria cinco
// para o card andar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const enterpriseId = url.searchParams.get("empreendimento")?.trim() || undefined;

  const trabalhos = await trabalhosDoBoard({ enterpriseId });

  return NextResponse.json(
    { data: { atividades: ATIVIDADES, estagios: ESTAGIOS, nomes: NOME_DO_TIPO, trabalhos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

type Corpo = {
  acao?: unknown;
  atividade?: unknown;
  canal?: unknown;
  clienteCpf?: unknown;
  clienteNome?: unknown;
  empreendimentoCodigo?: unknown;
  empreendimentoId?: unknown;
  empreendimentoNome?: unknown;
  evidenciaPath?: unknown;
  feita?: unknown;
  id?: unknown;
  irisTicketId?: unknown;
  observacao?: unknown;
  tipo?: unknown;
  trabalhoOrigemId?: unknown;
  unidade?: unknown;
};

const TIPOS: TipoDeTrabalho[] = [
  "cancelamento",
  "cancelamento_correcao",
  "cessao",
  "contrato",
  "distrato",
];
const CANAIS: CanalDoTrabalho[] = ["coordenador", "hercules", "iris"];

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  // ── MARCAR UMA ATIVIDADE ───────────────────────────────────────────────────
  //
  // ⚠️ É AQUI QUE O CARD ANDA SOZINHO: a camada de dados avança o estágio quando a última atividade
  // do estágio é marcada, na mesma chamada.
  if (String(corpo.acao ?? "") === "atividade") {
    const id = String(corpo.id ?? "").trim();
    const atividade = String(corpo.atividade ?? "").trim();
    if (!id || !atividade) {
      return NextResponse.json({ error: "informe o trabalho e a atividade" }, { status: 400 });
    }
    const r = await marcarAtividade({ atividade, feita: corpo.feita === true, id });
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ andou: r.andou, estagio: r.estagio, ok: true });
  }

  // ── ABRIR UMA SOLICITAÇÃO ──────────────────────────────────────────────────
  const tipo = String(corpo.tipo ?? "") as TipoDeTrabalho;
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: `tipo desconhecido: ${String(corpo.tipo)}` }, { status: 400 });
  }

  const canal = String(corpo.canal ?? "") as CanalDoTrabalho;
  if (!CANAIS.includes(canal)) {
    return NextResponse.json({ error: "informe de onde veio a solicitação" }, { status: 400 });
  }

  const clienteNome = String(corpo.clienteNome ?? "").trim();
  const unidade = String(corpo.unidade ?? "").trim();
  const empreendimentoId = String(corpo.empreendimentoId ?? "").trim();
  if (!clienteNome || !unidade || !empreendimentoId) {
    return NextResponse.json(
      { error: "empreendimento, unidade e cliente são obrigatórios" },
      { status: 400 },
    );
  }

  // ⚠️ A CORREÇÃO NASCE LIGADA A UM CONTRATO, e sem ele ninguém sabe o que está sendo corrigido.
  if (tipo === "cancelamento_correcao" && !String(corpo.trabalhoOrigemId ?? "").trim()) {
    return NextResponse.json(
      { error: "o cancelamento por correção precisa apontar o contrato que está sendo corrigido" },
      { status: 400 },
    );
  }

  const r = await abrirTrabalho({
    canal,
    clienteCpf: String(corpo.clienteCpf ?? "").replace(/\D/g, "") || null,
    clienteNome,
    empreendimentoCodigo: String(corpo.empreendimentoCodigo ?? "").trim(),
    empreendimentoId,
    empreendimentoNome: String(corpo.empreendimentoNome ?? "").trim(),
    evidenciaPath: String(corpo.evidenciaPath ?? "").trim() || null,
    irisTicketId: String(corpo.irisTicketId ?? "").trim() || null,
    observacao: String(corpo.observacao ?? "").trim() || null,
    tipo,
    trabalhoOrigemId: String(corpo.trabalhoOrigemId ?? "").trim() || null,
    unidade,
  });

  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ id: r.id, ok: true });
}
