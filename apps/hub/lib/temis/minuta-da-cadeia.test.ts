import { describe, expect, it } from "vitest";

import type { CadeiaDoContrato } from "./cadeia-do-contrato";
import { fraseDaOrigem, minutaFoiHerdada, recadoDaGeracao } from "./minuta-da-cadeia";

// A ORIGEM QUE APARECE — as funções puras que a prévia e a tela de trabalho mostram.
//
// ⚠️ A FRASE É MONTADA NO SERVIDOR, E A TELA SÓ A EXIBE. É a mesma disciplina de
// `ordem-da-categoria.ts`: tela que recalcula a cadeia é tela que discorda do motor sobre o mesmo
// contrato, e a discordância não aparece no dia em que é escrita.

const CADEIA: CadeiaDoContrato = {
  niveis: [
    { degrau: "unidade", id: "uni-1", minutaId: null, rotulo: "esta unidade" },
    { degrau: "categoria", id: "cat-1", minutaId: null, rotulo: "Condomínio" },
    { degrau: "divisao", id: "36", minutaId: null, rotulo: "VALE DO OURO VOL" },
    { degrau: "empreendimento", id: "35", minutaId: null, rotulo: "VALE DO OURO" },
  ],
};

describe("fraseDaOrigem", () => {
  it("diz o degrau com o nome que o operador conhece, nunca o id", () => {
    expect(fraseDaOrigem({ origem: "categoria", rotulo: "Condomínio" })).toBe(
      "modelo da categoria Condomínio",
    );
    expect(fraseDaOrigem({ origem: "divisao", rotulo: "VALE DO OURO VOL" })).toBe(
      "modelo da divisão VALE DO OURO VOL",
    );
    expect(fraseDaOrigem({ origem: "pai", rotulo: "VALE DO OURO" })).toBe(
      "modelo herdado do VALE DO OURO",
    );
    expect(fraseDaOrigem({ origem: "empreendimento", rotulo: "VEREDAS DO OURO" })).toBe(
      "modelo do empreendimento VEREDAS DO OURO",
    );
  });

  it("a minuta pedida à mão se declara como tal", () => {
    expect(fraseDaOrigem({ origem: "pedida", rotulo: "escolha manual" })).toBe(
      "modelo escolhido à mão para esta venda",
    );
  });
});

describe("minutaFoiHerdada", () => {
  it("o degrau mais específico da venda NÃO é herança", () => {
    // A unidade nunca tem minuta própria, então o primeiro degrau que conta é a categoria.
    expect(minutaFoiHerdada(CADEIA, { origem: "categoria" })).toBe(false);
  });

  it("qualquer degrau acima dele é herança, e a tela destaca", () => {
    expect(minutaFoiHerdada(CADEIA, { origem: "divisao" })).toBe(true);
    expect(minutaFoiHerdada(CADEIA, { origem: "pai" })).toBe(true);
  });

  it("sem categoria, a divisão é o mais específico e não é herança", () => {
    const semCategoria: CadeiaDoContrato = {
      niveis: CADEIA.niveis.filter((n) => n.degrau !== "categoria"),
    };
    expect(minutaFoiHerdada(semCategoria, { origem: "divisao" })).toBe(false);
    expect(minutaFoiHerdada(semCategoria, { origem: "empreendimento" })).toBe(true);
  });

  it("a minuta pedida à mão nunca é herança", () => {
    expect(minutaFoiHerdada(CADEIA, { origem: "pedida" })).toBe(false);
  });
});

describe("recadoDaGeracao", () => {
  it("nomeia o modelo, a versão, o degrau e as peças que foram junto", () => {
    expect(
      recadoDaGeracao({
        anexos: [{ nome: "Convenção de condomínio" }, { nome: "Memorial descritivo" }],
        minuta: {
          herdada: false,
          nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL",
          origemFrase: "modelo da divisão VALE DO OURO VOL",
          versao: 6,
        },
      }),
    ).toBe(
      "Contrato gerado com VOL-MINUTA-COMPRA-VENDA-NORMAL v6 (modelo da divisão VALE DO OURO VOL). Foram junto: Convenção de condomínio, Memorial descritivo.",
    );
  });

  it("quando herdou, a frase DIZ que herdou", () => {
    const frase = recadoDaGeracao({
      anexos: [],
      minuta: {
        herdada: true,
        nome: "Contrato Lagoa Bonita",
        origemFrase: "modelo herdado do LAGOA BONITA",
        versao: 3,
      },
    });
    expect(frase).toContain("herdado de um nível acima");
    expect(frase).toContain("Sem anexos.");
  });

  it("resposta sem minuta não inventa nada", () => {
    expect(recadoDaGeracao(undefined)).toBe("Contrato gerado.");
    expect(recadoDaGeracao({})).toBe("Contrato gerado.");
  });
});
