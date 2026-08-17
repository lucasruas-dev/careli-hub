// O VALOR LÍQUIDO DO INCORPORADOR por parcela: o que sobra para ele depois da comissão da cadeia
// e da taxa de gestão da carteira.
//
// ⚠️ O APOLO MOSTRA O BRUTO HOJE. O incorporador abre a carteira e vê R$ 7,1 mi de carteira total,
// quando o que chega para ele é outro número. Esta é a camada que traduz um no outro.
//
// DUAS FONTES, NESTA ORDEM (decisão do Lucas, 17/08/2026):
//
//   1. `payments.split_data` — o rateio que o C2X gravou e MANDOU PARA O ASAAS. É a verdade: tem o
//      nome de cada beneficiário, o perfil e o valor. Preenchido em 102.133 das 100.359 parcelas.
//   2. A FÓRMULA, só onde o split não existe. O split é recente, então empreendimento antigo
//      (Lavra do Ouro, Morada da Serra) não tem — e sem o fallback a tela mostraria zero para eles.
//
// A tela precisa dizer qual das duas foi usada. "Calculado" e "foi isso que caiu na conta" são
// coisas diferentes, e quem confere repasse precisa saber com qual está olhando.

export type FonteDoLiquido = "calculado" | "split";

export type PerfilDeParcela = "ato" | "outro" | "parcela" | "sinal";

/** Uma linha do `split_data` do C2X, já com o que interessa. */
export type LinhaDeSplit = {
  /** Razão social do beneficiário. É o único campo presente em TODAS as parcelas. */
  nome?: null | string;
  /** Existe em menos de um quarto das parcelas: ver `liquidoPeloSplit`. */
  perfil: null | string;
  valor: number;
};

export type PoliticaDoEmpreendimento = {
  /** `commercial_policies.total_value_commission` (C2X). Percentual sobre o VALOR DO LOTE. */
  comissaoPct: null | number;
  /** `commercial_policies.initial_input_value` (C2X). Entrada mínima, ato + sinal. */
  entradaPct: null | number;
  /**
   * A % que fica com o INCORPORADOR nas parcelas do financiamento.
   *
   * ⚠️ NASCE NO APOLO (`apolo_enterprise_settings.gestao_carteira_percentual`), e é a única peça
   * da política que o Apolo manda: é o percentual da gestão de carteira que a Careli fechou para
   * AQUELE empreendimento. O mesmo incorporador pode ter percentual diferente em cada um
   * (Lucas, 17/08). O resto da política vem do C2X, que tem prioridade no financeiro.
   */
  gestaoCarteiraPct: null | number;
};

export type ParcelaParaLiquido = {
  /**
   * A entrada QUE ESTE CONTRATO FECHOU, de `commercial_plans.initial_input_value` do plano da
   * acquisition_request.
   *
   * ⚠️ NÃO É A ENTRADA MÍNIMA DA POLÍTICA, e confundir as duas erra o valor de um jeito grosseiro.
   * Medido em 17/08: a entrada varia MUITO por contrato — no Lagoa Bonita há 12 valores diferentes,
   * de 10% a 50%, e no Cidade Jardim vai até 100%, todos num empreendimento cuja política diz 10%.
   * São 338 contratos com plano personalizado. Calcular tudo com o mínimo daria ao incorporador
   * 30% da entrada onde ele tem direito a 86%.
   *
   * A política entra só como último recurso, quando o contrato não tem plano — mesma cascata que o
   * BI do Lucas usa (plano custom > plano base > política).
   */
  entradaPctContratada?: null | number;
  /** Razão social do incorporador, para casar o split quando ele não traz `perfil`. */
  nomeDoIncorporador?: null | string;
  perfil: PerfilDeParcela;
  /** `split_data` da parcela, quando existir. */
  split?: LinhaDeSplit[] | null;
  valor: number;
  /** Valor da unidade (VGV do contrato). Usado só no fallback. */
  valorUnidade?: null | number;
};

