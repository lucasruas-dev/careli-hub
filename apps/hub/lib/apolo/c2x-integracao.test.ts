import { describe, expect, it } from "vitest";

import {
  documentoDaIntegracao,
  interpretarIntegracao,
  montarClienteIntegracao,
  montarImobiliariaIntegracao,
  resolverHostSonda,
} from "./c2x-integracao";
import type { ApoloC2xCadastro } from "./types";

// Prova o payload do ENDPOINT OFICIAL (contrato de 22/jul). O que muda em relação ao caminho
// antigo não é o de-para dos domínios (esse é o mesmo), é o ENVELOPE: profile em texto,
// vínculo por documento, endereço como objeto, sem senha.

const CAD_VAZIA: ApoloC2xCadastro = {
  age: null, birthday: null, city: null, civilState: null, cnpj: null,
  complement: null, cpf: null, creciNumber: null, creciValidate: null,
  district: null, fantasyName: null, isCompany: false, motherName: null,
  municipalInscription: null, nacionality: null, naturalness: null, nire: null,
  number: null, openCompanyDate: null, profession: null, propertyRegime: null,
  rg: null, salaryRange: null, schooling: null, sex: null,
  socialContractUpdatedAt: null, socialName: null, spouse: null, state: null,
  street: null, zipcode: null,
};

const cad = (over: Partial<ApoloC2xCadastro>): ApoloC2xCadastro => ({ ...CAD_VAZIA, ...over });

describe("payload do cliente (contrato oficial)", () => {
  const base = {
    cadastro: cad({
      birthday: "1985-04-12",
      civilState: "Solteiro",
      cpf: "123.456.789-09",
      motherName: "Joana Souza",
      nacionality: "Brasileira",
      naturalness: "Belo Horizonte",
      salaryRange: "1 a 3 salários", // rótulo REAL da lista (sem "salários" vira valor em R$)
      schooling: "Superior completo",
      sex: "Feminino",
    }),
    email: "maria@exemplo.com",
    nome: "Maria Aparecida Souza",
    telefone: "+55 (31) 99999-8888",
  };

  it("usa profile e person_type em TEXTO (não os ids do caminho antigo)", () => {
    const p = montarClienteIntegracao(base);
    expect(p.profile).toBe("cliente");
    expect(p.person_type).toBe("fisica");
    expect(p).not.toHaveProperty("profile_id");
    expect(p).not.toHaveProperty("person_type_id");
  });

  it("NÃO manda senha nem user_status_id (a API já cria como Aprovado)", () => {
    const p = montarClienteIntegracao(base);
    expect(p).not.toHaveProperty("password");
    expect(p).not.toHaveProperty("user_status_id");
  });

  it("manda o documento só com dígitos", () => {
    const p = montarClienteIntegracao(base);
    expect(p.cpf).toBe("12345678909");
    // identification_number repete o CPF (decisão: não capturamos RG)
    expect(p.identification_number).toBe("12345678909");
    expect(p.document_type_id).toBe(2);
  });

  it("traduz os rótulos do Apolo para os ids do C2X", () => {
    const p = montarClienteIntegracao(base);
    expect(p.civil_state_id).toBe(1); // Solteiro
    expect(p.sex_id).toBe(2); // Feminino
    expect(p.schooling_id).toBe(7); // Superior completo
    expect(p.salary_range_id).toBe(2); // 1 a 3
  });

  it("SOLTEIRO não leva regime de bens", () => {
    const p = montarClienteIntegracao(base);
    expect(p).not.toHaveProperty("property_regime_id");
  });

  it("CASADO leva regime de bens (o erro que barrou o Jose Renato em 28/jul)", () => {
    const p = montarClienteIntegracao({
      ...base,
      cadastro: cad({
        ...base.cadastro,
        civilState: "Casado",
        propertyRegime: "Comunhão parcial de bens",
      }),
    });
    expect(p.civil_state_id).toBe(2);
    expect(p.property_regime_id).toBe(1);
  });

  it("vínculo vai por DOCUMENTO (não pelo id da imobiliária no C2X)", () => {
    const p = montarClienteIntegracao({
      ...base,
      enterpriseId: 35,
      vinculedByDocument: "12.345.678/0001-99",
    });
    expect(p.vinculed_by_document).toBe("12345678000199");
    expect(p.enterprise_id).toBe(35);
    expect(p).not.toHaveProperty("vinculed_by_id");
  });

  it("endereço é OBJETO (não o array de nested attributes)", () => {
    const p = montarClienteIntegracao({
      ...base,
      endereco: {
        address: "Rua X", cityId: 3106, complement: "Sala 2",
        district: "Centro", number: "100", stateId: 11, zipcode: "30110-000",
      },
    });
    expect(p.address).toEqual({
      address: "Rua X", city_id: 3106, complement: "Sala 2",
      district: "Centro", number: "100", state_id: 11, zipcode: "30110000",
    });
    expect(p).not.toHaveProperty("addresses_attributes");
  });

  it("telefone sai sem o DDI e marcado como WhatsApp", () => {
    const p = montarClienteIntegracao(base);
    expect(p.phones).toEqual([{ is_whatsapp: true, phone: "31999998888" }]);
    expect(p).not.toHaveProperty("phones_attributes");
  });

  it("o ID do cadastro tem PRIORIDADE sobre o rótulo (mata a viagem lossy)", () => {
    const p = montarClienteIntegracao({
      ...base,
      // rótulos dizem uma coisa, os ids do cadastro dizem outra: quem manda é o id
      cadastro: cad({ ...base.cadastro, civilState: "Solteiro", schooling: "Superior completo" }),
      ids: { civilStateId: 2, propertyRegimeId: 1, schoolingId: 5, sexId: 3 },
    });
    expect(p.civil_state_id).toBe(2);
    expect(p.schooling_id).toBe(5);
    // "Não quero informar": o rótulo se perdia na volta (matchSexoId só entende M/F); o id passa
    expect(p.sex_id).toBe(3);
    // virou casado pelo id -> agora o regime é exigido e vai junto
    expect(p.property_regime_id).toBe(1);
  });

  it("id zerado/inválido não sobrescreve o rótulo", () => {
    const p = montarClienteIntegracao({
      ...base,
      ids: { civilStateId: 0, sexId: null },
    });
    expect(p.civil_state_id).toBe(1); // caiu no rótulo "Solteiro"
    expect(p.sex_id).toBe(2); // caiu no rótulo "Feminino"
  });

  it("campo sem valor fica FORA do JSON (não vai como null)", () => {
    const p = montarClienteIntegracao({
      cadastro: cad({ cpf: "123.456.789-09" }),
      email: null,
      nome: "Fulano",
      telefone: null,
    });
    expect(p).not.toHaveProperty("email");
    expect(p).not.toHaveProperty("birthday");
    expect(p).not.toHaveProperty("phones");
    expect(p).not.toHaveProperty("address");
  });
});

