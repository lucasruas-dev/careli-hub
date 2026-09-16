import { describe, expect, it } from "vitest";

import {
  idsDoCorpo,
  idsParaSalvar,
  recorteDaContaNoCorpo,
  vinculosDoPortalNoCorpo,
  vinculosParaSalvar,
} from "./vinculos-do-formulario";

// O MERGE DE TRÊS PONTAS DO SETUP: o que a pessoa desmarcou sai, o que nasceu no banco depois de o
// formulário abrir fica. O caso real é o produto que o portal da Cecílio cadastra enquanto um admin
// está com o formulário do portal aberto para trocar a logo.

describe("vinculosParaSalvar", () => {
  it("⚠️ o vínculo gravado depois da abertura do formulário é mantido, com a carteira do banco", () => {
    const salvar = vinculosParaSalvar({
      gravadosAgora: [
        { carteiraAdministrada: true, enterpriseId: "37" },
        { carteiraAdministrada: false, enterpriseId: "39" },
        { carteiraAdministrada: false, enterpriseId: "100004" },
      ],
      iniciais: ["37", "39"],
      pedidos: [
        { carteiraAdministrada: true, enterpriseId: "37" },
        { carteiraAdministrada: false, enterpriseId: "39" },
      ],
    });
    expect(salvar).toEqual([
      { carteiraAdministrada: true, enterpriseId: "37" },
      { carteiraAdministrada: false, enterpriseId: "39" },
      { carteiraAdministrada: false, enterpriseId: "100004" },
    ]);
  });

  it("o que a pessoa desmarcou sai, mesmo continuando no banco", () => {
    const salvar = vinculosParaSalvar({
      gravadosAgora: [{ enterpriseId: "37" }, { enterpriseId: "39" }],
      iniciais: ["37", "39"],
      pedidos: [{ enterpriseId: "37" }],
    });
    expect(salvar).toEqual([{ enterpriseId: "37" }]);
  });

  it("o que a pessoa marcou entra; o pedido vence o banco quando os dois têm o mesmo id", () => {
    const salvar = vinculosParaSalvar({
      gravadosAgora: [{ carteiraAdministrada: false, enterpriseId: " 41 " }],
      iniciais: [],
      pedidos: [{ carteiraAdministrada: true, enterpriseId: "41" }, { carteiraAdministrada: false, enterpriseId: "36" }],
    });
    expect(salvar).toEqual([
      { carteiraAdministrada: true, enterpriseId: "41" },
      { carteiraAdministrada: false, enterpriseId: "36" },
    ]);
  });

  it("o que saiu do banco enquanto o formulário estava aberto não volta pelo merge", () => {
    expect(vinculosParaSalvar({ gravadosAgora: [], iniciais: ["37"], pedidos: [] })).toEqual([]);
  });
});

describe("idsParaSalvar (o recorte da conta)", () => {
  it("⚠️ mantém o produto que a conta cadastrou no portal depois de o formulário abrir", () => {
    expect(idsParaSalvar({ gravadosAgora: ["37", "100004"], iniciais: ["37", "39"], pedidos: ["39"] })).toEqual([
      "39",
      "100004",
    ]);
  });
});

// ── O CORPO DAS ROTAS DO SETUP ────────────────────────────────────────────────
// ⚠️ A pendência da onda 2: a tela mandava os iniciais e as rotas não repassavam. Estes testes travam
// o que as duas rotas entregam a `salvarIncorporador` e a `salvarUsuarioIncorporador`.

describe("idsDoCorpo", () => {
  it("lista vira ids limpos, sem vazio; o que não é texto nem número fica fora", () => {
    expect(idsDoCorpo([" 37 ", "", 100004, null, { id: "1" }, "  "])).toEqual(["37", "100004"]);
  });

  it("⚠️ ausente continua ausente (não mexer), e lista vazia continua vazia (tirar tudo)", () => {
    expect(idsDoCorpo(undefined)).toBeUndefined();
    expect(idsDoCorpo("37")).toBeUndefined();
    expect(idsDoCorpo([])).toEqual([]);
  });
});

describe("vinculosDoPortalNoCorpo (POST /api/apolo/incorporadores)", () => {
  it("⚠️ repassa os vínculos iniciais que a tela manda", () => {
    const corpo = {
      empreendimentos: [
        { carteiraAdministrada: true, enterpriseId: "37" },
        { carteiraAdministrada: false, enterpriseId: " 100000 " },
      ],
      nome: "Cecílio Rocha",
      vinculosIniciais: ["37", "39", "100000"],
    };
    expect(vinculosDoPortalNoCorpo(corpo)).toEqual({
      empreendimentos: [
        { carteiraAdministrada: true, enterpriseId: "37" },
        { carteiraAdministrada: false, enterpriseId: "100000" },
      ],
      vinculosIniciais: ["37", "39", "100000"],
    });
  });

  it("sem iniciais no corpo (tela antiga) = a regra antiga do servidor; pedido sem id fica fora", () => {
    expect(
      vinculosDoPortalNoCorpo({ empreendimentos: [{ enterpriseId: "" }, { carteiraAdministrada: 1, enterpriseId: 41 }, null] }),
    ).toEqual({ empreendimentos: [{ carteiraAdministrada: true, enterpriseId: "41" }], vinculosIniciais: undefined });
    expect(vinculosDoPortalNoCorpo(null)).toEqual({ empreendimentos: [], vinculosIniciais: undefined });
  });
});

describe("recorteDaContaNoCorpo (POST /api/apolo/incorporadores/usuarios)", () => {
  it("⚠️ repassa o recorte e os iniciais da conta", () => {
    expect(recorteDaContaNoCorpo({ empreendimentos: ["39", "100004"], empreendimentosIniciais: ["37", "39"] })).toEqual({
      empreendimentos: ["39", "100004"],
      empreendimentosIniciais: ["37", "39"],
    });
  });

  it("portal de incorporador não manda a lista: os dois ficam ausentes e o servidor não mexe no recorte", () => {
    expect(recorteDaContaNoCorpo({ email: "a@b.com", nome: "Ana" })).toEqual({
      empreendimentos: undefined,
      empreendimentosIniciais: undefined,
    });
  });
});
