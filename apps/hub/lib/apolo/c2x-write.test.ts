import { describe, expect, it } from "vitest";

import {
  documentoDoCadastro,
  interpretarResposta,
  montarPayloadCliente,
  montarPayloadImobiliaria,
  payloadParaAuditoria,
  soDigitos,
} from "./c2x-write";
import type { ApoloC2xCadastro } from "./types";

// Cadastro base (só os campos que a montagem lê; o resto nulo).
function cadastro(over: Partial<ApoloC2xCadastro> = {}): ApoloC2xCadastro {
  return {
    age: null,
    birthday: null,
    city: null,
    civilState: null,
    cnpj: null,
    complement: null,
    cpf: null,
    creciNumber: null,
    creciValidate: null,
    district: null,
    fantasyName: null,
    isCompany: false,
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
    ...over,
  };
}

describe("montarPayloadCliente", () => {
  it("traduz os rótulos do Apolo para os ids do C2X", () => {
    const p = montarPayloadCliente(
      {
        nome: "JOAO DA SILVA",
        email: "joao@ex.com",
        telefone: "(31) 90000-0000",
        cadastro: cadastro({
          cpf: "111.444.777-35",
          rg: "MG-11.222.333",
          birthday: "15/05/1990",
          civilState: "Solteiro (a)",
          sex: "Masculino",
          schooling: "Superior Completo",
          salaryRange: "3 a 6 salários",
          profession: "ADMINISTRADOR(A)",
          naturalness: "Belo Horizonte",
          nacionality: "Brasileira",
          motherName: "MARIA",
        }),
      },
      { vinculedById: 4314, senha: "x" },
    );

    expect(p.profile_id).toBe(2);
    expect(p.user_status_id).toBe(2);
    expect(p.vinculed_by_id).toBe(4314);
    expect(p.cpf).toBe("11144477735"); // sem máscara
    expect(p.birthday).toBe("1990-05-15"); // BR -> ISO
    expect(p.civil_state_id).toBe(1);
    expect(p.sex_id).toBe(1);
    expect(p.schooling_id).toBe(7);
    expect(p.salary_range_id).toBe(3);
    expect(p.document_type_id).toBe(2); // sempre CPF (decisão do Lucas)
    expect(p.identification_number).toBe("11144477735"); // repete o CPF
    expect(p.name).toBe("JOAO DA SILVA");
  });

  it("exige regime de bens quando casado, e não quando solteiro", () => {
    const casado = montarPayloadCliente(
      {
        nome: "N",
        email: "e@e.com",
        telefone: null,
        cadastro: cadastro({
          cpf: "1",
          civilState: "Casado (a)",
          propertyRegime: "Comunhão parcial de bens",
        }),
      },
      { vinculedById: 1, senha: "x" },
    );
    expect(casado.civil_state_id).toBe(2);
    expect(casado.property_regime_id).toBe(1);

    const solteiro = montarPayloadCliente(
      {
        nome: "N",
        email: "e@e.com",
        telefone: null,
        cadastro: cadastro({ cpf: "1", civilState: "Solteiro (a)", propertyRegime: "x" }),
      },
      { vinculedById: 1, senha: "x" },
    );
    // Solteiro não manda regime de bens, mesmo que o cadastro tenha lixo no campo.
    expect(solteiro.property_regime_id).toBeUndefined();
  });

  it("manda o cônjuge aninhado em spouse_attributes quando ele existe", () => {
    const p = montarPayloadCliente(
      {
        nome: "N",
        email: "e@e.com",
        telefone: null,
        cadastro: cadastro({
          cpf: "1",
          civilState: "Casado (a)",
          propertyRegime: "Comunhão parcial de bens",
          spouse: {
            name: "MARIA CONJUGE",
            cpf: "529.982.247-25",
            birthday: "10/03/1988",
            document: "MG-99",
            email: "maria@ex.com",
            phone: "(31) 91111-1111",
            profession: "ADVOGADO(A)",
          },
        }),
      },
      { vinculedById: 1, senha: "x" },
    );
    const s = p.spouse_attributes as Record<string, unknown>;
    expect(s.name).toBe("MARIA CONJUGE");
    expect(s.cpf).toBe("52998224725");
    expect(s.birthday).toBe("1988-03-10");
    expect(s.profession_id).toBeGreaterThan(0);
  });

  it("não inclui chave nenhuma com valor vazio/nulo", () => {
    const p = montarPayloadCliente(
      { nome: "N", email: null, telefone: null, cadastro: cadastro({ cpf: "1" }) },
      { vinculedById: 1, senha: "x" },
    );
    expect("email" in p).toBe(false);
    expect("phone" in p).toBe(false);
    expect("naturalness" in p).toBe(false);
  });
});

describe("montarPayloadImobiliaria", () => {
  it("vai como pessoa jurídica com CNPJ", () => {
    const p = montarPayloadImobiliaria(
      {
        nome: "IMOB TESTE LTDA",
        email: "imob@ex.com",
        telefone: null,
        cadastro: cadastro({
          cnpj: "12.345.678/0001-99",
          socialName: "IMOB TESTE LTDA",
          fantasyName: "Imob Teste",
        }),
      },
      { senha: "x" },
    );
    expect(p.profile_id).toBe(6);
    expect(p.person_type_id).toBe(2);
    expect(p.cnpj).toBe("12345678000199");
    expect(p.fantasy_name).toBe("Imob Teste");
  });
});

describe("documentoDoCadastro", () => {
  it("prefere CNPJ quando é empresa, senão CPF, sempre só dígitos", () => {
    expect(documentoDoCadastro(cadastro({ cnpj: "12.345.678/0001-99" }))).toBe(
      "12345678000199",
    );
    expect(documentoDoCadastro(cadastro({ cpf: "111.444.777-35" }))).toBe("11144477735");
  });
});

describe("interpretarResposta", () => {
  it("reconhece sucesso e devolve o token", () => {
    const r = interpretarResposta({ status: "success", token: "abc123" });
    expect(r.status).toBe("success");
    expect(r.status === "success" && r.token).toBe("abc123");
  });

  it("marca duplicado quando a API diz que o CPF já existe (não é erro real)", () => {
    const r = interpretarResposta({
      status: "failed",
      errors: { cpf: ["já cadastrado(a) no sistema"] },
      errors_message: "CPF já cadastrado(a) no sistema",
    });
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.duplicado).toBe(true);
  });

  it("erro de validação comum não é duplicado", () => {
    const r = interpretarResposta({
      status: "failed",
      errors: { birthday: ["não pode ficar em branco"] },
      errors_message: "Data de Nascimento não pode ficar em branco",
    });
    expect(r.status === "failed" && r.duplicado).toBe(false);
  });
});

describe("payloadParaAuditoria", () => {
  it("nunca deixa a senha passar", () => {
    const auditado = payloadParaAuditoria({ name: "x", password: "SEGREDO" });
    expect("password" in auditado).toBe(false);
    expect(auditado.name).toBe("x");
  });
});

describe("soDigitos", () => {
  it("tira máscara de CPF/CNPJ/telefone", () => {
    expect(soDigitos("111.444.777-35")).toBe("11144477735");
    expect(soDigitos(null)).toBe("");
  });
});
