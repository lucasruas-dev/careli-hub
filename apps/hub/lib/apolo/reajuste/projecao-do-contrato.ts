import { type ExtratoClienteRelatorio } from "@/lib/apolo/extrato-cliente";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";
import {
  acumuladoDoUltimoAno,
  type CenarioDeProjecao,
  mesTipico,
  type ParcelaProjetada,
  projetarParcela,
} from "@/lib/apolo/reajuste/projecao";
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
  /** Mensalidade original do contrato. */
  mensalidadeBase: number;
  /** O que a cobrança pratica hoje. */
  mensalidadeVigente: number;
  /** Por que não deu para projetar, quando não deu. */
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

    const base = {
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

    if (contrato.encerrado) {
      return { ...base, motivo: "Contrato encerrado: não há parcela futura para projetar." };
    }
    if (!indice) {
      return {
        ...base,
        motivo: contrato.indiceCorrecao
          ? `O índice "${contrato.indiceCorrecao}" não tem série pública para projetar.`
          : "O contrato não registra índice de correção, então não dá para projetar.",
      };
    }
    if (!serie) {
      return { ...base, motivo: `Não consegui buscar a série do ${indice} agora.` };
    }

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

    const mesTipicoPorCenario = input.cenarios
      ? (Object.fromEntries(
          input.cenarios.map((c) => [c, mesTipico(serie, c)]),
        ) as Record<CenarioDeProjecao, null | number>)
      : undefined;

    return {
      ...base,
      indicePublicadoAte: projetada.indicePublicadoAte,
      linhas: projetada.linhas,
      mesTipicoPct: mesTipico(serie, input.cenario),
      mesTipicoPorCenario,
      motivo: projetada.motivo,
      porCenario,
    };
  });

  return { data, ok: true };
}
