import { describe, expect, it } from "vitest";

import { direcaoInicialDoCampo } from "./ui";

// ⚠️ O BUG QUE DERRUBOU A TELA EM PRODUÇÃO (25/08/2026).
//
// Ao trocar de critério de ordenação, o código amostrava o primeiro item para decidir se a coluna
// nova começa crescente ou decrescente. Com a lista VAZIA isso é `undefined`, e um `as T` escondia
// o buraco do TypeScript: o extrator recebia undefined e estourava com "Cannot read properties of
// undefined (reading 'ultima')", levando a página inteira — tela branca, "This page couldn't load".
//
// Bastava filtrar por uma unidade cujo comprador ainda não assinou (ela some da lista de barras) e
// clicar em qualquer critério. Nenhum teste cobria lista vazia, e o typecheck não podia ajudar
// porque o cast silenciava exatamente o caso que quebrava.

type Item = { nome: string; ultima: null | string; valor: number };

// Este é o formato que estourava: acesso direto a propriedade do item, sem guarda.
const campos = {
  assinou: (i: Item) => i.ultima ?? "",
  nome: (i: Item) => i.nome,
  valor: (i: Item) => i.valor,
};

describe("direcaoInicialDoCampo", () => {
  it("NÃO estoura quando não há amostra — a lista está vazia", () => {
    expect(() => direcaoInicialDoCampo(campos, "assinou", undefined)).not.toThrow();
  });

  it("sem amostra, cai em decrescente", () => {
    // Não há dado para ordenar, então a direção não muda nada até chegar linha.
    expect(direcaoInicialDoCampo(campos, "assinou", undefined)).toBe(true);
    expect(direcaoInicialDoCampo(campos, "nome", undefined)).toBe(true);
  });

  it("coluna numérica começa DECRESCENTE", () => {
    // Ninguém clica em "valor" querendo ver o menor primeiro.
    expect(direcaoInicialDoCampo(campos, "valor", { nome: "A", ultima: null, valor: 5 })).toBe(true);
  });

  it("coluna de texto começa CRESCENTE", () => {
    // Nem em "cliente" querendo começar pelo Z.
    expect(direcaoInicialDoCampo(campos, "nome", { nome: "A", ultima: null, valor: 5 })).toBe(false);
  });

  it("campo que não existe no mapa não quebra", () => {
    expect(direcaoInicialDoCampo(campos, "inexistente", { nome: "A", ultima: null, valor: 1 })).toBe(
      false,
    );
  });

  it("extrator que devolve string a partir de campo nulo continua sendo texto", () => {
    // `ultima: null` vira "" pelo `?? ""` — é string, então crescente.
    expect(direcaoInicialDoCampo(campos, "assinou", { nome: "A", ultima: null, valor: 1 })).toBe(
      false,
    );
  });
});
