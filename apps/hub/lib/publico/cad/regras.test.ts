import { describe, expect, it } from "vitest";

import {
  filtrarEmpreendimentosHabilitados,
  normalizarCnpj,
  normalizarCpf,
  normalizarCreci,
  normalizarEmail,
  normalizarTelefone,
  progresso,
  protocoloDaAutenticacao,
  proximoEstado,
  resolverVinculo,
  telefoneCompleto,
  validarCorretor,
  vinculosCredenciados,
  type EmpreendimentoPublico,
  type EstadoCad,
  type VinculoCorretor,
} from "@/lib/publico/cad/regras";

// CPFs válidos de teste (passam no módulo 11).
const CPF_OK = "52998224725";
const CPF_OK_2 = "11144477735";
const CNPJ_OK = "11222333000181";

describe("normalização de entrada", () => {
  it("tira máscara de CPF e CNPJ", () => {
    expect(normalizarCpf("529.982.247-25")).toBe(CPF_OK);
    expect(normalizarCnpj("11.222.333/0001-81")).toBe(CNPJ_OK);
  });

  it("normaliza e-mail para minúscula, sem espaço", () => {
    expect(normalizarEmail("  Corretor@Imob.COM.br ")).toBe("corretor@imob.com.br");
  });

  it("normaliza telefone com +55, zero de operadora e dois números no mesmo campo", () => {
    expect(normalizarTelefone("+55 37 99956-9096")).toBe("37999569096");
    // Zero de operadora sai, mas sobram 12 dígitos: o número importado já vinha torto. O
    // normalizador NÃO adivinha qual dígito remover (apagar dado é pior que dado visível
    // torto), e é `telefoneCompleto` quem barra na validação.
    expect(normalizarTelefone("0379991251532")).toBe("379991251532");
    expect(telefoneCompleto("0379991251532")).toBe(false);
    // O corretor cola "fixo/celular" do contato: fica o primeiro, que é o que dá para discar.
    expect(normalizarTelefone("3793505-0441/3799909-8584")).toBe("37935050441");
  });

  it("normaliza CRECI sem inventar formato (cada conselho estadual escreve de um jeito)", () => {
    expect(normalizarCreci("  mg   12345 ")).toBe("MG 12345");
    expect(normalizarCreci("12345-f")).toBe("12345-F");
  });
});

