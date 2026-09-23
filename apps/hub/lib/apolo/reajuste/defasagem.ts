import {
  type ExtratoClienteParcelaBruta,
  mensalidadePlausivel,
  mensalidadeTipica,
  temBoleto,
} from "@/lib/apolo/extrato-cliente";

// A DEFASAGEM DA CARTEIRA — quanto a parcela FUTURA está atrás do que a cobrança já pratica.
//
// ⚠️ ISTO É MEDIÇÃO, NÃO PROJEÇÃO, e essa é a razão de a peça existir em separado. Medido em
// 23/09/2026 sobre a carteira inteira: **o valor contratual da parcela nunca é atualizado no
// C2X**. Só a parcela que RECEBE BOLETO é corrigida, cumulativamente desde a data-base. O AR 206
// (LOU) mostra o mecanismo inteiro:
//
//     R$ 535,99   135 de 144 parcelas   ZERO com boleto   fev/2024 a jan/2036
//     R$ 566,81     3 parcelas             3 com boleto   abr-jun/2026
//     R$ 657,27     6 parcelas             5 com boleto   ago-dez/2026   (+22,63%)
//
// Logo a defasagem não precisa de índice nenhum para ser apurada: basta comparar o que a cobrança
// JÁ USA com o que as futuras ainda carregam. Isso elimina a maior fonte de erro do assunto.
//
// ⚠️ NÃO TENTE DEDUZIR ISTO DE ÍNDICE. Eu tentei, em 23/09/2026, e o teste me enganou: casar o
// degrau com "índice acumulado em janela de 1 a 5 anos, tolerância 1,5 ponto" deu 97,8% de
// encaixe, e o backtest honesto (prever o degrau seguinte só com o passado do contrato) acertou
// 4,1%. Com cinco janelas e essa folga, encaixa por acaso. O documento é
// `docs/operations/2026-09-23-como-o-reajuste-realmente-anda.md`.
//
// ⚠️ A MENSALIDADE ATÍPICA PRECISA SAIR, e a régua é a MESMA do extrato (`mensalidadePlausivel`,
// que existe por causa do AR 3716). Sem ela, um balão marcado como `parcel_type_id = 3` aparece
// como 4.472% de defasagem e contamina qualquer soma.
//
// ⚠️ ESTA PEÇA NÃO ESCREVE NADA. Ela diz quanto está defasado; corrigir parcela no C2X é operação
// do legado, que é READ-ONLY daqui, e é decisão de negócio, não de relatório.

export type DefasagemDoContrato = {
  /** O maior valor entre as parcelas que JÁ receberam boleto: o que a cobrança pratica hoje. */
  cobrado: number;
  /** O patamar que as parcelas futuras sem boleto ainda carregam. */
  contratual: number;
  /** Quantas parcelas futuras estão nesse patamar defasado. */
  futurasDefasadas: number;
  /** `cobrado / contratual - 1`, em % (22.63 = 22,63%). Zero quando está em dia. */
  percentual: number;
  /** Quanto cada parcela futura sobe se for corrigida ao patamar cobrado, em reais. */
  porParcela: number;
  /**
   * Por que não deu para medir, quando não deu. Quem chama MOSTRA isto: "não consegui" dito é
   * melhor do que um zero que parece "está em dia".
   */
  motivo?: string;
  /** O vencimento da última parcela com boleto, que marca a fronteira entre passado e futuro. */
  ultimoBoletoEm: null | string;
  /** `false` quando não há o que medir (sem boleto, sem futuras, ou série imprestável). */
  apurada: boolean;
};

const SEM_MEDICAO = (motivo: string): DefasagemDoContrato => ({
  apurada: false,
  cobrado: 0,
  contratual: 0,
  futurasDefasadas: 0,
  motivo,
  percentual: 0,
  porParcela: 0,
  ultimoBoletoEm: null,
});

