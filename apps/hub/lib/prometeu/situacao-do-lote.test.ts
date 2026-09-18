import { describe, expect, it } from "vitest";

import type { SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

import { contarSituacoes, situacaoNoTelao } from "./situacao-do-lote";

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

  it("proposta, contrato, assinatura e faturado contam como vendido, como nos cards do Apolo", () => {
    for (const s of ["proposta", "contrato", "assinatura", "faturado", "vendida"] as const) {
      expect(situacaoNoTelao(s)).toBe("vendido");
    }
  });

  // ⚠️ O bloqueio do coordenador vive só no Panteon; a régua antiga do telão, que lia o C2X, não
  // o via e pintava o lote de verde.
  it("bloqueada no Panteon fica indisponível", () => {
    expect(situacaoNoTelao("bloqueada")).toBe("indisponivel");
  });
});

describe("contagem do painel", () => {
  it("soma cada situação", () => {
    expect(
      contarSituacoes([
        "disponivel",
        "disponivel",
        "reservado",
        "vendido",
        "indisponivel",
      ]),
    ).toEqual({ disponivel: 2, indisponivel: 1, reservado: 1, vendido: 1 });
  });

  it("lista vazia zera tudo, sem inventar chave", () => {
    expect(contarSituacoes([])).toEqual({
      disponivel: 0,
      indisponivel: 0,
      reservado: 0,
      vendido: 0,
    });
  });
});
