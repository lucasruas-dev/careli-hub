import { describe, expect, it } from "vitest";

import {
  boletosQueFaltamNaResposta,
  mensagemDosBoletos,
} from "./boletos-por-escrito";

// Os tres boletos do caso real AT-013760 (16/09/2026).
const DO_JOSE = [
  { parcela: "Parcela 15/144", url: "https://www.asaas.com/i/0g6469q7tsxm4y1j" },
  { parcela: "Parcela 20/144", url: "https://www.asaas.com/i/osfs3lzjpo238zh3" },
  { parcela: "Parcela 21/144", url: "https://www.asaas.com/i/swwun7tswp8bqyvc" },
];

// O que a Caca DISSE em audio no caso real: promete, e nao traz link nenhum.
const RESPOSTA_FALADA =
  "Já gerei os três boletos, e vou te mandar aqui por escrito, logo em seguida. " +
  "Dá uma conferida nos dados antes de pagar, tá?";

describe("boletosQueFaltamNaResposta", () => {
  // ⚠️ O BUG INTEIRO EM UM TESTE: a resposta falada promete e nao traz link. Os tres tem que
  // sair por escrito.
  it("devolve todos quando a resposta falada nao traz link nenhum", () => {
    expect(boletosQueFaltamNaResposta(DO_JOSE, RESPOSTA_FALADA)).toEqual(DO_JOSE);
  });

  // Quando a resposta ja foi por TEXTO com os links, nao repete: o cliente receberia tudo
  // duas vezes e nao saberia qual pagar.
  it("nao repete o que ja esta no texto", () => {
    const comLinks = `Seguem: ${DO_JOSE[0]!.url} e ${DO_JOSE[1]!.url}`;

    expect(boletosQueFaltamNaResposta(DO_JOSE, comLinks)).toEqual([DO_JOSE[2]]);
  });

  it("nada a mandar quando todos ja estao no texto", () => {
    const tudo = DO_JOSE.map((b) => b.url).join(" ");

    expect(boletosQueFaltamNaResposta(DO_JOSE, tudo)).toEqual([]);
  });

  it("nada a mandar quando nenhum boleto foi gerado", () => {
    expect(boletosQueFaltamNaResposta([], RESPOSTA_FALADA)).toEqual([]);
  });

  // ⚠️ A MESMA PARCELA GERADA DUAS VEZES NO TURNO NAO VIRA DOIS LINKS. Se a Caca chamar a
  // ferramenta de novo para a mesma parcela, o cliente recebe um so.
  it("nao duplica a mesma url gerada duas vezes", () => {
    const repetido = [DO_JOSE[0]!, DO_JOSE[0]!];

    expect(boletosQueFaltamNaResposta(repetido, RESPOSTA_FALADA)).toEqual([DO_JOSE[0]]);
  });

  // ⚠️ SO SAI LINK DE VERDADE. Uma url vazia ou malformada nao pode virar mensagem ao cliente.
  it("descarta o que nao e url http valida", () => {
    const sujo = [
      { parcela: "Parcela 1", url: "" },
      { parcela: "Parcela 2", url: "nao-e-link" },
      { parcela: "Parcela 3", url: "https://www.asaas.com/i/abc123" },
    ];

    expect(boletosQueFaltamNaResposta(sujo, RESPOSTA_FALADA)).toEqual([sujo[2]]);
  });
});

describe("mensagemDosBoletos", () => {
  it("lista cada parcela com o seu link, um por linha", () => {
    const texto = mensagemDosBoletos(DO_JOSE);

    for (const boleto of DO_JOSE) {
      expect(texto).toContain(boleto.url);
      expect(texto).toContain(boleto.parcela);
    }
  });

  // ⚠️ O LINK VAI INTEIRO E SOZINHO NA LINHA, sem pontuacao grudada: um "." no fim de uma
  // url do WhatsApp entra no link e o cliente abre uma pagina de erro.
  it("nao gruda pontuacao no fim do link", () => {
    const texto = mensagemDosBoletos(DO_JOSE);

    for (const boleto of DO_JOSE) {
      expect(texto).not.toContain(`${boleto.url}.`);
      expect(texto).not.toContain(`${boleto.url},`);
    }
  });

  // Mantem o aviso que a propria ferramenta ja manda dar ao cliente.
  it("pede para conferir os dados antes de pagar", () => {
    expect(mensagemDosBoletos(DO_JOSE).toLowerCase()).toContain("confer");
  });

  it("frase no singular quando e um boleto so", () => {
    const texto = mensagemDosBoletos([DO_JOSE[0]!]);

    expect(texto).toContain("boleto");
    expect(texto).not.toContain("boletos");
  });

  it("nao monta mensagem vazia", () => {
    expect(mensagemDosBoletos([])).toBe("");
  });
});
