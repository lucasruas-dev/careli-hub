// O CARTÃO DO PLANO NA TABELA DO LOTE — o texto, igual ao da MMendes.
//
// Lucas (18/09/2026), com o print do cartão do Garden na Mesa de Venda: *"tem esse escrito. tem que
// ser igual o mmendes"*. O cartão dizia "R$ 4.764 · 84x · entrada R$ 34.800 (8%)": parcela arredondada
// para o real, sem o valor do lote, sem a tabela de onde o desconto saiu e sem a linha do à vista. No
// mapa do Garden no portal da MMendes (`masterplans-internos/garden.html`, `renderOficial`) cada plano
// é um cartão com, nesta ordem:
//
//   1. o nome, com a ressalva ao lado ("válido para as próximas 16 unidades");
//   2. "entrada R$ 32.016 · 4 × R$ 25.000 · 84 meses";
//   3. "Valor do lote" R$ 400.200, e embaixo "de R$ 435.000 · −8%" (ou "sem desconto");
//   4. "Parcela mensal" R$ 3.192,67 × 84, e embaixo "correção: IPCA + 6% a.a.";
//
// e, depois dos planos, a linha do À VISTA: "melhor desconto de tabela: 12% (plano Investidor)", o
// valor do lote com esse desconto e "em uma parcela".
//
// ⚠️ O TEXTO MORA AQUI, E NÃO NO JSX, para ser conferido contra a MMendes lote a lote (o teste roda a
// conta extraída do próprio `garden.html`). O simulador da Mesa e o do espelho público são o MESMO
// componente, e os dois desenham destas funções.
//
// ⚠️ TRÊS DIFERENÇAS DE PROPÓSITO, medidas no teste:
//   • A PARCELA LEVA OS CENTAVOS ("R$ 3.192,67"). É a regra da própria MMendes para parcela
//     (`moedaPa`: *"A PARCELA VIRA CONTRATO: se ela tem centavos, mostre os centavos"*), usada no
//     simulador dela; o `renderOficial` ainda arredonda (`moeda`), e o Lucas pediu os centavos.
//   • A ENTRADA LEVA O % DO PLANO ("entrada R$ 32.016 (8%)"), pedido do Lucas de 05/09/2026 (*"pode
//     colocar o % de cada plano aqui"*): é o que faz a escada de entrada da tabela se ler.
//   • A CORREÇÃO É A DO CADASTRO ("IPCA anual + 6% a.a."): o índice sai de `INDICES` e a taxa de
//     `textoDaTaxa`, os mesmos da ficha do plano e do PDF. A MMendes escreve "IPCA + 6% a.a." porque o
//     rótulo dela é fixo no arquivo.

import { INDICES } from "@/lib/apolo/planos-comerciais";
import { precoNoPlano } from "@/lib/hercules/ajuste-de-preco";

/** O menos tipográfico da MMendes ("−8%"), e não o hífen. */
const MENOS = "−";

/**
 * Reais como a MMendes escreve a parcela (`moedaPa`): com centavos quando tem centavos, sem ",00"
 * quando o valor é redondo. "R$ 3.192,67", "R$ 400.200".
 *
 * ⚠️ NUNCA ESCONDE CENTAVO. O `dinheiro` do simulador arredondava para o real, e o cartão dizia
 * R$ 3.193 onde a conta, o PDF e a MMendes dizem R$ 3.192,67.
 */
export function reaisDoCartao(valor: number): string {
  const v = Number.isFinite(valor) ? valor : 0;
  const redondo = Math.abs(v - Math.round(v)) < 0.005;
  return `R$ ${
    redondo
      ? Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })
      : v.toLocaleString("pt-BR", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })
  }`;
}

