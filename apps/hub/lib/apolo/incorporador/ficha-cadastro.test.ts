import { describe, expect, it } from "vitest";

import type { ApoloC2xCadastro } from "@/lib/apolo/types";

import {
  formatarDocumento,
  montarGruposDeCadastro,
  type InsumosDoCadastro,
} from "./ficha-cadastro";

// A ABA CADASTRO DO PORTAL É A FICHA COMPLETA DA PESSOA NA TELA DE UM CLIENTE EXTERNO. Os testes
// cobrem o que errado custa caro: os grupos/campos baterem com o RegistrationPanel interno (a
// ordem do Lucas é "tem que ser igual"), a prioridade das fontes (esteira vence C2X, que vence
// metadata) e o documento sair SEM máscara (ordem de 18/08/2026).

const c2xVazio: ApoloC2xCadastro = {
  age: null,
  birthday: null,
  city: null,
  civilState: null,
  cnpj: null,
  companySize: null,
  complement: null,
  cpf: null,
  creciNumber: null,
  creciValidate: null,
  district: null,
  fantasyName: null,
  isCompany: false,
  legalRepresentative: null,
  motherName: null,
  municipalInscription: null,
  nacionality: null,
  naturalness: null,
  nire: null,
  number: null,
  openCompanyDate: null,
  profession: null,
  propertyRegime: null,
  rg: null,
  salaryRange: null,
  schooling: null,
  sex: null,
  socialContractUpdatedAt: null,
  socialName: null,
  spouse: null,
  state: null,
  street: null,
  zipcode: null,
};

const insumos = (over: Partial<InsumosDoCadastro>): InsumosDoCadastro => ({
  c2x: null,
  conjuge: {
    cpf: null,
    documento: null,
    email: null,
    nascimento: null,
    nome: null,
    profissao: null,
    telefone: null,
  },
  contatos: { email: null, telefone: null },
  documento: "12345678900",
  ehPj: false,
  endereco: null,
  ficha: {},
  nome: "José da Silva",
  razaoSocial: null,
  ...over,
});

describe("formatarDocumento", () => {
  it("⚠️ documento sai INTEIRO — ordem do Lucas (18/08/2026): igual ao Apolo interno", () => {
    expect(formatarDocumento("12345678900")).toBe("123.456.789-00");
    expect(formatarDocumento("123.456.789-00")).toBe("123.456.789-00");
    expect(formatarDocumento("12345678000199")).toBe("12.345.678/0001-99");
  });

  it("o que não é CPF/CNPJ sai como veio (aparado), como o CRM interno mostra", () => {
    expect(formatarDocumento("  ABC-1  ")).toBe("ABC-1");
    expect(formatarDocumento("")).toBeNull();
    expect(formatarDocumento(null)).toBeNull();
  });
});

describe("montarGruposDeCadastro — PF", () => {
  it("monta os MESMOS grupos da aba Cadastro interna: Dados do cliente, Dados cadastrais", () => {
    const grupos = montarGruposDeCadastro(insumos({}));

    expect(grupos.map((grupo) => grupo.titulo)).toEqual(["Cadastro", "Dados cadastrais"]);
    expect(grupos[0]?.eyebrow).toBe("Dados do cliente");
  });

  it("⚠️ o CPF do primeiro grupo sai sem máscara", () => {
    const grupos = montarGruposDeCadastro(insumos({}));
    const cpf = grupos[0]?.campos.find((campo) => campo.rotulo === "CPF/CNPJ");

    expect(cpf?.valor).toBe("123.456.789-00");
  });

  it("PF tem os campos do RegistrationPanel interno (RG, nascimento, estado civil…)", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        c2x: { ...c2xVazio, rg: "MG-1.234.567" },
        ficha: {
          dataNascimento: "1980-05-02",
          estadoCivilId: "1",
          nomeMae: "MARIA DA SILVA",
          profissaoId: "",
          sexoId: "1",
        },
      }),
    );

    const rotulos = grupos[1]?.campos.map((campo) => campo.rotulo) ?? [];
    for (const esperado of [
      "Tipo pessoa",
      "RG",
      "Nascimento",
      "Idade",
      "Sexo",
      "Estado civil",
      "Profissão",
      "Renda",
      "Escolaridade",
      "Naturalidade",
      "Nacionalidade",
      "Nome da mãe",
      "Endereço",
      "Número",
      "Bairro",
      "Complemento",
      "CEP",
      "Cidade",
    ]) {
      expect(rotulos).toContain(esperado);
    }

    const valor = (rotulo: string) =>
      grupos[1]?.campos.find((campo) => campo.rotulo === rotulo)?.valor;
    expect(valor("RG")).toBe("MG-1.234.567");
    expect(valor("Nascimento")).toBe("02/05/1980");
    expect(valor("Sexo")).toBe("Masculino");
    expect(valor("Estado civil")).toBe("Solteiro (a)");
    expect(valor("Nome da mãe")).toBe("Maria Da Silva");
  });

  it("⚠️ a esteira VENCE o C2X (a ficha vive em dois lugares — apolo-ficha-vs-cadastro)", () => {
    // O operador corrigiu o sexo na esteira; o C2X ainda tem o valor antigo. A tela do portal
    // tem que mostrar a correção, como o CRM interno mostra.
    const grupos = montarGruposDeCadastro(
      insumos({
        c2x: { ...c2xVazio, sex: "Masculino" },
        // `ficha` chega aqui JÁ mesclada pelo IO (metadata < C2X < esteira): o teste garante que
        // o valor mesclado é o exibido, não o cru do C2X.
        ficha: { sexoId: "2" },
      }),
    );

    const sexo = grupos[1]?.campos.find((campo) => campo.rotulo === "Sexo");
    expect(sexo?.valor).toBe("Feminino");
  });

  it("campo sem valor em nenhuma fonte sai como travessão, nunca some do grupo", () => {
    const grupos = montarGruposDeCadastro(insumos({}));
    const renda = grupos[1]?.campos.find((campo) => campo.rotulo === "Renda");

    expect(renda?.valor).toBe("-");
  });

  it("regime de bens só aparece para casado/união estável", () => {
    const solteiro = montarGruposDeCadastro(insumos({ ficha: { estadoCivilId: "1" } }));
    const casado = montarGruposDeCadastro(
      insumos({ ficha: { estadoCivilId: "2", regimeBensId: "1" } }),
    );

    expect(
      solteiro[1]?.campos.some((campo) => campo.rotulo === "Regime de bens"),
    ).toBe(false);
    expect(
      casado[1]?.campos.find((campo) => campo.rotulo === "Regime de bens")?.valor,
    ).toBe("Comunhão parcial de bens");
  });
});

