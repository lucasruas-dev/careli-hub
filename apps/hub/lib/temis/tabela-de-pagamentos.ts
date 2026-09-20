// O QUADRO DE PAGAMENTO DO CONTRATO — a variável `[tabela_geral_pagamentos]`.
//
// Lucas (20/09/2026), gerando o contrato do Vale do Ouro: *"Falta a tabela de pagamentos"*, e depois
// de trocar o nome na minuta: *"mudamos a variavel e mesmo assim não veio a tabela"*.
//
// ⚠️ A VARIÁVEL EXISTIA NO CATÁLOGO E NINGUÉM A MONTAVA. O grupo "gerado" (`paragrafo_sinal`,
// `paragrafo_parcelamento`, `paragrafo_vencimento`, `tabela_pagamentos` e `tabela_geral_pagamentos`)
// estava declarado em `variaveis.ts` e escrito nos blocos prontos, mas `dados-do-contrato.ts` nunca
// produziu nenhum deles: o contrato saía com o colchete no papel e a geração travava, porque
// variável sem valor bloqueia o documento. Trocar `tabela_pagamentos` por `tabela_geral_pagamentos`
// não mudava nada — os dois estavam igualmente vazios.
//
// ⚠️ E O QUADRO É UMA TABELA DE VERDADE, não texto com espaços. O motor de variáveis só sabe virar
// TEXTO (`textoDaVariavel`), então este módulo devolve NÓS do documento e `preencherContrato` troca
// o parágrafo inteiro por eles. Texto alinhado com espaços vira uma coluna torta no PDF, e a tabela
// do contrato é peça que o cliente confere número a número.
//
// ⚠️ A FONTE É O CRONOGRAMA QUE A PROPOSTA CONGELOU (`hercules_propostas.condicoes`), e não uma
// conta nova. O que o contrato promete tem de ser exatamente o que o simulador mostrou e o PDF da
// proposta imprimiu. Proposta importada do C2X não tem cronograma: aí o quadro não existe, a
// variável fica em branco e a conferência da Têmis acusa — melhor do que uma tabela inventada.
import { INDICES, type IndiceCorrecao } from "@/lib/apolo/planos-comerciais";

import type { NoDoDocumento } from "./documento-html";

/** Uma parcela como o cronograma da proposta a guarda. */
type ParcelaGravada = {
  numero?: unknown;
  total?: unknown;
  valor?: unknown;
  vencimento?: unknown;
};

type CondicoesGravadas = {
  anuais?: unknown;
  entrada?: unknown;
  mensais?: unknown;
  plano?: {
    indiceCorrecao?: unknown;
    jurosPeriodicidade?: unknown;
    jurosTaxa?: unknown;
  } | null;
  totais?: { anuais?: unknown; entrada?: unknown; geral?: unknown; mensais?: unknown } | null;
};

type LinhaDoQuadro = {
  correcao: string;
  juros: string;
  quantidade: number;
  tipo: string;
  total: null | number;
  valor: string;
  vencimento: string;
};

const CABECALHO = ["Parcela", "Correção", "Juros", "1º vencimento", "Qtde.", "Valor", "Total"];

/**
 * O quadro geral de pagamentos, pronto para entrar no documento.
 *
 * Devolve `null` quando não há cronograma: sem parcela não há quadro.
 */
export function tabelaGeralDePagamentos(condicoes: unknown): NoDoDocumento | null {
  const dados = (condicoes ?? null) as CondicoesGravadas | null;
  if (!dados) return null;

  const entrada = parcelas(dados.entrada);
  const mensais = parcelas(dados.mensais);
  const anuais = parcelas(dados.anuais);
  if (entrada.length === 0 && mensais.length === 0 && anuais.length === 0) return null;

  const correcao = rotuloDoIndice(dados.plano?.indiceCorrecao);
  const juros = rotuloDosJuros(dados.plano?.jurosTaxa, dados.plano?.jurosPeriodicidade);
  const totais = dados.totais ?? {};

  const linhas: LinhaDoQuadro[] = [];

  // ⚠️ A ENTRADA NÃO LEVA CORREÇÃO NEM JUROS, e isso não é omissão: ela é paga à vista ou em poucas
  // parcelas dentro do mesmo fluxo, antes de existir saldo devedor. Repetir o IPCA na linha dela
  // faria o contrato prometer correção sobre um valor que ninguém corrige.
  if (entrada.length > 0) {
    linhas.push({
      correcao: "—",
      juros: "—",
      quantidade: quantidadeDaSerie(entrada),
      tipo: quantidadeDaSerie(entrada) > 1 ? "Entrada (parcelada)" : "Entrada",
      total: numero(totais.entrada) ?? somaDe(entrada),
      valor: valorDaSerie(entrada),
      vencimento: dataBr(entrada[0]?.vencimento),
    });
  }

  if (mensais.length > 0) {
    linhas.push({
      correcao,
      juros,
      quantidade: quantidadeDaSerie(mensais),
      tipo: "Mensais",
      total: numero(totais.mensais) ?? somaDe(mensais),
      valor: valorDaSerie(mensais),
      vencimento: dataBr(mensais[0]?.vencimento),
    });
  }

  if (anuais.length > 0) {
    linhas.push({
      correcao,
      juros,
      quantidade: quantidadeDaSerie(anuais),
      tipo: "Anuais",
      total: numero(totais.anuais) ?? somaDe(anuais),
      valor: valorDaSerie(anuais),
      vencimento: dataBr(anuais[0]?.vencimento),
    });
  }

  const totalGeral =
    numero(totais.geral) ??
    linhas.reduce((soma, linha) => soma + (linha.total ?? 0), 0);

  return {
    children: [
      linhaDaTabela(CABECALHO, true),
      ...linhas.map((linha) =>
        linhaDaTabela([
          linha.tipo,
          linha.correcao,
          linha.juros,
          linha.vencimento,
          String(linha.quantidade),
          linha.valor,
          linha.total === null ? "—" : dinheiro(linha.total),
        ]),
      ),
      // A última linha fecha a conta: é o número que o comprador procura primeiro.
      {
        children: [
          celula("Total", { colSpan: CABECALHO.length - 1, negrito: true }),
          celula(dinheiro(totalGeral), { negrito: true }),
        ],
        type: "tr",
      },
    ],
    type: "table",
  };
}

