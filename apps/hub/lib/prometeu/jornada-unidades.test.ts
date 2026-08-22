import { describe, expect, it } from "vitest";

import { mesclarJornada, passosDasUnidades } from "./jornada-unidades";
import type { PassoDaUnidade } from "./reservas-c2x";

// A FICHA TEM QUE CONTAR A HISTÓRIA INTEIRA, NA ORDEM DO RELÓGIO.
//
// Pedido do Lucas (22/08, com o evento rodando): *"essa AA Maria reservou uma unidade, só que ela
// devolveu... eu preciso apontar isso na ficha dela que ela reservou e teve um cancelamento. Mas
// temos caso da pessoa devolver a PA e pegar outra, então esse histórico temos que ter"*.
//
// Os dois casos abaixo são reais, do Villa Paris: a Ana Maria reservou a RVPD14 e devolveu, e o
// Geraldo Tomaz devolveu a RVPC02 às 09:33 e pegou a RVPD02 nove minutos depois.

const passo = (over: Partial<PassoDaUnidade>): PassoDaUnidade => ({
  de: null,
  em: "2026-08-22T12:00:00.000Z",
  lote: "14",
  motivo: null,
  operador: null,
  para: "Reservado",
  quadra: "D",
  unidade: "RVPD14",
  ...over,
});

describe("passosDasUnidades", () => {
  it("diz em português o que aconteceu com o lote", () => {
    const p = passosDasUnidades([passo({ para: "Reservado", unidade: "RVPD14" })])[0]!;
    expect(p.titulo).toBe("Reservou a unidade · RVPD14");
    expect(p.cancelado).toBe(false);
  });

  it("a devolução acende a bolinha vermelha — é o que o Lucas precisa ver na ficha", () => {
    const p = passosDasUnidades([
      passo({ de: "Reservado", para: "Cancelado", unidade: "RVPD14" }),
    ])[0]!;
    expect(p.titulo).toBe("Devolveu a unidade · RVPD14");
    expect(p.cancelado).toBe(true);
    expect(p.detalhe).toBe("de Reservado");
  });

  it("mostra quem mexeu e o motivo quando o C2X registrou", () => {
    const p = passosDasUnidades([
      passo({ motivo: "cliente desistiu", operador: "NIVEA CARELI", para: "Cancelado" }),
    ])[0]!;
    expect(p.detalhe).toBe("cliente desistiu · por NIVEA CARELI");
  });

  it("sem operador e sem motivo não inventa texto", () => {
    const p = passosDasUnidades([passo({ de: null })])[0]!;
    expect(p.detalhe).toBeNull();
  });
});

describe("mesclarJornada", () => {
  it("intercala o caminho do salão com o das unidades pelo relógio", () => {
    // Sequência real do Antonio Marcos: check-in 09:13, reserva 09:25, contrato 10:01,
    // concluído 10:09 (horário de Brasília).
    const daPessoa = [
      { cancelado: false, detalhe: null, quando: "2026-08-22T12:13:05.000Z", titulo: "Check-in" },
      { cancelado: false, detalhe: null, quando: "2026-08-22T13:09:16.000Z", titulo: "Finalizado" },
    ];
    const dasUnidades = passosDasUnidades([
      passo({ em: "2026-08-22T12:25:59.000Z", para: "Reservado", unidade: "RVPA26" }),
      passo({
        de: "Proposta realizada",
        em: "2026-08-22T13:01:44.000Z",
        para: "Contrato gerado",
        unidade: "RVPA26",
      }),
    ]);

    expect(mesclarJornada(daPessoa, dasUnidades).map((p) => p.titulo)).toEqual([
      "Check-in",
      "Reservou a unidade · RVPA26",
      "Contrato gerado · RVPA26",
      "Finalizado",
    ]);
  });

  it("conta a troca de lote na ordem: devolveu uma e pegou outra", () => {
    // Geraldo Tomaz, 22/08: RVPC02 cai 09:33, RVPD02 entra 09:42.
    const dasUnidades = passosDasUnidades([
      passo({ em: "2026-08-22T12:33:55.000Z", para: "Reservado", unidade: "RVPC02" }),
      passo({
        de: "Reservado",
        em: "2026-08-22T12:33:56.000Z",
        para: "Cancelado",
        unidade: "RVPC02",
      }),
      passo({ em: "2026-08-22T12:42:29.000Z", para: "Reservado", unidade: "RVPD02" }),
    ]);
    const linha = mesclarJornada([], dasUnidades);
    expect(linha.map((p) => p.titulo)).toEqual([
      "Reservou a unidade · RVPC02",
      "Devolveu a unidade · RVPC02",
      "Reservou a unidade · RVPD02",
    ]);
    expect(linha[1]!.cancelado).toBe(true);
    expect(linha[2]!.cancelado).toBe(false);
  });

  it("passo sem hora vai para o fim, em vez de fingir que veio primeiro", () => {
    const daPessoa = [
      { cancelado: false, detalhe: null, quando: null, titulo: "Sem carimbo" },
      { cancelado: false, detalhe: null, quando: "2026-08-22T12:13:00.000Z", titulo: "Check-in" },
    ];
    expect(mesclarJornada(daPessoa, []).map((p) => p.titulo)).toEqual(["Check-in", "Sem carimbo"]);
  });

  it("no empate de horário o passo do salão vem antes do da unidade", () => {
    const daPessoa = [
      { cancelado: false, detalhe: null, quando: "2026-08-22T12:00:00.000Z", titulo: "Negociação" },
    ];
    const dasUnidades = passosDasUnidades([passo({ em: "2026-08-22T12:00:00.000Z" })]);
    expect(mesclarJornada(daPessoa, dasUnidades)[0]!.titulo).toBe("Negociação");
  });
});
