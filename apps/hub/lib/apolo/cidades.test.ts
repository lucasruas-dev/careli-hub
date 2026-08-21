import { describe, expect, it } from "vitest";

import { buscarCidades, normalizar, separarUf, textoDaCidade } from "./cidades";

// Uma fatia real da lista do C2X, incluindo os casos que fazem a regra existir.
const LINHAS = [
  "Belo Horizonte|MG",
  "Belo Oriente|MG",
  "Monte Belo|MG",
  "João Monlevade|MG",
  "João Pessoa|PB",
  "Pará de Minas|MG",
  "Sapucaia|RJ",
  "São Paulo|SP",
  "Bom Jesus|PI",
  "Bom Jesus|RS",
  "Bom Jesus|SC",
];

describe("normalização", () => {
  it("tira acento e caixa — ninguém digita acento em campo de cadastro", () => {
    expect(normalizar("São João")).toBe("sao joao");
    expect(normalizar("PARÁ DE MINAS")).toBe("para de minas");
  });
});

describe("a UF digitada junto", () => {
  it("aceita a UF ANTES do nome", () => {
    expect(separarUf("mg joão")).toEqual({ termo: "joao", uf: "MG" });
  });

  it("aceita a UF DEPOIS do nome", () => {
    expect(separarUf("joão monlevade mg")).toEqual({ termo: "joao monlevade", uf: "MG" });
  });

  it("aceita separada por barra", () => {
    expect(separarUf("joão/MG")).toEqual({ termo: "joao", uf: "MG" });
  });

  it("sem UF, devolve só o termo", () => {
    expect(separarUf("belo horizonte")).toEqual({ termo: "belo horizonte", uf: null });
  });

  it("⚠️ NÃO confunde o começo de um nome com UF", () => {
    // "pará de minas" começa com "pa", que é uma UF. Se as duas primeiras letras de qualquer
    // palavra virassem filtro, quem digita o nome inteiro receberia lista vazia.
    expect(separarUf("pará de minas")).toEqual({ termo: "para de minas", uf: null });
    expect(separarUf("sapucaia")).toEqual({ termo: "sapucaia", uf: null });
  });
});

describe("busca", () => {
  it("quem COMEÇA com o termo vem antes de quem só contém", () => {
    const r = buscarCidades("belo", LINHAS);
    expect(r[0]!.nome).toBe("Belo Horizonte");
    expect(r[1]!.nome).toBe("Belo Oriente");
    expect(r.map((c) => c.nome)).toContain("Monte Belo");
    expect(r.at(-1)!.nome).toBe("Monte Belo");
  });

  it("a UF estreita de verdade — é para isso que ela serve", () => {
    expect(buscarCidades("joão", LINHAS).map((c) => c.uf)).toEqual(["MG", "PB"]);
    expect(buscarCidades("joão mg", LINHAS).map((c) => c.nome)).toEqual(["João Monlevade"]);
  });

  it("desambigua homônimo entre estados — 247 nomes se repetem no C2X", () => {
    expect(buscarCidades("bom jesus", LINHAS)).toHaveLength(3);
    expect(buscarCidades("bom jesus rs", LINHAS)).toEqual([{ nome: "Bom Jesus", uf: "RS" }]);
  });

  it("só a UF já lista as cidades daquele estado", () => {
    const r = buscarCidades("pb", LINHAS);
    expect(r).toEqual([{ nome: "João Pessoa", uf: "PB" }]);
  });

  it("acha sem acento", () => {
    expect(buscarCidades("sao paulo", LINHAS)[0]!.nome).toBe("São Paulo");
  });

  it("entrada vazia não sugere nada", () => {
    expect(buscarCidades("", LINHAS)).toEqual([]);
    expect(buscarCidades("   ", LINHAS)).toEqual([]);
  });

  it("respeita o limite", () => {
    expect(buscarCidades("bom jesus", LINHAS, 2)).toHaveLength(2);
  });
});

describe("o que fica gravado", () => {
  it("só o nome — o C2X guarda texto livre e o padrão dominante é o nome puro", () => {
    expect(textoDaCidade({ nome: "João Monlevade", uf: "MG" })).toBe("João Monlevade");
  });
});
