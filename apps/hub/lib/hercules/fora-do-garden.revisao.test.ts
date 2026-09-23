import { describe, expect, it } from "vitest";

import { taxaMensal } from "@/lib/apolo/planos-comerciais";

import { composicoesQueFecham } from "./composicoes";
import { montarCronograma } from "./cronograma";
import { comoPlano, type LinhaDoPlano } from "./planos-do-panteon";
import {
  entradaParaAParcela,
  montarProposta,
  sistemaDoCadastro,
  temAnuaisCadastradas,
} from "./simulacao";

// REVISÃO DE 18/09/2026, LENTE "REGRESSÃO FORA DO GARDEN" (rodada 3 do fix/planos-como-mmendes).
//
// Lucas, perguntado se as anuais pelo valor cheio valiam só no Garden ou em todos: *"So no Garden"*.
// Aqui ficam presos os números que a ORIGIN/MAIN calcula para planos reais de outros empreendimentos
// (SELECT em `temis_planos` e no lote mediano disponível de `hercules_unidades`, 18/09/2026). Foram
// medidos rodando a mesma chamada contra a origin/main extraída com `git show`: 707 montagens, 1.810
// inversões, 724 cronogramas (valores) e 2.112 buscas por parcela em cada um dos dois conjuntos de
// preço (o mediano e o de um lote real), todas iguais ao centavo. Se um
// destes números mudar, mudou fora do Garden.
//
// ⚠️ OS PLANOS VÃO PELO CAMINHO DOS CHAMADORES: `comoPlano` (a linha do banco) e
// `temAnuaisCadastradas` (o critério único do valor cheio), como a Mesa, o cronograma e a busca fazem.

const linha = (l: Partial<LinhaDoPlano> & { enterprise_id: string; nome: string }): LinhaDoPlano =>
  ({
    anuais_quantidade: null,
    anuais_valor: null,
    ativo: true,
    categoria_id: null,
    juros_convencao: "equivalente",
    ordem: 0,
    slot: null,
    ...l,
  }) as LinhaDoPlano;

/** 19 · NORMAL - SACOC: 168x, 10%, 0,5% a.m., IPCA mensal. */
const P19_NORMAL_SACOC = comoPlano(
  linha({ enterprise_id: "19", entrada_percentual: 10, indice_correcao: "IPCA_MENSAL", juros_periodicidade: "mensal", juros_taxa: 0.5, nome: "NORMAL - SACOC", parcelas: 168, sistema_amortizacao: "sacoc" }),
);
/** 27 · NORMAL 02: 120x, 12%, 0,8% a.m. */
const P27_NORMAL_02 = comoPlano(
  linha({ enterprise_id: "27", entrada_percentual: 12, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0.8, nome: "NORMAL 02", parcelas: 120, sistema_amortizacao: "sacoc" }),
);
/** 42 · Normal - Price: 120x, 10%, 0,6434% a.m., Price. */
const P42_NORMAL_PRICE = comoPlano(
  linha({ enterprise_id: "42", entrada_percentual: 10, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0.6434, nome: "Normal - Price", parcelas: 120, sistema_amortizacao: "price" }),
);
/** 35 · NORMAL: 156x, 10%, 0,7207% a.m. */
const P35_NORMAL = comoPlano(
  linha({ enterprise_id: "35", entrada_percentual: 10, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0.7207, nome: "NORMAL", parcelas: 156, sistema_amortizacao: "sacoc" }),
);

const conta = (plano: ReturnType<typeof comoPlano>) => ({
  anuaisCadastradasNoPlano: temAnuaisCadastradas(plano),
  parcelas: plano.parcelas,
  sistemaAmortizacao: sistemaDoCadastro(plano.sistemaAmortizacao),
  taxaAoMes: taxaMensal(plano),
});

