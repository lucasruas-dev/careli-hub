import { NextResponse } from "next/server";

import { chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { authorizeApoloAdmin } from "@/lib/apolo/auth";
import { documentosDoEmpreendimento } from "@/lib/apolo/boletos/documentos";
import {
  acharOuCriarCliente,
  cobrancasDaReferencia,
  criarBoleto,
  impedimentosDaConta,
  situacaoCadastral,
} from "@/lib/apolo/boletos/emissao";
import { empreendimentoPorSlug } from "@/lib/apolo/boletos/empreendimentos";
import { type LinhaParaEmitir, nomesDivergentes, prepararLote } from "@/lib/apolo/boletos/lote";

// EMITIR O LOTE DO MÊS — a única rota do Panteon que cria cobrança para as carteiras de fora do C2X.
//
// ⚠️ SÓ ADMIN. Emitir boleto é dinheiro saindo em nome de outra empresa, num CNPJ que não é o
// nosso, e o Asaas não desfaz em lote: cancelar é uma chamada por cobrança e o cliente já pode ter
// recebido. É o mesmo recorte do reenvio de aviso de reprovação, por motivo mais forte.
//
// ⚠️ ENSAIO POR PADRÃO. Sem `confirmar: true` a rota monta o lote, confere tudo e devolve o que
// SAIRIA — sem tocar no Asaas. É assim que a tela mostra a lista antes do clique, e é assim que se
// descobre um CPF faltando com zero boletos criados em vez de metade.
//
// ⚠️ A REGRA DE EMISSÃO É REAPLICADA AQUI. A tela lê a planilha no navegador e já sabe quem emite;
// aceitar essa decisão pronta seria deixar o valor do boleto ser escolhido pelo lado que o operador
// consegue editar. O corpo traz a LINHA como está na planilha e quem decide é o servidor.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Emissão é uma chamada por cliente mais uma por boleto, em série. Onze boletos da CER cabem
// folgados; o Guaimbé, com 29, precisa do teto alto.
export const maxDuration = 300;

type Corpo = {
  competencia?: unknown;
  confirmar?: unknown;
  empreendimento?: unknown;
  linhas?: unknown;
};

export type ResultadoDoItem = {
  cobranca: null | string;
  erro: null | string;
  ja_existia: boolean;
  link: null | string;
  nome: string;
  referencia: string;
  unidade: string;
  valor: number;
  vencimento: string;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

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

  const slug = String(corpo.empreendimento ?? "").trim();
  const empreendimento = empreendimentoPorSlug(slug);
  if (!empreendimento) {
    return NextResponse.json({ error: `empreendimento desconhecido: ${slug}` }, { status: 400 });
  }
  if (!empreendimento.conta) {
    return NextResponse.json(
      { error: `${empreendimento.nome} ainda não tem conta do Asaas configurada` },
      { status: 400 },
    );
  }
  if (!chaveDaConta(empreendimento.conta)) {
    return NextResponse.json(
      {
        error: `a chave da conta ${rotuloDaConta(empreendimento.conta)} não está no ambiente — sem ela nada é emitido`,
      },
      { status: 400 },
    );
  }

  const linhas = Array.isArray(corpo.linhas) ? (corpo.linhas as LinhaParaEmitir[]) : null;
  if (!linhas || linhas.length === 0) {
    return NextResponse.json({ error: "nenhuma linha recebida" }, { status: 400 });
  }

  const documentos = await documentosDoEmpreendimento(slug);
  const lote = prepararLote({ competencia, documentos, empreendimento: slug, linhas });
  const divergencias = nomesDivergentes(linhas, documentos);

  const confirmar = corpo.confirmar === true;
  const conta = empreendimento.conta;

  // ⚠️ A SITUAÇÃO DA CONTA É CONSULTADA ANTES, e não descoberta no erro do 15º boleto. Cadastro
  // pendente no Asaas limita a 100 boletos por dia; aprovado, 5.000. O Guaimbé sozinho tem 29 e o
  // Vale do Sol 102 — passar do teto no meio do lote deixa o resto por emitir sem ninguém saber.
  const situacao = await situacaoCadastral(conta);
  const impedimentos = situacao.ok
    ? impedimentosDaConta(situacao.data, lote.itens.length)
    : [`não consegui consultar a situação do cadastro no Asaas: ${situacao.erro}`];

  if (!confirmar) {
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

  // ⚠️ IMPEDIMENTO BARRA A EMISSÃO CONFIRMADA. No ensaio ele é só um aviso na tela; aqui ele para.
  if (impedimentos.length > 0) {
    return NextResponse.json(
      { error: impedimentos.join(" · "), impedimentos },
      { status: 409 },
    );
  }

  const resultados: ResultadoDoItem[] = [];

  // ⚠️ EM SÉRIE, DE PROPÓSITO. Em paralelo, duas linhas do mesmo CPF (o MARCELO, com dois
  // apartamentos) fariam duas buscas de cliente ao mesmo tempo, as duas não achariam nada, e o
  // Asaas ganharia dois cadastros para a mesma pessoa — que é justamente o que `acharOuCriarCliente`
  // existe para evitar.
  for (const item of lote.itens) {
    const base = {
      cobranca: null,
      erro: null,
      ja_existia: false,
      link: null,
      nome: item.nome,
      referencia: item.referencia,
      unidade: item.unidade,
      valor: item.valor,
      vencimento: item.vencimento,
    } satisfies ResultadoDoItem;

    // ⚠️ CONSULTA ANTES DE CRIAR, SEMPRE. Alguém vai clicar duas vezes, ou a conexão vai cair no
    // meio e a rodada será repetida. Sem isto o cliente recebe dois boletos do mesmo mês e liga
    // perguntando qual pagar.
    const jaEmitido = await cobrancasDaReferencia(conta, item.referencia);
    if (jaEmitido.ok && (jaEmitido.data.data?.length ?? 0) > 0) {
      const existente = jaEmitido.data.data[0]!;
      resultados.push({
        ...base,
        cobranca: existente.id,
        ja_existia: true,
        link: existente.bankSlipUrl ?? existente.invoiceUrl ?? null,
      });
      continue;
    }
    if (!jaEmitido.ok) {
      resultados.push({ ...base, erro: `não consegui conferir se já existia: ${jaEmitido.erro}` });
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

  const emitidos = resultados.filter((r) => r.cobranca && !r.ja_existia).length;
  const repetidos = resultados.filter((r) => r.ja_existia).length;
  const falhas = resultados.filter((r) => r.erro).length;

  return NextResponse.json(
    {
      data: {
        competencia,
        conta: rotuloDaConta(conta),
        emitidos,
        empreendimento: empreendimento.nome,
        ensaio: false,
        falhas,
        fora: lote.fora,
        repetidos,
        resultados,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
