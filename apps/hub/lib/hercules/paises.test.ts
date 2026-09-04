import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buscarPaises,
  formatarTelefoneDoPais,
  PAISES,
  telefoneComPais,
} from "./paises";

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

describe("a bandeira de cada país", () => {
  // ⚠️ ESTE TESTE EXISTE PORQUE A LISTA E O MAPA VIVEM EM ARQUIVOS DIFERENTES. A bandeira é SVG
  // (`BandeiraDoPais.tsx`) — emoji não desenha no Windows —, e quem adicionar um país aqui sem
  // adicionar lá veria um globo no lugar da bandeira, sem erro nenhum. É texto de propósito: o
  // componente é JSX, e importá-lo custaria um ambiente de teste inteiro para conferir 60 siglas.
  const fonte = readFileSync(
    new URL(
      "../../modules/incorporador/hercules/BandeiraDoPais.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const mapa = fonte.slice(fonte.indexOf("const POR_ISO2"));

  it("todo país da lista tem bandeira no mapa do componente", () => {
    const siglas = new Set(mapa.split(/[^A-Z]+/));
    const semBandeira = PAISES.filter((p) => !siglas.has(p.iso2));
    expect(semBandeira.map((p) => p.nome)).toEqual([]);
  });
});
