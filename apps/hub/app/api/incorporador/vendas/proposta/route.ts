import { NextResponse } from "next/server";

import { autorizar, foraDoEscopo, unidadeNoEscopo } from "@/lib/apolo/incorporador/escopo";
import { propostaDaVenda } from "@/lib/apolo/incorporador/venda-proposta";

// A PROPOSTA DE UMA VENDA, para o popup do painel de vendas do portal do incorporador.
//
// Versão escopada do que a tela interna já mostra no `VendaPropostaModal`, traduzida para a língua
// do dono do empreendimento em `venda-proposta.ts`: entrada, desconto, parcelamento da entrada e o
// tempo de financiamento. O que é combinado comercial INTERNO (nome/percentual de plano, juros,
// corretor, split) não atravessa — a allowlist começa na consulta e termina aqui, campo a campo.
//
// A ORDEM É FIXA E NÃO SE INVERTE (o mesmo contrato da rota de parcelas):
//   1. `autorizar`        — sem sessão assinada, 401 e nada mais roda;
//   2. `unidadeNoEscopo`  — ANTES da leitura de dados: trocar o número na barra de endereço não
//      pode devolver a proposta de um comprador de outro loteamento;
//   3. `foraDoEscopo`     — unidade de outro loteador responde 404, o mesmo que unidade
//      inexistente. Para quem não tem o empreendimento, ele não existe.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const cru = new URL(request.url).searchParams.get("unitId")?.trim() ?? "";
  const unitId = Number(cru);

  // Id que nem é um id responde como unidade que não existe: nada de 400 explicando o formato
  // para quem está tateando a rota.
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return foraDoEscopo();
  }

  // A conferência de escopo, ANTES de qualquer leitura de dados. Fail-closed.
  const pertence = await unidadeNoEscopo(unitId, auth.sessao);
  if (!pertence) {
    return foraDoEscopo();
  }

  const resultado = await propostaDaVenda(unitId);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 503 });
  }

  // Unidade do escopo sem proposta registrada é um estado normal (lote disponível): payload nulo,
  // e o popup diz isso em texto.
  if (!resultado.data) {
    return NextResponse.json(
      { data: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const proposta = resultado.data;

  return NextResponse.json(
    {
      data: {
        // Allowlist explícita, campo a campo — nunca o objeto do loader. O loader já nasce
        // enxuto, mas a rota repete a lista de propósito: campo novo no loader NÃO viaja para o
        // cliente sem alguém escrever o nome dele aqui.
        desconto: proposta.desconto,
        entrada: {
          parcelas: proposta.entrada.parcelas.map((parcela) => ({
            n: parcela.n,
            paga: parcela.paga,
            valor: parcela.valor,
            vencimento: parcela.vencimento,
          })),
          percentual: proposta.entrada.percentual,
          total: proposta.entrada.total,
        },
        faturadoEm: proposta.faturadoEm,
        financiamento: {
          parcelas: proposta.financiamento.parcelas,
          primeiroVencimento: proposta.financiamento.primeiroVencimento,
          valorParcela: proposta.financiamento.valorParcela,
        },
        imobiliaria: proposta.imobiliaria,
        unidade: proposta.unidade,
        valorNegociado: proposta.valorNegociado,
        valorTabela: proposta.valorTabela,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
