import { describe, expect, it } from "vitest";

import type { SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

import { contarSituacoes, lotesTravadosDoEvento, situacaoNoTelao } from "./situacao-do-lote";

// O telão não decide situação desde 18/09/2026 (Lucas: *"esses status tem que morar em um so
// lugar"*): ela vem de lib/hercules/situacao-da-unidade.ts. Estes testes só provam que a TRADUÇÃO
// para as palavras do telão não inventa nada no caminho, e principalmente que não pinta verde o
// que a régua única diz estar ocupado.

const TODAS: readonly SituacaoDaUnidade[] = [
  "assinatura",
  "bloqueada",
  "contrato",
  "disponivel",
  "faturado",
  "proposta",
  "reservada",
  "reservado",
  "vendida",
];

describe("a palavra do telão para a situação da régua única", () => {
  it("só disponível é livre: nenhuma outra situação vira verde", () => {
    for (const s of TODAS) {
      expect(situacaoNoTelao(s) === "disponivel").toBe(s === "disponivel");
    }
  });

  it("reserva viva (do Hércules ou do salão) e reservada no cadastro são reservado", () => {
    expect(situacaoNoTelao("reservado")).toBe("reservado");
    expect(situacaoNoTelao("reservada")).toBe("reservado");
  });

  // ⚠️ O MESMO AGRUPAMENTO DO MÓDULO ÚNICO (`baldeDaSituacao`): proposta, contrato e assinatura são
  // "em negociação"; faturado e vendida sem proposta, "vendido". Dois nomes para o mesmo lote em
  // telas diferentes é a queixa do Lucas em outra roupa.
  it("proposta, contrato e assinatura são negociação; faturado e vendida são vendido", () => {
    for (const s of ["proposta", "contrato", "assinatura"] as const) {
      expect(situacaoNoTelao(s)).toBe("negociacao");
    }
    for (const s of ["faturado", "vendida"] as const) {
      expect(situacaoNoTelao(s)).toBe("vendido");
    }
  });

  // ⚠️ O bloqueio do coordenador vive só no Panteon; a régua antiga do telão, que lia o C2X, não
  // o via e pintava o lote de verde.
  it("bloqueada no Panteon fica indisponível", () => {
    expect(situacaoNoTelao("bloqueada")).toBe("indisponivel");
  });
});

describe("a trava do Setup do evento", () => {
  it("normaliza os códigos e ignora o que não é lista", () => {
    expect([...lotesTravadosDoEvento({ lotesBloqueados: [" jdg0201 ", "JDG0101", "", null] })]).toEqual([
      "JDG0201",
      "JDG0101",
    ]);
    expect(lotesTravadosDoEvento({ lotesBloqueados: "JDG0201" }).size).toBe(0);
    expect(lotesTravadosDoEvento(null).size).toBe(0);
  });
});

describe("contagem do painel", () => {
  it("soma cada situação", () => {
    expect(
      contarSituacoes([
        "disponivel",
        "disponivel",
        "reservado",
        "negociacao",
        "vendido",
        "indisponivel",
      ]),
    ).toEqual({ disponivel: 2, indisponivel: 1, negociacao: 1, reservado: 1, vendido: 1 });
  });

  it("lista vazia zera tudo, sem inventar chave", () => {
    expect(contarSituacoes([])).toEqual({
      disponivel: 0,
      indisponivel: 0,
      negociacao: 0,
      reservado: 0,
      vendido: 0,
    });
  });
});
