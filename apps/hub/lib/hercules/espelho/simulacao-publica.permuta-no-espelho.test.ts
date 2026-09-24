import { describe, expect, it } from "vitest";

import {
  TAMANHO_MAXIMO_DA_DESCRICAO,
  TETO_DE_BENS_NA_PROPOSTA,
} from "../bens-e-permutas";
import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// A PERMUTA ENTRA NO ESPELHO PÚBLICO (23/09/2026), E A RÉGUA DO SERVIDOR PRECISA ACEITÁ-LA.
//
// Eu tinha escrito, na rodada do desconto, que a permuta continuaria fora do espelho, porque
// permuta é negociação e o espelho é vitrine. Lucas, em resposta direta: *"permuta tem que entrar,
// não entendi sua colocação"*. A separação era minha, não dele, e está desfeita.
//
// ⚠️ SEM ESTA RÉGUA, A TELA E O PAPEL DIVERGEM EM SILÊNCIO. O bloco de bens aparecendo na tela sem
// a lista chegar aqui é exatamente o defeito que o Lucas relatou em 22/09 no valor da entrada
// (*"mesmo eu alterando o valor de entrada (...) ele não traz o valor que eu tinha colocado"*):
// a tela mostra R$ 115.000 a financiar, o PDF imprime R$ 195.000, e ninguém vê a troca.
//
// ⚠️ E A VALIDAÇÃO É A MESMA DA ROTA DA PROPOSTA, de propósito: tipo em {bem, permuta}, `entraComo`
// em {entrada, abatimento}, valor número positivo e finito, descrição não vazia, os mesmos tetos.
// A página não tem login e o corpo se escreve à mão — aqui ele é mais perigoso, não menos.

const PARCELADO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
};
const NORMAL = {
  anuaisQuantidade: 5,
  anuaisValor: 25_000,
  descontoPercentual: 0,
  entradaPercentual: 10,
  nome: "NORMAL",
  parcelas: 60,
};
const GARDEN = [NORMAL, PARCELADO];

/** O lote do print do Lucas: R$ 435.000 de tabela. */
const TABELA = 435_000;

/** O carro do exemplo dele, do jeito que a tela o monta. */
const CARRO = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada" as const,
  tipo: "bem" as const,
  valor: 80_000,
};

function pedir(bensPedidos: unknown) {
  return valoresDaSimulacaoPublica({
    anuaisPedidas: { quantidade: 0, valor: 0 },
    bensPedidos,
    entradaMinimaPercentual: 8,
    entradaPedida: 31_320,
    parcelasPedidas: 84,
    plano: PARCELADO,
    planos: GARDEN,
    precoDeTabela: TABELA,
    valorPedido: 391_500,
  });
}

const recusa = (r: ReturnType<typeof pedir>) => (r.ok === false ? r.mensagem : "");

describe("os bens da tela chegam inteiros à régua pública", () => {
  it("⚠️ o carro de R$ 80.000 digitado no espelho volta na lista, campo a campo", () => {
    expect(pedir([CARRO])).toMatchObject({ bens: [CARRO], ok: true });
  });

  it("dois itens viajam juntos, e o `entraComo` de cada um é respeitado", () => {
    const lote = {
      descricao: "Lote 12 da quadra 4 em Anápolis",
      entraComo: "abatimento" as const,
      tipo: "permuta" as const,
      valor: 20_000,
    };
    expect(pedir([CARRO, lote])).toMatchObject({ bens: [CARRO, lote], ok: true });
  });

  it("⚠️ ausente, nulo e lista vazia são 'não tem permuta', e não erro", () => {
    // Nenhum cliente de hoje manda este campo — nem a tela em cache do navegador. Recusá-los
    // pararia o PDF de quem só quer a simulação de sempre.
    for (const bens of [undefined, null, []])
      expect(pedir(bens)).toMatchObject({ bens: [], ok: true });
  });

  it("o texto numérico da tela vira número, e a descrição perde o espaço das pontas", () => {
    expect(
      pedir([{ ...CARRO, descricao: "  Ford Ka 2019  ", valor: "32000.50" }]),
    ).toMatchObject({
      bens: [{ ...CARRO, descricao: "Ford Ka 2019", valor: 32_000.5 }],
      ok: true,
    });
  });

  it("⚠️ e o que vem A MAIS no item é descartado, e não repassado ao PDF", () => {
    const r = pedir([{ ...CARRO, id: "rascunho-1", valorFipe: 41_000 }]);
    expect(r.ok && r.bens[0]).toEqual(CARRO);
  });
});

