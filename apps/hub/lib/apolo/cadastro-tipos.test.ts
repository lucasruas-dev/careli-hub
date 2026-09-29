import { describe, expect, it } from "vitest";

import {
  CADASTRO_TIPOS,
  documentoDaIdentificacao,
  faltaNoVinculo,
  findCadastroTipo,
  formatoDoCadastro,
} from "./cadastro-tipos";

// O CORRETOR AUTÔNOMO É UM TIPO PRÓPRIO DE CADASTRO — decisão do Lucas (27/09/2026).
//
// "Preciso cadastrar corretor autonomo, tipo, ele nao sera vinculado a uma imobiliaria, ele sera uma
// entidade. Quem fara esse cadastro e time nosso interno."
//
// ⚠️ E NUNCA UMA IMOBILIÁRIA: *"NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO
// IMOBILIARIA, isso sera bem restrito"*. Por isso o teste cobra o rótulo também: o tipo não pode
// aparecer em lista nenhuma falando de imobiliária.
//
// O que está travado aqui:
//   • o tipo existe e está DISPONÍVEL no menu "+" do Apolo;
//   • `/apolo/cadastro?tipo=corretor` abre o formato do CORRETOR, e não cai calado no de cliente;
//   • o formato do corretor é PF, sem Vínculo e fora da esteira; o do prospect e o da imobiliária
//     continuam como eram (nada afrouxou para quem já existe).

describe("o tipo Corretor no menu + do Apolo", () => {
  const corretor = CADASTRO_TIPOS.find((t) => t.slug === "corretor");

  it("existe e está disponível", () => {
    expect(corretor).toBeDefined();
    expect(corretor?.disponivel).toBe(true);
    expect(corretor?.label).toBe("Corretor");
  });

  it("nem o rótulo nem a descrição falam de imobiliária", () => {
    const texto = `${corretor?.label ?? ""} ${corretor?.descricao ?? ""}`.toLowerCase();
    expect(texto).not.toContain("imobili");
  });

  it("os tipos que já existiam continuam no menu", () => {
    const slugs = CADASTRO_TIPOS.map((t) => t.slug);
    expect(slugs).toContain("prospect");
    expect(slugs).toContain("imobiliaria");
    expect(CADASTRO_TIPOS.find((t) => t.slug === "imobiliaria")?.disponivel).toBe(true);
  });
});

describe("findCadastroTipo", () => {
  it("tipo=corretor abre o CORRETOR (antes caía calado no cadastro de cliente)", () => {
    expect(findCadastroTipo("corretor").slug).toBe("corretor");
  });

  it("slug desconhecido continua caindo no prospect, como sempre", () => {
    expect(findCadastroTipo("inexistente").slug).toBe("prospect");
    expect(findCadastroTipo(null).slug).toBe("prospect");
  });
});

describe("o formato que cada tipo abre no wizard", () => {
  it("corretor autônomo: pessoa física, sem Vínculo, fora da esteira", () => {
    expect(formatoDoCadastro("corretor")).toMatchObject({
      entraNaEsteira: false,
      exigeVinculo: false,
      papel: "corretor",
      persona: "pf",
    });
  });

  it("prospect: o documento decide PF ou PJ, e o Vínculo continua obrigatório", () => {
    expect(formatoDoCadastro("prospect")).toMatchObject({
      entraNaEsteira: true,
      exigeVinculo: true,
      papel: "prospect",
      persona: "documento",
    });
  });

  it("imobiliária: continua PJ", () => {
    expect(formatoDoCadastro("imobiliaria")).toMatchObject({
      exigeVinculo: false,
      papel: "imobiliaria",
      persona: "pj",
    });
  });

  it("o corretor autônomo só aceita documento de identificação: nunca vira PJ", () => {
    expect(documentoDaIdentificacao(formatoDoCadastro("corretor")).aceitos).toEqual(["identidade"]);
    expect(documentoDaIdentificacao(formatoDoCadastro("prospect")).aceitos).toEqual([
      "identidade",
      "cnpj",
    ]);
    expect(documentoDaIdentificacao(formatoDoCadastro("imobiliaria")).aceitos).toEqual(["cnpj"]);
  });

  it("a frase pedida na tela vem do mesmo lugar que a lista de aceitos", () => {
    expect(documentoDaIdentificacao(formatoDoCadastro("corretor")).frase).not.toContain("CNPJ");
    expect(documentoDaIdentificacao(formatoDoCadastro("prospect")).frase).toContain("CNPJ");
  });
});

describe("o que falta no Vínculo (a mesma lista que habilita o botão e monta o aviso)", () => {
  const prospect = formatoDoCadastro("prospect");
  const corretor = formatoDoCadastro("corretor");

  // (fatia 2, 28/09/2026) A frase passou a nomear as DUAS portas do vínculo, porque o bloco agora
  // oferece as duas: imobiliária ou corretor autônomo. Lucas (27/09/2026), sobre o autônomo:
  // *"Sim, empreendimento a empreendimento"*.
  it("prospect sem vínculo: cobra imobiliária OU corretor autônomo, e empreendimento/corretor", () => {
    expect(
      faltaNoVinculo({ formato: prospect, imobiliariaId: "", modoPublico: false, vinculoOk: false }),
    ).toEqual(["imobiliária ou corretor autônomo", "empreendimento e corretor"]);
  });

  it("⚠️ com o corretor autônomo escolhido, o corretor NÃO é cobrado: ele É o corretor", () => {
    expect(
      faltaNoVinculo({
        autonomoId: "aaaaaaaa-1111-4111-8111-111111111111",
        formato: prospect,
        imobiliariaId: "",
        modoPublico: false,
        vinculoOk: false,
      }),
    ).toEqual(["empreendimento"]);
  });

  it("autônomo com empreendimento resolvido: nada falta, e sem pedir imobiliária", () => {
    expect(
      faltaNoVinculo({
        autonomoId: "aaaaaaaa-1111-4111-8111-111111111111",
        formato: prospect,
        imobiliariaId: "",
        modoPublico: false,
        vinculoOk: true,
      }),
    ).toEqual([]);
  });

  it("prospect com o vínculo resolvido: nada falta", () => {
    expect(
      faltaNoVinculo({
        formato: prospect,
        imobiliariaId: "11111111-2222-4333-8444-555555555555",
        modoPublico: false,
        vinculoOk: true,
      }),
    ).toEqual([]);
  });

  it("corretor autônomo: NADA de imobiliária é cobrado (ele não é vinculado a nenhuma)", () => {
    expect(
      faltaNoVinculo({ formato: corretor, imobiliariaId: "", modoPublico: false, vinculoOk: false }),
    ).toEqual([]);
  });

  it("no público o vínculo vem do token, como sempre", () => {
    expect(
      faltaNoVinculo({ formato: prospect, imobiliariaId: "", modoPublico: true, vinculoOk: false }),
    ).toEqual([]);
  });
});
