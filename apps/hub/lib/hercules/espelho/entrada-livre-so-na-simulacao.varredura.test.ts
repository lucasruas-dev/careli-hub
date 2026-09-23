import { describe, expect, it } from "vitest";

import { conferirProposta, type PedidoDeProposta } from "../proposta";
import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// A ENTRADA FICOU LIVRE NA SIMULAÇÃO, E CONTINUA PRESA NA VENDA (22/09/2026).
//
// Lucas: *"na cecilio pode deixar tudo liberado, sem trava, somente com alertas, se ele quiser pagar
// uma entrada menor o valor da parcela tem que subir, somente garante essa visão."*
//
// ⚠️ "ESSA VISÃO" É A SIMULAÇÃO, E NÃO A VENDA. A folha do espelho sai com a tarja de prévia e com a
// frase "não constitui proposta, não reserva a unidade e não vincula as partes" — ela mostra uma
// conta. A PROPOSTA é o que entra no sistema, vira reserva, minuta e contrato, e é lá que a entrada
// mínima da tabela protege o dinheiro do ato.
//
// São dois caminhos que NÃO se cruzam, e este arquivo existe para que continuem assim:
//
//   SIMULAÇÃO   `valoresDaSimulacaoPublica`  →  api/publico/espelho/simulacao    (sem login)
//   VENDA       `conferirProposta`           →  api/incorporador/venda/proposta  (com sessão)
//
// ⚠️ SE ALGUÉM AFROUXAR A SEGUNDA JUNTO COM A PRIMEIRA, ESTE ARQUIVO QUEBRA. A tentação é real: as
// duas chamam `pisoDaEntradaNoPrazo` com os mesmos argumentos, e "unificar a régua" parece limpeza.
// Seria o fim do piso de entrada da casa: uma proposta de 30 vezes com 10% de entrada, num produto
// que vende a 40% em 30 vezes, entraria no sistema sem um único erro de validação.

/** A tabela do Cecílio Rocha, a do print do Lucas (e a escada que decide a entrada de cada prazo). */
const TABELA = [
  { entradaPercentual: 10, nome: "NORMAL", parcelas: 60 },
  { entradaPercentual: 8, nome: "INVESTIDOR PARCELADO", parcelas: 84 },
  { entradaPercentual: 40, nome: "INVESTIDOR", parcelas: 36 },
];

const PLANO_DA_SIMULACAO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
};

/** O pedido da Mesa de Venda com a MESMA condição, para o mesmo lote. */
const PEDIDO: PedidoDeProposta = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  compradores: [
    { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 100, titular: true },
  ],
  entradaMinimaPercentual: 8,
  entradaValor: 10_000,
  entradaVezes: 1,
  parcelas: 84,
  planosDaTabela: TABELA,
  primeiraParcelaEm: "2026-10-10",
  reservaId: "res-1",
  unidadeId: "uni-1",
  validadeEm: "2026-09-29T02:59:59.000Z",
  valorNegociado: 432_400,
  vencimentoDia: 10,
};

const AGORA = "2026-09-22T17:00:00.000Z";

const simular = (entradaPedida: number) =>
  valoresDaSimulacaoPublica({
    anuaisPedidas: { quantidade: 4, valor: 25_000 },
    entradaMinimaPercentual: 8,
    entradaPedida,
    parcelasPedidas: 84,
    plano: PLANO_DA_SIMULACAO,
    planos: TABELA,
    precoDeTabela: 470_000,
    valorPedido: 432_400,
  });

describe("a mesma entrada baixa: a simulação imprime, a proposta recusa", () => {
  it("⚠️ R$ 10.000 (o print do Lucas): a simulação aceita como está, `conferirProposta` recusa", () => {
    const daSimulacao = simular(10_000);
    expect(daSimulacao).toMatchObject({ entrada: 10_000, ok: true });

    const erroDaVenda = conferirProposta(PEDIDO, AGORA).find((e) => e.campo === "entrada");
    expect(erroDaVenda).toBeDefined();
    // 8% de R$ 432.400 = R$ 34.592: o mesmo número que a tela mostra no aviso vermelho.
    expect(erroDaVenda?.mensagem).toContain("34.592,00");
  });

  it("em toda entrada abaixo do mínimo, a simulação passa e a venda para", () => {
    const abaixoDoMinimo = [0.01, 1, 1_000, 10_000, 34_591.99];
    for (const entradaValor of abaixoDoMinimo) {
      expect(simular(entradaValor)).toMatchObject({ entrada: entradaValor, ok: true });
      expect(
        conferirProposta({ ...PEDIDO, entradaValor }, AGORA).some((e) => e.campo === "entrada"),
      ).toBe(true);
    }
  });

  it("do mínimo para cima as duas concordam: simula e vende", () => {
    for (const entradaValor of [34_592, 50_000, 100_000]) {
      expect(simular(entradaValor)).toMatchObject({ entrada: entradaValor, ok: true });
      expect(conferirProposta({ ...PEDIDO, entradaValor }, AGORA)).toEqual([]);
    }
  });

  it("⚠️ a faixa do prazo continua RECUSANDO na venda: 36 vezes pedem os 40% do INVESTIDOR", () => {
    // O caso que o Lucas ditou em 05/09/2026, e que nada disto pode desfazer: prazo curto, entrada
    // alta. 40% de R$ 432.400 = R$ 172.960.
    const erro = conferirProposta(
      { ...PEDIDO, anuaisQuantidade: 3, entradaValor: 43_240, parcelas: 36 },
      AGORA,
    ).find((e) => e.campo === "entrada");
    expect(erro).toBeDefined();
    expect(erro?.mensagem).toContain("172.960,00");
    expect(erro?.mensagem).toContain("INVESTIDOR");
  });
});