describe("payload da imobiliária", () => {
  it("vai como pessoa jurídica com CNPJ e razão social", () => {
    const p = montarImobiliariaIntegracao({
      cadastro: cad({
        cnpj: "12.345.678/0001-99",
        fantasyName: "Imobiliária Central",
        isCompany: true,
        socialName: "Central Imóveis LTDA",
      }),
      email: "contato@imobiliaria.com",
      nome: "Imobiliária Central",
      telefone: "3133334444",
    });
    expect(p.profile).toBe("imobiliaria");
    expect(p.person_type).toBe("juridica");
    expect(p.cnpj).toBe("12345678000199");
    expect(p.social_name).toBe("Central Imóveis LTDA");
    expect(p.fantasy_name).toBe("Imobiliária Central");
    expect(p).not.toHaveProperty("password");
  });
});

describe("leitura da resposta", () => {
  it("201 = criado, e devolve o ID do C2X (o que faltava no caminho antigo)", () => {
    const r = interpretarIntegracao(201, { created: true, id: 45678, status: "success", user_code: "CLI123" }, 120);
    expect(r.status).toBe("sucesso");
    if (r.status === "sucesso") {
      expect(r.c2xId).toBe(45678);
      expect(r.userCode).toBe("CLI123");
      expect(r.criado).toBe(true);
      expect(r.ms).toBe(120);
    }
  });

  it("200 = atualizado (created=false)", () => {
    const r = interpretarIntegracao(200, { created: false, id: 45678, status: "success" }, 90);
    expect(r.status).toBe("sucesso");
    if (r.status === "sucesso") expect(r.criado).toBe(false);
  });

  it("409 = já existe — não é falha, é a idempotência", () => {
    const r = interpretarIntegracao(409, { errors_message: "documento já cadastrado" }, 50);
    expect(r.status).toBe("duplicado");
  });

  it("422 = validação, e NADA foi criado", () => {
    const r = interpretarIntegracao(422, {
      errors: { cpf: ["CPF inválido"] },
      errors_message: "CPF inválido",
      status: "failed",
    }, 60);
    expect(r.status).toBe("validacao");
    if (r.status === "validacao") expect(r.erros.cpf).toEqual(["CPF inválido"]);
  });

  it("401 = chave recusada · 404 = documento não existe para o PUT", () => {
    expect(interpretarIntegracao(401, {}, 10).status).toBe("sem_autorizacao");
    expect(interpretarIntegracao(404, {}, 10).status).toBe("nao_encontrado");
  });
});

describe("documento da pessoa", () => {
  it("PJ usa CNPJ; PF usa CPF", () => {
    expect(documentoDaIntegracao(cad({ cnpj: "12.345.678/0001-99" }))).toBe("12345678000199");
    expect(documentoDaIntegracao(cad({ cpf: "123.456.789-09" }))).toBe("12345678909");
  });
});

// A sonda de diagnóstico manda o TOKEN DE ESCRITA do C2X no header. Até 05/08/2026 o destino vinha
// do corpo da requisição, então bastava uma sessão admin (ou um XSS na área logada) para receber a
// credencial de produção num coletor qualquer. Estes casos travam a regressão.
describe("host permitido para a sonda (vazamento de credencial)", () => {
  const ENV = "https://teste.careli.adm.br";

  it("sem host no corpo, vale o configurado na env", () => {
    expect(resolverHostSonda(undefined, ENV)).toEqual({ base: ENV, ok: true });
    expect(resolverHostSonda("  ", `${ENV}/`)).toEqual({ base: ENV, ok: true });
  });

  it("aceita produção e teste, e devolve o host canônico da lista", () => {
    const r = resolverHostSonda("https://sistema.careli.adm.br/", ENV);
    expect(r).toEqual({ base: "https://sistema.careli.adm.br", ok: true });
  });

  it("recusa host de fora, inclusive disfarçado de usuário na URL ou com porta trocada", () => {
    for (const mau of [
      "https://coletor-do-atacante.tld",
      "https://sistema.careli.adm.br@coletor-do-atacante.tld",
      "https://sistema.careli.adm.br.coletor.tld",
      "http://sistema.careli.adm.br:8080",
      "nao é uma url",
    ]) {
      expect(resolverHostSonda(mau, ENV).ok, mau).toBe(false);
    }
  });
});
