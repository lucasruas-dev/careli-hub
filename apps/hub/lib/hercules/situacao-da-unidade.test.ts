import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  acharUnidade,
  baldeDaSituacao,
  estaLivre,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  rotuloDoBalde,
  type SituacaoDasUnidades,
  situacaoDoTerreno,
  type UnidadeComSituacao,
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

// ⚠️ O TERRENO LIDO DO BANCO (a família do pai, as duas glebas do Vale do Ouro, o Rio de Pedras que
// NÃO se agrupa) está provado contra um banco em memória em `trava-do-lote.test.ts`, junto com a
// trava que usa esse terreno, e a porta única da reserva em `criar-reserva.test.ts`. Aqui ficam as
// partes que não precisam de banco.

describe("acharUnidade: uma ordem só para todas as telas", () => {
  const unidade = (id: string, codigo: string, situacao: UnidadeComSituacao["situacao"]): UnidadeComSituacao => ({
    codigo,
    enterpriseId: "37",
    id,
    lote: null,
    origemC2xId: null,
    quadra: null,
    situacao,
  });
  const pelaLinha = unidade("linha-a", "VOC0305", "disponivel");
  const peloLegado = unidade("linha-b", "VOC0306", "contrato");
  const peloCodigo = unidade("linha-c", "VOC0307", "reservado");
  const situacoes: SituacaoDasUnidades = {
    porCodigo: new Map([["VOC0307", peloCodigo]]),
    porLinha: new Map([["linha-a", pelaLinha]]),
    porOrigemC2x: new Map([["9102", peloLegado]]),
    terreno: () => undefined,
    unidades: [pelaLinha, peloLegado, peloCodigo],
  };

  it("a linha do Panteon manda sobre o id do legado e sobre o código", () => {
    expect(acharUnidade(situacoes, { codigo: "VOC0307", linhaId: "linha-a", origemC2x: 9102 })).toBe(pelaLinha);
  });

  it("sem linha conhecida, o id do legado (número ou texto) manda sobre o código", () => {
    expect(acharUnidade(situacoes, { codigo: "VOC0307", linhaId: "nao-lida", origemC2x: 9102 })).toBe(peloLegado);
    expect(acharUnidade(situacoes, { codigo: "VOC0307", origemC2x: " 9102 " })).toBe(peloLegado);
  });

  it("o código casa sem diferença de caixa nem de espaço", () => {
    expect(acharUnidade(situacoes, { codigo: " voc0307 ", origemC2x: " " })).toBe(peloCodigo);
  });

  it("nenhuma chave que case: undefined (a tela decide, e o conservador é ocupado)", () => {
    expect(acharUnidade(situacoes, {})).toBeUndefined();
    expect(acharUnidade(situacoes, { codigo: "", linhaId: "", origemC2x: null })).toBeUndefined();
    expect(acharUnidade(situacoes, { codigo: "VOC9999", origemC2x: 1 })).toBeUndefined();
  });
});

describe("lerSituacaoDasUnidades: as bordas que não precisam de cadastro", () => {
  it("sem empreendimento pedido, devolve vazio sem ir ao banco", async () => {
    const semBanco = {
      from: () => {
        throw new Error("não devia consultar");
      },
    } as unknown as SupabaseClient;
    const vazio = await lerSituacaoDasUnidades(semBanco, ["", "  "]);
    expect(vazio.unidades).toEqual([]);
    expect(vazio.terreno("qualquer")).toBeUndefined();
  });

  it("⚠️ leitura que falha LANÇA: nunca um mapa pela metade, que pintaria de livre o que não se leu", async () => {
    const consulta: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "conexão perdida" } }).then(aceitar, recusar),
    };
    for (const metodo of ["eq", "in", "is", "not", "or", "order", "range", "select"]) consulta[metodo] = () => consulta;
    const bancoQueCai = { from: () => consulta } as unknown as SupabaseClient;
    await expect(lerSituacaoDasUnidades(bancoQueCai, ["37"])).rejects.toThrow("conexão perdida");
  });
});
