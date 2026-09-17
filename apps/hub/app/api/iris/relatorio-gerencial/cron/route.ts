import { NextResponse, type NextRequest } from "next/server";

import { ehDiaUtil, executarRelatorioDeAtendimento } from "@/lib/iris/relatorio-gerencial/executar";
import { diaNaCasa } from "@/lib/iris/relatorio-gerencial/janela";

// O CRON DAS 18H30 — o relatório gerencial de atendimento sai daqui.
//
// Lucas (17/09/2026): *"todo dia útil, às 18h30, sai um relatório em HTML das filas de Atendimento,
// Cobrança e Central de Relacionamento, mais os atendimentos conduzidos pela CACÁ, para
// nivea.careli@careli.adm.br, pela caixa da CACÁ"*.
//
// ⚠️ NO `vercel.json` O HORÁRIO É `30 21`, E NÃO `30 18`. A Vercel agenda em UTC: 18h30 de Brasília
// é 21h30 UTC. Com `30 18` o relatório chega às 15h30, com o expediente pela metade, e demora dias
// para alguém desconfiar — o e-mail chega, só que errado.
//
// ⚠️ SÁBADO E DOMINGO NÃO TÊM RELATÓRIO. O cron já é `1-5`, mas a trava está aqui também: um
// disparo manual de fim de semana mandaria um relatório zerado para a diretoria.
//
// Parâmetros (todos opcionais, para conferência):
//   ?dia=2026-09-17  reprocessa aquele dia
//   ?ensaio=1        devolve o HTML sem enviar e sem registrar
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A apuração lê o dia inteiro de mensagens e tickets; 60s é folga sobre os ~6s medidos.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const parametros = request.nextUrl.searchParams;
  const dia = (parametros.get("dia") ?? "").trim() || diaNaCasa(new Date());
  const ensaio = parametros.get("ensaio") === "1";
  const manual = !request.headers.get("x-vercel-cron");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return NextResponse.json({ error: "dia deve ser AAAA-MM-DD" }, { status: 400 });
  }

  if (!ehDiaUtil(dia)) {
    return NextResponse.json(
      { data: { dia, motivo: "fim de semana", status: "nao_enviado" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const resultado = await executarRelatorioDeAtendimento({
      dia,
      ensaio,
      origem: manual ? "manual" : "cron",
    });

    // No ensaio o que interessa é OLHAR o relatório, então ele volta como página.
    if (ensaio) {
      return new NextResponse(resultado.html, {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const { html: _html, ...semOHtml } = resultado;
    return NextResponse.json(
      { data: { ...semOHtml, origem: manual ? "manual" : "cron" } },
      {
        headers: { "Cache-Control": "no-store" },
        // Envio que falhou responde 500: assim o painel de crons da Vercel marca vermelho, além
        // do alerta que o próprio executor publica no hub.
        status: resultado.status === "falhou" ? 500 : 200,
      },
    );
  } catch (erro) {
    console.error("[iris][relatorio-gerencial] falhou", erro);
    return NextResponse.json(
      {
        error:
          erro instanceof Error ? erro.message : "Falha ao montar o relatório de atendimento.",
      },
      { status: 500 },
    );
  }
}

function autorizado(request: NextRequest): boolean {
  if (request.headers.get("x-vercel-cron")) return true;

  const autorizacao = request.headers.get("authorization");
  const token = autorizacao?.startsWith("Bearer ")
    ? autorizacao.slice("Bearer ".length).trim()
    : "";
  const segredo = process.env.CRON_SECRET?.trim();

  return Boolean(segredo && token === segredo);
}
