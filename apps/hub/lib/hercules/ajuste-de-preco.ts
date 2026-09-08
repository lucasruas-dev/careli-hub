// O DESCONTO (OU O ACRÉSCIMO) NO PREÇO DO LOTE.
//
// Lucas, 08/09/2026, olhando o bloco "O lote" do simulador: *"não temos um campo para dar desconto
// ou aumentar o preço caso o usuário entenda que deva aumentar. Acho que aqui pode ficar isso,
// desconto em valor ou % que influencia o valor da proposta — isso não pode mudar o valor original
// de tabela"*.
//
// ⚠️ POR QUE ISTO EXISTE, se o campo do lote já era editável. Porque digitar por cima do preço PERDE
// a informação que interessa. Depois de salvar, ninguém sabe se R$ 142.500 foi um desconto de 5%, um
// preço de tabela desatualizado ou um erro de digitação — e a tela só dizia "editado". Aqui a tabela
// continua intacta e o que se guarda é a INTENÇÃO: quanto foi dado, e em que moeda foi pensado.
//
// ⚠️ E ELE FECHA UM BURACO QUE JÁ ESTAVA ABERTO. Medido em 08/09/2026: a régua do servidor
// (`conferirProposta`) só exigia `valorNegociado > 0`. Não havia piso, teto, nem comparação com a
// tabela — dava para gerar proposta de R$ 1,00 num lote de R$ 178.100 e o PDF saía. O ajuste dá ao
// desconto um lugar com nome, que é o que permite ter regra sobre ele.
//
// ⚠️ A COMISSÃO ACOMPANHA O VALOR VENDIDO. Decisão do Lucas na mesma conversa, e é a que o dinheiro
// real já seguia: o split do Asaas incide sobre o valor PAGO de cada parcela
// (`split_enterprise_group_values`), então descontar encolhe a comissão na mesma proporção, sem
// ninguém precisar recalcular nada. Quem discorda disso é o dossiê jurídico do Hades, que calcula a
// corretagem sobre `enterprise_unities.price` — a tabela. Ver a nota no fim deste arquivo.

/** Em que moeda a pessoa pensou o ajuste. Guardar isso é o que distingue "5%" de "R$ 7.500". */
export type ModoDoAjuste = "percentual" | "reais";

export type AjusteDePreco = {
  modo: ModoDoAjuste;
  /** Negativo é desconto, positivo é acréscimo. Zero é "sem ajuste". */
  valor: number;
};

export type PrecoAjustado = {
  /** Quanto o ajuste vale em reais — negativo no desconto. Sempre preenchido, mesmo no modo %. */
  emReais: number;
  /** Quanto o ajuste vale em percentual do preço de tabela — negativo no desconto. */
  emPercentual: number;
  /** Verdadeiro quando o pedido foi recortado (ver `AJUSTE_MAXIMO` e o piso de um centavo). */
  limitado: boolean;
  /** O preço de tabela, intacto. Ele nunca muda: é o pedido do Lucas, e é a referência de auditoria. */
  tabela: number;
  /** O que vai para a proposta. */
  valor: number;
};

export const SEM_AJUSTE: AjusteDePreco = { modo: "percentual", valor: 0 };

/**
 * O quanto um ajuste pode ir, em percentual do preço de tabela.
 *
 * ⚠️ NÃO É A REGRA COMERCIAL — é sanidade de digitação. A alçada de desconto (quanto cada pessoa
 * pode dar, e a partir de quanto precisa de aprovação) é decisão de negócio e ainda não existe; o
 * molde para ela é a entrada mínima, que já tem cadastro por empreendimento e régua dupla.
 *
 * Este teto existe só para que "-500" digitado no modo percentual (quando a pessoa queria R$ 500)
 * não vire um lote de graça. 100% de desconto é o limite aritmético; acima disso o preço fica
 * negativo, que não é desconto, é outra coisa.
 */
export const AJUSTE_MAXIMO = 100;

/** O menor preço que uma proposta pode ter. Um centavo, não zero: lote de graça não é venda. */
const PISO_EM_CENTAVOS = 1;

/**
 * Aplica o ajuste sobre a tabela e devolve as duas medidas.
 *
 * ⚠️ AS DUAS MEDIDAS SAEM SEMPRE, e é de propósito: quem aprova desconto pensa em percentual, quem
 * fecha a proposta pensa em reais, e a conta de cabeça entre os dois é onde nasce o erro. Digitou
 * `-5%`, a tela mostra `− R$ 7.500,00`; digitou `-7.500`, ela mostra `5%`.
 *
 * ⚠️ A CONTA É EM CENTAVOS INTEIROS. `150000 * 0.95` em ponto flutuante dá 142499.99999999997, e
 * esse número vira o preço impresso no contrato. Arredondar no fim não basta — as duas medidas
 * precisam fechar entre si, senão a tela mostra um desconto de R$ 7.500,00 sobre um valor que só
 * caiu R$ 7.499,99.
 */
