import { describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";

import { montarCronograma } from "../cronograma";
import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// A DATA ESCOLHIDA NUMA PARCELA QUE NÃO É A ÚLTIMA IA PARA O LIXO EM SILÊNCIO (22/09/2026).
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA, A TELA SÓ FAZ A LISTA DE DATAS CRESCER ATÉ A POSIÇÃO TOCADA. Medido em
// `SimuladorDeProposta.tsx`: `datasDaEntradaCruas` nasce `[]` e o `onChange` do campo de data faz
// `while (proxima.length <= i) proxima.push(null)`. Nada completa a lista até `entradaVezes`. Quem
// escolhe a data da 2ª de 4 parcelas sobe `entradaVezes: 4` com `entradaDatas: [null, "2026-12-20"]`,
// uma lista de tamanho 2. A conferência do servidor exigia `length === entradaVezes` e devolvia nulo,
// jogando fora a lista INTEIRA: a tela mostrava 20/12/2026 na segunda linha e a folha agendava a data
// calculada. Mesma família do item 4 do Lucas (*"mesmo eu alterando o valor... quando eu mando para
// PDF ele não traz o valor que eu tinha colocado"*), num terceiro campo.
//
// ⚠️ E A MESA NUNCA TEVE ESSE DEFEITO, o que mostra que o erro era da régua e não da tela: a rota da
// proposta (`app/api/incorporador/venda/proposta/route.ts`) só mapeia o que vem e deixa o cronograma
// decidir posição a posição. Só o espelho público exigia o tamanho exato.

const NORMAL = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  descontoPercentual: 0,
  entradaPercentual: 10,
  nome: "NORMAL",
  parcelas: 60,
};

const PLANO_DA_FOLHA: PlanoComercial = {
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 60,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** R$ 400.000 com R$ 40.000 de entrada em 4 vezes, o desenho do campo de data da tela. */
const aceito = (entradaDatasPedidas: unknown, vezes = 4) => {
  const r = valoresDaSimulacaoPublica({
    entradaDatasPedidas,
    entradaMinimaPercentual: 10,
    entradaPedida: 40_000,
    entradaVezesPedidas: vezes,
    parcelasPedidas: 60,
    plano: NORMAL,
    planos: [NORMAL],
    precoDeTabela: 400_000,
    valorPedido: 400_000,
  });
  if (!r.ok) throw new Error(r.mensagem);
  return r;
};

/**
 * O cronograma que vai à folha, com a primeira parcela da entrada em 10/11/2026.
 *
 * As datas calculadas, mês a mês, são 10/11/2026, 10/12/2026, 10/01/2027 e 10/02/2027.
 */
const folha = (entradaDatasPedidas: unknown, vezes = 4) => {
  const a = aceito(entradaDatasPedidas, vezes);
  return montarCronograma({
    anuaisQuantidade: a.anuais.quantidade,
    anuaisValor: a.anuais.valor,
    diaDeVencimento: 10,
    entradaDatas: a.entradaDatas,
    entradaParcelas: a.entradaParcelas,
    entradaValor: a.entrada,
    entradaVezes: a.entradaVezes,
    parcelasMensais: a.parcelas,
    plano: PLANO_DA_FOLHA,
    primeiraParcelaDaEntrada: "2026-11-10",
    valorNegociado: a.valor,
  });
};

describe("a data escolhida no meio da entrada chega à folha", () => {
  it("⚠️ a 2ª de 4 parcelas sobe sozinha na lista, e a folha agenda 20/12/2026 nela", () => {
    expect(folha([null, "2026-12-20"]).entrada.map((p) => p.vencimento)).toEqual(
      ["2026-11-10", "2026-12-20", "2027-01-10", "2027-02-10"],
    );
  });

  it("a lista curta vira a lista inteira: as posições não tocadas ficam na data calculada", () => {
    expect(aceito([null, "2026-12-20"]).entradaDatas).toEqual([
      null,
      "2026-12-20",
      null,
      null,
    ]);
  });

  it("uma escolha só, na primeira parcela, também vale sozinha", () => {
    expect(folha(["2026-11-25"]).entrada.map((p) => p.vencimento)).toEqual([
      "2026-11-25",
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
    ]);
  });

  it("⚠️ lista MAIOR que as vezes continua recusada: é estado velho de outra simulação", () => {
    const cinco = [null, "2026-12-20", null, null, "2027-03-10"];
    expect(aceito(cinco).entradaDatas).toBeNull();
    expect(folha(cinco).entrada.map((p) => p.vencimento)).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
    ]);
  });

  it("lista curta só de nulos continua não subindo: ninguém escolheu nada", () => {
    expect(aceito([null, null]).entradaDatas).toBeNull();
  });

  it("data quebrada derruba a lista curta do mesmo jeito que a inteira", () => {
    expect(aceito([null, "2026-1"]).entradaDatas).toBeNull();
    expect(aceito([null, "2026-02-31"]).entradaDatas).toBeNull();
  });
});
