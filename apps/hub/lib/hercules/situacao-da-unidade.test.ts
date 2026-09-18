import { describe, expect, it } from "vitest";

import {
  acharUnidade,
  baldeDaSituacao,
  estaLivre,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  rotuloDoBalde,
  situacaoDoTerreno,
} from "./situacao-da-unidade";

// A régua única da situação da unidade (Lucas, 18/09/2026: *"esses status tem que morar em um so
// lugar"*). Estes testes são a definição: toda tela do Panteon pinta a unidade pelo que sai daqui.

describe("a ordem da régua", () => {
  it("a proposta viva manda sobre a reserva e sobre o cadastro", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "bloqueada",
        propostasVivas: [{ desde: "2026-09-10", etapa: "contrato" }],
        reservada: true,
      }),
    ).toBe("contrato");
  });

  it("entre duas propostas vivas, vale a mais recente", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "vendida",
        propostasVivas: [
          { desde: "2026-01-02", etapa: "faturado" },
          { desde: "2026-09-15", etapa: "proposta" },
        ],
        reservada: false,
      }),
    ).toBe("proposta");
  });

  it("proposta morta (cancelada, distrato) não conta", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "disponivel",
        propostasVivas: [{ desde: "2026-09-15", etapa: "cancelado" }],
        reservada: false,
      }),
    ).toBe("disponivel");
  });

  it("sem proposta, a reserva viva ocupa o lote — do Hércules ou do evento", () => {
    expect(situacaoDoTerreno({ cadastro: "disponivel", propostasVivas: [], reservada: true })).toBe(
      "reservado",
    );
  });

  it("sem processo nenhum, vale o cadastro", () => {
    expect(situacaoDoTerreno({ cadastro: "disponivel", propostasVivas: [], reservada: false })).toBe(
      "disponivel",
    );
    // ⚠️ É o caso dos 93 lotes do LBP: bloqueados no Panteon, "Disponível" no Apolo até aqui.
    expect(situacaoDoTerreno({ cadastro: "bloqueada", propostasVivas: [], reservada: false })).toBe(
      "bloqueada",
    );
  });

  it("⚠️ vendida ou reservada sem proposta continuam OCUPADAS, nunca livres", () => {
    expect(situacaoDoTerreno({ cadastro: "vendida", propostasVivas: [], reservada: false })).toBe("vendida");
    expect(situacaoDoTerreno({ cadastro: "reservada", propostasVivas: [], reservada: false })).toBe(
      "reservada",
    );
  });

  it("valor de cadastro desconhecido não vira livre", () => {
    expect(situacaoDoTerreno({ cadastro: "permutada", propostasVivas: [], reservada: false })).toBe(
      "bloqueada",
    );
    expect(situacaoDoTerreno({ cadastro: null, propostasVivas: [], reservada: false })).toBe("bloqueada");
  });
});

describe("como as telas escrevem", () => {
  it("só disponível é livre", () => {
    expect(estaLivre("disponivel")).toBe(true);
    for (const s of ["reservado", "proposta", "contrato", "assinatura", "faturado", "vendida", "reservada", "bloqueada"] as const) {
      expect(estaLivre(s)).toBe(false);
    }
  });

  it("⚠️ cinco baldes, os mesmos em toda tela: proposta, contrato e assinatura são negociação", () => {
    expect(baldeDaSituacao("disponivel")).toBe("disponivel");
    expect(baldeDaSituacao("reservado")).toBe("reservado");
    expect(baldeDaSituacao("reservada")).toBe("reservado");
    expect(baldeDaSituacao("bloqueada")).toBe("bloqueado");
    for (const s of ["proposta", "contrato", "assinatura"] as const) {
      expect(baldeDaSituacao(s)).toBe("negociacao");
    }
    expect(baldeDaSituacao("faturado")).toBe("vendido");
    expect(baldeDaSituacao("vendida")).toBe("vendido");
    expect(rotuloDoBalde("negociacao")).toBe("Em negociação");
  });

  it("um rótulo por situação", () => {
    expect(rotuloDaSituacao("disponivel")).toBe("Disponível");
    expect(rotuloDaSituacao("contrato")).toBe("Contrato");
    expect(rotuloDaSituacao("bloqueada")).toBe("Bloqueado");
    expect(rotuloDaSituacao("vendida")).toBe("Vendido");
  });
});
