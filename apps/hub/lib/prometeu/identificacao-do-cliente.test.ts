import { describe, expect, it } from "vitest";

import {
  origemDoClienteParaExibir,
  primeiroNome,
  sufixoDeProponentes,
} from "./identificacao-do-cliente";

// A cliente do primeiro teste com o leitor 2D de verdade (28/08/2026, Villa Paris).
const FLAVIA = { corretor: "Ana Paula", imobiliaria: "Careli Imóveis" };

describe("linha de origem do cliente bipado", () => {
  it("imobiliária + corretor entram juntos, nessa ordem", () => {
    expect(origemDoClienteParaExibir(FLAVIA)).toEqual({
      texto: "Careli Imóveis · Ana Paula",
      tipo: "imobiliaria",
    });
  });

  it("só imobiliária", () => {
    expect(origemDoClienteParaExibir({ corretor: null, imobiliaria: "Careli Imóveis" })).toEqual({
      texto: "Careli Imóveis",
      tipo: "imobiliaria",
    });
  });

  it("só corretor vira linha de pessoa (ícone diferente), sem rótulo de imobiliária", () => {
    expect(origemDoClienteParaExibir({ corretor: "Ana Paula", imobiliaria: null })).toEqual({
      texto: "Ana Paula",
      tipo: "corretor",
    });
  });

  it("sem nada devolve null — a tela não desenha rótulo órfão", () => {
    expect(origemDoClienteParaExibir({ corretor: null, imobiliaria: null })).toBeNull();
    expect(origemDoClienteParaExibir({})).toBeNull();
  });

  it("string vazia ou só espaço conta como ausente", () => {
    expect(origemDoClienteParaExibir({ corretor: "   ", imobiliaria: "" })).toBeNull();
    expect(origemDoClienteParaExibir({ corretor: "  ", imobiliaria: " Careli " })).toEqual({
      texto: "Careli",
      tipo: "imobiliaria",
    });
  });

  it("colapsa espaço interno que vem do cadastro", () => {
    expect(
      origemDoClienteParaExibir({ corretor: null, imobiliaria: "Careli   Imóveis" })?.texto,
    ).toBe("Careli Imóveis");
  });

  it("autônomo com o mesmo nome nos dois campos não repete", () => {
    expect(
      origemDoClienteParaExibir({ corretor: "ANA PAULA", imobiliaria: "Ana Paula" }),
    ).toEqual({ texto: "Ana Paula", tipo: "imobiliaria" });
  });
});

describe("sufixo de proponentes", () => {
  it("titular sozinho não ganha sufixo", () => {
    expect(sufixoDeProponentes(0)).toBe("");
    expect(sufixoDeProponentes(1)).toBe("");
  });

  it("conta só os extras", () => {
    expect(sufixoDeProponentes(2)).toBe("+1");
    expect(sufixoDeProponentes(5)).toBe("+4");
  });
});

describe("primeiroNome", () => {
  it("pega o primeiro nome para a frase do atendimento", () => {
    expect(primeiroNome("FLAVIA CALDEIRA ANDRADE")).toBe("FLAVIA");
  });

  it("nome único volta inteiro", () => {
    expect(primeiroNome("MADONNA")).toBe("MADONNA");
  });

  it("espaço sobrando não vira nome vazio", () => {
    expect(primeiroNome("   JOAO   DA SILVA  ")).toBe("JOAO");
  });

  it("vazio é vazio", () => {
    expect(primeiroNome("")).toBe("");
    expect(primeiroNome("   ")).toBe("");
  });
});
