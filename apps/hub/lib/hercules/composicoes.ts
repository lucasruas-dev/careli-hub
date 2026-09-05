// AS COMPOSIÇÕES QUE FECHAM — partindo do que o cliente pode pagar por mês.
//
// Lucas (03/09/2026), sobre o simulador: *"o que eu gosto, a opção de começar pelo valor da parcela,
// isso ajuda bastante"*. É como o comprador fala — "consigo pagar 3.450" —, e o caminho de lá até
// entrada, prazo e reforço, na mão, é tentativa e erro.
//
// ⚠️ A BUSCA É SOBRE OS PLANOS DA CASA, não sobre o infinito. Cada plano traz prazo, juros e o
// percentual de entrada que a diretoria aprovou; o que varia aqui é a ENTRADA (e, quando ajuda, o
// reforço anual). Varrer prazo livremente devolveria composições que ninguém pode vender.
//
// ⚠️ E A ENTRADA É O QUE SE MEXE, porque é o que o cliente negocia de verdade. Para uma parcela
// pedida, cada plano tem UMA entrada que fecha exatamente — é conta fechada, não busca: sai de
// `entradaParaAParcela`. O que a varredura acrescenta é o reforço anual, que baixa a entrada.

import type { SistemaAmortizacao } from "@/lib/apolo/planos-comerciais";

import { pisoDaEntradaNoPrazo } from "./faixa-do-plano";
import { entradaParaAParcela, montarProposta } from "./simulacao";

export type PlanoDaComposicao = {
  /** Percentual de entrada que o plano prevê — o piso sugerido, não uma trava. */
  entradaPercentual: number;
  nome: string;
  parcelas: number;
  /**
   * Como o plano divide o saldo — e, portanto, de quanto é a parcela.
   *
   * ⚠️ NÃO É ENFEITE, E FALTAVA AQUI ATÉ 04/09/2026. Sem este campo a varredura calculava Price
   * para todo mundo, inclusive nos 21 de 24 empreendimentos que vendem em SACOC: para a MESMA
   * parcela pedida, a entrada que a lista oferecia saía errada, e a parcela de volta no cartão
   * discordava do PDF gerado logo em seguida (que sempre respeitou o sistema, via
   * `montarCronograma`). Quem monta um `PlanoDaComposicao` a partir do cadastro converte a string
   * com `sistemaDoCadastro`, para cair onde `calcularParcela` cai quando o campo vem estranho.
   */
  sistemaAmortizacao: SistemaAmortizacao;
  /** Taxa MENSAL já convertida. Quem converte é `taxaMensal`, do cadastro de planos. */
  taxaAoMes: number;
};

export type Composicao = {
  /** Quantos reforços anuais, e de quanto. */
  anuais: { quantidade: number; valor: number };
  entrada: number;
  /** Quanto a entrada representa do valor negociado. */
  entradaPercentual: number;
  /**
   * O saldo que vira série mensal, JÁ DESCONTADO o valor presente dos reforços.
   *
   * ⚠️ NÃO É `valor − entrada`. Os reforços anuais vencem lá na frente e entram na conta pelo que
   * valem HOJE, não pelo valor de face — é assim que `montarProposta` calcula e é o número que o
   * PDF imprime como "Financiado". A tela recalculava `valor − entrada` por conta própria e
   * mostrava R$ 180.000 onde o papel do cliente dizia R$ 166.111,11, na mesma venda. Pior: no
   * SACOC a parcela é `financiado ÷ n`, então o cartão se contradizia sozinho — anunciava
   * R$ 1.384,26 embaixo de um saldo que daria R$ 1.500,00.
   */
  financiado: number;
  /** A do PRIMEIRO ciclo no SACOC — a que o C2X emite no primeiro ano. Ver `montarProposta`. */
  parcela: number;
  parcelas: number;
  plano: string;
  /**
   * Entrada + a série mensal INTEIRA + reforços.
   *
   * ⚠️ NÃO É `parcela × parcelas` FORA DA PRICE: no SACOC a parcela sobe no aniversário, e o total
   * vem de `somaDasMensais`. Multiplicar a parcela do primeiro ano pelo prazo tirava R$ 72 mil de
   * um contrato de 120 meses a 8% a.a. — e é este número que ordena o desempate da lista.
   */
  total: number;
};