/** 8 → "8", 7,5 → "7,5". */
function percentual(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export type LinhasDoCartao = {
  /** "correção: IPCA anual + 6% a.a." (ou "sem correção"). */
  correcao: string;
  nome: string;
  /** "de R$ 435.000 · −8%", ou "sem desconto" quando o valor é a tabela. */
  origemDoValor: string;
  /** "R$ 3.192,67". */
  parcela: string;
  /** "× 84". */
  prazo: string;
  ressalva: null | string;
  /** "entrada R$ 32.016 (8%) · 4 × R$ 25.000 · 84 meses". */
  resumo: string;
  /** "R$ 400.200": o valor do lote NESTE plano, já com o desconto dele. */
  valorDoLote: string;
};

/**
 * O que o cartão de um plano escreve, linha a linha, na ordem da MMendes.
 *
 * `preco` é o valor do lote no plano (o que o clique carrega) e `precoDeTabela` é a tabela do lote:
 * a diferença entre os dois é o desconto que a linha de baixo do valor explica. O percentual sai dos
 * dois números, e não do cadastro: se o preço do cartão tiver desconto à mão (a Mesa deixa), a linha
 * diz o desconto de verdade.
 */
export function linhasDoCartao(entrada: {
  anuais: { quantidade: number; valor: number };
  entrada: number;
  entradaPercentual: number;
  indiceCorrecao: null | string | undefined;
  nome: string;
  parcela: number;
  parcelas: number;
  preco: number;
  precoDeTabela: number;
  ressalva?: null | string;
  /** `textoDaTaxa(plano)`: "6% a.a.", "0,5% a.m.", ou vazio sem juros. */
  taxa: string;
}): LinhasDoCartao {
  const { anuais, preco, precoDeTabela } = entrada;

  const resumo = [
    `entrada ${reaisDoCartao(entrada.entrada)} (${percentual(entrada.entradaPercentual)}%)`,
    // A MMendes escreve "0 × R$ 0" num plano sem anual; aqui a parte some.
    anuais.quantidade > 0
      ? `${anuais.quantidade} × ${reaisDoCartao(anuais.valor)}`
      : null,
    `${entrada.parcelas} meses`,
  ]
    .filter(Boolean)
    .join(" · ");

  const diferenca = Math.round((preco - precoDeTabela) * 100) / 100;
  const origemDoValor =
    diferenca === 0 || !(precoDeTabela > 0)
      ? "sem desconto"
      : `de ${reaisDoCartao(precoDeTabela)} · ${diferenca < 0 ? MENOS : "+"}${percentual(
          (Math.abs(diferenca) / precoDeTabela) * 100,
        )}%`;

  return {
    correcao: correcaoDoCartao(entrada.indiceCorrecao, entrada.taxa),
    nome: entrada.nome,
    origemDoValor,
    parcela: reaisDoCartao(entrada.parcela),
    prazo: `× ${entrada.parcelas}`,
    ressalva: entrada.ressalva?.trim() || null,
    resumo,
    valorDoLote: reaisDoCartao(preco),
  };
}

/**
 * A linha de correção do cartão: o índice do cadastro mais os juros, como a MMendes junta os dois
 * ("correção: IPCA + 6% a.a."). Sem índice, diz que não corrige, e os juros, se houver.
 */
export function correcaoDoCartao(
  indice: null | string | undefined,
  taxa: string,
): string {
  const rotulo =
    indice && indice !== "SEM_CORRECAO"
      ? INDICES[indice as keyof typeof INDICES]
      : null;
  if (!rotulo) return taxa ? `sem correção · juros ${taxa}` : "sem correção";
  return `correção: ${rotulo}${taxa ? ` + ${taxa}` : ""}`;
}

export type LinhaDoAVista = {
  /** "melhor desconto de tabela: 12% (plano INVESTIDOR)". */
  detalhe: string;
  /** "de R$ 435.000 · −12%". */
  origemDoValor: string;
  pagamento: string;
  /** "R$ 382.800". */
  valorDoLote: string;
};

/**
 * A linha do À VISTA, depois dos planos: o lote com o MAIOR desconto de tabela, em uma parcela.
 *
 * ⚠️ SÓ QUANDO ALGUM PLANO TEM DESCONTO. Na MMendes ela sempre aparece porque o Garden sempre teve
 * desconto; aqui o mesmo componente serve os outros empreendimentos, onde nenhum plano tem desconto
 * e onde a condição à vista é outra conversa (há plano À VISTA cadastrado no C2X com regra própria).
 * Uma linha "À vista, sem desconto" ali seria uma condição que ninguém aprovou. Nulo = sem linha.
 *
 * ⚠️ EMPATE FICA COM O PRIMEIRO, como o `reduce` da MMendes (`b.desc > a.desc ? b : a`).
 */
export function linhaDoAVista(entrada: {
  planos: ReadonlyArray<{ desconto: number; nome: string }>;
  precoDeTabela: number;
}): LinhaDoAVista | null {
  const melhor = entrada.planos.reduce<null | {
    desconto: number;
    nome: string;
  }>((a, b) => (a === null || b.desconto > a.desconto ? b : a), null);
  if (!melhor || !(melhor.desconto > 0) || !(entrada.precoDeTabela > 0))
    return null;

  // O mesmo preço que o plano do melhor desconto dá ao lote (`precoNoPlano`, a conta do cartão dele).
  const valor = precoNoPlano(entrada.precoDeTabela, melhor.desconto);
  return {
    detalhe: `melhor desconto de tabela: ${percentual(melhor.desconto)}% (plano ${melhor.nome})`,
    origemDoValor: `de ${reaisDoCartao(entrada.precoDeTabela)} · ${MENOS}${percentual(melhor.desconto)}%`,
    pagamento: "em uma parcela",
    valorDoLote: reaisDoCartao(valor),
  };
}
