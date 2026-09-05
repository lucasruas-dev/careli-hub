import { describe, expect, it } from "vitest";

import {
  casa,
  comparavel,
  jaEstaNaLista,
  ordenar,
  type ProponenteEncontrado,
  termoDaBusca,
} from "./busca-de-proponente";

const pessoa = (nome: string, documento: string) => ({ documento, id: nome, nome });

describe("termoDaBusca", () => {
  it("reconhece CPF em qualquer formato que o corretor cole", () => {
    // Do WhatsApp, do teclado numérico e da planilha — a mesma pergunta.
    for (const cru of ["058.183.866-19", "05818386619", "058 183 866 19"]) {
      const t = termoDaBusca(cru);
      expect(t.tipo, cru).toBe("cpf");
      if (t.tipo === "cpf") expect(t.digitos).toBe("05818386619");
    }
  });

  it("CPF parcial já busca, a partir de 4 dígitos", () => {
    expect(termoDaBusca("0581").tipo).toBe("cpf");
    // Três dígitos ainda é gente demais.
    expect(termoDaBusca("058").tipo).toBe("curto");
  });

  it("⚠️ nome com número continua sendo nome", () => {
    // "Ana 3" tem um dígito, mas ninguém procura CPF assim.
    expect(termoDaBusca("Ana 3").tipo).toBe("nome");
    expect(termoDaBusca("Maria").tipo).toBe("nome");
  });

  it("menos de três letras não busca", () => {
    expect(termoDaBusca("ma").tipo).toBe("curto");
    expect(termoDaBusca("  ").tipo).toBe("curto");
    expect(termoDaBusca("").tipo).toBe("curto");
  });
});

describe("casa", () => {
  const maria = pessoa("MARIA DA SILVA", "529.982.247-25");

  it("⚠️ acha sem acento e sem caixa — a base tem o mesmo nome de três jeitos", () => {
    // O C2X grava em caixa alta e sem acento; a CAD grava com acento; a planilha traz espaço duplo.
    expect(casa(pessoa("João Carlos Aparecido", "111"), termoDaBusca("joao"))).toBe(true);
    expect(casa(pessoa("JOAO CARLOS", "111"), termoDaBusca("João"))).toBe(true);
  });

  it("⚠️ palavras em qualquer ordem, que é como se procura", () => {
    // Quem lembra do sobrenome primeiro não pode ficar sem resultado.
    expect(casa(maria, termoDaBusca("silva maria"))).toBe(true);
    expect(casa(maria, termoDaBusca("maria silva"))).toBe(true);
  });

  it("toda palavra do termo tem que aparecer", () => {
    expect(casa(maria, termoDaBusca("maria souza"))).toBe(false);
  });

  it("CPF casa por prefixo de dígitos, ignorando a máscara dos dois lados", () => {
    expect(casa(maria, termoDaBusca("529982"))).toBe(true);
    expect(casa(maria, termoDaBusca("529.982.247-25"))).toBe(true);
    expect(casa(maria, termoDaBusca("111111"))).toBe(false);
  });

  it("termo curto não casa com ninguém", () => {
    expect(casa(maria, termoDaBusca("ma"))).toBe(false);
  });

  it("pessoa sem nome ou sem documento não quebra a busca", () => {
    expect(casa({ documento: null, id: "x", nome: null }, termoDaBusca("maria"))).toBe(false);
    expect(casa({ documento: null, id: "x", nome: null }, termoDaBusca("52998"))).toBe(false);
  });
});

describe("ordenar", () => {
  const p = (nome: string, credenciado: boolean): ProponenteEncontrado => ({
    cpf: "000",
    credenciado,
    etapa: null,
    id: nome,
    motivo: null,
    nome,
  });

  it("⚠️ credenciado primeiro — é o único que a tela deixa adicionar", () => {
    // Enterrado no meio de homônimos sem CAD, o corretor conclui que "não tem".
    const lista = [p("Ana", false), p("Zeca", true), p("Bruno", false)].sort(ordenar);
    expect(lista.map((x) => x.nome)).toEqual(["Zeca", "Ana", "Bruno"]);
  });

  it("dentro do mesmo grupo, por nome", () => {
    const lista = [p("Zeca", true), p("Ana", true)].sort(ordenar);
    expect(lista.map((x) => x.nome)).toEqual(["Ana", "Zeca"]);
  });
});

describe("jaEstaNaLista", () => {
  it("⚠️ compara por dígitos: o mesmo CPF não entra duas vezes por causa da máscara", () => {
    // O titular vem cru do banco e o candidato vem formatado. Comparar texto deixaria a MESMA
    // pessoa entrar duas vezes, e a soma fecharia 100% com um comprador repetido.
    expect(jaEstaNaLista("529.982.247-25", ["52998224725"])).toBe(true);
    expect(jaEstaNaLista("52998224725", ["529.982.247-25"])).toBe(true);
  });

  it("CPF diferente entra", () => {
    expect(jaEstaNaLista("111.444.777-35", ["52998224725"])).toBe(false);
  });
});

describe("comparavel", () => {
  it("tira acento, caixa e espaço repetido", () => {
    expect(comparavel("  José   DA  Conceição ")).toBe("jose da conceicao");
  });

  it("nulo vira string vazia, sem quebrar", () => {
    expect(comparavel(null)).toBe("");
  });
});