/**
 * O piso de entrada da casa, em percentual do valor negociado.
 *
 * ⚠️ REGRA COMERCIAL, NÃO CONTA. Lucas (03/09/2026), vendo o simulador oferecer entrada de R$ 5.000
 * num lote de R$ 178 mil: *"lembrando que temos um valor mínimo de entrada, 10%"*. A varredura
 * partia da parcela e aceitava qualquer entrada que fechasse a conta — matematicamente correto e
 * comercialmente impossível. Um corretor que abre a tela e lê "entrada R$ 3.000" promete isso.
 *
 * ⚠️ NÃO CONFUNDIR COM `entradaPercentual` DO PLANO, que é a entrada SUGERIDA de cada plano (20%
 * no investidor, 10% no normal). Este é o chão que vale para todos.
 *
 * ⚠️ É O PADRÃO, NÃO A REGRA FINAL. Desde 03/09/2026 cada empreendimento aponta a sua % mínima na
 * aba Política Comercial (`apolo_enterprise_settings.entrada_minima_percentual`) — decisão do Lucas
 * no mesmo dia: *"vamos ter um campo dentro da parte que vamos cadastrar a política comercial e lá
 * vamos apontar a % mínima"*. O motivo é concreto: o Garden tem planos cadastrados com 8%, e uma
 * constante única ou proíbe o que o Garden vende ou libera abaixo do mínimo nos outros. Este número
 * vale para quem não cadastrou o seu.
 */
export const ENTRADA_MINIMA_PERCENTUAL = 10;

/**
 * O piso em reais, para um valor negociado.
 *
 * ⚠️ ARREDONDA NO CENTAVO, e não é cosmético: 10% de R$ 178.100 dá 17810.000000000002 em ponto
 * flutuante, e a tela dizia "abaixo do mínimo" para uma entrada de exatamente R$ 17.810. O mínimo é
 * "10% em diante" (Lucas, 03/09/2026) — o próprio 10% vale.
 *
 * ⚠️ `percentual` NULO CAI NO PADRÃO, mas ZERO É ZERO. Empreendimento que aceita venda sem entrada
 * é uma decisão legítima e cadastrável; tratar 0 como "não cadastrado" a desfaria em silêncio.
 */
export function entradaMinima(valor: number, percentual?: null | number): number {
  const usar =
    typeof percentual === "number" && Number.isFinite(percentual)
      ? percentual
      : ENTRADA_MINIMA_PERCENTUAL;
  return Math.max(0, Math.round(valor * usar) / 100);
}

/** Arredonda para cima, na casa do milhar: entrada de R$ 27.304 é proposta; R$ 28.000 é conversa. */
function milhar(valor: number): number {
  return Math.ceil(valor / 1_000) * 1_000;
}

/**
 * As composições que cabem numa parcela, uma por plano (mais as variações com reforço anual).
 *
 * ⚠️ ORDENADAS PELA MENOR ENTRADA, e é essa a "mais recomendada". Numa mesa de venda, o que trava o
 * negócio quase sempre é o dinheiro de agora — o cliente já disse que a parcela cabe. Ordenar por
 * total pago colocaria na frente a proposta com a maior entrada, que é a que ele não tem.
 *
 * ⚠️ ENTRADA NEGATIVA SIGNIFICA QUE A PARCELA JÁ PAGA O LOTE: a composição não entra, em vez de
 * aparecer com entrada zero e enganar. Quem pede parcela alta demais precisa ver menos opções, não
 * opções erradas.
 */