describe("⚠️ a régua recusa o que a rota da proposta já recusa", () => {
  it("valor VAZIO é recusa, e nunca zero (`Number('')` é 0)", () => {
    // Nesta casa isso já virou cobrança de R$ 0,00 emitida. Um campo que ninguém preencheu não
    // pode virar "permuta de zero reais" impressa na folha como se tivesse sido combinada.
    const r = pedir([{ ...CARRO, valor: "" }]);
    expect(r.ok).toBe(false);
    expect(recusa(r)).toMatch(/valor do bem ou permuta na posição 1/i);
  });

  it("nulo, zero, negativo, lixo, lista e booleano no valor caem no mesmo lugar", () => {
    for (const valor of [null, undefined, 0, -5, "abc", [], [5], true, {}])
      expect(pedir([{ ...CARRO, valor }]).ok).toBe(false);
  });

  it("tipo fora de {bem, permuta} é recusa", () => {
    const r = pedir([{ ...CARRO, tipo: "veiculo" }]);
    expect(r.ok).toBe(false);
    expect(recusa(r)).toMatch(/"bem" ou "permuta"/);
  });

  it("`entraComo` fora de {entrada, abatimento} é recusa", () => {
    for (const entraComo of ["", "ENTRADA", "outro", null])
      expect(pedir([{ ...CARRO, entraComo }]).ok).toBe(false);
  });

  it("descrição vazia ou só de espaços é recusa", () => {
    for (const descricao of ["", "   ", null, 42])
      expect(pedir([{ ...CARRO, descricao }]).ok).toBe(false);
  });

  it(`descrição acima de ${TAMANHO_MAXIMO_DA_DESCRICAO} caracteres é recusa, e no limite passa`, () => {
    expect(pedir([{ ...CARRO, descricao: "a".repeat(TAMANHO_MAXIMO_DA_DESCRICAO) }]).ok).toBe(true);
    expect(pedir([{ ...CARRO, descricao: "a".repeat(TAMANHO_MAXIMO_DA_DESCRICAO + 1) }]).ok).toBe(false);
  });

  it(`acima de ${TETO_DE_BENS_NA_PROPOSTA} itens é recusa, e no teto passa`, () => {
    const lista = (n: number) => Array.from({ length: n }, () => CARRO);
    expect(pedir(lista(TETO_DE_BENS_NA_PROPOSTA)).ok).toBe(true);
    const r = pedir(lista(TETO_DE_BENS_NA_PROPOSTA + 1));
    expect(r.ok).toBe(false);
    expect(recusa(r)).toMatch(new RegExp(`${TETO_DE_BENS_NA_PROPOSTA} bens ou permutas`));
  });

  it("o que não é lista é recusa, e não 'sem permuta'", () => {
    for (const bens of ["Ford Ka", 3, { descricao: "Ford Ka" }])
      expect(pedir(bens).ok).toBe(false);
  });

  it("⚠️ um item torto no meio derruba a lista INTEIRA, e não só ele", () => {
    // Meia lista impressa é pior do que lista nenhuma: a folha somaria um abatimento parcial
    // embaixo de um bloco que o visitante montou inteiro, e ele encaminharia o papel sem ver.
    const r = pedir([CARRO, "Ford Ka"]);
    expect(r.ok).toBe(false);
  });
});
