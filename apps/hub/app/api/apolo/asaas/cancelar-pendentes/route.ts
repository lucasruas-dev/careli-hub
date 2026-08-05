import { NextResponse, type NextRequest } from "next/server";

import {
  type AsaasCobranca,
  cancelarCobranca,
  listarCobrancas,
} from "@/lib/apolo/asaas-prevenda";
import { authorizeApoloAdmin } from "@/lib/apolo/auth";

// CANCELA as cobranças PIX NÃO PAGAS da conta Gurgel (pré-venda). Fechou o prazo de pagamento; o que
// não foi pago é cancelado pra não entrar dinheiro fora do prazo. NUNCA toca em cobrança paga
// (RECEIVED/CONFIRMED) — o próprio Asaas recusa deletar uma paga, e aqui há uma segunda trava.
//
// dryRun (default): só LISTA o que seria cancelado, sem apagar nada. confirmar=1: apaga de verdade.
// Autorização: ADMIN do Apolo (Bearer). Operação outward e irreversível — sempre confira o dryRun
// antes. Ver [[project_asaas_prevenda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Não pagos = aguardando + vencido. Pagos (nunca cancelar): RECEIVED, CONFIRMED, RECEIVED_IN_CASH.
const STATUS_NAO_PAGOS = ["PENDING", "OVERDUE"];

function normaliza(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

async function listarNaoPagos(): Promise<{
  cobrancas: AsaasCobranca[];
  erro?: string;
}> {
  const cobrancas: AsaasCobranca[] = [];
  for (const status of STATUS_NAO_PAGOS) {
    let offset = 0;
    // Teto de segurança: 50 páginas de 100 = 5000 cobranças.
    for (let pagina = 0; pagina < 50; pagina++) {
      const r = await listarCobrancas({ limit: 100, offset, status });
      if (!r.ok) return { cobrancas, erro: `listagem (${status}): ${r.erro}` };
      cobrancas.push(...(r.data.data ?? []));
      if (!r.data.hasMore) break;
      offset += 100;
    }
  }

  return { cobrancas };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const confirmar = request.nextUrl.searchParams.get("confirmar") === "1";
  // A conta Gurgel pode ter PIX de OUTROS lançamentos: cancela só o empreendimento alvo (default =
  // o lançamento atual). `todos=1` desliga o filtro (usar com MUITO cuidado).
  const empreendimento =
    request.nextUrl.searchParams.get("empreendimento")?.trim() || "Vale do Ouro";
  const semFiltro = request.nextUrl.searchParams.get("todos") === "1";

  const { cobrancas: todas, erro } = await listarNaoPagos();
  if (erro) return NextResponse.json({ error: erro }, { status: 502 });

  const alvo = normaliza(empreendimento);
  const cobrancas = semFiltro
    ? todas
    : todas.filter((c) => normaliza(c.description ?? "").includes(alvo));

  const valorTotal = cobrancas.reduce((soma, c) => soma + (c.value || 0), 0);
  const porStatus = cobrancas.reduce<Record<string, number>>((mapa, c) => {
    mapa[c.status] = (mapa[c.status] ?? 0) + 1;
    return mapa;
  }, {});
  const amostra = cobrancas.slice(0, 10).map((c) => ({
    dueDate: c.dueDate,
    id: c.id,
    status: c.status,
    value: c.value,
  }));

  // DRY RUN (default): só mostra o que SERIA cancelado, sem apagar nada.
  if (!confirmar) {
    return NextResponse.json({
      data: {
        amostra,
        dryRun: true,
        empreendimento: semFiltro ? "(todos os lançamentos)" : empreendimento,
        naoPagosNaContaGurgel: todas.length,
        porStatus,
        total: cobrancas.length,
        valorTotal,
      },
    });
  }

  // CANCELAMENTO REAL: deleta cada não-pago. Trava dupla: pula qualquer status fora da lista de
  // não-pagos (nunca deleta pago) e contabiliza falhas em vez de estourar.
  let cancelados = 0;
  const falhas: Array<{ erro: string; id: string }> = [];
  for (const c of cobrancas) {
    if (!STATUS_NAO_PAGOS.includes(c.status)) continue;
    const r = await cancelarCobranca(c.id);
    if (r.ok && r.data.deleted !== false) cancelados += 1;
    else falhas.push({ erro: r.ok ? "nao confirmou delecao" : r.erro, id: c.id });
  }

  return NextResponse.json({
    data: {
      cancelados,
      detalheFalhas: falhas.slice(0, 20),
      dryRun: false,
      falhas: falhas.length,
      totalTentado: cobrancas.length,
    },
  });
}
