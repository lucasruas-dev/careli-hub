import {
  acumulado,
  acumuladoEntre,
  type CodigoDeIndice,
  mediaMensalGeometrica,
  mesAnterior,
  mesesEntre,
  type SerieMensal,
  ultimoMes,
} from "@/lib/apolo/reajuste/serie-de-indice";

// A PROJEÇÃO DA PARCELA — quanto a mensalidade tende a ficar, e por quê.
//
// Lucas (23/09/2026): *"ter um relatório que mostra ao cliente a evolução das parcelas com base na
// série histórica do índice de correção que está naquele contrato, e uma projeção para o futuro"*.
//
// ⚠️ A REGRA NÃO É "O ÍNDICE DO ANO". Medido em 23/09/2026 sobre a carteira inteira (118.033
// mensais, 874 contratos, 926 degraus detectados pela régua do extrato): a mediana do degrau real
// em 2026 foi 15,65%, contra IPCA de 4,26% e INCC de 6,09%. Nenhum índice de um ano explica isso.
//
// ✅ O QUE EXPLICA 97,8% É O ÍNDICE ACUMULADO DESDE A ÚLTIMA APLICAÇÃO:
//     IPCA 1 ano 375 · IPCA 3 anos 366 · IPCA 4 anos 50 · INCC-M 1 ano 77 · IGP-M 2 anos 33 · …
//     sem explicação: 16 de 926 (1,7%)
// A causa é operacional: a correção é aplicada À MÃO no C2X, e só quando a parcela recebe boleto.
// Contrato que ficou três anos sem boleto leva três anos de índice num degrau só. O documento é
// `docs/operations/2026-09-23-como-o-reajuste-realmente-anda.md`.
//
// ⚠️ POR ISSO A PEÇA TEM DUAS METADES, E ELAS NÃO SE MISTURAM:
//   • REPRESADO — o índice que já foi publicado e ainda não alcançou a parcela. É FATO apurável:
//     os meses existem, o índice saiu, a correção não entrou. Não é opinião nossa.
//   • PROJETADO — daí para a frente. É ESTIMATIVA, e o nome disso é palpite bem-feito.
// Desenhar as duas na mesma curva, sem separar, seria dizer ao cliente que sabemos o que não
// sabemos. A separação existe no TIPO, para não depender de quem desenha a tela lembrar dela.
//
// ⚠️ OS 8% DO CONTRATO NÃO ENTRAM AQUI. Medido em 23/09/2026: em 901 degraus contra 0, o índice
// PURO explica melhor que o índice somado ao `contractual_interest` (erro médio 1,13 contra 4,81
// pontos). Os 8% são JURO do financiamento, já embutido na parcela pela amortização; somá-los ao
// reajuste contaria o mesmo dinheiro duas vezes.

/** O cenário de índice futuro. O nome é do cliente, não do estatístico. */
export type CenarioDeProjecao = "conservador" | "otimista" | "tendencia";

/** Quantos meses de história cada cenário olha para estimar o mês típico. */
const JANELA_DO_CENARIO: Record<CenarioDeProjecao, number> = {
  // 10 anos: atravessa mais de um ciclo econômico, então não fica refém do momento.
  conservador: 120,
  // 3 anos: o passado recente, que é o que o cliente reconhece como "os últimos tempos".
  otimista: 36,
  // 5 anos: o meio-termo, e o padrão.
  tendencia: 60,
};

/**
 * O cenário conservador e o otimista NÃO são a mesma média com nome diferente: depois de medir a
 * janela, um sobe e o outro desce, porque cenário que não abre leque não é cenário.
 */
const AJUSTE_DO_CENARIO: Record<CenarioDeProjecao, number> = {
  conservador: 1.25,
  otimista: 0.8,
  tendencia: 1,
};

export type ParcelaProjetada = {
  /** "AAAAMM" do vencimento. */
  competencia: string;
  /**
   * De onde vem o valor:
   *   • "real"      — a parcela existe no contrato, com este valor. Não é conta nossa.
   *   • "represado" — corrigida pelo índice JÁ PUBLICADO que ainda não foi aplicado. Fato.
   *   • "projetado" — corrigida por índice ESTIMADO. Palpite.
   */
  origem: "projetado" | "real" | "represado";
  /** O valor da parcela nesta competência. */
  valor: number;
};