describe("fora do Garden, os números são os da origin/main (reforço lançado à mão a valor presente)", () => {
  it("nenhum plano real fora do Garden tem anual cadastrada", () => {
    for (const p of [P19_NORMAL_SACOC, P27_NORMAL_02, P42_NORMAL_PRICE, P35_NORMAL]) {
      expect(temAnuaisCadastradas(p)).toBe(false);
    }
  });

  it("montarProposta: 19 NORMAL-SACOC, 27 NORMAL 02 e 42 Normal-Price com reforço à mão", () => {
    const a = montarProposta({ ...conta(P19_NORMAL_SACOC), baloesQuantidade: 5, baloesValor: 25_000, entrada: 21_307, valor: 213_064 });
    expect(a.parcela).toBeCloseTo(517.4216466233659, 8);
    expect(a.financiado).toBeCloseTo(86_926.83663272546, 6);

    const b = montarProposta({ ...conta(P27_NORMAL_02), baloesQuantidade: 3, baloesValor: 15_000, entrada: 69_010, valor: 575_081.63 });
    expect(b.parcela).toBeCloseTo(3_906.592345985031, 8);

    const c = montarProposta({ ...conta(P42_NORMAL_PRICE), baloesQuantidade: 2, baloesValor: 25_000, entrada: 25_300, valor: 253_000 });
    expect(c.parcela).toBeCloseTo(2_194.807880883134, 8);
  });

  it("entradaParaAParcela: 20 Normal (0,6434% a.m.) com 4 × R$ 25.000 e parcela de R$ 2.000", () => {
    const normal20 = comoPlano(
      linha({ enterprise_id: "20", entrada_percentual: 10, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0.6434, nome: "Normal", parcelas: 120, sistema_amortizacao: "sacoc" }),
    );
    const r = entradaParaAParcela({ ...conta(normal20), baloesQuantidade: 4, baloesValor: 25_000, parcela: 2_000, valor: 92_900 });
    expect(r.entrada).toBe(0);
    expect(r.sobra).toBeCloseTo(229_903.2424640908, 6);
  });

  it("busca por parcela no 29 (R$ 79.900, R$ 2.500 por mês): a mesma lista da origin/main", () => {
    const linhas29 = [
      linha({ enterprise_id: "29", entrada_percentual: 20, indice_correcao: "SEM_CORRECAO", juros_periodicidade: "mensal", juros_taxa: 0, nome: "INVESTIDOR", parcelas: 12, sistema_amortizacao: "sacoc" }),
      linha({ enterprise_id: "29", entrada_percentual: 30, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0, nome: "CURTO", parcelas: 24, sistema_amortizacao: "sacoc" }),
      linha({ enterprise_id: "29", entrada_percentual: 10, indice_correcao: "IPCA_ANUAL", juros_periodicidade: "mensal", juros_taxa: 0.5, nome: "NORMAL", parcelas: 120, sistema_amortizacao: "sacoc" }),
    ].map(comoPlano);
    const planos = linhas29.map((p) => ({
      anuaisQuantidade: p.anuaisQuantidade,
      anuaisValor: p.anuaisValor,
      descontoPercentual: p.descontoPercentual,
      entradaPercentual: p.entradaPercentual,
      nome: p.nome,
      parcelas: p.parcelas,
      sistemaAmortizacao: sistemaDoCadastro(p.sistemaAmortizacao),
      taxaAoMes: taxaMensal(p),
    }));
    // Como o simulador chama hoje: cada plano sobre o valor da tela.
    const achadas = composicoesQueFecham({
      entradaMinimaPercentual: 10,
      parcelaAlvo: 2_500,
      planos,
      precoDeTabela: 79_900,
      precos: planos.map(() => 79_900),
      valor: 79_900,
    });
    expect(
      achadas.map((c) => [c.plano, c.parcelas, c.anuais.quantidade, c.anuais.valor, c.entrada, Math.round(c.parcela * 100) / 100]),
    ).toEqual([
      ["INVESTIDOR", 12, 1, 30_000, 20_000, 2_491.67],
      // ⚠️ AS DUAS DO CURTO TROCARAM DE LUGAR EM 22/09/2026, e é o desempate novo trabalhando. Elas
      // empatam na entrada (R$ 24.000) e no total (o preço do lote, desde que o total passou a
      // fechar com ele), e até aqui quem ficava na frente era a que a varredura gerou primeiro. O
      // terceiro critério é a MENOR PARCELA: R$ 1.704,17 na frente de R$ 2.329,17, com a mesma
      // entrada e o mesmo total. Nenhum número mudou — mudou qual delas o corretor lê primeiro.
      ["CURTO", 24, 1, 15_000, 24_000, 1_704.17],
      ["CURTO", 24, 0, 0, 24_000, 2_329.17],
      ["INVESTIDOR", 12, 0, 0, 50_000, 2_491.67],
    ]);
  });

  it("montarCronograma: 35 NORMAL (R$ 143.451, 156x) com 3 × R$ 15.000, valores da origin/main", () => {
    const c = montarCronograma({
      anuaisQuantidade: 3,
      anuaisValor: 15_000,
      diaDeVencimento: 10,
      entradaValor: 14_346,
      entradaVezes: 1,
      parcelasMensais: 156,
      plano: P35_NORMAL,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 143_451,
    });
    // `bensEPermutas: 0` nasceu em 22/09/2026 e é a única linha nova: os outros cinco números
    // continuam sendo os da origin/main, que é o que esta revisão existe para travar.
    expect(c.totais).toEqual({ anuais: 45_000, bensEPermutas: 0, entrada: 14_346, financiado: 91_135.3, geral: 214_339.56, mensais: 154_993.56 });
    expect(c.mensais[0]?.valor).toBe(584.2);
    expect(c.mensais[12]?.valor).toBe(612.3);
    expect(c.mensais.at(-1)?.valor).toBe(1_579.94);
    expect(c.mensais[0]?.vencimento).toBe("2026-11-10");
  });

  // ⚠️ ERA DEFEITO NA PRIMEIRA VERSÃO DA RODADA 3: a data da anual tinha mudado em todo
  // empreendimento. Medido contra a origin/main: 630 de 630 cronogramas com reforço fora do Garden
  // passaram a vencer a anual UM MÊS ANTES (a anual k com a mensal 12k, e não 12 meses depois da
  // primeira mensal), e o bloco pronto da Têmis (`lib/temis/blocos-prontos.ts`, "Fluxo — escrito")
  // escreve no contrato "vencíveis a cada doze meses contados da primeira parcela mensal". CORRIGIDO
  // (18/09/2026, "So no Garden"): a anual na mensal 12k vale só no plano com anuais cadastradas
  // (`temAnuaisCadastradas`, o mesmo critério do valor cheio); fora dele, a data é a de sempre. Com a
  // primeira mensal em 10/11/2026, doze meses dão 10/11/2027, como na origin/main.
  it("a 1ª anual do 35 NORMAL vence doze meses depois da 1ª mensal, como diz a cláusula e como era na origin/main", () => {
    const c = montarCronograma({
      anuaisQuantidade: 3,
      anuaisValor: 15_000,
      diaDeVencimento: 10,
      entradaValor: 14_346,
      entradaVezes: 1,
      parcelasMensais: 156,
      plano: P35_NORMAL,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 143_451,
    });
    expect(c.mensais[0]?.vencimento).toBe("2026-11-10");
    expect(c.anuais.map((a) => a.vencimento)).toEqual(["2027-11-10", "2028-11-10", "2029-11-10"]);
  });
});
