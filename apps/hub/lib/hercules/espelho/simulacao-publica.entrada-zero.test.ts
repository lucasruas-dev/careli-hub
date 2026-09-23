import { describe, expect, it } from "vitest";

import { conferirEntradaMontada } from "../entrada-montada";
import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// A ENTRADA ZERO É UMA ESCOLHA, E A ENTRADA MONTADA TAMBÉM VAI AO PAPEL (22/09/2026).
//
// ⚠️ SÃO OS DOIS ÚLTIMOS PEDAÇOS DO ITEM 4 DO LUCAS (*"mesmo eu alterando o valor de entrada, quando
// eu mando para PDF ele não traz o valor que eu tinha colocado"*). A correção da véspera soltou a
// entrada DIGITADA, mas deixou duas portas abertas, e as duas trocam o número do corretor em
// silêncio depois do clique:
//
//   1. ENTRADA ZERO. `entradaPedida > 0` mandava o campo apagado para a SUGESTÃO do plano. A
//      justificativa escrita dizia que "a tela trata campo vazio como ainda não escolhi", e isso é
//      FALSO: apagar o campo faz `cockpit.entrada = 0` (`SimuladorDeProposta.tsx`), a composição
//      montada devolve `entrada: 0` e o cartão grande imprime "R$ 0,00", "A financiar R$ 332.400" e
//      "Parcela R$ 3.957,14". Medido com os números do print do Lucas (Cecílio Rocha, R$ 432.400,
//      INVESTIDOR PARCELADO em 84x, 4 anuais de R$ 25.000), o PDF saía com R$ 34.592 de entrada,
//      R$ 297.808 financiados e R$ 3.545,33 de parcela: OUTRA folha.
//      ⚠️ A TELA NUNCA MANDA "AUSENTE": ela sempre manda um número. Zero é o campo apagado, e só um
//      corpo escrito à mão omite a chave — por isso ausente (e lixo, e negativo) continua sendo a
//      sugestão, e zero passa a ser zero.
//
//   2. ENTRADA MONTADA À MÃO. O botão "montar valores" aparece no espelho público sempre que a
//      entrada tem mais de uma parcela, mas as parcelas montadas não iam no corpo da requisição: a
//      folha imprimia a divisão igual. Quem monta 10.000 + 7.000 + 7.000 + 7.000 via no papel
//      4 × R$ 7.750.

const NORMAL = {
  anuaisQuantidade: 5,
  anuaisValor: 25_000,
  descontoPercentual: 0,
  entradaPercentual: 10,
  nome: "NORMAL",
  parcelas: 60,
};
const PARCELADO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
};
const CECILIO = [NORMAL, PARCELADO];

/** O pedido do print do Lucas, com a entrada e as parcelas montadas de cada caso. */
const aceito = (p: {
  datasDaEntrada?: unknown;
  entrada?: unknown;
  parcelasDaEntrada?: unknown;
  vezes?: unknown;
}) => {
  const r = valoresDaSimulacaoPublica({
    entradaMinimaPercentual: 8,
    entradaDatasPedidas: p.datasDaEntrada,
    entradaPedida: p.entrada,
    entradaParcelasPedidas: p.parcelasDaEntrada,
    entradaVezesPedidas: p.vezes,
    parcelasPedidas: 84,
    plano: PARCELADO,
    planos: CECILIO,
    precoDeTabela: 470_000,
    valorPedido: 432_400,
  });
  if (!r.ok) throw new Error(r.mensagem);
  return r;
};

describe("a entrada ZERO da tela é zero na folha", () => {
  it("⚠️ campo apagado: o PDF imprime zero, e não os R$ 34.592 da sugestão de 8%", () => {
    expect(aceito({ entrada: 0 }).entrada).toBe(0);
  });

  it("ausente, lixo, negativo e vazio continuam caindo na sugestão (só o corpo à mão os produz)", () => {
    // 8% de R$ 432.400 = R$ 34.592, a sugestão do plano no prazo dele.
    for (const entrada of [undefined, null, "", "abc", -5])
      expect(aceito({ entrada }).entrada).toBe(34_592);
  });

  it("a entrada digitada acima de zero continua intacta (o caminho de ontem)", () => {
    expect(aceito({ entrada: 10_000 }).entrada).toBe(10_000);
  });
});

