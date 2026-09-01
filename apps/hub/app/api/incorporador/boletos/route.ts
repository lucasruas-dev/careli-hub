import { NextResponse } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { documentoMascarado, documentosDeVarios, documentosDoEmpreendimento } from "@/lib/apolo/boletos/documentos";
import {
  acharOuCriarCliente,
  apenasDaCompetencia,
  cobrancasDaReferencia,
  criarBoleto,
  impedimentosDaConta,
  lerReferencia,
  listarCobrancas,
  situacaoCadastral,
} from "@/lib/apolo/boletos/emissao";
import { empreendimentoPorSlug } from "@/lib/apolo/boletos/empreendimentos";
import { type LinhaParaEmitir, nomesDivergentes, prepararLote } from "@/lib/apolo/boletos/lote";
import { carteirasDoPortal, portalEmiteBoletos, portalPodeEmitir } from "@/lib/apolo/boletos/portais";
import { autorizar } from "@/lib/apolo/incorporador/escopo";

// A EMISSÃO DE BOLETOS DENTRO DO PORTAL DO INCORPORADOR.
//
// Pedido do Lucas (01/09/2026): *"essa tela vai somente no perfil da CER e Cecilio (...) Nessa
// tela vamos emitir os boletos, gerar os pagamentos"*.
//
// ⚠️ É A SEGUNDA ESCRITA EXTERNA DO PANTEON, e a mais séria: a primeira (a base do LSoft) corrige
// cadastro; esta cria cobrança em nome de outra empresa, num CNPJ que não é o nosso, e o Asaas não
// desfaz em lote. Por isso as travas são as mesmas do LSoft, com uma a mais:
//   1. só portais de `carteirasDoPortal` entram — e a lista é explícita, não derivada de vínculo;
//   2. o empreendimento pedido é conferido contra a lista DAQUELE portal, a cada chamada;
//   3. a regra de emissão é reaplicada aqui: o navegador não decide quem recebe boleto;
//   4. ensaio por padrão — sem `confirmar: true` nada é criado no Asaas.
//
// ⚠️ ROTA SEPARADA DA `/api/boletos/emitir`, apesar de o motor ser o mesmo. Aquela pede admin do
// Hub (Bearer do Supabase); esta pede sessão de portal. Fundir as duas seria uma função decidindo
// qual autenticação vale por um `if` — e é assim que um dia a errada passa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function fora(): NextResponse {
  // 404, não 403: para quem não tem a aba, esta rota não existe.
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

/** O último dia do mês da competência. */
function intervaloDaCompetencia(competencia: string): { fim: string; inicio: string } {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { fim: `${competencia}-${ultimo}`, inicio: `${competencia}-01` };
}

function estaVencido(situacao: string, vencimento: string, pagamento: null | string): boolean {
  if (pagamento) return false;
  if (situacao === "OVERDUE") return true;
  if (situacao === "RECEIVED" || situacao === "CONFIRMED" || situacao === "RECEIVED_IN_CASH") {
    return false;
  }
  return vencimento < new Date().toISOString().slice(0, 10);
}

