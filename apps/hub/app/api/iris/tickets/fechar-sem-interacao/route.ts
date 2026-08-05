import { NextResponse, type NextRequest } from "next/server";

import { fecharTicketsSemInteracaoDaCaca } from "@/lib/iris/fechar-sem-interacao";

// Cron horario: fecha os atendimentos que morreram na mao da CACA (ela falou por ultimo e o
// cliente nao voltou em 4h). Sem isso o ticket zumbi bloqueia o time de abrir conversa nova
// com o mesmo cliente. Protegido como os demais crons: x-vercel-cron ou Bearer CRON_SECRET.
// Entra na allowlist do proxy.ts. Ver [[project-iris]].
//
// ?simulacao=1 conta quantos fechariam sem tocar em nada (conferencia antes de rodar pra valer).
// ?horas=N sobrescreve a janela padrao de 4h.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const parametros = request.nextUrl.searchParams;
  const simulacao =
    parametros.get("simulacao") === "1" || parametros.get("dryRun") === "1";
  const horasBrutas = Number.parseInt(parametros.get("horas") ?? "", 10);
  const horas =
    Number.isFinite(horasBrutas) && horasBrutas > 0 ? horasBrutas : undefined;

  try {
    const resultado = await fecharTicketsSemInteracaoDaCaca({
      horas,
      simulacao,
    });

    return NextResponse.json(
      { data: { ...resultado, source: "cron" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao fechar os atendimentos sem interacao da Iris.",
      },
      { status: 500 },
    );
  }
}

function isAuthorized(request: NextRequest) {
  if (request.headers.get("x-vercel-cron")) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  return Boolean(cronSecret && token === cronSecret);
}
