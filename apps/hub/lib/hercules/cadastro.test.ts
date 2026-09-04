import { describe, expect, it } from "vitest";

import { soDoPanteon } from "./cadastro";


describe("soDoPanteon", () => {
  const CADASTRO = [
    { c2xEnterpriseId: "35", cidade: null, codigo: "VLO", id: "u-vlo", nome: "Vale do Ouro", ordem: 0, paiId: null, uf: null, vendendo: true },
    { c2xEnterpriseId: "9001", cidade: null, codigo: "TST", id: "u-tst", nome: "ZZ TESTE", ordem: 999, paiId: null, uf: null, vendendo: true },
    { c2xEnterpriseId: null, cidade: null, codigo: "LOX", id: "u-lox", nome: "Lavra do Ouro", ordem: 1, paiId: null, uf: null, vendendo: false },
  ];
  const NO_C2X = new Set(["35", "36", "37"]);

  it("⚠️ devolve o que existe SÓ no Panteon", () => {
    // Sem isto o empreendimento some da tela Venda inteira: o escopo do portal é traduzido em
    // códigos pelo catálogo do C2X, e quem não está lá não vira código.
    expect(soDoPanteon(CADASTRO, ["35", "9001"], NO_C2X)).toEqual([
      { codigo: "TST", enterpriseId: "9001" },
    ]);
  });

  it("⚠️ NÃO amplia permissão: só sai o que a sessão já traz", () => {
    expect(soDoPanteon(CADASTRO, ["35"], NO_C2X)).toEqual([]);
    expect(soDoPanteon(CADASTRO, [], NO_C2X)).toEqual([]);
  });

  it("empreendimento sem id do C2X fica de fora", () => {
    // A Lavra do Ouro é pai de grupo sem espelho no legado: não tem id para casar com unidade.
    expect(soDoPanteon(CADASTRO, ["35", "9001", "LOX"], NO_C2X).map((p) => p.codigo)).toEqual(["TST"]);
  });
});
