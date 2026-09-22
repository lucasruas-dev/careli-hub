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

  // ⚠️ O PEDIDO DE CANCELAMENTO (21/09/2026). Lucas: *"hoje ele aponta para contrato e polui
  // nossos indicadores"*. A etapa da proposta NÃO muda no banco; muda o que a tela mostra.
  it("o pedido de cancelamento vence a etapa da proposta", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "vendida",
        propostasVivas: [{ desde: "2026-09-10", emCancelamento: true, etapa: "assinatura" }],
        reservada: false,
      }),
    ).toBe("em_cancelamento");
  });

  it("vale a marca da proposta MAIS RECENTE, como tudo o mais nesta régua", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "disponivel",
        propostasVivas: [
          { desde: "2026-01-02", emCancelamento: true, etapa: "faturado" },
          { desde: "2026-09-15", etapa: "contrato" },
        ],
        reservada: false,
      }),
    ).toBe("contrato");
  });

  it("⚠️ o lote em cancelamento NÃO volta para o estoque", () => {
    // O contrato ainda existe: sair livre aqui seria o convite à segunda venda.
    expect(
      estaLivre(
        situacaoDoTerreno({
          cadastro: "disponivel",
          propostasVivas: [{ desde: "2026-09-10", emCancelamento: true, etapa: "contrato" }],
          reservada: true,
        }),
      ),
    ).toBe(false);
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

  it("⚠️ em cancelamento é um balde PRÓPRIO, e não cai em negociação nem em vendido", () => {
    // É o ponto do trabalho de 21/09/2026: tirar essas vendas do número de contrato sem soltar o
    // lote. Se ele caísse num balde existente, o indicador continuaria poluído.
    expect(baldeDaSituacao("em_cancelamento")).toBe("em_cancelamento");
    expect(rotuloDaSituacao("em_cancelamento")).toBe("Em cancelamento");
    expect(estaLivre("em_cancelamento")).toBe(false);
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

// ⚠️ A LINHA BLOQUEADA NÃO HERDA A VENDA DA IRMÃ (22/09/2026).
//
// Medido em produção: os lotes 13/01, 13/02 e 12/06 do Vale do Ouro existem TRÊS vezes no cadastro
// — VLO bloqueada, VOC bloqueada e VOR com a venda. A régua juntava o terreno e trazia a venda do
// VOR para dentro do VOC, e o card de Faturado do VOC dizia 88 onde o legado (e a Nívea) contavam
// 86; a lista, que é por proposta do empreendimento, mostrava os 86 certos. Bloquear é como a
// operação escreve "este lote não se vende aqui" — é a carteira de onde o lote saiu, exatamente
// como já está escrito na regra da irmã com dono no cadastro, dez linhas acima na leitura.
describe("a linha bloqueada do terreno", () => {
  it("não recebe a venda que vive na outra gleba", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "bloqueada",
        propostasVivas: [{ daLinha: false, desde: "2026-09-09", etapa: "faturado" }],
        reservada: false,
      }),
    ).toBe("bloqueada");
  });

  it("nem a reserva que vive na outra gleba", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "bloqueada",
        propostasVivas: [{ daLinha: false, desde: "2026-09-01", etapa: "reservado" }],
        reservada: true,
      }),
    ).toBe("bloqueada");
  });

  it("mas a venda DA PRÓPRIA linha continua valendo, bloqueio ou não", () => {
    // Bloquear um lote que tem venda viva na própria linha é contradição do cadastro, e aí quem
    // manda é o processo: existe dono, com proposta.
    expect(
      situacaoDoTerreno({
        cadastro: "bloqueada",
        propostasVivas: [{ daLinha: true, desde: "2026-09-09", etapa: "faturado" }],
        reservada: false,
      }),
    ).toBe("faturado");
  });

  it("a linha NÃO bloqueada segue herdando o terreno, que é o que impede vender duplicado", () => {
    // O caso do VOC 03/05: disponível no cadastro do VOC, com reserva viva gravada na gleba velha.
    expect(
      situacaoDoTerreno({
        cadastro: "disponivel",
        propostasVivas: [{ daLinha: false, desde: "2026-09-08", etapa: "reservado" }],
        reservada: false,
      }),
    ).toBe("reservado");
  });

  it("sem dizer de qual linha veio, a proposta continua valendo (o padrão de antes)", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "bloqueada",
        propostasVivas: [{ desde: "2026-09-09", etapa: "faturado" }],
        reservada: false,
      }),
    ).toBe("faturado");
  });
});

// ⚠️ O PAI É REFLEXO (Lucas, 22/09/2026: *"VLO é reflexo"*).
//
// No produto dividido a venda mora no FILHO e o pai é a soma; proposta viva pendurada no pai é
// fantasma. A régua escolhe a proposta mais RECENTE do terreno, então uma reserva de 18/09 no pai
// ganhava de uma venda faturada do filho de 09/09. Medido depois da carga de 22/09: 105 propostas
// vivas no VLO e 48 no LAB, TODAS em unidade espelho e nenhuma em unidade de filho — o VOC
// mostrava 19 reservados, onde o legado conta ZERO, e o Faturado caía de 86 para 68.
describe("a proposta pendurada no pai", () => {
  it("não vence a venda do filho, mesmo sendo mais recente", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "vendida",
        propostasVivas: [
          { daLinha: true, desde: "2026-09-09", etapa: "faturado" },
          { daLinha: false, desde: "2026-09-18", etapa: "reservado", noPai: true },
        ],
        reservada: false,
      }),
    ).toBe("faturado");
  });

  it("nem segura o lote livre do filho, mesmo sendo a única do terreno", () => {
    // ⚠️ SEM EXCEÇÃO (Lucas, 22/09/2026: *"esquece esses 3 casos"*). Chegou a existir uma: quando
    // o filho não tinha nenhuma proposta, a do pai mandava, para não mostrar livre um lote com
    // reserva viva no legado (VLO 07/10, 11/02 e 14/01). O Lucas dispensou: no Panteon quem
    // responde pelo lote é o filho, e o pai não tem vida própria em nenhum caso.
    expect(
      situacaoDoTerreno({
        cadastro: "disponivel",
        propostasVivas: [{ daLinha: false, desde: "2026-09-18", etapa: "reservado", noPai: true }],
        reservada: false,
      }),
    ).toBe("disponivel");
  });

  it("a proposta do FILHO irmão continua valendo, que é o que impede vender duplicado", () => {
    expect(
      situacaoDoTerreno({
        cadastro: "disponivel",
        propostasVivas: [{ daLinha: false, desde: "2026-09-08", etapa: "assinatura" }],
        reservada: false,
      }),
    ).toBe("assinatura");
  });
});
