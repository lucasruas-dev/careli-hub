import { NextResponse } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { documentoMascarado, documentosDeVarios } from "@/lib/apolo/boletos/documentos";
import {
  apenasDaCompetencia,
  chaveDeUnidade,
  lerReferencia,
  listarCobrancas,
} from "@/lib/apolo/boletos/emissao";
import {
  EMPREENDIMENTOS_DE_BOLETO,
  empreendimentoPorSlug,
} from "@/lib/apolo/boletos/empreendimentos";

// O QUE JÁ FOI EMITIDO NO MÊS — a tabela da tela, lida direto do Asaas.
//
// ⚠️ O ASAAS É A FONTE, e de propósito não existe tabela nossa espelhando a emissão. O estado que
// interessa (pago, vencido, link do boleto) muda no Asaas o tempo todo, sem nos avisar: uma cópia
// local ficaria velha no dia seguinte e a tela mostraria "em aberto" para quem já pagou. O que é
// nosso — nome e CPF — vem de `boletos_documentos`, cruzado pela referência da cobrança.
//
// ⚠️ UMA CHAMADA POR CONTA, e não por empreendimento. Os quatro edifícios da CER dividem a mesma
// conta: buscar um por vez seriam quatro varreduras da mesma carteira. A referência de cada
// cobrança (`boleto:ed-rubi:401:2026-09`) é o que devolve cada boleto ao seu prédio.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export type BoletoEmitido = {
  cobranca: string;
  documento: null | string;
  emissao: null | string;
  empreendimento: string;
  link: null | string;
  nome: string;
  pagamento: null | string;
  situacao: string;
  unidade: string;
  valor: number;
  vencido: boolean;
  vencimento: string;
};

/** O último dia do mês da competência — o intervalo em que os vencimentos dela caem. */
function intervaloDaCompetencia(competencia: string): { fim: string; inicio: string } {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { fim: `${competencia}-${ultimo}`, inicio: `${competencia}-01` };
}

/**
 * A cobrança está vencida?
 *
 * ⚠️ O STATUS DO ASAAS MANDA. Ele conhece o feriado e a compensação; derivar só da data marcaria
 * como vencido um boleto pago hoje que ainda não compensou. A data entra como reforço para o caso
 * de um status que a gente não conheça.
 */
function estaVencido(situacao: string, vencimento: string, pagamento: null | string): boolean {
  if (pagamento) return false;
  if (situacao === "OVERDUE") return true;
  if (situacao === "RECEIVED" || situacao === "CONFIRMED" || situacao === "RECEIVED_IN_CASH") {
    return false;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  return vencimento < hoje;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const competencia = (url.searchParams.get("competencia") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  // Sem `empreendimentos` a rota devolve todos os que têm conta configurada.
  const pedidos = (url.searchParams.get("empreendimentos") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const alvos = (
    pedidos.length > 0
      ? pedidos.map(empreendimentoPorSlug).filter((e) => e !== null)
      : EMPREENDIMENTOS_DE_BOLETO
  ).filter((e) => e.conta && chaveDaConta(e.conta));

  if (alvos.length === 0) {
    return NextResponse.json(
      { data: { boletos: [], competencia, contasSemChave: [] } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const contas = [...new Set(alvos.map((e) => e.conta as ContaAsaas))];
  const slugsPorConta = new Map<ContaAsaas, Set<string>>();
  for (const e of alvos) {
    const conta = e.conta as ContaAsaas;
    if (!slugsPorConta.has(conta)) slugsPorConta.set(conta, new Set());
    slugsPorConta.get(conta)!.add(e.slug);
  }

  const intervalo = intervaloDaCompetencia(competencia);
  const documentos = await documentosDeVarios(alvos.map((e) => e.slug));

  const boletos: BoletoEmitido[] = [];
  const falhas: { conta: string; erro: string }[] = [];

  for (const conta of contas) {
    const lista = await listarCobrancas(conta, intervalo);
    if (!lista.ok) {
      falhas.push({ conta: rotuloDaConta(conta), erro: lista.erro });
      continue;
    }

    const permitidos = slugsPorConta.get(conta)!;
    for (const c of apenasDaCompetencia(lista.data, competencia)) {
      const ref = lerReferencia(c.externalReference);
      // ⚠️ Cobrança de outro empreendimento da MESMA conta não entra: quem pediu só o Ed. Rubi não
      // pode receber os boletos do Jade só porque a chave é a mesma.
      if (!ref || !permitidos.has(ref.empreendimento)) continue;

      // A referência volta com hífen no lugar do espaço — ver `chaveDeUnidade`.
      const cadastro =
        documentos.get(`${ref.empreendimento}|${ref.unidade}`) ??
        [...documentos].find(
          ([k]) => chaveDeUnidade(k.split("|")[1]) === chaveDeUnidade(ref.unidade),
        )?.[1];
      const pagamento = c.paymentDate ?? c.clientPaymentDate ?? null;

      boletos.push({
        cobranca: c.id,
        documento: cadastro ? documentoMascarado(cadastro.documento) : null,
        emissao: c.dateCreated ?? null,
        empreendimento: ref.empreendimento,
        link: c.bankSlipUrl ?? c.invoiceUrl ?? null,
        // Sem cadastro, a descrição da cobrança ainda diz de quem é — melhor que campo vazio.
        nome: cadastro?.nome ?? c.description ?? "(sem cadastro)",
        pagamento,
        situacao: c.status,
        unidade: ref.unidade,
        valor: c.value,
        vencido: estaVencido(c.status, c.dueDate, pagamento),
        vencimento: c.dueDate,
      });
    }
  }

  boletos.sort(
    (a, b) =>
      a.empreendimento.localeCompare(b.empreendimento) ||
      a.vencimento.localeCompare(b.vencimento) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );

  return NextResponse.json(
    { data: { boletos, competencia, falhas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