function linhaDaTabela(valores: readonly string[], cabecalho = false): NoDoDocumento {
  return {
    children: valores.map((valor) => celula(valor, { cabecalho, negrito: cabecalho })),
    type: "tr",
  };
}

function celula(
  texto: string,
  opcoes: { cabecalho?: boolean; colSpan?: number; negrito?: boolean } = {},
): NoDoDocumento {
  return {
    children: [{ children: [{ bold: opcoes.negrito || undefined, text: texto }], type: "p" }],
    ...(opcoes.colSpan && opcoes.colSpan > 1 ? { colSpan: opcoes.colSpan } : {}),
    type: opcoes.cabecalho ? "th" : "td",
  } as NoDoDocumento;
}

/**
 * O valor da série: a PRIMEIRA parcela, sem nenhuma ressalva escrita junto.
 *
 * ⚠️ O "A PARTIR DE" SAIU A PEDIDO DO LUCAS (20/09/2026): *"outra coisa que precisa mudar é tirar o
 * texto a partir de"*. A coluna passa a ser só número. A ressalva que ele carregava continua no
 * quadro, na coluna Correção ("IPCA anual"), e na cláusula VII do contrato, que é onde o reajuste é
 * contratado: a mensal do plano com correção anual sai de R$ 770,49 e chega a R$ 2.083,74 na 156ª.
 */
function valorDaSerie(serie: readonly ParcelaGravada[]): string {
  const primeira = numero(serie[0]?.valor);
  return primeira === null ? "—" : dinheiro(primeira);
}

/**
 * Quantas parcelas a série tem.
 *
 * ⚠️ O NÚMERO SAI DO CAMPO `total` DA PARCELA, que é o prazo contratado, e só cai no tamanho da
 * lista quando ele falta. São dois números diferentes: o cronograma gravado pode ter sido cortado
 * (proposta antiga, gravação parcial), e o contrato tem de dizer 156 parcelas mesmo assim.
 */
function quantidadeDaSerie(serie: readonly ParcelaGravada[]): number {
  return numero(serie[0]?.total) ?? serie.length;
}

function parcelas(valor: unknown): ParcelaGravada[] {
  return Array.isArray(valor) ? (valor.filter(Boolean) as ParcelaGravada[]) : [];
}

function somaDe(serie: readonly ParcelaGravada[]): null | number {
  let soma = 0;
  for (const parcela of serie) {
    const valor = numero(parcela.valor);
    if (valor === null) return null;
    soma += valor;
  }
  return soma;
}

function rotuloDoIndice(indice: unknown): string {
  const chave = String(indice ?? "").trim();
  if (!chave || chave === "SEM_CORRECAO") return "sem correção";
  return INDICES[chave as IndiceCorrecao] ?? chave;
}

/** Mesma escrita de `textoDaTaxa` (planos-comerciais): "0,7207% a.m.", sem zero à direita. */
function rotuloDosJuros(taxa: unknown, periodicidade: unknown): string {
  const valor = numero(taxa);
  if (valor === null || valor <= 0) return "sem juros";
  const escrito = String(Number(valor.toFixed(4))).replace(".", ",");
  return `${escrito}% ${String(periodicidade ?? "mensal") === "anual" ? "a.a." : "a.m."}`;
}

function numero(valor: unknown): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dinheiro(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(valor);
}

/** `AAAA-MM-DD` vira `DD/MM/AAAA`. Sem `new Date()`: fuso não pode mover vencimento de contrato. */
function dataBr(valor: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}
