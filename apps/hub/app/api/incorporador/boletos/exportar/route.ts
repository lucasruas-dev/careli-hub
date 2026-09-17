import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import {
  COLUNAS_DA_PLANILHA,
  LIMITE_DE_LINHAS,
  linhasDaPlanilha,
  nomeDoArquivo,
} from "@/lib/apolo/boletos/planilha-de-boletos";
import { portalEmiteBoletos } from "@/lib/apolo/boletos/portais";
import { autorizar } from "@/lib/apolo/incorporador/escopo";

// EXPORTAR A CARTEIRA DO MÊS PARA EXCEL — o botão da tela de boletos.
//
// Lucas (17/09/2026): *"coloca aqui na tela da cecilio, filtros, ordenação e exportação para
// excel"*.
//
// ⚠️ POST, E NÃO GET, porque o arquivo é o RECORTE DA TELA: a lista filtrada e ordenada viaja no
// corpo. Um GET que refizesse a leitura devolveria outra coisa (a competência inteira) e ainda
// repetiria a consulta ao Asaas — a mais cara desta tela, e a que já custou fatura por excesso de
// chamada em outro módulo.
//
// ⚠️ A MESMA PORTA DA TELA. `autorizar` + `portalEmiteBoletos`: quem não vê a tela não baixa o
// arquivo dela. Não há leitura de banco aqui, então não há escopo por carteira para conferir —
// o conteúdo é o que a sessão acabou de receber na listagem.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalEmiteBoletos(auth.sessao.slug)) {
    return NextResponse.json({ error: "Este portal não emite boletos." }, { status: 403 });
  }

  let corpo: { carteira?: unknown; competencia?: unknown; linhas?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const competencia = String(corpo.competencia ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  const linhas = linhasDaPlanilha(corpo.linhas);
  if (linhas.length === 0) {
    return NextResponse.json({ error: "Nada para exportar." }, { status: 400 });
  }

  const carteira = typeof corpo.carteira === "string" ? corpo.carteira : null;

  const livro = new ExcelJS.Workbook();
  livro.created = new Date();
  const aba = livro.addWorksheet("Boletos");

  aba.columns = COLUNAS_DA_PLANILHA.map((c) => ({
    key: c.chave,
    width: c.largura,
  }));

  const cabecalho = aba.addRow(COLUNAS_DA_PLANILHA.map((c) => c.titulo));
  cabecalho.font = { bold: true };
  // ⚠️ O CABEÇALHO CONGELADO NÃO É ENFEITE: a carteira maior medida tem 334 linhas, e sem isto
  // quem rola até o fim não sabe mais qual coluna é o vencimento e qual é o pagamento.
  aba.views = [{ state: "frozen", ySplit: 1 }];
  aba.autoFilter = { from: { column: 1, row: 1 }, to: { column: COLUNAS_DA_PLANILHA.length, row: 1 } };

  for (const linha of linhas) {
    aba.addRow(COLUNAS_DA_PLANILHA.map((c) => linha[c.chave]));
  }

  // O total: a soma que quem exporta faria na mão logo depois de abrir.
  const total = aba.addRow(
    COLUNAS_DA_PLANILHA.map((c) =>
      c.chave === "cliente"
        ? `${linhas.length} boleto(s)`
        : c.moeda
          ? linhas.reduce((soma, l) => soma + l.valor, 0)
          : "",
    ),
  );
  total.font = { bold: true };

  for (const [indice, coluna] of COLUNAS_DA_PLANILHA.entries()) {
    if (coluna.moeda) {
      // Número com formato de moeda: a planilha soma e filtra; texto "R$ 1.520,92" não faria nem um
      // nem outro.
      aba.getColumn(indice + 1).numFmt = 'R$ #,##0.00';
      aba.getColumn(indice + 1).alignment = { horizontal: "right" };
    }
  }

  const buffer = await livro.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(competencia, carteira)}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Quem mandar mais do que o teto recebe o arquivo com o teto, e a tela avisa.
      "X-Linhas": String(Math.min(linhas.length, LIMITE_DE_LINHAS)),
    },
  });
}
