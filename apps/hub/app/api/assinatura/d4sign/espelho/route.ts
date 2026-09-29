import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloSyncRequest, cronPeloSegredo } from "@/lib/apolo/autorizar-sync";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { MOVER_VENDAS } from "@/lib/assinatura/envelope-na-venda";
import { espelharD4Sign, lerSoDoPedido, type OpcoesDoEspelho, TETO_DO_SO } from "@/lib/assinatura/espelho-d4sign/espelho";
import { getHadesDbPool } from "@/lib/guardian/db";

// A RODADA DO ESPELHO DA D4SIGN (F3 do plano da fonte única, seção 6).
//
// GET  = o cron da Vercel (`7,37 * * * *`). ⚠️ SÓ `Authorization: Bearer <CRON_SECRET>`, comparado com
//        `timingSafeEqual`; `x-vercel-cron` não vale (qualquer um manda esse cabeçalho); segredo vazio
//        → 503. O `proxy.ts` NÃO muda (0.28): ele já deixa passar `/api` com Bearer, e a porta é aqui.
// POST = o admin do Hub, à mão. ENSAIO por padrão; grava só com `?gravar=1`. Recusa `refazer` e teto
//        infinito (são do script, de madrugada, com OK); `so` só inteiros, até 50; registra QUEM disparou.
//
// ⚠️ O CRON NÃO ESTÁ NO `vercel.json` AINDA (plano, F3, "Ordem": ensaio → OK → `--gravar` → prova → OK →
// cron). A linha a acrescentar, com OK do Lucas:
//   { "path": "/api/assinatura/d4sign/espelho", "schedule": "7,37 * * * *" }
// E antes de ligar: conferir no log de UMA rodada que a chamada da Vercel chegou com o Bearer.
//
// ⚠️ A RESPOSTA É O RELATÓRIO, QUE SÓ TEM IDS E CONTAGENS (nunca nome, e-mail ou documento).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** O cron: 3 em paralelo, até 20 `/list`, 240 s de orçamento num `maxDuration` de 300. */
const OPCOES_DO_CRON: OpcoesDoEspelho = {
  concorrencia: 3,
  gravar: true,
  intervaloMs: 0,
  moverVendas: MOVER_VENDAS,
  orcamentoMs: 240_000,
  tetoDeListas: 20,
};

/** O teto do POST: o mesmo do cron (a carga grande é do script). */
const TETO_DO_POST = 20;

function pecas(): { admin: NonNullable<ReturnType<typeof createApoloAdminClient>>; pool: Parameters<typeof espelharD4Sign>[0]["pool"] } | NextResponse {
  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Configure a chave server-side do Supabase." }, { status: 503 });
  const pool = getHadesDbPool();
  // ⚠️ Só o NOME do que falta, nunca valor (as variáveis são credencial do legado).
  if (!pool.ok) return NextResponse.json({ error: "Configuracao do C2X ausente." }, { status: 503 });
  return { admin, pool: pool.pool };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cron = cronPeloSegredo(request);
  if (!cron.ok) {
    return cron.motivo === "segredo_ausente"
      ? NextResponse.json({ error: "Rotina desligada: segredo do cron ausente." }, { status: 503 })
      : NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  const p = pecas();
  if (p instanceof NextResponse) return p;
  const relatorio = await espelharD4Sign({ admin: p.admin, opcoes: OPCOES_DO_CRON, pool: p.pool });
  return NextResponse.json({ data: relatorio });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const p = pecas();
  if (p instanceof NextResponse) return p;

  const autorizacao = await authorizeApoloSyncRequest(request, p.admin);
  if (!autorizacao.ok) return autorizacao.response;

  const url = new URL(request.url);
  if (url.searchParams.has("refazer")) {
    return NextResponse.json({ error: "Refazer é do script da carga inicial, com OK." }, { status: 400 });
  }
  const tetoBruto = url.searchParams.get("teto");
  let teto = TETO_DO_POST;
  if (tetoBruto !== null) {
    const n = Number(tetoBruto);
    if (!Number.isSafeInteger(n) || n < 0 || n > TETO_DO_POST) {
      return NextResponse.json({ error: `O teto do POST vai de 0 a ${TETO_DO_POST}.` }, { status: 400 });
    }
    teto = n;
  }
  const so = lerSoDoPedido(url.searchParams.get("so"));
  if (so === null) {
    return NextResponse.json({ error: `"so" aceita até ${TETO_DO_SO} números de envio.` }, { status: 400 });
  }
  const gravar = url.searchParams.get("gravar") === "1";

  // ⚠️ QUEM DISPAROU, SÓ O ID (Segurança 17).
  console.info("[assinatura][espelho-d4sign] POST", { gravar, so: so?.length ?? 0, teto, usuarioId: autorizacao.usuarioId });

  const relatorio = await espelharD4Sign({
    admin: p.admin,
    opcoes: {
      concorrencia: 3,
      gravar,
      intervaloMs: 0,
      moverVendas: MOVER_VENDAS,
      orcamentoMs: 240_000,
      so,
      tetoDeListas: teto,
    },
    pool: p.pool,
  });
  return NextResponse.json({ data: relatorio });
}