export function aplicarAjuste(tabela: number, ajuste: AjusteDePreco): PrecoAjustado {
  const tabelaEmCentavos = paraCentavos(tabela);

  // Tabela ausente ou inválida: não há sobre o que calcular percentual, e um ajuste em reais sobre
  // o nada produziria um preço tirado do ar.
  if (!Number.isFinite(tabelaEmCentavos) || tabelaEmCentavos <= 0) {
    return { emReais: 0, emPercentual: 0, limitado: false, tabela: 0, valor: 0 };
  }

  const cru = ajuste?.valor;
  const pedido = Number.isFinite(cru) ? cru : 0;
  const tabelaEmReais = tabelaEmCentavos / 100;

  // ⚠️ NaN E INFINITY NÃO SÃO A MESMA COISA. NaN é o campo vazio ou meio digitado, e é o estado
  // normal de quem está escrevendo — não avisa nada. Infinity é um número que ninguém digita: se
  // chegou aqui, algo o produziu, e o ajuste foi DESCARTADO. Marcar `limitado` é o que faz a tela
  // dizer isso, em vez de mostrar o preço de tabela como se nada tivesse sido pedido.
  if (pedido === 0) {
    const descartado = typeof cru === "number" && !Number.isFinite(cru) && !Number.isNaN(cru);
    return {
      emReais: 0,
      emPercentual: 0,
      limitado: descartado,
      tabela: tabelaEmReais,
      valor: tabelaEmReais,
    };
  }

  const cortado = Math.max(-AJUSTE_MAXIMO_ABSOLUTO, Math.min(AJUSTE_MAXIMO_ABSOLUTO, pedido));

  const desejadoEmCentavos =
    ajuste.modo === "percentual"
      ? Math.round((tabelaEmCentavos * limitarPercentual(cortado)) / 100)
      : paraCentavos(cortado);

  const finalCru = tabelaEmCentavos + desejadoEmCentavos;
  const finalEmCentavos = Math.max(PISO_EM_CENTAVOS, finalCru);

  // ⚠️ O AJUSTE É RECALCULADO A PARTIR DO PREÇO FINAL, e não copiado do pedido. Quando o piso morde
  // (alguém digitou -R$ 200.000 num lote de 150), o desconto que a tela mostra tem de ser o que
  // realmente aconteceu — R$ 149.999,99 — e não o que foi pedido. Mostrar o pedido faria a soma da
  // tela não fechar com o próprio número que ela exibe logo abaixo.
  const efetivoEmCentavos = finalEmCentavos - tabelaEmCentavos;

  return {
    emReais: efetivoEmCentavos / 100,
    // O percentual sai com duas casas: é o que a tela mostra, e o que fecha de volta em reais.
    emPercentual: arredondar((efetivoEmCentavos / tabelaEmCentavos) * 100, 2),
    limitado: finalCru !== finalEmCentavos || cortado !== pedido,
    tabela: tabelaEmReais,
    valor: finalEmCentavos / 100,
  };
}

/**
 * O teto em VALOR ABSOLUTO, que serve aos dois modos.
 *
 * No modo percentual ele é o próprio `AJUSTE_MAXIMO`. No modo reais, um número grande demais é
 * cortado aqui antes de virar centavos — o que evita `Infinity` e os estouros de precisão que
 * aparecem quando alguém cola um número de 20 dígitos no campo.
 */
const AJUSTE_MAXIMO_ABSOLUTO = 1_000_000_000;

/** No modo percentual, o teto é de 100% para baixo (e o mesmo para cima, por simetria). */
function limitarPercentual(p: number): number {
  return Math.max(-AJUSTE_MAXIMO, Math.min(AJUSTE_MAXIMO, p));
}

/** Reais para centavos inteiros, sem o arrasto do ponto flutuante. */
function paraCentavos(v: number): number {
  if (!Number.isFinite(v)) return Number.NaN;
  return Math.round(v * 100);
}

function arredondar(v: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

/**
 * O ajuste é o que a pessoa pediu, ou o que sobrou depois de a tabela mudar?
 *
 * ⚠️ ISTO EXISTE PORQUE A TABELA MUDA DEBAIXO DA PROPOSTA. O preço de `hercules_unidades` vem de uma
 * CARGA do C2X, não de sincronização: quando alguém roda o script de novo com uma tabela nova, as
 * propostas já gravadas continuam com o preço antigo. Guardando o retrato da tabela junto com o
 * ajuste, dá para dizer depois se os R$ 7.500 de diferença foram um desconto concedido ou a tabela
 * que subiu — que são coisas diferentes na hora de conferir a comissão.
 */
export function ajusteEntreValores(tabela: number, negociado: number): PrecoAjustado {
  const t = paraCentavos(tabela);
  const n = paraCentavos(negociado);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(n)) {
    return { emReais: 0, emPercentual: 0, limitado: false, tabela: 0, valor: 0 };
  }
  const diferenca = n - t;
  return {
    emReais: diferenca / 100,
    emPercentual: arredondar((diferenca / t) * 100, 2),
    limitado: false,
    tabela: t / 100,
    valor: n / 100,
  };
}

/** Como a tela escreve o ajuste, já com o sinal. Vazio quando não há ajuste nenhum. */
export function descreverAjuste(p: PrecoAjustado): string {
  if (p.emReais === 0) return "";
  const palavra = p.emReais < 0 ? "Desconto" : "Acréscimo";
  const pct = Math.abs(p.emPercentual);
  return `${palavra} de ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

// ⚠️ O QUE ESTE ARQUIVO NÃO RESOLVE, e que precisa de decisão do Lucas:
//
// 1. A ALÇADA. Quanto cada pessoa pode descontar antes de precisar de aprovação. O molde pronto é a
//    entrada mínima (`apolo_enterprise_settings.entrada_minima_percentual`, migration 0128): cadastro
//    por empreendimento, régua na tela E no servidor, nulo = padrão da casa.
//
// 2. O DOSSIÊ JURÍDICO. `lib/hades/dossie/dados.ts` calcula a corretagem sobre `enterprise_unities.
//    price` — o preço de TABELA do C2X. Com a decisão de que a comissão acompanha o valor vendido,
//    esse cálculo passa a divergir de propósito para toda venda com desconto. Para as vendas do
//    legado ele continua certo (lá a tabela É o preço fechado); para as novas, não.
