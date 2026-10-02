import { describe, expect, it } from "vitest";

import { apoloProfileLabels, apoloProfileOptions } from "./catalog";
import {
  PERFIL_COMPRADOR_CECILIO,
  RESPOSTA_HANDOFF_COMPRADOR_CECILIO,
  ehCompradorCecilio,
  rotuloDaUnidadeCecilio,
  unidadesDaCarteiraCecilio,
} from "./comprador-cecilio";

// O PAPEL "COMPRADOR CECÍLIO" (02/10/2026). O que este arquivo trava:
//   • o papel é reconhecido pelo id E pelo rótulo, porque a Iris recebe os dois formatos;
//   • o papel está na lista que VALIDA o que vem do banco — fora dela, a leitura descarta o papel
//     calada (foi o que segurou o 'prospect' de aparecer na ficha);
//   • as unidades saem do metadata sem quebrar com lixo e sem repetir;
//   • a frase que o cliente lê não fala de dívida.

describe("ehCompradorCecilio", () => {
  it("reconhece o id do papel e o rótulo, com ou sem acento", () => {
    expect(ehCompradorCecilio(["pessoa_fisica", "comprador_cecilio"])).toBe(true);
    expect(ehCompradorCecilio(["Comprador Cecílio"])).toBe(true);
    expect(ehCompradorCecilio(["comprador cecilio"])).toBe(true);
  });

  it("não confunde com o comprador do C2X nem com lista vazia", () => {
    expect(ehCompradorCecilio(["usuario", "pessoa_fisica"])).toBe(false);
    expect(ehCompradorCecilio(["Comprador"])).toBe(false);
    expect(ehCompradorCecilio([])).toBe(false);
    expect(ehCompradorCecilio(null)).toBe(false);
  });
});

describe("o catálogo conhece o papel", () => {
  it("entra na lista que valida o papel lido do banco, com rótulo próprio", () => {
    expect(apoloProfileOptions).toContain(PERFIL_COMPRADOR_CECILIO);
    expect(apoloProfileLabels[PERFIL_COMPRADOR_CECILIO]).toBe("Comprador Cecílio");
  });
});

describe("unidadesDaCarteiraCecilio", () => {
  it("lê as unidades de metadata.cecilio, sem repetir", () => {
    const metadata = {
      cecilio: {
        unidades: [
          { carteira: "Garden", unidade: "Q11 L01" },
          { carteira: "Garden", unidade: "Q11 L01" },
          { carteira: "Ed. Rubi", unidade: "201" },
          { carteira: "Vale do Ouro 2", unidade: null },
        ],
      },
      source: "cecilio",
    };

    expect(unidadesDaCarteiraCecilio(metadata)).toEqual([
      { carteira: "Garden", unidade: "Q11 L01" },
      { carteira: "Ed. Rubi", unidade: "201" },
      { carteira: "Vale do Ouro 2", unidade: null },
    ]);
  });

  it("devolve vazio para metadata sem a carteira ou com formato estranho", () => {
    expect(unidadesDaCarteiraCecilio(null)).toEqual([]);
    expect(unidadesDaCarteiraCecilio({ profileNames: ["Usuario"] })).toEqual([]);
    expect(unidadesDaCarteiraCecilio({ cecilio: { unidades: "Garden" } })).toEqual([]);
    expect(unidadesDaCarteiraCecilio({ cecilio: { unidades: [{ unidade: "101" }, 7] } })).toEqual([]);
  });

  it("monta o rótulo da unidade, e só a carteira quando não há unidade", () => {
    expect(rotuloDaUnidadeCecilio({ carteira: "Garden", unidade: "Q11 L01" })).toBe("Garden · Q11 L01");
    expect(rotuloDaUnidadeCecilio({ carteira: "Vale do Ouro 2", unidade: null })).toBe("Vale do Ouro 2");
  });
});

describe("a frase que o cliente lê", () => {
  it("não cita dívida, parcela, boleto nem carteira: quem escreve pode não ser o titular", () => {
    expect(RESPOSTA_HANDOFF_COMPRADOR_CECILIO).not.toMatch(/d[ií]vida|parcela|boleto|atras|carteira|Cec[ií]lio/i);
  });
});
