import {
  type ExtratoClienteRelatorio,
  TIPO_ATO,
  TIPO_MENSAL,
  TIPO_SINAL,
} from "@/lib/apolo/extrato-cliente";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";
import {
  acumuladoDoUltimoAno,
  type CenarioDeProjecao,
  mesTipico,
  type ParcelaProjetada,
  projetarParcela,
} from "@/lib/apolo/reajuste/projecao";
import {
  jurosAnualDoContrato,
  montarQuadroAnual,
  primeiroVencimentoDoContrato,
  type QuadroAnual,
  type SistemaDeAmortizacao,
  sistemaDeclarado,
  sistemaDoContrato,
} from "@/lib/apolo/reajuste/quadro-anual";
import {
  buscarSerie,
  type CodigoDeIndice,
  indiceDoNome,
  type SerieMensal,
  ultimoMes,
} from "@/lib/apolo/reajuste/serie-de-indice";

// A EVOLUÇÃO DA PARCELA DE UM CONTRATO — o relatório que o Lucas pediu, por cliente.
//
// Lucas (23/09/2026): *"um relatório que mostra ao cliente a evolução das parcelas, com base na
// série histórica do índice de correção que está naquele contrato, e uma projeção para o futuro"*.
//
// ⚠️ ELE MORA NO FINANCEIRO DO CLIENTE, ao lado do Extrato e dos Acordos — não é painel de
// carteira. Eu errei isso na primeira tentativa e construí o painel geral (`/apolo/defasagem`),
// que continua valendo para a operação, mas não era o pedido.
//
// ⚠️ NADA AQUI RECALCULA O QUE O EXTRATO JÁ SABE. Mensalidade base, mensalidade vigente, defasagem
// medida e índice do contrato saem de `loadExtratoDoCliente`; esta peça só acrescenta o tempo.
// Duas contas do mesmo número em duas telas é como elas começam a divergir.
//
// ⚠️ A PEÇA TEM DUAS METADES QUE NÃO SE MISTURAM, e o tipo obriga a isso:
//   • o que JÁ ACONTECEU e o que está represado — fato medido, sem índice nenhum no meio;
//   • o que VAI acontecer — estimativa a partir da série publicada, e dito como estimativa.

export type EvolucaoDoContrato = {
  /** Os degraus que já aconteceram, como o extrato os detectou. */
  eventos: ExtratoClienteRelatorio["eventos"];
  /** Nome do índice como o contrato o registra ("IPCA ANUAL"), ou null. */
  indiceDoContrato: null | string;
  /** O índice reconhecido para a série. `null` = não dá para projetar. */
  indice: CodigoDeIndice | null;
  /** Último mês publicado do índice. A fonte atrasa um mês, e a tela diz isso. */
  indicePublicadoAte: null | string;
  /** O acumulado de 12 meses do índice, para a tela mostrar "o IPCA do último ano". */
  indiceNoAno: null | number;
  linhas: ParcelaProjetada[];
  /**
   * Os TRÊS cenários de uma vez, quando `cenarios` é pedido. É o que o PDF usa.
   *
   * ⚠️ MESMA LEITURA PARA OS TRÊS: pedir o PDF três vezes, uma por cenário, custaria três varreduras
   * do C2X e três buscas de série para desenhar a mesma folha. O que muda entre eles é só a média
   * aplicada, que é conta pura sobre a série já carregada.
   */
  porCenario?: Record<CenarioDeProjecao, ParcelaProjetada[]>;
  /** O % ao mês de cada cenário, para o papel escrever a premissa de cada coluna. */
  mesTipicoPorCenario?: Record<CenarioDeProjecao, null | number>;
  /**
   * O QUADRO ANUAL, da primeira à última parcela, nos três cenários: juros e correção calculados
   * como o contrato manda (Lucas, 24/09/2026). É conta do CONTRATO, não do caixa — ver
   * `quadro-anual.ts`. Ausente quando a conta inteira não é possível, e aí `motivo` diz por quê.
   */
  quadros?: Record<CenarioDeProjecao, QuadroAnual>;
  /** A taxa do contrato, já efetiva ao ano, como a proposta registra. `null` = não registrada. */
  jurosAnualPct?: null | number;
  /**
   * O contrato tem índice com série pública, mas a série não pôde ser lida AGORA. É transitório:
   * o PDF recusa em vez de imprimir um papel sem o quadro.
   */
  serieIndisponivel?: boolean;
  /** SACOC (juros no aniversário) ou PRICE (juros já na parcela). */
  sistema?: SistemaDeAmortizacao;
  /** Mensalidade original do contrato. */
  mensalidadeBase: number;
  /** O que a cobrança pratica hoje. */
  mensalidadeVigente: number;
  /** Por que o quadro não saiu, quando não saiu. Só existe SEM quadro. */
  motivo?: string;
  /** O % ao mês usado no trecho estimado (para a tela poder mostrar a premissa). */
  mesTipicoPct: null | number;
  /** Defasagem JÁ medida pelo extrato: vigente ÷ base − 1, em %. */
  defasagemPct: number;
  /** O rótulo do contrato ("LOS0617"). */
  codigo: string;
  empreendimento: null | string;
  /** `true` = contrato encerrado; a projeção não sai, e a tela explica. */
  encerrado: boolean;
  contratoId: number;
};