describe("validação do corretor", () => {
  it("aceita um cadastro completo", () => {
    const r = validarCorretor({
      cpf: "529.982.247-25",
      creci: "mg 1234",
      email: "Ana@imob.com.br",
      nome: "  Ana   Maria Souza ",
      telefone: "(37) 99956-9096",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.cpf).toBe(CPF_OK);
      expect(r.dados.email).toBe("ana@imob.com.br");
      expect(r.dados.nome).toBe("Ana Maria Souza");
      expect(r.dados.creci).toBe("MG 1234");
    }
  });

  it("recusa CPF com dígito verificador errado (o wizard interno só checa o tamanho)", () => {
    const r = validarCorretor({
      cpf: "11111111111",
      email: "a@b.com",
      nome: "Ana Souza",
      telefone: "37999569096",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join(" ")).toMatch(/CPF/i);
  });

  it("recusa nome sem sobrenome: é o nome que sai impresso na CAD", () => {
    const r = validarCorretor({
      cpf: CPF_OK,
      email: "a@b.com",
      nome: "Ana",
      telefone: "37999569096",
    });
    expect(r.ok).toBe(false);
  });

  it("recusa telefone incompleto (soDigitos >= 10 aceitaria lixo)", () => {
    const r = validarCorretor({
      cpf: CPF_OK,
      email: "a@b.com",
      nome: "Ana Souza",
      telefone: "3799",
    });
    expect(r.ok).toBe(false);
  });

  it("CRECI é opcional: o cadastro passa sem ele", () => {
    const r = validarCorretor({
      cpf: CPF_OK,
      creci: "",
      email: "a@b.com",
      nome: "Ana Souza",
      telefone: "37999569096",
    });
    expect(r.ok).toBe(true);
  });

  it("junta todos os erros de uma vez, para o corretor não descobrir um por vez", () => {
    const r = validarCorretor({ cpf: "1", email: "x", nome: "A", telefone: "2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.length).toBe(4);
  });
});

describe("casamento corretor -> imobiliária", () => {
  const credenciada: VinculoCorretor = {
    imobiliariaAtiva: true,
    imobiliariaEntityId: "imob-1",
    imobiliariaNome: "Imob Alfa",
  };
  const descredenciada: VinculoCorretor = {
    imobiliariaAtiva: false,
    imobiliariaEntityId: "imob-2",
    imobiliariaNome: "Imob Beta",
  };

  it("sem vínculo nenhum: não entra", () => {
    expect(resolverVinculo([])).toEqual({ motivo: "sem-vinculo", ok: false });
  });

  it("só imobiliária descredenciada: não entra", () => {
    const r = resolverVinculo([descredenciada]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("descredenciada");
  });

  it("o mesmo CPF em duas imobiliárias: vale a CREDENCIADA, não a primeira da lista", () => {
    const r = resolverVinculo([descredenciada, credenciada]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vinculo.imobiliariaEntityId).toBe("imob-1");
  });

  it("existir na base não é estar credenciada", () => {
    expect(vinculosCredenciados([descredenciada])).toHaveLength(0);
  });
});

describe("filtro de empreendimento habilitado", () => {
  const ativos: EmpreendimentoPublico[] = [
    { code: "VDO", id: "10", logoUrl: null, name: "Vale do Ouro" },
    { code: "LBR", id: "20", logoUrl: null, name: "Lagoa Bonita" },
    { code: "AAA", id: "30", logoUrl: null, name: "Alfa" },
  ];

  it("mostra só a interseção entre credenciado e ativo", () => {
    const r = filtrarEmpreendimentosHabilitados(["10", "30"], ativos);
    expect(r.map((e) => e.id)).toEqual(["30", "10"]); // ordenado por nome pt-BR
  });

  it("credenciamento em empreendimento que saiu do ar não aparece", () => {
    expect(filtrarEmpreendimentosHabilitados(["99"], ativos)).toHaveLength(0);
  });

  it("sem credenciamento nenhum: lista vazia, e não a lista global", () => {
    expect(filtrarEmpreendimentosHabilitados([], ativos)).toHaveLength(0);
  });

  it("compara como texto: id numérico do C2X não pode escapar por tipo", () => {
    const r = filtrarEmpreendimentosHabilitados([10 as unknown as string], ativos);
    expect(r.map((e) => e.id)).toEqual(["10"]);
  });

  it("ignora entradas vazias vindas de metadata sem enterpriseId", () => {
    expect(filtrarEmpreendimentosHabilitados(["", "20"], ativos).map((e) => e.id)).toEqual(["20"]);
  });
});

describe("máquina de estados", () => {
  it("CPF conhecido com VÁRIOS empreendimentos vai para a escolha", () => {
    expect(proximoEstado("identificar", { empreendimentos: 3, tipo: "cpf-conhecido" })).toBe(
      "empreendimento",
    );
  });

  it("CPF conhecido com UM empreendimento PULA a escolha (regra do Lucas)", () => {
    expect(proximoEstado("identificar", { empreendimentos: 1, tipo: "cpf-conhecido" })).toBe("cad");
  });

  it("CPF novo abre o cadastro, não manda o corretor embora", () => {
    expect(proximoEstado("identificar", { tipo: "cpf-novo" })).toBe("cnpj");
  });

  it("CNPJ recusado é terminal na central", () => {
    expect(proximoEstado("cnpj", { tipo: "cnpj-recusado" })).toBe("central");
  });

  it("percorre o auto-cadastro inteiro até a CAD com um empreendimento só", () => {
    let estado: EstadoCad = "identificar";
    estado = proximoEstado(estado, { tipo: "cpf-novo" });
    expect(estado).toBe("cnpj");
    estado = proximoEstado(estado, { tipo: "cnpj-ok" });
    expect(estado).toBe("dados");
    estado = proximoEstado(estado, { tipo: "dados-ok" });
    expect(estado).toBe("creci");
    estado = proximoEstado(estado, { tipo: "creci-ok" });
    expect(estado).toBe("confirmar");
    estado = proximoEstado(estado, { empreendimentos: 1, tipo: "cadastrado" });
    expect(estado).toBe("cad");
    estado = proximoEstado(estado, { tipo: "cad-pronta" });
    expect(estado).toBe("enviando");
    estado = proximoEstado(estado, { tipo: "enviada" });
    expect(estado).toBe("sucesso");
  });

  it("zero empreendimentos habilitados cai na central de qualquer estado", () => {
    expect(proximoEstado("confirmar", { tipo: "sem-empreendimento" })).toBe("central");
    expect(proximoEstado("identificar", { tipo: "sem-empreendimento" })).toBe("central");
  });

  it("evento fora de ordem não move a máquina", () => {
    expect(proximoEstado("identificar", { tipo: "cnpj-ok" })).toBe("identificar");
    expect(proximoEstado("dados", { tipo: "enviada" })).toBe("dados");
  });

  it("sucesso e central são terminais: não voltam sozinhos", () => {
    expect(proximoEstado("sucesso", { tipo: "voltar" })).toBe("sucesso");
    expect(proximoEstado("central", { tipo: "voltar" })).toBe("central");
  });

  it("voltar desfaz um passo do cadastro", () => {
    expect(proximoEstado("creci", { tipo: "voltar" })).toBe("dados");
    expect(proximoEstado("dados", { tipo: "voltar" })).toBe("cnpj");
  });
});

describe("progresso", () => {
  it("cresce ao longo do cadastro e satura no fim", () => {
    expect(progresso("identificar").passo).toBe(1);
    expect(progresso("cad").passo).toBe(7);
    const fim = progresso("sucesso");
    expect(fim.passo).toBe(fim.total);
  });
});

describe("protocolo", () => {
  it("aceita o código gerado no servidor", () => {
    expect(protocoloDaAutenticacao("CAD-2026-AB12CD34")).toBe("CAD-2026-AB12CD34");
  });

  it("recusa código forjado fora do formato", () => {
    expect(protocoloDaAutenticacao("qualquer coisa")).toBe("");
    expect(protocoloDaAutenticacao(null)).toBe("");
  });
});

describe("CPFs distintos não colidem", () => {
  it("dois CPFs válidos normalizam para valores diferentes", () => {
    expect(normalizarCpf(CPF_OK)).not.toBe(normalizarCpf(CPF_OK_2));
  });
});
