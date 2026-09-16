import { describe, expect, it } from "vitest";

import {
  comoSeHerdou,
  itensDoMenorRecorte,
  type ItemComDono,
} from "./recorte-da-unidade";

// Um plano de mentira, com só o que a régua olha.
type Plano = ItemComDono & { nome: string };

const plano = (nome: string, enterpriseId: null | string, categoriaId?: null | string): Plano => ({
  categoriaId: categoriaId ?? null,
  enterpriseId,
  nome,
});

// Os ids são os REAIS da Lagoa Bonita: pai 31, filhos LBF 33, LBP 32, LBR 27.
const PAI = "31";
const LBF = "33";
const LBP = "32";
const CONDOMINIO = "cat-condominio";
const LOTEAMENTO = "cat-loteamento";

const loteDoLBF = { categoriaId: null, enterpriseId: LBF, paiEnterpriseId: PAI };
const loteDoLBP = { categoriaId: null, enterpriseId: LBP, paiEnterpriseId: PAI };

describe("só no pai, vale para todos os filhos", () => {
  // ⚠️ É A FRASE DO LUCAS, VIRADA EM TESTE: *"se eu cadastrar os planos somente no pai, prevalece
  // em todas categorias (se tiver) em todos os filhos"*.
  const doPai = [plano("Normal", PAI), plano("Curto", PAI)];

  it("o filho sem plano herda o do pai", () => {
    const r = itensDoMenorRecorte(loteDoLBF, doPai);
    expect(r.itens.map((p) => p.nome)).toEqual(["Normal", "Curto"]);
    expect(r.origem).toBe("pai");
  });

  it("vale igual para o outro filho", () => {
    expect(itensDoMenorRecorte(loteDoLBP, doPai).origem).toBe("pai");
  });

  it("e vale também quando a unidade TEM categoria, se a categoria não tiver plano", () => {
    const r = itensDoMenorRecorte({ ...loteDoLBF, categoriaId: CONDOMINIO }, doPai);
    expect(r.origem).toBe("pai");
    expect(r.itens).toHaveLength(2);
  });
});

describe("o filho ganha do pai", () => {
  const planos = [plano("Normal do pai", PAI), plano("Normal do LBF", LBF)];

  it("o lote do LBF usa o do LBF", () => {
    const r = itensDoMenorRecorte(loteDoLBF, planos);
    expect(r.itens.map((p) => p.nome)).toEqual(["Normal do LBF"]);
    expect(r.origem).toBe("filho");
  });

  // ⚠️ O DEGRAU FECHA A QUESTÃO: o pai não entra nem para completar a lista do filho. Juntar os
  // dois é o que faz o Vale do Ouro mostrar seis planos onde existem três.
  it("e o do pai NÃO entra junto", () => {
    expect(itensDoMenorRecorte(loteDoLBF, planos).itens).toHaveLength(1);
  });

  it("mas o irmão que não tem plano próprio continua herdando do pai", () => {
    expect(itensDoMenorRecorte(loteDoLBP, planos).origem).toBe("pai");
  });
});

describe("a categoria ganha de todos", () => {
  const planos = [
    plano("Normal do pai", PAI),
    plano("Normal do LBF", LBF),
    plano("Condomínio 120x", PAI, CONDOMINIO),
  ];

  it("o lote do LBF que é Condomínio usa o plano da categoria", () => {
    const r = itensDoMenorRecorte({ ...loteDoLBF, categoriaId: CONDOMINIO }, planos);
    expect(r.itens.map((p) => p.nome)).toEqual(["Condomínio 120x"]);
    expect(r.origem).toBe("categoria");
  });

  // ⚠️ A CATEGORIA ATRAVESSA OS FILHOS. Ela é cadastrada no PAI e cobre lote de qualquer gleba:
  // medido, "Condomínio" cobre 186 lotes do LBR, 125 do LBP e 39 do LBF.
  it("e vale para o lote de outro filho, com a mesma categoria", () => {
    const r = itensDoMenorRecorte({ ...loteDoLBP, categoriaId: CONDOMINIO }, planos);
    expect(r.origem).toBe("categoria");
  });

  it("lote de OUTRA categoria não pega o plano dessa", () => {
    const r = itensDoMenorRecorte({ ...loteDoLBF, categoriaId: LOTEAMENTO }, planos);
    expect(r.itens.map((p) => p.nome)).toEqual(["Normal do LBF"]);
    expect(r.origem).toBe("filho");
  });
});

