import { afterEach, describe, expect, it, vi } from "vitest";

import { matchCompanySizeId } from "./c2x-fields";
import {
  C2X_CAMPO_CONTRATO_SOCIAL,
  dataAtualizacaoCadastralC2x,
  documentoDoCadastro,
  enviarUsuarioC2x,
  interpretarResposta,
  montarPayloadCliente,
  montarPayloadClientePj,
  montarPayloadImobiliaria,
  payloadParaAuditoria,
  payloadParaFormData,
  perfilPorPapel,
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

// ⚠️ TRAVA DO FLUXO PRINCIPAL. O cliente PF é o caminho com centenas de cadastros criados em
// produção; abrir o caminho PJ não pode mudar UM byte dele. Este teste compara o payload INTEIRO
// (chave a chave, nada de "contém"), então qualquer campo novo, removido ou renomeado no ramo PF
// quebra aqui — inclusive um `person_type_id` adicionado "só para ficar explícito".
describe("payload do cliente PF (congelado)", () => {
  it("continua exatamente o mesmo, campo a campo", () => {
    const p = montarPayloadCliente(
      {
        nome: "JOAO DA SILVA",
        email: "joao@ex.com",
        telefone: "+55 (31) 90000-0000",
        endereco: {
          address: "Rua A",
          cityId: 3100,
          complement: "Apto 2",
          district: "Centro",
          number: "10",
          stateId: 13,
          zipcode: "35.660-000",
        },
        cadastro: cadastro({
          birthday: "15/05/1990",
          civilState: "Casado (a)",
          cpf: "111.444.777-35",
          motherName: "MARIA",
          nacionality: "Brasileira",
          naturalness: "Belo Horizonte",
          profession: "ADMINISTRADOR(A)",
          propertyRegime: "Comunhão parcial de bens",
          salaryRange: "3 a 6 salários",
          schooling: "Superior Completo",
          sex: "Masculino",
          spouse: {
            birthday: "10/03/1988",
            cpf: "529.982.247-25",
            document: null,
            email: "maria@ex.com",
            name: "MARIA CONJUGE",
            phone: "(31) 91111-1111",
            profession: "ADVOGADO(A)",
          },
        }),
      },
      { senha: "SENHA-FIXA", vinculedById: 4314 },
    );

    expect(p).toEqual({
      name: "JOAO DA SILVA",
      email: "joao@ex.com",
      password: "SENHA-FIXA",
      profile_id: 2,
      user_status_id: 2,
      vinculed_by_id: 4314,

      cpf: "11144477735",
      document_type_id: 2,
      identification_number: "11144477735",
      birthday: "1990-05-15",
      phone: "+55 (31) 90000-0000",

      civil_state_id: 2,
      property_regime_id: 1,
      sex_id: 1,
      schooling_id: 7,
      salary_range_id: 3,
      profession_id: 3,
      naturalness: "Belo Horizonte",
      nacionality: "Brasileira",
      mother_name: "MARIA",

      spouse_attributes: {
        name: "MARIA CONJUGE",
        cpf: "52998224725",
        birthday: "1988-03-10",
        email: "maria@ex.com",
        cellphone: "(31) 91111-1111",
        identification_number: "52998224725",
        document_type_id: 2,
        profession_id: 4,
      },
      addresses_attributes: [
        {
          address: "Rua A",
          city_id: 3100,
          complement: "Apto 2",
          district: "Centro",
          number: "10",
          state_id: 13,
          zipcode: "35660000",
        },
      ],
      phones_attributes: [{ is_whatsapp: true, phone: "(31) 90000-0000", phone_code: "+55" }],
      signers_attributes: [
        {
          document_type_id: 2,
          email: "joao@ex.com",
          identification_number: "11144477735",
          name: "JOAO DA SILVA",
        },
        {
          document_type_id: 2,
          email: "maria@ex.com",
          identification_number: "52998224725",
          name: "MARIA CONJUGE",
        },
      ],
    });

    // Sem tipo de pessoa no PF: o C2X carimba 1 sozinho e é assim que os 432 clientes já criados
    // nasceram. Mandar explícito é mudança de payload em produção, e fica para uma decisão à parte.
    expect("person_type_id" in p).toBe(false);
  });
});

describe("cliente PESSOA JURÍDICA", () => {
  const empresa = {
    nome: "VOVO BRAGA PADARIA E MERCEARIA LTDA",
    email: "contato@vovobraga.com",
    telefone: "(37) 3231-4565",
    cadastro: cadastro({
      cnpj: "18.915.155/0001-13",
      companySize: "ME",
      fantasyName: "VOVO BRAGA PADARIA E MERCEARIA",
      isCompany: true,
      legalRepresentative: {
        cpf: "086.167.966-06",
        email: "renata@ex.com",
        name: "RENATA BRAGA DA CRUZ",
        profession: null,
      },
      municipalInscription: "Isento",
      nire: "Isento",
      openCompanyDate: "2013-09-19",
      socialName: "VOVO BRAGA PADARIA E MERCEARIA LTDA",
    }),
  };

  it("entra pelo cadastro de CLIENTE (profile 2), como jurídica e com CNPJ", () => {
    const p = montarPayloadCliente(empresa, { senha: "x", vinculedById: 4314 });

    expect(p.profile_id).toBe(2); // NÃO 6: cliente é cliente, a persona não decide o perfil
    expect(p.person_type_id).toBe(2); // sem isto a empresa nasce como pessoa física com CNPJ
    expect(p.user_status_id).toBe(2);
    expect(p.vinculed_by_id).toBe(4314); // o cliente não entra solto, nem quando é empresa
    expect(p.cnpj).toBe("18915155000113"); // sem máscara
    expect(p.social_name).toBe("VOVO BRAGA PADARIA E MERCEARIA LTDA");
    expect(p.fantasy_name).toBe("VOVO BRAGA PADARIA E MERCEARIA");
    expect(p.municipal_inscription).toBe("Isento");
    expect(p.user_nire).toBe("Isento");
    expect(p.open_company_date).toBe("2013-09-19");
    expect(p.company_size_id).toBe(2); // ME
  });

  it("NÃO inventa os campos de pessoa física", () => {
    const p = montarPayloadCliente(empresa, { senha: "x", vinculedById: 4314 });
    // Nos 80 clientes PJ que já existem no C2X essas colunas estão vazias em quase todos.
    const soDePessoaFisica = [
      "cpf",
      "document_type_id",
      "identification_number",
      "birthday",
      "mother_name",
      "civil_state_id",
      "property_regime_id",
      "sex_id",
      "schooling_id",
      "salary_range_id",
      "naturalness",
      "nacionality",
      "spouse_attributes",
    ];
    expect(soDePessoaFisica.filter((campo) => campo in p)).toEqual([]);
  });

  it("quem assina é o REPRESENTANTE LEGAL, não a empresa nem um cônjuge", () => {
    const p = montarPayloadCliente(empresa, { senha: "x", vinculedById: 1 });
    expect(p.signers_attributes).toEqual([
      {
        document_type_id: 2,
        email: "renata@ex.com",
        identification_number: "08616796606",
        name: "RENATA BRAGA DA CRUZ",
      },
    ]);
  });

  it("sem profissão do sócio cai em PROFISSÃO NÃO DECLARADA (25), e usa a do sócio quando existe", () => {
    const semProfissao = montarPayloadCliente(empresa, { senha: "x", vinculedById: 1 });
    expect(semProfissao.profession_id).toBe(25);

    const comProfissao = montarPayloadCliente(
      {
        ...empresa,
        cadastro: cadastro({
          ...empresa.cadastro,
          legalRepresentative: {
            ...empresa.cadastro.legalRepresentative!,
            profession: "EMPRESÁRIO(A)",
          },
        }),
      },
      { senha: "x", vinculedById: 1 },
    );
    expect(comProfissao.profession_id).toBe(93); // EMPRESÁRIO(A)
  });

  it("empresa sem sócio sobe sem assinante, em vez de eleger alguém", () => {
    const p = montarPayloadClientePj(
      {
        ...empresa,
        cadastro: cadastro({ ...empresa.cadastro, legalRepresentative: null }),
      },
      { senha: "x", vinculedById: 1 },
    );
    expect("signers_attributes" in p).toBe(false);
    expect(p.profile_id).toBe(2);
  });

  it("porte que não casa fica de fora, sem chute", () => {
    const p = montarPayloadClientePj(
      {
        ...empresa,
        cadastro: cadastro({ ...empresa.cadastro, companySize: "SOCIEDADE ANONIMA" }),
      },
      { senha: "x", vinculedById: 1 },
    );
    expect("company_size_id" in p).toBe(false);
  });
});

// OS DOIS CAMPOS QUE O C2X RECUSOU NA VOVO BRAGA (05/08): a data da atualização cadastral e o
// arquivo do contrato social. Sem eles a PJ volta com "não pode ficar em branco".
describe("PJ: data da atualização cadastral", () => {
  const empresaCom = (socialContractUpdatedAt: string | null) => ({
    nome: "VOVO BRAGA PADARIA E MERCEARIA LTDA",
    email: "contato@vovobraga.com",
    telefone: null,
    cadastro: cadastro({
      cnpj: "18.915.155/0001-13",
      isCompany: true,
      openCompanyDate: "2013-09-19",
      socialContractUpdatedAt,
      socialName: "VOVO BRAGA PADARIA E MERCEARIA LTDA",
    }),
  });

  it("manda a data REAL do cartão CNPJ quando ela existe", () => {
    const p = montarPayloadClientePj(empresaCom("2013-09-19"), { senha: "x", vinculedById: 1 });
    expect(p.social_contract_updated_at).toBe("2013-09-19");
  });

  it("aceita a data em BR e converte para o formato da coluna DATE", () => {
    const p = montarPayloadClientePj(empresaCom("19/09/2013"), { senha: "x", vinculedById: 1 });
    expect(p.social_contract_updated_at).toBe("2013-09-19");
  });

  // ⚠️ A ARMADILHA: `limpar()` apaga chave vazia. Se o fallback não garantisse valor, o campo
  // sumiria do JSON e o C2X recusaria de novo com a MESMA mensagem — pareceria que a correção
  // não funcionou. Por isso a chave TEM que estar presente mesmo sem data no cadastro.
  it("sem data no cadastro cai em HOJE (último recurso) e NUNCA some do payload", () => {
    const p = montarPayloadClientePj(empresaCom(null), { senha: "x", vinculedById: 1 });
    expect("social_contract_updated_at" in p).toBe(true);
    expect(p.social_contract_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    expect(p.social_contract_updated_at).toBe(hoje);
  });

  it("dataAtualizacaoCadastralC2x sempre devolve uma data", () => {
    expect(dataAtualizacaoCadastralC2x("2005-11-03")).toBe("2005-11-03");
    expect(dataAtualizacaoCadastralC2x("03/11/2005")).toBe("2005-11-03");
    expect(dataAtualizacaoCadastralC2x("lixo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataAtualizacaoCadastralC2x(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // A imobiliária também é PJ e provavelmente vai precisar do mesmo campo, mas ela NÃO entra
  // neste recorte (decisão do Lucas: não mexer no fluxo de credenciamento agora). O teste existe
  // para a mudança ser deliberada quando acontecer, e não um efeito colateral.
  it("a IMOBILIÁRIA continua sem o campo (fora deste recorte)", () => {
    const p = montarPayloadImobiliaria(
      {
        nome: "IMOB TESTE LTDA",
        email: "imob@ex.com",
        telefone: null,
        cadastro: cadastro({ cnpj: "12.345.678/0001-99", socialContractUpdatedAt: "2013-09-19" }),
      },
      { senha: "x" },
    );
    expect("social_contract_updated_at" in p).toBe(false);
  });
});

describe("payloadParaFormData (multipart do PJ)", () => {
  it("serializa nested attributes na notação de colchetes do Rack", () => {
    const form = payloadParaFormData({
      name: "VOVO BRAGA",
      person_type_id: 2,
      addresses_attributes: [{ address: "Rua A", city_id: 3100 }],
      phones_attributes: [{ is_whatsapp: true, phone: "(37) 3231-4565", phone_code: "+55" }],
      signers_attributes: [{ name: "RENATA", identification_number: "08616796606" }],
      spouse_attributes: { name: "MARIA" },
    });

    expect(form.get("name")).toBe("VOVO BRAGA");
    expect(form.get("person_type_id")).toBe("2");
    expect(form.get("addresses_attributes[0][address]")).toBe("Rua A");
    expect(form.get("addresses_attributes[0][city_id]")).toBe("3100");
    expect(form.get("phones_attributes[0][is_whatsapp]")).toBe("true");
    expect(form.get("phones_attributes[0][phone_code]")).toBe("+55");
    expect(form.get("signers_attributes[0][name]")).toBe("RENATA");
    expect(form.get("spouse_attributes[name]")).toBe("MARIA");
  });
});

describe("enviarUsuarioC2x: transporte", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function espionarFetch() {
    const chamadas: { body: unknown; headers: Record<string, string>; url: string }[] = [];
    vi.stubEnv("C2X_WRITE_API_URL", "https://teste.careli.adm.br");
    vi.stubEnv("C2X_WRITE_API_TOKEN", "token-de-teste");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      chamadas.push({
        body: init.body,
        headers: init.headers as Record<string, string>,
        url,
      });
      return new Response(JSON.stringify({ status: "success", token: "tok" }), { status: 201 });
    });
    return chamadas;
  }

  // ⚠️ TRAVA DO FLUXO PRINCIPAL: sem anexo o corpo continua sendo o MESMO JSON de sempre. É o
  // caminho de centenas de cadastros PF; trocar o transporte dele por causa do anexo da PJ seria
  // regressão no que funciona.
  it("SEM anexo manda JSON, exatamente como hoje", async () => {
    const chamadas = espionarFetch();
    await enviarUsuarioC2x({ cpf: "11144477735", name: "JOAO" });

    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.url).toBe("https://teste.careli.adm.br/api/v1/users");
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(c.headers.Authorization).toBe("token-de-teste"); // CRU, sem "Bearer"
    expect(c.body).toBe(JSON.stringify({ cpf: "11144477735", name: "JOAO" }));
  });

  it("COM anexo manda multipart, com o arquivo na parte social_contract", async () => {
    const chamadas = espionarFetch();
    const r = await enviarUsuarioC2x(
      { cnpj: "18915155000113", name: "VOVO BRAGA", social_contract_updated_at: "2013-09-19" },
      {
        bytes: new Uint8Array([37, 80, 68, 70]), // "%PDF"
        campo: C2X_CAMPO_CONTRATO_SOCIAL,
        contentType: "application/pdf",
        fileName: "CONTRATO SOCIAL (12).pdf",
      },
    );

    expect(r.status).toBe("success");
    const c = chamadas[0]!;
    const corpo = c.body as FormData;
    expect(corpo).toBeInstanceOf(FormData);
    // O boundary é do fetch: definir Content-Type na mão quebra o parse do Rails.
    expect("Content-Type" in c.headers).toBe(false);
    expect(corpo.get("cnpj")).toBe("18915155000113");
    expect(corpo.get("social_contract_updated_at")).toBe("2013-09-19");

    const arquivo = corpo.get(C2X_CAMPO_CONTRATO_SOCIAL) as File;
    expect(arquivo).toBeInstanceOf(Blob);
    expect(arquivo.name).toBe("CONTRATO SOCIAL (12).pdf");
    expect(arquivo.type).toBe("application/pdf");
    expect(arquivo.size).toBe(4);
  });
});

describe("perfilPorPapel", () => {
  it("decide pelo PAPEL, não pela persona: prospect é cliente mesmo sendo PJ", () => {
    expect(perfilPorPapel("prospect")).toBe("cliente");
    expect(perfilPorPapel("imobiliaria")).toBe("imobiliaria");
    expect(perfilPorPapel("incorporador")).toBe("incorporador");
  });

  it("quem não tem cadastro no C2X devolve null (não sobe)", () => {
    expect(perfilPorPapel("corretor")).toBeNull(); // mora só no Apolo
    expect(perfilPorPapel("fornecedor")).toBeNull();
    expect(perfilPorPapel("parceiro")).toBeNull();
    expect(perfilPorPapel("colaborador")).toBeNull();
    expect(perfilPorPapel("")).toBeNull();
    expect(perfilPorPapel(null)).toBeNull();
  });
});

describe("matchCompanySizeId", () => {
  it("casa o porte do enriquecimento com o company_sizes do C2X", () => {
    expect(matchCompanySizeId("ME")).toBe(2);
    expect(matchCompanySizeId("MEI")).toBe(1); // MEI antes de ME, senão "ME" casaria dentro
    expect(matchCompanySizeId("EPP")).toBe(3);
    expect(matchCompanySizeId("DEMAIS")).toBe(6);
    expect(matchCompanySizeId("Micro Empresa")).toBe(2);
    expect(matchCompanySizeId("Empresa de Pequeno Porte")).toBe(3);
    expect(matchCompanySizeId(null)).toBeNull();
    expect(matchCompanySizeId("qualquer coisa")).toBeNull();
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