export type ResultadoLiquido = {
  bruto: number;
  fonte: FonteDoLiquido;
  liquido: null | number;
  /** Preenchido quando não deu para calcular. A tela mostra isto em vez de um número errado. */
  motivo?: string;
};

/**
 * Percentual pode chegar como 7 (por cento) ou 0,07 (fração). O C2X grava dos dois jeitos, e o
 * próprio BI do Lucas normaliza assim.
 */
function comoFracao(valor: null | number | undefined): null | number {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  if (valor <= 0) return null;
  return valor > 1 ? valor / 100 : valor;
}

/** O incorporador dentro do `split_data`. O C2X escreve o perfil por extenso. */
const PERFIS_DO_INCORPORADOR = new Set(["incorporador", "loteador"]);

/**
 * Acha a linha do incorporador no split.
 *
 * ⚠️ O CAMPO `perfil` SÓ EXISTE EM UMA MINORIA DAS PARCELAS. Medido em 17/08 numa amostra de
 * 20.000 parcelas com split: **15.159 não têm `perfil`**, só `nome` e `valor`. Casar apenas por
 * perfil deixaria 76% dos casos cair no fallback SEM ninguém perceber — o pior desfecho, porque a
 * fórmula é estimativa e ali existia o número real.
 *
 * Por isso o casamento também aceita o NOME do incorporador, que quem chama informa (vem do
 * cadastro do empreendimento no C2X). Sem perfil e sem nome conhecido, devolve "não sei", e a
 * decisão de estimar fica explícita em quem chama.
 */
function liquidoPeloSplit(
  split: LinhaDeSplit[],
  nomeDoIncorporador?: null | string,
): { encontrado: boolean; valor: number } {
  const porPerfil = split.filter((linha) =>
    PERFIS_DO_INCORPORADOR.has((linha.perfil ?? "").trim().toLowerCase()),
  );

  if (porPerfil.length > 0) {
    return {
      encontrado: true,
      valor: porPerfil.reduce((soma, linha) => soma + (linha.valor || 0), 0),
    };
  }

  const alvo = normalizarNome(nomeDoIncorporador);
  if (alvo) {
    const porNome = split.filter((linha) => normalizarNome(linha.nome) === alvo);
    if (porNome.length > 0) {
      return {
        encontrado: true,
        valor: porNome.reduce((soma, linha) => soma + (linha.valor || 0), 0),
      };
    }
  }

  return { encontrado: false, valor: 0 };
}