describe("plano de categoria NÃO vaza para quem não é da categoria", () => {
  // ⚠️ O VAZAMENTO QUE ESTA RÉGUA EXISTE PARA IMPEDIR. Hoje `lerPlanosDoPanteon` nem traz a coluna
  // `categoria_id`: o primeiro plano de categoria cadastrado entraria na lista de TODOS os lotes.
  const planos = [plano("Só do Condomínio", PAI, CONDOMINIO)];

  it("unidade sem categoria não enxerga plano de categoria", () => {
    const r = itensDoMenorRecorte(loteDoLBF, planos);
    expect(r.itens).toEqual([]);
    expect(r.origem).toBeNull();
  });

  it("nem no degrau do pai", () => {
    expect(itensDoMenorRecorte({ ...loteDoLBF, enterpriseId: PAI }, planos).itens).toEqual([]);
  });
});

describe("nada cadastrado", () => {
  it("devolve vazio e origem nula — é cadastro por fazer, não erro", () => {
    const r = itensDoMenorRecorte(loteDoLBF, []);
    expect(r.itens).toEqual([]);
    expect(r.origem).toBeNull();
  });

  it("plano de outro produto não entra", () => {
    // O LBP (32) não é nem o filho nem o pai deste lote.
    expect(itensDoMenorRecorte(loteDoLBF, [plano("De outro", LBP)]).itens).toEqual([]);
  });
});

describe("produto sem divisão", () => {
  // ⚠️ O PAI SÓ ENTRA QUANDO É OUTRO EMPREENDIMENTO. Sem isto, um produto simples devolveria
  // origem "pai" para o plano dele mesmo — e isso iria parar no registro da venda.
  const recanto = { categoriaId: null, enterpriseId: "20", paiEnterpriseId: "20" };

  it("o plano do próprio produto é do FILHO, não herdado", () => {
    const r = itensDoMenorRecorte(recanto, [plano("Normal", "20")]);
    expect(r.origem).toBe("filho");
  });

  it("e sem pai declarado funciona igual", () => {
    const r = itensDoMenorRecorte(
      { categoriaId: null, enterpriseId: "20", paiEnterpriseId: null },
      [plano("Normal", "20")],
    );
    expect(r.origem).toBe("filho");
  });
});

describe("as bordas do dado", () => {
  it("ids com espaço continuam casando", () => {
    const r = itensDoMenorRecorte(
      { categoriaId: null, enterpriseId: " 33 ", paiEnterpriseId: PAI },
      [plano("Do LBF", "33")],
    );
    expect(r.origem).toBe("filho");
  });

  it("id vazio não casa com id vazio", () => {
    // Dois nulos não são "o mesmo dono": seriam todos os planos órfãos de uma vez.
    const r = itensDoMenorRecorte(
      { categoriaId: null, enterpriseId: null, paiEnterpriseId: null },
      [plano("Órfão", null)],
    );
    expect(r.itens).toEqual([]);
  });

  it("categoria vazia é tratada como sem categoria", () => {
    const r = itensDoMenorRecorte(
      { categoriaId: "  ", enterpriseId: LBF, paiEnterpriseId: PAI },
      [plano("Do LBF", LBF)],
    );
    expect(r.origem).toBe("filho");
  });
});

describe("comoSeHerdou", () => {
  it("diz de onde veio, para a tela não mentir por omissão", () => {
    expect(comoSeHerdou("categoria")).toContain("categoria");
    expect(comoSeHerdou("filho")).toContain("empreendimento desta unidade");
    expect(comoSeHerdou("pai")).toContain("herdado");
    expect(comoSeHerdou(null)).toBe("nada cadastrado");
  });
});
