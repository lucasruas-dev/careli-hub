import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";
import { type CenarioDeProjecao } from "@/lib/apolo/reajuste/projecao";
import { evolucaoDosContratos } from "@/lib/apolo/reajuste/projecao-do-contrato";
import {
  montarEvolucaoPdf,
  nomeDoArquivoEvolucao,
} from "@/lib/apolo/reajuste/evolucao-pdf";

// A EVOLUÇÃO DA PARCELA EM PDF TIMBRADO.
//
// Lucas (23/09/2026): *"agora falta criar o relatório em PDF igual temos os outros"*.
//
// ⚠️ MESMA APURAÇÃO DA ROTA JSON: as duas chamam `evolucaoDosContratos`, então tela e papel nunca
// divergem sobre a parcela de um cliente. É a mesma regra que o extrato segue.
//
// ⚠️ O CENÁRIO VIAJA NA URL porque o papel tem de sair no cenário que a pessoa estava olhando.
// Gerar sempre na tendência faria a tela mostrar um número e o PDF imprimir outro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const CENARIOS = ["conservador", "otimista", "tendencia"] as const;

function json(corpo: unknown, status: number) {
  return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" }, status });
}

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return json({ error: "Informe um c2xId valido." }, 400);
  }

  const contratoParam = params.get("contrato");
  const contratoId = contratoParam ? Number(contratoParam) : null;
  if (contratoParam && (!Number.isInteger(contratoId) || (contratoId ?? 0) <= 0)) {
    return json({ error: "Informe um contrato valido." }, 400);
  }

  // ⚠️ O PAPEL LEVA OS TRÊS CENÁRIOS (Lucas, 24/09/2026: "pode fazer as três visões em um
  // relatório só"), e não o que estava na tela. Um papel com um número só é lido como previsão;
  // três colunas mostram que o resultado é uma FAIXA. O `?cenario=` continua aceito e decide
  // apenas qual coluna o texto de apoio trata como a mais provável.
  const pedido = params.get("cenario");
  const cenario = CENARIOS.includes(pedido as never)
    ? (pedido as CenarioDeProjecao)
    : "tendencia";
  const TODOS: CenarioDeProjecao[] = ["otimista", "tendencia", "conservador"];

  try {
    // ⚠️ DUAS LEITURAS, E ELAS NÃO SÃO REDUNDANTES: a evolução traz os números; o extrato traz o
    // TITULAR (nome e documento mascarado), que o papel precisa no cabeçalho e o payload da
    // evolução não carrega de propósito — a tela já tem o cliente aberto na frente.
    const [evolucao, extrato] = await Promise.all([
      evolucaoDosContratos({ c2xId, cenario, cenarios: TODOS, contratoId }),
      loadExtratoDoCliente({ c2xId, contratoId }),
    ]);

    if (!evolucao.ok) return json({ error: evolucao.error }, 503);
    if (!extrato.ok) return json({ error: extrato.error }, 503);
    if (evolucao.data.length === 0) {
      return json({ error: "Cliente sem contrato com carteira no C2X." }, 404);
    }

    const dados = {
      cenario,
      cliente: {
        documentoMascarado: extrato.data.cliente.documentoMascarado,
        nome: extrato.data.cliente.nome,
      },
      contratos: evolucao.data,
      posicaoEm: extrato.data.posicaoEm,
    };

    const bytes = await montarEvolucaoPdf(dados);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${nomeDoArquivoEvolucao(dados)}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (erro) {
    console.error("[apolo][evolucao-da-parcela][pdf] falha", erro);
    return json({ error: "Não foi possível gerar o PDF agora." }, 500);
  }
}
