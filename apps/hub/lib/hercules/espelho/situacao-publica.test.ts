import { describe, expect, it } from "vitest";

import type { SituacaoDaUnidade } from "../situacao-da-unidade";

import {
  contarPublicas,
  corPublica,
  situacaoPublicaDoLote,
  type TerrenoComSituacao,
} from "./situacao-publica";

// O QUE ESTE TESTE PROTEGE: verde e uma AFIRMACAO publica, "este lote esta a venda", feita num link
// que circula no WhatsApp, para gente que nao tem login. A situacao vem da regua unica
// (`situacao-da-unidade.ts`); aqui se prova que o espelho so a traduz em duas cores, e que toda
// duvida sai azul.

const TODAS: SituacaoDaUnidade[] = [
  "disponivel",
  "reservado",
  "reservada",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
  "vendida",
  "bloqueada",
];

describe("cor publica de uma situacao da regua unica", () => {
  it("verde se e so se a regua diz livre", () => {
    for (const s of TODAS) {
      expect(corPublica(s)).toBe(s === "disponivel" ? "disponivel" : "indisponivel");
    }
  });

  // ⚠️ FAIL-CLOSED. Nao conseguir ler nunca vira verde.
  it("azul quando a situacao nao veio", () => {
    expect(corPublica(undefined)).toBe("indisponivel");
  });
});

/** O `porLinha` da regua unica: cada linha aponta para o terreno que responde por ela. */
function porLinha(linhas: Record<string, TerrenoComSituacao>): Map<string, TerrenoComSituacao> {
  return new Map(Object.entries(linhas));
}

describe("a cor de um quadrado do espelho", () => {
  it("uma linha so: a cor da regua unica", () => {
    const livre = porLinha({ VOC0105: { id: "VOC0105", situacao: "disponivel" } });
    expect(situacaoPublicaDoLote([{ doPai: false, id: "VOC0105" }], livre)).toBe("disponivel");

    const emContrato = porLinha({ VOC0105: { id: "VOC0105", situacao: "contrato" } });
    expect(situacaoPublicaDoLote([{ doPai: false, id: "VOC0105" }], emContrato)).toBe("indisponivel");
  });

  // ⚠️ O PAI APONTA PARA A GLEBA (espelho_de), e a regua unica ja devolve a mesma resposta para as
  // duas linhas. O cadastro parado do pai nao tem voz propria.
  it("pai que aponta para a gleba: o terreno da gleba responde pelas duas linhas", () => {
    const gleba = { id: "VOC0305", situacao: "reservado" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0305" },
          { doPai: false, id: "VOC0305" },
        ],
        porLinha({ VLO0305: gleba, VOC0305: gleba }),
      ),
    ).toBe("indisponivel");
  });

  // ⚠️ OS LOTES QUE VOC E VOR DISPUTAM (migration 0162). O pai aponta para a gleba que vende; a
  // linha bloqueada da outra carteira e outra unidade para a regua unica e nao apaga o verde.
  it("pai que aponta para a gleba que vende: a linha bloqueada da outra carteira nao conta", () => {
    const vor = { id: "VOR0410", situacao: "disponivel" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0410" },
          { doPai: false, id: "VOC0410" },
          { doPai: false, id: "VOR0410" },
        ],
        porLinha({
          VLO0410: vor,
          VOC0410: { id: "VOC0410", situacao: "bloqueada" },
          VOR0410: vor,
        }),
      ),
    ).toBe("disponivel");
  });

  // Os 83 lotes da Lagoa Bonita que so existem no pai: ele responde por si.
  it("pai sem gleba responde pelo proprio terreno", () => {
    expect(
      situacaoPublicaDoLote(
        [{ doPai: true, id: "LABC0901" }],
        porLinha({ LABC0901: { id: "LABC0901", situacao: "disponivel" } }),
      ),
    ).toBe("disponivel");
  });

  // ⚠️ SEM O PONTEIRO, o quadrado junta linhas que o Panteon nao diz serem o mesmo terreno. Se uma
  // delas esta em processo, o lote nao pode sair verde so porque a outra diz livre.
  it("linhas de terrenos diferentes sem ponteiro: verde so se todas estiverem livres", () => {
    const linhas = [
      { doPai: true, id: "PAI01" },
      { doPai: false, id: "FIL01" },
    ];
    expect(
      situacaoPublicaDoLote(
        linhas,
        porLinha({
          FIL01: { id: "FIL01", situacao: "proposta" },
          PAI01: { id: "PAI01", situacao: "disponivel" },
        }),
      ),
    ).toBe("indisponivel");
    expect(
      situacaoPublicaDoLote(
        linhas,
        porLinha({
          FIL01: { id: "FIL01", situacao: "disponivel" },
          PAI01: { id: "PAI01", situacao: "disponivel" },
        }),
      ),
    ).toBe("disponivel");
  });

  // ⚠️ FAIL-CLOSED: linha que a regua unica nao trouxe, ou quadrado sem linha nenhuma.
  it("azul quando alguma linha do quadrado nao tem resposta da regua unica", () => {
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0105" },
          { doPai: false, id: "VOC0105" },
        ],
        porLinha({ VOC0105: { id: "VOC0105", situacao: "disponivel" } }),
      ),
    ).toBe("indisponivel");
    expect(situacaoPublicaDoLote([], porLinha({}))).toBe("indisponivel");
  });
});

describe("contagem da legenda", () => {
  it("conta as duas cores e nao inventa terceira", () => {
    expect(
      contarPublicas(["disponivel", "indisponivel", "disponivel"]),
    ).toEqual({ disponivel: 2, indisponivel: 1 });
  });

  it("devolve zeros para lista vazia", () => {
    expect(contarPublicas([])).toEqual({ disponivel: 0, indisponivel: 0 });
  });
});