export function composicoesQueFecham(entrada: {
  anuaisPossiveis?: number[];
  /** A % mínima de entrada DESTE empreendimento. Ausente = padrão da casa. */
  entradaMinimaPercentual?: null | number;
  parcelaAlvo: number;
  planos: PlanoDaComposicao[];
  /** Teto do que o cliente tem de entrada. Ausente = sem teto. */
  tetoDaEntrada?: null | number;
  valor: number;
}): Composicao[] {
  const { anuaisPossiveis = [0, 15_000, 20_000, 25_000, 30_000], parcelaAlvo, planos, valor } = entrada;
  const teto = entrada.tetoDaEntrada ?? null;
  const pisoDaCasa = milhar(entradaMinima(valor, entrada.entradaMinimaPercentual));

  /**
   * O piso de CADA plano — o da casa ou o da faixa dele, o que for maior.
   *
   * ⚠️ A VARREDURA RECOMENDAVA EXATAMENTE O QUE A TELA RECUSA. Ancorando todos os planos no piso da
   * casa, a lista saía ordenada por menor entrada e a PRIMEIRA — a que a modal marca "Recomendada"
   * e a única que ela mostra — vinha do plano mais curto com a entrada mais baixa: INVESTIDOR 36x
   * com R$ 14.000 (10%) num lote de R$ 140.000, onde a faixa exige R$ 56.000 (40%). O coordenador
   * clicava em Gerar e o PDF saía com R$ 42.000 de entrada a menos do que a tabela manda; se em vez
   * disso ele clicasse em Editar, o campo Entrada acusava na hora "Abaixo do mínimo de 40%" — a
   * tela recusando o número que ela mesma tinha acabado de recomendar.
   *
   * ⚠️ CADA PLANO TEM O SEU, e não há um piso único da varredura: o prazo do plano É a faixa dele.
   */
  const pisoDoPlano = (plano: PlanoDaComposicao) =>
    // ⚠️ O ARREDONDAMENTO PARA CIMA NÃO PODE PASSAR DO LOTE. `milhar` existe para transformar
    // "entrada de R$ 27.304" em conversa de mesa ("R$ 28.000"), e isso é bom em plano parcelado —
    // mas no plano À VISTA o piso é 100% do valor, e milhar(138.500) devolve R$ 139.000: uma
    // entrada MAIOR que o lote. A composição saía recomendada e `conferirProposta` a recusava logo
    // depois com "a entrada não pode passar do valor negociado" — a tela oferecendo o que ela mesma
    // proíbe, sem saída para o coordenador.
    Math.min(
      valor,
      milhar(
        pisoDaEntradaNoPrazo({
          parcelas: plano.parcelas,
          pisoDaCasaEmReais: pisoDaCasa,
          planos: planos.map((p) => ({
            entradaPercentual: p.entradaPercentual,
            nome: p.nome,
            parcelas: p.parcelas,
          })),
          valorNegociado: valor,
        }).emReais,
      ),
    );

  if (parcelaAlvo <= 0 || valor <= 0) return [];

  const achadas: Composicao[] = [];

  for (const plano of planos) {
    if (plano.parcelas <= 0) continue;

    // ⚠️ O REFORÇO TEM QUE CABER NO PRAZO. O k-ésimo balão cai no mês 12k (ver
    // `valorPresenteDosBaloes`): num plano de 36 meses só existem três aniversários, e varrer até
    // seis oferecia "6 × R$ 15.000 ao ano" num contrato de três anos — dinheiro cobrado depois da
    // última parcela. A conta descontava tudo do saldo e a parcela saía menor do que o contrato
    // consegue cumprir.
    const aniversarios = Math.floor(plano.parcelas / 12);

    for (const valorAnual of anuaisPossiveis) {
      // Zero reforço é uma composição legítima, e a mais simples de explicar.
      const quantidades =
        valorAnual === 0
          ? [0]
          : Array.from({ length: Math.min(6, aniversarios) }, (_, i) => i + 1);

      for (const quantidade of quantidades) {
        // ⚠️ A INVERSÃO É A DO SISTEMA DO PLANO. Ver `fatorDoFinanciado`, em `simulacao.ts`: no
        // SACOC o saldo que a parcela pedida paga é `parcela × n` (amortização pura), e não o valor
        // presente de uma série Price. Usar a inversão errada devolvia, para a mesma parcela, uma
        // entrada mais alta do que a necessária — e a composição voltava ao cartão com uma parcela
        // que o contrato não emite.
        const { entrada: exata, sobra } = entradaParaAParcela({
          baloesQuantidade: quantidade,
          baloesValor: valorAnual,
          parcela: parcelaAlvo,
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
          taxaAoMes: plano.taxaAoMes,
          valor,
        });

        // A parcela pedida já paga o lote: não é composição, é outra conversa.
        if (sobra > 0) continue;

        // ⚠️ ANCORA NO PISO, NÃO DESCARTA. Quando a entrada que fecharia a parcela pedida fica
        // abaixo do mínimo da casa, a composição continua válida: com a entrada no piso a parcela
        // sai MENOR do que a pedida, que é a favor do cliente. Descartar esconderia a melhor
        // notícia da mesa ("cabe, e ainda sobra").
        const arredondada = Math.max(pisoDoPlano(plano), milhar(exata));

        // ⚠️ ENTRADA QUE COBRE O LOTE INTEIRO NÃO É COMPOSIÇÃO — é venda à vista, e ela não
        // responde a pergunta que foi feita. Quem digitou "o cliente paga R$ 4.000 por mês" recebia
        // como única recomendação o plano À VISTA com entrada de 100% e "R$ 0,00 por mês, 1 vez", e
        // o PDF saía com "Parcela 1 de 1: R$ 0,00" para alguém que acabou de dizer que pode pagar
        // quatro mil. Vender à vista continua possível: basta escolher o plano na tabela.
        if (arredondada >= valor) continue;
        if (teto !== null && arredondada > teto) continue;

        const montada = montarProposta({
          baloesQuantidade: quantidade,
          baloesValor: valorAnual,
          entrada: arredondada,
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
          taxaAoMes: plano.taxaAoMes,
          valor,
        });

        achadas.push({
          anuais: { quantidade, valor: valorAnual },
          entrada: arredondada,
          entradaPercentual: valor > 0 ? (arredondada / valor) * 100 : 0,
          financiado: montada.financiado,
          parcela: montada.parcela,
          parcelas: plano.parcelas,
          plano: plano.nome,
          total: montada.total,
        });
      }
    }
  }

  // ⚠️ UMA POR PLANO+REFORÇO: sem isso, seis quantidades de reforço do mesmo plano viram seis
  // linhas quase iguais e a lista deixa de ser lida.
  const melhorPorChave = new Map<string, Composicao>();
  for (const c of achadas) {
    const chave = `${c.plano}|${c.anuais.quantidade > 0 ? "com-reforco" : "sem-reforco"}`;
    const atual = melhorPorChave.get(chave);
    if (!atual || c.entrada < atual.entrada) melhorPorChave.set(chave, c);
  }

  return [...melhorPorChave.values()].sort(
    (a, b) => a.entrada - b.entrada || a.total - b.total,
  );
}
