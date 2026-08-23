import { describe, expect, it } from "vitest";

import { preencherCorpoDoTemplate, variantesDoTelefone } from "./disparo-na-conversa";

// O CASO (23/08/2026): disparos automáticos de template não apareciam na conversa da Iris —
// 48 envios em 7 dias sem registro nenhum. A materialização depende de duas funções puras:
// casar o telefone do disparo com o contato (9º dígito!) e renderizar o corpo real.
describe("variantesDoTelefone", () => {
  it("gera a variante sem o 9º dígito para celular BR", () => {
    expect(variantesDoTelefone("5531999264143")).toEqual([
      "5531999264143",
      "553199264143",
    ]);
  });

  it("gera a variante com o 9º dígito para número gravado sem ele", () => {
    expect(variantesDoTelefone("553199264143")).toEqual([
      "553199264143",
      "5531999264143",
    ]);
  });

  it("completa o 55 de número local e ignora formatação", () => {
    expect(variantesDoTelefone("(31) 99926-4143")).toContain("5531999264143");
  });

  // 10-11 dígitos são tratados como BR sem o 55 (mesma heurística do inbound) — um número
  // estrangeiro CURTO é ambíguo e o fluxo de disparo é doméstico. Estrangeiro longo passa puro.
  it("número estrangeiro longo passa como está, sem variante", () => {
    expect(variantesDoTelefone("442079460958")).toEqual(["442079460958"]);
  });
});

describe("preencherCorpoDoTemplate", () => {
  it("substitui os {{n}} pelos parâmetros na ordem", () => {
    expect(
      preencherCorpoDoTemplate("Olá {{1}}, sua parcela vence em {{2}}.", ["Maria", "10/09"]),
    ).toBe("Olá Maria, sua parcela vence em 10/09.");
  });

  it("placeholder sem parâmetro fica visível em vez de virar buraco", () => {
    expect(preencherCorpoDoTemplate("Olá {{1}}, código {{2}}.", ["Maria"])).toBe(
      "Olá Maria, código {{2}}.",
    );
  });
});
