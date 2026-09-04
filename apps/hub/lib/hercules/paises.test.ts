import { describe, expect, it } from "vitest";

import {
  bandeira,
  buscarPaises,
  formatarTelefoneDoPais,
  telefoneComPais,
} from "./paises";

describe("bandeira", () => {
  it("monta a bandeira a partir do ISO2", () => {
    expect(bandeira("BR")).toBe("🇧🇷");
    expect(bandeira("pt")).toBe("🇵🇹");
    expect(bandeira("US")).toBe("🇺🇸");
  });

  it("o que não é ISO2 vira globo, e não um quadrado quebrado", () => {
    expect(bandeira("")).toBe("🌐");
    expect(bandeira("BRA")).toBe("🌐");
  });
});

describe("buscarPaises", () => {
  it("⚠️ busca SEM ACENTO, porque ninguém digita trema com pressa", () => {
    expect(buscarPaises("suica").map((p) => p.iso2)).toContain("CH");
    expect(buscarPaises("italia").map((p) => p.iso2)).toContain("IT");
  });

  it("acha pelo código, com e sem o mais", () => {
    expect(buscarPaises("351").map((p) => p.iso2)).toContain("PT");
    expect(buscarPaises("+351").map((p) => p.iso2)).toContain("PT");
  });

  it("o Brasil é o primeiro da lista sem busca", () => {
    expect(buscarPaises("")[0]?.iso2).toBe("BR");
  });
});

describe("formatarTelefoneDoPais", () => {
  it("⚠️ o Brasil ganha a máscara que todo mundo reconhece", () => {
    expect(formatarTelefoneDoPais("31987654321", "55")).toBe("(31) 98765-4321");
    expect(formatarTelefoneDoPais("3132362775", "55")).toBe("(31) 3236-2775");
  });

  it("vai se formando enquanto a pessoa digita", () => {
    expect(formatarTelefoneDoPais("3", "55")).toBe("(3");
    expect(formatarTelefoneDoPais("31", "55")).toBe("(31");
    expect(formatarTelefoneDoPais("319", "55")).toBe("(31) 9");
  });

  it("⚠️ fora do Brasil NÃO inventa máscara", () => {
    // Cada país tem a sua, e várias mudam por região: máscara errada deixa número certo com cara
    // de errado. Agrupar de três em três é como se dita em qualquer lugar.
    expect(formatarTelefoneDoPais("16175550123", "1")).toBe("16 175 550 123");
    expect(formatarTelefoneDoPais("912345678", "351")).toBe("912 345 678");
  });
});

describe("telefoneComPais", () => {
  it("põe o país na frente", () => {
    expect(telefoneComPais("31987654321", "55")).toBe("5531987654321");
    expect(telefoneComPais("912345678", "351")).toBe("351912345678");
  });

  it("⚠️ NÃO repete o código que a pessoa já digitou", () => {
    // Colar "+55 31 98765-4321" com o Brasil escolhido daria 5555319..., um número que não existe,
    // e o erro só apareceria quando a mensagem não chegasse.
    expect(telefoneComPais("5531987654321", "55")).toBe("5531987654321");
  });

  it("sem número não monta nada", () => {
    expect(telefoneComPais("", "55")).toBe("");
  });
});
