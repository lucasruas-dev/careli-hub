import { describe, expect, it } from "vitest";

import { chaveDoLote, type LinhaDoTerreno, terrenosDasUnidades } from "./terreno";

// O TERRENO (a união extraída de `lerSituacaoDasUnidades` na F3 da fonte única). Os testes da régua
// (`situacao-da-unidade.test.ts`) continuam provando o comportamento dela; aqui, o atalho do espelho.

const linha = (patch: Partial<LinhaDoTerreno> & { id: string }): LinhaDoTerreno => ({
  enterprise_id: "35",
  espelho_de: null,
  lote: "06",
  quadra: "03",
  ...patch,
});

describe("terrenosDasUnidades", () => {
  it("o pai (VLO), a viva para onde ele aponta (VOC) e a gleba irmã da mesma quadra e lote (VOR) são um terreno", () => {
    const grupos = terrenosDasUnidades([
      linha({ enterprise_id: "35", espelho_de: "u-voc", id: "u-vlo" }),
      linha({ enterprise_id: "36", id: "u-voc" }),
      linha({ enterprise_id: "38", id: "u-vor" }),
      linha({ enterprise_id: "35", espelho_de: "u-vor-outro", id: "u-vlo-2", lote: "07" }),
      linha({ enterprise_id: "38", id: "u-vor-outro", lote: "07" }),
      linha({ enterprise_id: "36", id: "u-outro-lote", lote: "09" }),
    ]);
    expect(grupos.get("u-vlo")).toBe(grupos.get("u-voc"));
    expect(grupos.get("u-voc")).toBe(grupos.get("u-vor"));
    expect(grupos.get("u-outro-lote")).not.toBe(grupos.get("u-voc"));
  });

  it("sem linha no pai não há terreno comum (Rio de Pedras: RDP e RPC repetem a numeração)", () => {
    const grupos = terrenosDasUnidades([linha({ enterprise_id: "40", id: "u-rdp" }), linha({ enterprise_id: "41", id: "u-rpc" })]);
    expect(grupos.get("u-rdp")).not.toBe(grupos.get("u-rpc"));
  });

  it("quadra e lote comparam sem zero à esquerda", () => {
    expect(chaveDoLote("36", "03", "06")).toBe(chaveDoLote("36", "3", "6"));
  });
});
