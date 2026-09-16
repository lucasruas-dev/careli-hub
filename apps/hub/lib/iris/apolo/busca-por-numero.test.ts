import { describe, expect, it } from "vitest";

import {
  documentoParaBusca,
  ehSoNumero,
  interpretarDigitos,
  mascaraDeCnpj,
  mascaraDeCpf,
  mascaraDeTelefone,
} from "./busca-por-numero";

describe("ehSoNumero", () => {
  it("aceita numero com a pontuacao de telefone e de documento", () => {
    expect(ehSoNumero("04610713632")).toBe(true);
    expect(ehSoNumero("046.107.136-32")).toBe(true);
    // A barra do CNPJ — faltava, e o CNPJ com pontuacao nao era reconhecido.
    expect(ehSoNumero("68.172.042/0001-43")).toBe(true);
    expect(ehSoNumero("+55 (31) 99866-2052")).toBe(true);
    expect(ehSoNumero(" 31 3521 4400 ")).toBe(true);
  });

  // ⚠️ NOME COM NUMERO NAO E BUSCA POR NUMERO. "Maria 2" e nome; tratar como telefone
  // faria a busca por nome parar de funcionar para quem tem digito no cadastro.
  it("recusa texto, mesmo com digito no meio", () => {
    expect(ehSoNumero("Maria 2")).toBe(false);
    expect(ehSoNumero("RR Solucoes")).toBe(false);
    expect(ehSoNumero("")).toBe(false);
    expect(ehSoNumero("   ")).toBe(false);
  });
});

describe("mascaras", () => {
  it("poe a mascara do CPF", () => {
    expect(mascaraDeCpf("04610713632")).toBe("046.107.136-32");
  });

  it("poe a mascara do CNPJ", () => {
    expect(mascaraDeCnpj("68172042000143")).toBe("68.172.042/0001-43");
  });

  it("poe a mascara do telefone, com e sem o nono digito", () => {
    expect(mascaraDeTelefone("31998662052")).toBe("(31) 99866-2052");
    expect(mascaraDeTelefone("3135214400")).toBe("(31) 3521-4400");
  });

  it("descarta o DDI antes de mascarar o telefone", () => {
    expect(mascaraDeTelefone("5531998662052")).toBe("(31) 99866-2052");
  });

  it("devolve os digitos quando o tamanho nao bate com nenhuma mascara", () => {
    expect(mascaraDeCpf("123")).toBe("123");
    expect(mascaraDeCnpj("123")).toBe("123");
    expect(mascaraDeTelefone("123")).toBe("123");
  });
});

describe("documentoParaBusca", () => {
  // ⚠️ O CASO DO PRINT DO LUCAS (16/09/2026): no CRM 360, "69109320644" achava 0 fichas e
  // "691.093.206-44" achava 1. Os dois tem que dar no mesmo documento.
  it("CPF sem pontuacao e com pontuacao viram o mesmo documento", () => {
    expect(documentoParaBusca("69109320644")).toEqual({ digitos: "69109320644", tipo: "cpf" });
    expect(documentoParaBusca("691.093.206-44")).toEqual({ digitos: "69109320644", tipo: "cpf" });
  });

  it("CNPJ sem e com pontuacao", () => {
    expect(documentoParaBusca("68172042000143")).toEqual({ digitos: "68172042000143", tipo: "cnpj" });
    expect(documentoParaBusca("68.172.042/0001-43")).toEqual({
      digitos: "68172042000143",
      tipo: "cnpj",
    });
  });

  it("aceita espaco em volta", () => {
    expect(documentoParaBusca("  691.093.206-44  ")?.tipo).toBe("cpf");
  });

  // Documento INCOMPLETO nao tem hash para bater: devolve nulo e a busca por texto segue.
  it("pedaco de documento nao vira busca por documento", () => {
    expect(documentoParaBusca("691093")).toBeNull();
    expect(documentoParaBusca("6910932064")).toBeNull();
  });

  it("nome nao vira documento", () => {
    expect(documentoParaBusca("Maria")).toBeNull();
    expect(documentoParaBusca("Maria 69109320644")).toBeNull();
    expect(documentoParaBusca("")).toBeNull();
  });

  // Telefone com DDI (13) nao e documento nenhum.
  it("telefone de 13 digitos nao e documento", () => {
    expect(documentoParaBusca("5531998662052")).toBeNull();
  });
});

describe("interpretarDigitos", () => {
  // ⚠️ O CASO QUE OBRIGA A PERGUNTAR: 11 digitos e CPF e tambem celular com DDD.
  it("com 11 digitos, pergunta — e mostra as DUAS mascaras", () => {
    const leitura = interpretarDigitos("04610713632");

    expect(leitura.ambiguo).toBe(true);
    expect(leitura.opcoes).toEqual([
      { mascara: "(04) 61071-3632", tipo: "telefone" },
      { mascara: "046.107.136-32", tipo: "cpf" },
    ]);
  });

  it("telefone vem primeiro, para nao mudar o que ja funcionava", () => {
    expect(interpretarDigitos("31998662052").opcoes[0]?.tipo).toBe("telefone");
  });

  // 14 digitos nao cabem em telefone brasileiro nenhum (55 + DDD + 9 = 13).
  it("com 14 digitos e CNPJ, sem duvida", () => {
    const leitura = interpretarDigitos("68172042000143");

    expect(leitura.ambiguo).toBe(false);
    expect(leitura.opcoes).toEqual([
      { mascara: "68.172.042/0001-43", tipo: "cnpj" },
    ]);
  });

  it("com 10, 12 ou 13 digitos e telefone, sem duvida", () => {
    expect(interpretarDigitos("3135214400").ambiguo).toBe(false);
    expect(interpretarDigitos("3135214400").opcoes[0]?.tipo).toBe("telefone");
    expect(interpretarDigitos("5531998662052").opcoes[0]?.tipo).toBe("telefone");
    expect(interpretarDigitos("553135214400").opcoes[0]?.tipo).toBe("telefone");
  });

  it("nao opina sobre texto nem sobre numero curto demais", () => {
    expect(interpretarDigitos("Maria").opcoes).toEqual([]);
    expect(interpretarDigitos("123").opcoes).toEqual([]);
    expect(interpretarDigitos("").opcoes).toEqual([]);
  });
});