/** Compara razão social ignorando caixa, acento e pontuação: o C2X grava sem padrão. */
function normalizarNome(v: null | string | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * A FÓRMULA, para quando não há split.
 *
 * Explicada pelo Lucas ao time em 16/01/2026, e ela não é "comissão sobre a entrada": a comissão é
 * um percentual do VALOR DO LOTE, e o incorporador recebe O COMPLEMENTO da entrada. Por isso a
 * fatia dele CRESCE quando a entrada é maior, embora a comissão em reais seja sempre a mesma:
 *
 *   lote 100.000, comissão 7%  ->  comissão = 7.000, sempre
 *     entrada 10% = 10.000  ->  cadeia 70,00%  ->  incorporador  3.000
 *     entrada 20% = 20.000  ->  cadeia 35,00%  ->  incorporador 13.000
 *     entrada 33% = 33.000  ->  cadeia 21,21%  ->  incorporador 26.000
 *
 * Nas PARCELAS do financiamento não há comissão: vale a % de gestão de carteira do empreendimento.
 */
function liquidoPelaFormula(
  parcela: ParcelaParaLiquido,
  politica: PoliticaDoEmpreendimento,
): ResultadoLiquido {
  const bruto = parcela.valor;

  if (parcela.perfil === "parcela") {
    const gestao = comoFracao(politica.gestaoCarteiraPct);
    if (gestao === null) {
      return {
        bruto,
        fonte: "calculado",
        liquido: null,
        motivo: "Gestão de carteira não cadastrada para este empreendimento.",
      };
    }

    return { bruto, fonte: "calculado", liquido: bruto * gestao };
  }

  // ── ENTRADA (ato + sinal) ────────────────────────────────────────────────
  const comissao = comoFracao(politica.comissaoPct);
  // A entrada DO CONTRATO manda; a mínima da política é o último recurso.
  const entrada =
    comoFracao(parcela.entradaPctContratada) ?? comoFracao(politica.entradaPct);
  const unidade = parcela.valorUnidade ?? null;

  if (comissao === null || entrada === null || !unidade || unidade <= 0) {
    return {
      bruto,
      fonte: "calculado",
      liquido: null,
      motivo: "Política comercial incompleta no C2X (comissão, entrada ou valor da unidade).",
    };
  }

  // A trava do Lucas: "nunca vou ter uma % mínima de entrada menor que a % dos comissionados".
  // Se acontecer, a conta daria fatia negativa para o incorporador — melhor avisar que inventar.
  if (comissao > entrada) {
    return {
      bruto,
      fonte: "calculado",
      liquido: null,
      motivo: "Comissão maior que a entrada: a política do empreendimento está inconsistente.",
    };
  }

  // A fatia do incorporador na entrada, uniforme entre ato e sinal.
  const fatiaDoIncorporador = 1 - comissao / entrada;

  return { bruto, fonte: "calculado", liquido: bruto * fatiaDoIncorporador };
}

/**
 * O líquido de UMA parcela. Split primeiro, fórmula depois.
 */
export function liquidoDaParcela(
  parcela: ParcelaParaLiquido,
  politica: PoliticaDoEmpreendimento,
): ResultadoLiquido {
  if (parcela.split && parcela.split.length > 0) {
    const peloSplit = liquidoPeloSplit(parcela.split, parcela.nomeDoIncorporador);

    if (peloSplit.encontrado) {
      return { bruto: parcela.valor, fonte: "split", liquido: peloSplit.valor };
    }

    // ⚠️ SPLIT ÍNTEGRO SEM O INCORPORADOR = ELE NÃO RECEBE NADA NESTA PARCELA, e isso é um FATO,
    // não uma lacuna. É o caso do Ato, que vai inteiro para a cadeia de comissão. Cair na fórmula
    // aqui INVENTARIA um líquido que o rateio real diz não existir.
    //
    // "Íntegro" = as linhas somam o valor da parcela (com tolerância de um centavo por
    // participante, por causa do rateio da tarifa do boleto).
    const somaDoSplit = parcela.split.reduce((soma, linha) => soma + (linha.valor || 0), 0);
    const tolerancia = 0.01 * parcela.split.length + 2;

    if (Math.abs(somaDoSplit - parcela.valor) <= tolerancia) {
      return { bruto: parcela.valor, fonte: "split", liquido: 0 };
    }

    // Split parcial ou ilegível: aí sim vale estimar, e a fonte diz que é cálculo.
  }

  return liquidoPelaFormula(parcela, politica);
}

/**
 * Soma o líquido de uma lista, sem esconder o que não deu para calcular.
 *
 * `semLiquido` existe para a tela poder dizer "R$ X, faltando N parcelas" em vez de apresentar uma
 * soma parcial como se fosse o total. Uma carteira que soma menos do que deveria, sem avisar, é o
 * tipo de número que o incorporador usa para conferir repasse e sai com a conclusão errada.
 */
export function somarLiquido(
  parcelas: ParcelaParaLiquido[],
  politica: PoliticaDoEmpreendimento,
): {
  bruto: number;
  liquido: number;
  motivos: string[];
  porSplit: number;
  semLiquido: number;
} {
  let bruto = 0;
  let liquido = 0;
  let porSplit = 0;
  let semLiquido = 0;
  const motivos = new Set<string>();

  for (const parcela of parcelas) {
    const resultado = liquidoDaParcela(parcela, politica);
    bruto += resultado.bruto;

    if (resultado.liquido === null) {
      semLiquido += 1;
      if (resultado.motivo) motivos.add(resultado.motivo);
      continue;
    }

    liquido += resultado.liquido;
    if (resultado.fonte === "split") porSplit += 1;
  }

  return { bruto, liquido, motivos: [...motivos], porSplit, semLiquido };
}
