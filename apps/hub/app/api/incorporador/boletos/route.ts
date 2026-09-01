import { NextResponse } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { documentoMascarado, documentosDeVarios } from "@/lib/apolo/boletos/documentos";
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
import {
  divergenciasDeNome,
  loteDaCompetencia,
  parcelasDaCompetencia,
} from "@/lib/apolo/boletos/parcelas";
import { carteirasDoPortal, portalEmiteBoletos, portalPodeEmitir } from "@/lib/apolo/boletos/portais";
import { autorizar } from "@/lib/apolo/incorporador/escopo";

// A EMISSÃO DE BOLETOS DENTRO DO PORTAL DO INCORPORADOR.
//
// Pedido do Lucas (01/09/2026): *"essa tela vai somente no perfil da CER e Cecilio (...) Nessa tela
// vamos emitir os boletos, gerar os pagamentos"*, e logo depois: *"não quero importar planilha, já
// traz isso pronto, vc já tem os dados pode montar a tela e ter o botão de gerar boleto e pronto"*.
//
// ⚠️ É A SEGUNDA ESCRITA EXTERNA DO PANTEON, e a mais séria: a primeira (a base do LSoft) corrige
// cadastro; esta cria cobrança em nome de outra empresa, num CNPJ que não é o nosso, e o Asaas não
// desfaz em lote. As travas:
//   1. só portais de `carteirasDoPortal` entram — lista explícita, não derivada de vínculo;
//   2. o empreendimento pedido é conferido contra a lista DAQUELE portal, a cada chamada;
//   3. o corpo do POST traz só competência e empreendimento: valor, CPF e vencimento vêm do banco;
//   4. ensaio por padrão — sem `confirmar: true` nada é criado no Asaas.
//
// ⚠️ A TRAVA 3 SUBSTITUIU UMA DEFESA. Antes a tela lia a planilha e mandava as linhas, e a rota
// reaplicava a regra por cima delas. Funcionava, mas mantinha um caminho em que o valor do boleto
// passava pelo navegador. Com a carteira no banco, esse caminho deixou de existir.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function fora(): NextResponse {
  // 404, não 403: para quem não tem a aba, esta rota não existe.
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

function intervaloDaCompetencia(competencia: string): { fim: string; inicio: string } {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { fim: `${competencia}-${ultimo}`, inicio: `${competencia}-01` };
}

/**
 * A cobrança está vencida?
 *
 * ⚠️ O STATUS DO ASAAS MANDA. Ele conhece o feriado e a compensação; derivar só da data marcaria como
 * vencido um boleto pago hoje que ainda não compensou.
 */
function estaVencido(situacao: string, vencimento: string, pagamento: null | string): boolean {
  if (pagamento) return false;
  if (situacao === "OVERDUE") return true;
  if (situacao === "RECEIVED" || situacao === "CONFIRMED" || situacao === "RECEIVED_IN_CASH") {
    return false;
  }
  return vencimento < new Date().toISOString().slice(0, 10);
}

