import { describe, expect, it } from "vitest";

import {
  destinoEhProducao,
  foraDoC2x,
  HOST_C2X_PRODUCAO,
  rotuloBotaoC2x,
} from "./c2x-envio-card";

// A regra que este arquivo protege custou 8 cadastros criados no ambiente errado (28/jul e 01/08).
// Se alguém afrouxar a comparação do host, é aqui que quebra.
describe("destinoEhProducao", () => {
  it("aceita o host de produção", () => {
    expect(destinoEhProducao(HOST_C2X_PRODUCAO)).toBe(true);
    expect(destinoEhProducao("  SISTEMA.CARELI.ADM.BR ")).toBe(true);
  });

  it("recusa teste, porta trocada, sósia e env vazia", () => {
    for (const host of [
      "teste.careli.adm.br",
      "sistema.careli.adm.br:8080",
      "sistema.careli.adm.br.coletor.tld",
      "não configurado",
      "inválido",
      "desconhecido",
      "",
    ]) {
      expect(destinoEhProducao(host)).toBe(false);
    }
  });
});

// Selo e botão têm que aparecer e sumir juntos: os dois leem esta função.
describe("foraDoC2x", () => {
  it("acende nos três avisos e cala no resto", () => {
    expect(foraDoC2x("erro")).toBe(true);
    expect(foraDoC2x("nunca_enviado")).toBe(true);
    expect(foraDoC2x("sem_confirmacao")).toBe(true);
    expect(foraDoC2x(null)).toBe(false);
    expect(foraDoC2x(undefined)).toBe(false);
    expect(foraDoC2x("resolvido")).toBe(false);
  });
});

describe("rotuloBotaoC2x", () => {
  it("separa a primeira tentativa da segunda chance", () => {
    expect(rotuloBotaoC2x("nunca_enviado")).toBe("Subir para o C2X");
    expect(rotuloBotaoC2x("erro")).toBe("Tentar de novo");
    expect(rotuloBotaoC2x("sem_confirmacao")).toBe("Tentar de novo");
  });
});