/** "AAAAMM" de hoje. */
function mesDe(iso: string): string {
  return iso.slice(0, 4) + iso.slice(5, 7);
}

/**
 * Monta a evolução de cada contrato do cliente.
 *
 * ⚠️ UMA BUSCA DE SÉRIE POR ÍNDICE, e não por contrato: o cliente com três lotes do mesmo
 * loteamento usaria a mesma série três vezes. Chamada externa é cara e a fonte é pública, mas
 * repetir não deixa de ser desperdício.
 */
export async function evolucaoDosContratos(input: {
  c2xId: number;
  cenario?: CenarioDeProjecao;
  /** Quando presente, projeta TAMBÉM estes cenários e os devolve em `porCenario`. */
  cenarios?: CenarioDeProjecao[];
  contratoId?: null | number;
  /** Quantos meses projetar. Padrão: 60 (cinco anos), que cabe na tela sem virar lista. */
  meses?: number;
}): Promise<{ data: EvolucaoDoContrato[]; ok: true } | { error: string; ok: false }> {
  const extrato = await loadExtratoDoCliente({
    c2xId: input.c2xId,
    contratoId: input.contratoId ?? null,
  });
  if (!extrato.ok) return { error: extrato.error, ok: false };

  const meses = input.meses ?? 60;
  const hoje = mesDe(extrato.data.posicaoEm);

  // Busca cada série UMA vez, e só as que os contratos deste cliente usam.
  const necessarios = new Set<CodigoDeIndice>();
  for (const relatorio of extrato.data.contratos) {
    const codigo = indiceDoNome(relatorio.contrato.indiceCorrecao);
    if (codigo) necessarios.add(codigo);
  }

  const series = new Map<CodigoDeIndice, SerieMensal>();
  await Promise.all(
    [...necessarios].map(async (codigo) => {
      try {
        series.set(codigo, await buscarSerie(codigo));
      } catch (erro) {
        // ⚠️ FONTE FORA DO AR NÃO DERRUBA A PEÇA. Sem a série o contrato sai com o histórico e o
        // represado (que são fato) e sem a curva futura, dizendo por quê — melhor do que 503 numa
        // aba que tem conteúdo útil mesmo sem projetar.
        console.error(`[apolo][evolucao] falha ao buscar a série do ${codigo}`, erro);
      }
    }),
  );

  const data: EvolucaoDoContrato[] = extrato.data.contratos.map((relatorio) => {
    const { contrato, eventos, totais } = relatorio;
    const indice = indiceDoNome(contrato.indiceCorrecao);
    const serie = indice ? series.get(indice) : undefined;

    // ── O QUADRO ANUAL ─────────────────────────────────────────────────────────────────────
    // ⚠️ O JURO E O ÍNDICE VÊM DA PROPOSTA (Lucas, 24/09/2026: "vc tem que pegar da proposta qual é
    // o juros e o índice de correção"), pelo MESMO caminho que o extrato lê: o plano de
    // `acquisition_requests.commercial_plan_id`. O plano "próprio" do contrato
    // (`commercial_plans.acquisition_request_id`) é casca vazia — no LOS0617 ele tem nome em branco,
    // zero parcelas e juro nulo — e por isso não é lido.
    const mensais = [...relatorio.realizados, ...relatorio.abertas].filter(
      (p) => p.tipoId === TIPO_MENSAL && p.vencimento,
    );
    // ⚠️ A PARCELA 1 PELO NÚMERO DE CADA MENSAL, e não o menor vencimento que sobrou no C2X: há
    // contrato cujas primeiras mensais não existem no legado (ver `primeiroVencimentoDoContrato`).
    const primeiroVencimento = primeiroVencimentoDoContrato(mensais);
    // ⚠️ O ANIVERSÁRIO É O DO CONTRATO (o ato), e não o da primeira parcela: é daqui que o índice é
    // medido e é daqui que o ciclo vira. Medido em agosto/2026, `act_date + 12 × ciclo` bate em 459
    // de 463 contratos da Lavra. Sem data de ato, a assinatura; sem as duas, o primeiro vencimento.
    const dataDoContrato = contrato.dataAto ?? contrato.dataAssinatura ?? null;
    const prazo = contrato.planoParcelas ?? mensais.length;
    const entrada = [...relatorio.realizados, ...relatorio.abertas]
      .filter((p) => p.tipoId === TIPO_ATO || p.tipoId === TIPO_SINAL)
      .reduce((soma, p) => soma + p.valorContratual, 0);
    const financiado = contrato.precoTabela ? contrato.precoTabela - entrada : null;
    const jurosAnualPct = jurosAnualDoContrato(contrato.jurosContratuais);
    // ⚠️ O QUE O C2X DECLARA VENCE O QUE A PARCELA SUGERE (ver `sistemaDeclarado`).
    const sistema =
      sistemaDeclarado({
        planoNome: contrato.planoNome,
        tabelaDoEmpreendimento: contrato.tabelaDoEmpreendimento,
      }) ??
      sistemaDoContrato({
        financiado,
        jurosAnualPct: jurosAnualPct ?? 0,
        parcela: totais.mensalidadeBase,
        prazo,
      });
    const semCorrecao = /SEM\s*CORRE/i.test(contrato.indiceCorrecao ?? "");
    const serieIndisponivel = !semCorrecao && Boolean(indice) && !serie;

    // Sempre os três quando há série: a tela e o papel citam a taxa de cada cenário.
    const mesTipicoPorCenario = serie
      ? (Object.fromEntries(
          (["otimista", "tendencia", "conservador"] as const).map((c) => [c, mesTipico(serie, c)]),
        ) as Record<CenarioDeProjecao, null | number>)
      : undefined;

    // ⚠️ O QUADRO SÓ SAI QUANDO A CONTA INTEIRA É POSSÍVEL (revisão de 24/09/2026). Cada uma destas
    // saídas já desenhou número errado para cliente: contrato encerrado projetado até 2036; juro nulo
    // impresso como "0,00% a.a." (LOS0619, R$ 71 mil abaixo do real); série fora do ar virando total
    // SEM correção. Meio quadro é pior que nenhum, porque parece inteiro.
    const motivo = contrato.encerrado
      ? "Contrato encerrado: o quadro da parcela só é montado para contrato em andamento."
      : sistema === "sacoc" && jurosAnualPct == null
        ? contrato.indiceCorrecao
          ? "O plano do contrato não registra a taxa de juros, então o quadro não pode ser calculado."
          : "O contrato não tem plano comercial ligado no C2X (juros e índice), então o quadro não pode ser calculado."
        : !semCorrecao && !contrato.indiceCorrecao
          ? "O contrato não registra índice de correção, então o quadro não pode ser calculado."
          : !semCorrecao && !indice
            ? `O índice "${contrato.indiceCorrecao}" não tem série pública, então a correção não pode ser calculada.`
            : serieIndisponivel
              ? `Não consegui buscar a série do ${indice} agora. Tente de novo em alguns minutos.`
              : !primeiroVencimento || !(prazo > 0) || !(totais.mensalidadeBase > 0)
                ? "Não encontrei a parcela de origem ou o primeiro vencimento deste contrato."
                : undefined;

    const quadros =
      motivo === undefined && primeiroVencimento
        ? (Object.fromEntries(
            (["otimista", "tendencia", "conservador"] as const).map((c) => [
              c,
              montarQuadroAnual({
                correcao: semCorrecao ? "sem-correcao" : undefined,
                dataDoContrato,
                jurosAnualPct: jurosAnualPct ?? 0,
                mesTipicoPct: mesTipicoPorCenario?.[c] ?? 0,
                parcelaBase: totais.mensalidadeBase,
                prazo,
                primeiroVencimento,
                serie: serie ?? null,
                sistema,
              }),
            ]),
          ) as Record<CenarioDeProjecao, QuadroAnual>)
        : undefined;

    const base = {
      jurosAnualPct,
      mesTipicoPorCenario,
      motivo,
      quadros,
      serieIndisponivel,
      sistema,
      codigo: contrato.codigo,
      contratoId: contrato.id,
      defasagemPct: totais.defasagem * 100,
      empreendimento: contrato.empreendimentoNome,
      encerrado: contrato.encerrado,
      eventos,
      indice,
      indiceDoContrato: contrato.indiceCorrecao,
      indiceNoAno: serie ? acumuladoDoUltimoAno(serie) : null,
      indicePublicadoAte: serie ? ultimoMes(serie) : null,
      linhas: [] as ParcelaProjetada[],
      mensalidadeBase: totais.mensalidadeBase,
      mensalidadeVigente: totais.mensalidadeVigente,
      mesTipicoPct: null as null | number,
    };

    if (contrato.encerrado || !indice || !serie) return base;

    // ⚠️ O PONTO DE PARTIDA É A MENSALIDADE VIGENTE, e não a base: é o que o cliente paga hoje.
    // A diferença entre as duas é a defasagem, que o extrato já mede e a tela mostra ao lado.
    const projetada = projetarParcela({
      cenario: input.cenario,
      hoje,
      indice,
      meses,
      // A defasagem já está embutida na vigente, então não há represado a somar de novo aqui:
      // dizer que a última correção foi "agora" é o que evita contar duas vezes o mesmo degrau.
      ultimaCorrecaoEm: hoje,
      serie,
      valorDeHoje: totais.mensalidadeVigente,
    });

    // Os demais cenários saem da MESMA série já carregada: só a média muda.
    const porCenario = input.cenarios
      ? (Object.fromEntries(
          input.cenarios.map((c) => [
            c,
            projetarParcela({
              cenario: c,
              hoje,
              indice,
              meses,
              serie,
              ultimaCorrecaoEm: hoje,
              valorDeHoje: totais.mensalidadeVigente,
            }).linhas,
          ]),
        ) as Record<CenarioDeProjecao, ParcelaProjetada[]>)
      : undefined;

    // ⚠️ O `motivo` da projeção antiga ("não encontrei a mensalidade vigente") NÃO sobe: as linhas
    // dela não são mais desenhadas, e o aviso ficaria ao lado de um quadro que está certo.
    return {
      ...base,
      indicePublicadoAte: projetada.indicePublicadoAte,
      linhas: projetada.linhas,
      mesTipicoPct: mesTipico(serie, input.cenario),
      porCenario,
    };
  });

  return { data, ok: true };
}