// ── LEITURA: o que já foi emitido no mês ────────────────────────────────────

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalEmiteBoletos(auth.sessao.slug)) return fora();

  const url = new URL(request.url);
  const competencia = (url.searchParams.get("competencia") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  const permitidos = carteirasDoPortal(auth.sessao.slug);
  const alvos = permitidos
    .map(empreendimentoPorSlug)
    .filter((e) => e !== null)
    .filter((e) => e.conta && chaveDaConta(e.conta));

  const carteiras = permitidos.map((slug) => {
    const e = empreendimentoPorSlug(slug);
    return {
      conta: e?.conta ? rotuloDaConta(e.conta) : null,
      // A tela precisa dizer "falta a chave" em vez de mostrar a aba vazia.
      contaConfigurada: Boolean(e?.conta && chaveDaConta(e.conta)),
      nome: e?.nome ?? slug,
      slug,
    };
  });

  if (alvos.length === 0) {
    return NextResponse.json(
      { data: { boletos: [], carteiras, competencia, falhas: [] } },
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

  const documentos = await documentosDeVarios(alvos.map((e) => e.slug));
  const intervalo = intervaloDaCompetencia(competencia);

  const boletos = [];
  const falhas: { conta: string; erro: string }[] = [];

  for (const conta of contas) {
    const lista = await listarCobrancas(conta, intervalo);
    if (!lista.ok) {
      falhas.push({ conta: rotuloDaConta(conta), erro: lista.erro });
      continue;
    }

    const desteConta = slugsPorConta.get(conta)!;
    for (const c of apenasDaCompetencia(lista.data, competencia)) {
      const ref = lerReferencia(c.externalReference);
      // ⚠️ A conta da CER serve quatro edifícios; um portal que só pudesse ver dois receberia os
      // outros dois de brinde se o filtro não estivesse aqui.
      if (!ref || !desteConta.has(ref.empreendimento)) continue;

      const cadastro = documentos.get(`${ref.empreendimento}|${ref.unidade}`);
      const pagamento = c.paymentDate ?? c.clientPaymentDate ?? null;

      boletos.push({
        cobranca: c.id,
        documento: cadastro ? documentoMascarado(cadastro.documento) : null,
        emissao: c.dateCreated ?? null,
        empreendimento: ref.empreendimento,
        link: c.bankSlipUrl ?? c.invoiceUrl ?? null,
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
    { data: { boletos, carteiras, competencia, falhas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── ESCRITA: emitir o lote ──────────────────────────────────────────────────

type Corpo = {
  competencia?: unknown;
  confirmar?: unknown;
  empreendimento?: unknown;
  linhas?: unknown;
};

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalEmiteBoletos(auth.sessao.slug)) return fora();

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const competencia = String(corpo.competencia ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return NextResponse.json({ error: "competência deve ser AAAA-MM" }, { status: 400 });
  }

  const slug = String(corpo.empreendimento ?? "").trim().toLowerCase();
  // ⚠️ A CONFERÊNCIA MAIS IMPORTANTE DA ROTA: sem ela, sessão de um portal emitiria na carteira de
  // outro só mandando o slug no corpo.
  if (!portalPodeEmitir(auth.sessao.slug, slug)) return fora();

  const empreendimento = empreendimentoPorSlug(slug);
  if (!empreendimento?.conta || !chaveDaConta(empreendimento.conta)) {
    return NextResponse.json(
      { error: `a conta do Asaas de ${empreendimento?.nome ?? slug} não está configurada` },
      { status: 400 },
    );
  }

  const linhas = Array.isArray(corpo.linhas) ? (corpo.linhas as LinhaParaEmitir[]) : null;
  if (!linhas || linhas.length === 0) {
    return NextResponse.json({ error: "nenhuma linha recebida" }, { status: 400 });
  }

  const conta = empreendimento.conta;
  const documentos = await documentosDoEmpreendimento(slug);
  const lote = prepararLote({ competencia, documentos, empreendimento: slug, linhas });
  const divergencias = nomesDivergentes(linhas, documentos);

  const situacao = await situacaoCadastral(conta);
  const impedimentos = situacao.ok
    ? impedimentosDaConta(situacao.data, lote.itens.length)
    : [`não consegui consultar a situação do cadastro no Asaas: ${situacao.erro}`];

  if (corpo.confirmar !== true) {
    return NextResponse.json(
      {
        data: {
          competencia,
          conta: rotuloDaConta(conta),
          divergencias,
          empreendimento: empreendimento.nome,
          ensaio: true,
          fora: lote.fora,
          impedimentos,
          itens: lote.itens.map((i) => ({
            nome: i.nome,
            referencia: i.referencia,
            unidade: i.unidade,
            valor: i.valor,
            vencimento: i.vencimento,
          })),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (impedimentos.length > 0) {
    return NextResponse.json({ error: impedimentos.join(" · "), impedimentos }, { status: 409 });
  }

  const resultados = [];

  // Em série: duas linhas do mesmo CPF em paralelo criariam dois cadastros para a mesma pessoa.
  for (const item of lote.itens) {
    const base = {
      cobranca: null as null | string,
      erro: null as null | string,
      ja_existia: false,
      link: null as null | string,
      nome: item.nome,
      referencia: item.referencia,
      unidade: item.unidade,
      valor: item.valor,
      vencimento: item.vencimento,
    };

    const jaEmitido = await cobrancasDaReferencia(conta, item.referencia);
    if (!jaEmitido.ok) {
      resultados.push({ ...base, erro: `não consegui conferir se já existia: ${jaEmitido.erro}` });
      continue;
    }
    if ((jaEmitido.data.data?.length ?? 0) > 0) {
      const existente = jaEmitido.data.data[0]!;
      resultados.push({
        ...base,
        cobranca: existente.id,
        ja_existia: true,
        link: existente.bankSlipUrl ?? existente.invoiceUrl ?? null,
      });
      continue;
    }

    const cliente = await acharOuCriarCliente(conta, {
      contato: item.contato,
      documento: item.documento,
      nome: item.nome,
      referencia: `boleto:${slug}:${item.unidade}`,
    });
    if (!cliente.ok) {
      resultados.push({ ...base, erro: `cliente: ${cliente.erro}` });
      continue;
    }

    const boleto = await criarBoleto(conta, {
      cliente: cliente.data.cliente.id,
      descricao: item.descricao,
      referencia: item.referencia,
      valor: item.valor,
      vencimento: item.vencimento,
    });
    if (!boleto.ok) {
      resultados.push({ ...base, erro: `boleto: ${boleto.erro}` });
      continue;
    }

    resultados.push({
      ...base,
      cobranca: boleto.data.id,
      link: boleto.data.bankSlipUrl ?? boleto.data.invoiceUrl ?? null,
    });
  }

  return NextResponse.json(
    {
      data: {
        competencia,
        conta: rotuloDaConta(conta),
        emitidos: resultados.filter((r) => r.cobranca && !r.ja_existia).length,
        empreendimento: empreendimento.nome,
        ensaio: false,
        falhas: resultados.filter((r) => r.erro).length,
        fora: lote.fora,
        repetidos: resultados.filter((r) => r.ja_existia).length,
        resultados,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