/** A moda dos valores, que é o PATAMAR — e não a média, que uma parcela torta puxaria. */
function patamar(valores: number[]): number {
  const contagem = new Map<string, number>();
  for (const v of valores) {
    const chave = v.toFixed(2);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  let melhor = 0;
  let maisVistas = 0;
  for (const [chave, quantas] of contagem) {
    if (quantas > maisVistas) {
      maisVistas = quantas;
      melhor = Number(chave);
    }
  }
  return melhor;
}

/**
 * Mede a defasagem de UM contrato.
 *
 * A fronteira é o vencimento da última parcela com boleto: o que vem depois dela e não tem boleto
 * é o futuro que ainda carrega o valor congelado.
 *
 * @param mensais As mensais do contrato, ativas, em qualquer ordem.
 */
export function defasagemDoContrato(
  mensais: ExtratoClienteParcelaBruta[],
): DefasagemDoContrato {
  if (mensais.length === 0) return SEM_MEDICAO("Contrato sem mensalidade.");

  // A régua do extrato tira balão e intermediária disfarçados de mensal (AR 3716).
  const tipica = mensalidadeTipica(mensais);
  const plausiveis = mensais.filter((p) => mensalidadePlausivel(p.valorInicial, tipica));
  const serie = plausiveis.length > 0 ? plausiveis : mensais;

  const comBoleto = serie.filter((p) => temBoleto(p));
  if (comBoleto.length === 0) {
    return SEM_MEDICAO("Nenhum boleto emitido ainda: não há valor praticado para comparar.");
  }

  // ⚠️ O MAIOR, e não o mais recente. A emissão não é cronológica: um boleto avulso de parcela
  // antiga sai depois de um da parcela seguinte, e "o último emitido" devolveria o valor velho.
  const cobrado = Math.max(...comBoleto.map((p) => p.valorInicial));

  const ultimoBoletoEm =
    comBoleto
      .map((p) => p.vencimento)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  if (!ultimoBoletoEm) {
    return SEM_MEDICAO("As parcelas com boleto não têm vencimento para marcar a fronteira.");
  }

  const futuras = serie.filter(
    (p) => !temBoleto(p) && (p.vencimento ?? "") > ultimoBoletoEm && p.valorInicial > 0,
  );
  if (futuras.length === 0) {
    return {
      ...SEM_MEDICAO("Não há parcela futura sem boleto: nada a corrigir daqui para a frente."),
      cobrado,
      ultimoBoletoEm,
    };
  }

  const contratual = patamar(futuras.map((p) => p.valorInicial));
  if (!(contratual > 0)) {
    return { ...SEM_MEDICAO("As parcelas futuras não têm valor."), cobrado, ultimoBoletoEm };
  }

  const percentual = (cobrado / contratual - 1) * 100;
  const defasadas = futuras.filter((p) => Math.abs(p.valorInicial - contratual) < 0.005).length;

  return {
    apurada: true,
    cobrado,
    contratual,
    // Em dia é ZERO, nunca negativo: parcela futura acima do cobrado acontece em contrato com
    // balão no meio, e chamar isso de "defasagem negativa" confundiria quem lê.
    futurasDefasadas: percentual > 0 ? defasadas : 0,
    percentual: percentual > 0 ? percentual : 0,
    porParcela: percentual > 0 ? cobrado - contratual : 0,
    ultimoBoletoEm,
  };
}

export type LinhaDaDefasagem = {
  /** `acquisition_requests.id`. */
  contratoId: number | string;
  cliente: null | string;
  /** Código do empreendimento no C2X. */
  code: string;
  defasagem: DefasagemDoContrato;
  /** Rótulo da unidade ("Q02 L05"). */
  unidade: string;
};

export type ResumoDaDefasagem = {
  /** Contratos cuja parcela futura está atrás do que se cobra. */
  comDefasagem: number;
  /** Contratos medidos e em dia. */
  emDia: number;
  /** Contratos em que não deu para medir (sem boleto, sem futuras). */
  naoApurados: number;
  /** Soma de `porParcela` dos defasados: quanto a mensalidade da carteira sobe por mês. */
  porMes: number;
  /** A defasagem mediana entre os defasados, em %. */
  medianaPct: number;
  total: number;
};

/** O resumo de um conjunto de linhas, que é o que o topo da tela mostra. */
export function resumirDefasagem(linhas: LinhaDaDefasagem[]): ResumoDaDefasagem {
  const defasados = linhas.filter((l) => l.defasagem.apurada && l.defasagem.percentual > 0);
  const emDia = linhas.filter((l) => l.defasagem.apurada && l.defasagem.percentual <= 0).length;
  const naoApurados = linhas.filter((l) => !l.defasagem.apurada).length;

  const percentuais = defasados.map((l) => l.defasagem.percentual).sort((a, b) => a - b);
  const meio = Math.floor(percentuais.length / 2);
  const medianaPct =
    percentuais.length === 0
      ? 0
      : percentuais.length % 2
        ? (percentuais[meio] ?? 0)
        : ((percentuais[meio - 1] ?? 0) + (percentuais[meio] ?? 0)) / 2;

  return {
    comDefasagem: defasados.length,
    emDia,
    medianaPct,
    naoApurados,
    porMes: defasados.reduce((soma, l) => soma + l.defasagem.porParcela, 0),
    total: linhas.length,
  };
}