describe("montarGruposDeCadastro — cônjuge", () => {
  it("casado ganha o grupo Dados do cônjuge, com os campos do interno", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        conjuge: {
          cpf: "98765432100",
          documento: "MG-7.654.321",
          email: "ana@exemplo.com",
          nascimento: "10/03/1982",
          nome: "ANA DA SILVA",
          profissao: "Professora",
          telefone: "31999990000",
        },
        ficha: { estadoCivilId: "2" },
      }),
    );

    const conjuge = grupos.find((grupo) => grupo.titulo === "Dados do cônjuge");
    expect(conjuge).toBeDefined();
    expect(conjuge?.campos.map((campo) => campo.rotulo)).toEqual([
      "Cônjuge",
      "CPF",
      "Telefone",
      "E-mail",
      "Nascimento",
      "Documento",
      "Profissão",
    ]);
    expect(conjuge?.campos[0]?.valor).toBe("Ana Da Silva");
    // CPF do cônjuge também sem máscara (mesma ordem do dono).
    expect(conjuge?.campos[1]?.valor).toBe("987.654.321-00");
  });

  it("cônjuge registrado aparece mesmo sem estado civil preenchido (importado incompleto)", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        conjuge: {
          cpf: null,
          documento: null,
          email: null,
          nascimento: null,
          nome: "ANA DA SILVA",
          profissao: null,
          telefone: null,
        },
      }),
    );

    expect(grupos.some((grupo) => grupo.titulo === "Dados do cônjuge")).toBe(true);
  });

  it("solteiro sem cônjuge não ganha o grupo", () => {
    const grupos = montarGruposDeCadastro(insumos({ ficha: { estadoCivilId: "1" } }));

    expect(grupos.some((grupo) => grupo.titulo === "Dados do cônjuge")).toBe(false);
  });
});

describe("montarGruposDeCadastro — PJ", () => {
  it("PJ tem os campos de empresa (NIRE, inscrição, abertura) e NÃO os de pessoa", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        c2x: {
          ...c2xVazio,
          isCompany: true,
          municipalInscription: "12345",
          nire: "3130001234-5",
          openCompanyDate: "01/02/2010",
        },
        documento: "12345678000199",
        ehPj: true,
        nome: "RR Soluções",
        razaoSocial: "RR SOLUÇÕES IMOBILIÁRIAS LTDA",
      }),
    );

    const rotulos = grupos[1]?.campos.map((campo) => campo.rotulo) ?? [];
    expect(rotulos).toContain("NIRE");
    expect(rotulos).toContain("Inscrição municipal");
    expect(rotulos).toContain("Data de abertura");
    expect(rotulos).not.toContain("RG");
    expect(rotulos).not.toContain("Estado civil");
    expect(rotulos).not.toContain("Nome da mãe");

    // PJ não tem cônjuge, nunca.
    expect(grupos.some((grupo) => grupo.titulo === "Dados do cônjuge")).toBe(false);

    // Razão social diferente do nome de exibição aparece no primeiro grupo (regra do interno).
    expect(
      grupos[0]?.campos.find((campo) => campo.rotulo === "Razão social")?.valor,
    ).toBe("RR SOLUÇÕES IMOBILIÁRIAS LTDA");
  });

  it("razão social IGUAL ao nome não duplica linha (mesma dedupe do interno)", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        documento: "12345678000199",
        ehPj: true,
        nome: "RR Soluções",
        razaoSocial: "rr soluções",
      }),
    );

    expect(grupos[0]?.campos.some((campo) => campo.rotulo === "Razão social")).toBe(false);
  });
});

describe("montarGruposDeCadastro — endereço", () => {
  it("a ficha (esteira/C2X) vence o endereço do Apolo, campo a campo", () => {
    const grupos = montarGruposDeCadastro(
      insumos({
        endereco: {
          bairro: "Centro",
          cep: "35700-000",
          cidade: "Sete Lagoas",
          complemento: "",
          logradouro: "Rua Antiga",
          numero: "10",
          uf: "MG",
        },
        ficha: { logradouro: "Rua Nova" },
      }),
    );

    const valor = (rotulo: string) =>
      grupos[1]?.campos.find((campo) => campo.rotulo === rotulo)?.valor;
    expect(valor("Endereço")).toBe("Rua Nova");
    // O que a ficha não trouxe continua vindo do endereço do Apolo.
    expect(valor("Bairro")).toBe("Centro");
    expect(valor("Cidade")).toBe("Sete Lagoas-MG");
  });
});