export type ProjecaoDaParcela = {
  /** O índice usado, ou `null` quando não deu para reconhecer o do contrato. */
  indice: CodigoDeIndice | null;
  /** Até que mês a série publicada alcança. Depois disto é estimativa. */
  indicePublicadoAte: null | string;
  linhas: ParcelaProjetada[];
  /**
   * Por que não dá para projetar, quando não dá. Quem chama MOSTRA isto em vez de esconder a
   * seção: "não consegui" dito é muito melhor que uma tabela vazia sem explicação.
   */
  motivo?: string;
  /** A correção publicada que ainda não alcançou a parcela, em % (0 quando está em dia). */
  represadoPct: number;
  /** O valor de hoje já com o represado aplicado. É o próximo degrau que o cliente vai ver. */
  valorComRepresado: number;
  /** A mensalidade de hoje, como o contrato a tem. */
  valorDeHoje: number;
};

export type EntradaDaProjecao = {
  /** Cenário do trecho estimado. Padrão: "tendencia". */
  cenario?: CenarioDeProjecao;
  /** O mês de referência, "AAAAMM". Normalmente o mês corrente. */
  hoje: string;
  /** O índice do contrato, já traduzido. `null` = não reconhecido. */
  indice: CodigoDeIndice | null;
  /**
   * O mês da ÚLTIMA correção que alcançou este contrato, "AAAAMM".
   *
   * ⚠️ É O DADO MAIS IMPORTANTE DA PEÇA, e o mais fácil de errar. Não é a data do contrato nem o
   * aniversário teórico: é quando a parcela REALMENTE mudou de valor pela última vez. Quem chama
   * tira isso dos eventos do extrato (`detectarEventosDeValor`), não do cadastro.
   */
  ultimaCorrecaoEm: null | string;
  /** Quantos meses projetar para a frente. */
  meses: number;
  /** A série histórica do índice. */
  serie: SerieMensal;
  /** A mensalidade vigente, em reais. */
  valorDeHoje: number;
  /**
   * De quantos em quantos meses o contrato reajusta. 12 = anual, que é o caso de toda a carteira
   * medida. Aplicar mês a mês faria o gráfico subir em rampa onde a realidade sobe em degrau.
   */
  periodicidadeEmMeses?: number;
};

