import { describe, expect, it } from "vitest";

import {
  type EmpreendimentoNaArvore,
  espelhosADescartar,
  semEspelhoDuplicado,
} from "./sem-espelho-duplicado";

// O Vale do Ouro real: o pai VLO (espelho, id 35 no C2X) e três recortes.
const VALE_DO_OURO: EmpreendimentoNaArvore[] = [
  { c2xEnterpriseId: "35", codigo: "VLO", id: "pai-1", paiId: null },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "f-lino", paiId: "pai-1" },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "f-cecilio", paiId: "pai-1" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "f-vor", paiId: "pai-1" },
  // Um produto sem filho nenhum, para provar que ele nunca é tocado.
  { c2xEnterpriseId: "40", codigo: "JDG", id: "solo", paiId: null },
];

describe("espelhosADescartar", () => {
  it("tira o espelho quando um filho está no escopo", () => {
    const fora = espelhosADescartar(VALE_DO_OURO, {
      codigos: ["VLO", "VOC", "VOL", "VOR", "JDG"],
      idsDoC2x: ["35", "36", "37", "41", "40"],
    });

    expect([...fora.codigos]).toEqual(["VLO"]);
    expect([...fora.idsDoC2x]).toEqual(["35"]);
  });

  it("⚠️ basta UM filho no escopo — não é preciso ter todos", () => {
    // A sessão pode autorizar só o recorte do Cecílio. Exigir os três deixaria o espelho entrar e
    // contar de novo os lotes que o VOC já traz.
    const fora = espelhosADescartar(VALE_DO_OURO, {
      codigos: ["VLO", "VOC"],
      idsDoC2x: ["35", "37"],
    });

    expect(fora.codigos.has("VLO")).toBe(true);
  });

  it("⚠️ pai SEM filho no escopo continua respondendo pelos próprios números", () => {
    // É ele que tem o dado. Tirá-lo deixaria o empreendimento inteiro fora da tela — o oposto do
    // que a regra existe para fazer.
    const fora = espelhosADescartar(VALE_DO_OURO, { codigos: ["VLO"], idsDoC2x: ["35"] });

    expect(fora.codigos.size).toBe(0);
    expect(fora.idsDoC2x.size).toBe(0);
  });

  it("produto sem filho cadastrado nunca é descartado", () => {
    const fora = espelhosADescartar(VALE_DO_OURO, { codigos: ["JDG"], idsDoC2x: ["40"] });
    expect(fora.codigos.has("JDG")).toBe(false);
  });

  it("reconhece o filho tanto pelo código quanto pelo id do C2X", () => {
    // As duas leituras da tela usam chaves diferentes; a regra tem de enxergar as duas.
    const porCodigo = espelhosADescartar(VALE_DO_OURO, { codigos: ["VOC"], idsDoC2x: [] });
    const porId = espelhosADescartar(VALE_DO_OURO, { codigos: [], idsDoC2x: ["37"] });

    expect(porCodigo.codigos.has("VLO")).toBe(true);
    expect(porId.idsDoC2x.has("35")).toBe(true);
  });

  it("não se perde com espaço nem com caixa", () => {
    const fora = espelhosADescartar(
      [
        { c2xEnterpriseId: " 35 ", codigo: " vlo ", id: "p", paiId: null },
        { c2xEnterpriseId: "37", codigo: "voc", id: "f", paiId: "p" },
      ],
      { codigos: ["VOC"], idsDoC2x: [] },
    );

    expect(fora.codigos.has("VLO")).toBe(true);
    expect(fora.idsDoC2x.has("35")).toBe(true);
  });
});

describe("semEspelhoDuplicado", () => {
  it("devolve a lista sem os descartados", () => {
    const fora = espelhosADescartar(VALE_DO_OURO, {
      codigos: ["VLO", "VOC", "VOL", "JDG"],
      idsDoC2x: ["35", "36", "37", "40"],
    });

    expect(semEspelhoDuplicado(["VLO", "VOC", "VOL", "JDG"], fora.codigos)).toEqual([
      "VOC",
      "VOL",
      "JDG",
    ]);
    expect(semEspelhoDuplicado(["35", "36", "37", "40"], fora.idsDoC2x)).toEqual(["36", "37", "40"]);
  });
});