// ── LEITURA: a carteira do mês e o que já foi emitido ───────────────────────

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

  const comChave = permitidos
    .map(empreendimentoPorSlug)
    .filter((e) => e !== null)
    .filter((e) => e.conta && chaveDaConta(e.conta));

  // A CARTEIRA DO MÊS — o que a tela mostra antes de qualquer clique, e a razão de a planilha ter
  // saído do caminho.
  const [parcelas, documentos] = await Promise.all([
    parcelasDaCompetencia({ competencia, empreendimentos: permitidos }),
    documentosDeVarios(permitidos),
  ]);

  const aEmitir = parcelas.map((p) => {
    const cadastro = documentos.get(`${p.empreendimento}|${p.unidade}`);
    return {
      bloqueio:
        p.bloqueio ??
        (cadastro ? null : `sem CPF/CNPJ cadastrado para a unidade ${p.unidade}`),
      documento: cadastro ? documentoMascarado(cadastro.documento) : null,
      empreendimento: p.empreendimento,
      // O nome do cadastro quando existe: é ele que sai no boleto.
      nome: cadastro?.nome ?? p.nome,
      nomeNaPlanilha: p.nome,
      unidade: p.unidade,
      valor: p.valor,
      vencimentoDia: p.vencimentoDia,
    };
  });

  aEmitir.sort(
    (a, b) =>
      a.empreendimento.localeCompare(b.empreendimento) ||
      (a.vencimentoDia ?? 99) - (b.vencimentoDia ?? 99) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );

  // O QUE JÁ FOI EMITIDO, direto do Asaas.
  const contas = [...new Set(comChave.map((e) => e.conta as ContaAsaas))];
  const slugsPorConta = new Map<ContaAsaas, Set<string>>();
  for (const e of comChave) {
    const conta = e.conta as ContaAsaas;
    if (!slugsPorConta.has(conta)) slugsPorConta.set(conta, new Set());
    slugsPorConta.get(conta)!.add(e.slug);
  }

  const intervalo = intervaloDaCompetencia(competencia);
  const boletos = [];
  const falhas: { conta: string; erro: string }[] = [];

  for (const conta of contas) {
    const lista = await listarCobrancas(conta, intervalo);
    if (!lista.ok) {
      falhas.push({ conta: rotuloDaConta(conta), erro: lista.erro });
      continue;
    }

    const destaConta = slugsPorConta.get(conta)!;
    for (const c of apenasDaCompetencia(lista.data, competencia)) {
      const ref = lerReferencia(c.externalReference);
      // ⚠️ A conta da CER serve cinco carteiras; um portal que só pudesse ver duas receberia as
      // outras de brinde se o filtro não estivesse aqui.
      if (!ref || !destaConta.has(ref.empreendimento)) continue;

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

  // ⚠️ A UNIDADE QUE JÁ TEM BOLETO SAI DA LISTA DE "A EMITIR". Sem isto ela apareceria nos dois
  // lados e o contador diria que faltam onze quando já saíram onze.
  const emitidas = new Set(boletos.map((b) => `${b.empreendimento}|${b.unidade}`));

  return NextResponse.json(
    {
      data: {
        aEmitir: aEmitir.map((p) => ({
          ...p,
          jaEmitido: emitidas.has(`${p.empreendimento}|${p.unidade}`),
        })),
        boletos,
        carteiras,
        competencia,
        falhas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── ESCRITA: emitir o lote ──────────────────────────────────────────────────

type Corpo = {
  competencia?: unknown;
  confirmar?: unknown;
  empreendimento?: unknown;
  /** As unidades a emitir. Ausente = todas as que a carteira do mês manda emitir. */
  unidades?: unknown;
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

  const conta = empreendimento.conta;
  const lote = await loteDaCompetencia({ competencia, empreendimento: slug });

  // Recorte por unidade, para o operador emitir um boleto só sem mandar o lote inteiro.
  const pedidas = Array.isArray(corpo.unidades)
    ? new Set((corpo.unidades as unknown[]).map((u) => String(u).trim()).filter(Boolean))
    : null;
  const itens = pedidas ? lote.itens.filter((i) => pedidas.has(i.unidade)) : lote.itens;

  if (pedidas && itens.length === 0) {
    return NextResponse.json(
      { error: "nenhuma das unidades pedidas está liberada para emissão neste mês" },
      { status: 400 },
    );
  }

  const divergencias = await divergenciasDeNome({ competencia, empreendimento: slug });

  const situacao = await situacaoCadastral(conta);
  const impedimentos = situacao.ok
    ? impedimentosDaConta(situacao.data, itens.length)
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
          itens: itens.map((i) => ({
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

  // ⚠️ EM SÉRIE, DE PROPÓSITO. Em paralelo, duas linhas do mesmo CPF (o MARCELO, com dois
  // apartamentos) fariam duas buscas de cliente ao mesmo tempo, as duas não achariam nada, e o Asaas
  // ganharia dois cadastros para a mesma pessoa.
  for (const item of itens) {
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

    // ⚠️ CONSULTA ANTES DE CRIAR, SEMPRE. Alguém vai clicar duas vezes, ou a conexão vai cair no meio
    // e a rodada será repetida. Sem isto o cliente recebe dois boletos do mesmo mês.
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