/** Soma meses a "AAAAMM". */
function somarMeses(aaaamm: string, meses: number): string {
  const ano = Number(aaaamm.slice(0, 4));
  const mes = Number(aaaamm.slice(4, 6));
  const total = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${novoAno}${String(novoMes).padStart(2, "0")}`;
}

/**
 * A correção JÁ PUBLICADA que ainda não alcançou a parcela.
 *
 * Do mês seguinte à última correção até o último mês publicado. Zero quando o contrato está em
 * dia, e `null` quando não dá para apurar (série com buraco, índice desconhecido).
 *
 * ⚠️ ISTO NÃO É PREVISÃO. São meses que já aconteceram e índices que já saíram; o que não
 * aconteceu foi a aplicação. Em LOS e LOU, medido, isso chega a três e quatro anos de índice.
 */
export function correcaoRepresada(input: {
  hoje: string;
  serie: SerieMensal;
  ultimaCorrecaoEm: null | string;
}): null | number {
  const publicadoAte = ultimoMes(input.serie);
  if (!publicadoAte) return null;
  if (!input.ultimaCorrecaoEm) return null;

  // Do mês SEGUINTE à última correção (o mês dela já foi contado no degrau que a aplicou).
  const inicio = somarMeses(input.ultimaCorrecaoEm, 1);
  if (mesesEntre(inicio, publicadoAte) <= 0) return 0;

  return acumuladoEntre(input.serie, inicio, publicadoAte);
}

/**
 * O mês típico do índice para o trecho estimado, em % ao mês.
 *
 * ⚠️ GEOMÉTRICA, NUNCA ARITMÉTICA: a média aritmética de variações percentuais superestima o
 * acumulado, porque ignora a composição. Em dez anos de IPCA a diferença é visível na parcela.
 */
export function mesTipico(
  serie: SerieMensal,
  cenario: CenarioDeProjecao = "tendencia",
): null | number {
  const ate = ultimoMes(serie);
  if (!ate) return null;

  const janela = JANELA_DO_CENARIO[cenario];
  // Janela cheia primeiro; se a série for curta demais, cai para o que existe, e nunca inventa.
  const medido =
    mediaMensalGeometrica(serie, ate, janela) ??
    mediaMensalGeometrica(serie, ate, 36) ??
    mediaMensalGeometrica(serie, ate, 12);

  return medido == null ? null : medido * AJUSTE_DO_CENARIO[cenario];
}

/**
 * Monta a projeção.
 *
 * A curva tem três trechos, e cada linha diz de qual ela é: o valor REAL de hoje, o degrau do
 * REPRESADO (que já é fato) e os degraus PROJETADOS daí para a frente.
 */
export function projetarParcela(entrada: EntradaDaProjecao): ProjecaoDaParcela {
  const {
    cenario = "tendencia",
    hoje,
    indice,
    meses,
    periodicidadeEmMeses = 12,
    serie,
    ultimaCorrecaoEm,
    valorDeHoje,
  } = entrada;

  const publicadoAte = ultimoMes(serie);
  const vazio: ProjecaoDaParcela = {
    indice,
    indicePublicadoAte: publicadoAte,
    linhas: [],
    represadoPct: 0,
    valorComRepresado: valorDeHoje,
    valorDeHoje,
  };

  if (!indice) {
    return { ...vazio, motivo: "O contrato não tem índice de correção reconhecido." };
  }
  if (serie.size === 0 || !publicadoAte) {
    return { ...vazio, motivo: `Não tenho a série do ${indice} para calcular.` };
  }
  if (!(valorDeHoje > 0)) {
    return { ...vazio, motivo: "Não encontrei a mensalidade vigente deste contrato." };
  }

  const represado = correcaoRepresada({ hoje, serie, ultimaCorrecaoEm });
  const tipico = mesTipico(serie, cenario);

  if (tipico == null) {
    return {
      ...vazio,
      motivo: `A série do ${indice} tem falha e não dá para estimar o mês típico.`,
      represadoPct: represado ?? 0,
      valorComRepresado: valorDeHoje * (1 + (represado ?? 0) / 100),
    };
  }

  const represadoPct = represado ?? 0;
  const valorComRepresado = valorDeHoje * (1 + represadoPct / 100);

  const linhas: ParcelaProjetada[] = [
    { competencia: hoje, origem: "real", valor: valorDeHoje },
  ];

  // O degrau do represado entra no mês seguinte: é o próximo boleto que o cliente recebe.
  if (represadoPct > 0) {
    linhas.push({
      competencia: somarMeses(hoje, 1),
      origem: "represado",
      valor: valorComRepresado,
    });
  }

  // ⚠️ DEGRAU, NÃO RAMPA. O contrato reajusta de `periodicidadeEmMeses` em `periodicidadeEmMeses`;
  // desenhar mês a mês mostraria uma subida suave que nenhum boleto do cliente teve.
  const doDegrau = (1 + tipico / 100) ** periodicidadeEmMeses;
  let valor = valorComRepresado;

  for (let m = periodicidadeEmMeses; m <= meses; m += periodicidadeEmMeses) {
    valor *= doDegrau;
    linhas.push({
      competencia: somarMeses(hoje, m),
      origem: "projetado",
      valor,
    });
  }

  return {
    indice,
    indicePublicadoAte: publicadoAte,
    linhas,
    represadoPct,
    valorComRepresado,
    valorDeHoje,
  };
}

/**
 * O acumulado de 12 meses que o índice fechou, para a peça mostrar "o IPCA do último ano".
 *
 * ⚠️ É O ACUMULADO ATÉ O ÚLTIMO MÊS PUBLICADO, e não até hoje: as fontes têm um mês de defasagem
 * (o índice de setembro sai em outubro), e pedir "até hoje" devolveria nulo todo mês.
 */
export function acumuladoDoUltimoAno(serie: SerieMensal): null | number {
  const ate = ultimoMes(serie);
  return ate ? acumulado(serie, ate, 12) : null;
}

/** Só para quem precisar do mês anterior sem importar de dois lugares. */
export { mesAnterior };