describe("a entrada MONTADA à mão vai para a folha", () => {
  it("⚠️ 10.000 + 7.000 + 7.000 + 7.000 sai assim, e não 4 × R$ 7.750", () => {
    const montadas = [10_000, 7_000, 7_000, 7_000];
    // A tela sobe a entrada para a soma da montagem (`conferirEntradaMontada`), então as duas
    // chegam casadas no corpo — é essa a combinação que a folha tem de reproduzir.
    const combinada = conferirEntradaMontada(31_000, montadas).entrada;
    expect(combinada).toBe(31_000);

    expect(
      aceito({ entrada: combinada, parcelasDaEntrada: montadas, vezes: 4 })
        .entradaParcelas,
    ).toEqual(montadas);
  });

  it("sem montagem nenhuma, nulo: o cronograma reparte em partes iguais como sempre", () => {
    expect(aceito({ entrada: 31_000, vezes: 4 }).entradaParcelas).toBeNull();
  });

  it("⚠️ montagem que não fecha a entrada aceita é ignorada, e não impressa", () => {
    // A folha traz a entrada no destaque E o fluxo linha a linha. Uma lista que soma outra coisa
    // imprimiria um cabeçalho brigando com o próprio fluxo, no papel que vai ao cliente.
    expect(
      aceito({ entrada: 31_000, parcelasDaEntrada: [1, 2, 3, 4], vezes: 4 })
        .entradaParcelas,
    ).toBeNull();
    // Quantidade diferente das vezes pedidas: mesma recusa.
    expect(
      aceito({
        entrada: 31_000,
        parcelasDaEntrada: [15_500, 15_500],
        vezes: 4,
      }).entradaParcelas,
    ).toBeNull();
    // Lixo, zero e negativo no meio da lista.
    for (const lista of [
      [10_000, 7_000, 0, 14_000],
      [10_000, 7_000, -7_000, 21_000],
      [10_000, 7_000, "sete mil", 7_000],
      "10000,7000",
      { 0: 31_000 },
    ])
      expect(
        aceito({ entrada: 31_000, parcelasDaEntrada: lista, vezes: 4 })
          .entradaParcelas,
      ).toBeNull();
  });

  it("⚠️ o teto de vezes também vale para a lista: 200 parcelas montadas não passam", () => {
    const muitas = Array.from({ length: 200 }, () => 155);
    expect(
      aceito({ entrada: 31_000, parcelasDaEntrada: muitas, vezes: 200 })
        .entradaParcelas,
    ).toBeNull();
  });
});

describe("e as DATAS escolhidas para as parcelas da entrada", () => {
  // ⚠️ O CAMPO DE DATA VEM JUNTO COM A MONTAGEM, E TAMBÉM NO ESPELHO PÚBLICO. O bloco "Cobrança"
  // (dia de vencimento e primeira parcela) some no modo simulação, a pedido do Lucas (*"tira essa
  // coisa de vencimento (...) como é um simulador"*), mas a data DE CADA PARCELA DA ENTRADA fica:
  // ela é parte da montagem. Sem ela no corpo, o corretor escolhe "a segunda cai em janeiro" e a
  // folha agenda o mês seguinte — e a data da entrada também empurra a primeira mensal
  // (`montarCronograma`), então o fluxo inteiro sai diferente do que ele viu.
  const montadas = [10_000, 7_000, 7_000, 7_000];
  const comDatas = (datasDaEntrada: unknown) =>
    aceito({
      datasDaEntrada,
      entrada: 31_000,
      parcelasDaEntrada: montadas,
      vezes: 4,
    }).entradaDatas;

  it("⚠️ as datas escolhidas passam, e as não escolhidas continuam nulas (a calculada vale)", () => {
    expect(comDatas([null, "2026-12-20", null, null])).toEqual([
      null,
      "2026-12-20",
      null,
      null,
    ]);
  });

  // ⚠️ A LISTA CURTA SAIU DAQUI EM 22/09/2026, e esta linha era o defeito escrito como regra. A tela
  // só faz a lista crescer até a posição tocada, então escolher a data da 2ª de 4 parcelas manda uma
  // lista de tamanho 2 com `entradaVezes: 4`: recusá-la jogava fora a data escolhida em silêncio.
  // O caso vive agora em `simulacao-publica.data-parcial.test.ts`, com o cronograma junto.
  it("lista ausente, MAIOR que as vezes ou com data quebrada não passa", () => {
    expect(comDatas(undefined)).toBeNull();
    expect(comDatas([null, "2026-12-20", null, null, "2027-03-10"])).toBeNull();
    // "2026-1" é o campo pela metade; "2026-13-40" não é dia nenhum.
    expect(comDatas([null, "2026-1", null, null])).toBeNull();
    expect(comDatas([null, "2026-13-40", null, null])).toBeNull();
    expect(comDatas("2026-12-20")).toBeNull();
  });

  it("lista só de nulos não sobe: não há escolha nenhuma ali", () => {
    expect(comDatas([null, null, null, null])).toBeNull();
  });
});
