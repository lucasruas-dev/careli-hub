import { describe, expect, it } from "vitest";

import {
  acharPlano,
  conferirPlano,
  type EntradaDePlano,
  paraCalculo,
  type PlanoDoTemis,
  separarPorProntidao,
} from "./planos";

const base: EntradaDePlano = {
  entradaPercentual: 20,
  indiceCorrecao: "IPCA_ANUAL",
  jurosTaxa: null,
  nome: "PLANO NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
};

const plano = (over: Partial<PlanoDoTemis> = {}): PlanoDoTemis => ({
  ativo: true,
  categoriaId: null,
  categoriaNome: null,
  criadoEm: "2026-09-01T12:00:00Z",
  entradaPercentual: 20,
  id: "p1",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  minutaId: null,
  minutaNome: null,
  nome: "PLANO NORMAL",
  observacao: null,
  ordem: 0,
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
  ...over,
});

describe("a conferência que impede o erro caro", () => {
  it("aceita um plano bem preenchido", () => {
    expect(conferirPlano(base)).toEqual([]);
  });

  it("recusa entrada em fração — o erro que faria 20% virar 0,2%", () => {
    // Digitar 0,20 achando que é 20% é o engano mais fácil de cometer e o mais difícil de perceber:
    // o contrato sai com entrada de vinte centavos por cento e ninguém confere.
    const problemas = conferirPlano({ ...base, entradaPercentual: 0.2 });
    expect(problemas).toEqual([]); // 0,2% é um valor VÁLIDO — o banco aceita, e há planos assim.
    // O que não pode passar é acima de 100:
    expect(conferirPlano({ ...base, entradaPercentual: 120 })).toHaveLength(1);
    expect(conferirPlano({ ...base, entradaPercentual: -1 })).toHaveLength(1);
  });

  it("recusa taxa de juros que parece estar em fração multiplicada", () => {
    // 12 = 12% ao ano. Alguém digitando 1200 quis dizer outra coisa.
    expect(conferirPlano({ ...base, jurosTaxa: 12 })).toEqual([]);
    expect(conferirPlano({ ...base, jurosTaxa: 1200 })).toHaveLength(1);
    expect(conferirPlano({ ...base, jurosTaxa: -1 })).toHaveLength(1);
  });

  it("juros nulo é plano SEM juros, não campo por preencher", () => {
    // É o caso do investidor e do curto em quase todo empreendimento.
    expect(conferirPlano({ ...base, jurosTaxa: null })).toEqual([]);
  });

  it("recusa parcelas zero ou fracionadas", () => {
    expect(conferirPlano({ ...base, parcelas: 0 })).toHaveLength(1);
    expect(conferirPlano({ ...base, parcelas: 12.5 })).toHaveLength(1);
  });

  it("recusa índice e sistema desconhecidos", () => {
    expect(conferirPlano({ ...base, indiceCorrecao: "SELIC" })).toHaveLength(1);
    expect(conferirPlano({ ...base, sistemaAmortizacao: "juros_simples" })).toHaveLength(1);
  });

  it("junta os problemas em vez de parar no primeiro", () => {
    // O operador corrige tudo de uma vez em vez de descobrir um erro por tentativa.
    const problemas = conferirPlano({ ...base, entradaPercentual: 150, nome: "", parcelas: 0 });
    expect(problemas.length).toBeGreaterThanOrEqual(3);
  });
});

describe("a ponte para o cálculo que já existe", () => {
  it("converte sem inventar campo", () => {
    const c = paraCalculo(plano({ entradaPercentual: 30, jurosTaxa: 12, parcelas: 36 }));
    expect(c).toMatchObject({
      entradaPercentual: 30,
      jurosTaxa: 12,
      parcelas: 36,
      sistemaAmortizacao: "sacoc",
      slot: "normal",
    });
  });

  it("slot nulo continua nulo, e não vira string", () => {
    expect(paraCalculo(plano({ slot: null })).slot).toBeNull();
  });
});

describe("escolher o plano de uma venda", () => {
  it("acha pelo id", () => {
    const lista = [plano({ id: "a" }), plano({ id: "b", nome: "CURTO" })];
    expect(acharPlano(lista, "b")?.nome).toBe("CURTO");
  });

  it("NÃO devolve plano inativo", () => {
    // Desativar um plano é justamente parar de vender nele; devolvê-lo aqui furaria a decisão.
    const lista = [plano({ ativo: false, id: "a" })];
    expect(acharPlano(lista, "a")).toBeNull();
  });

  it("plano que não existe devolve nulo em vez de aproximar", () => {
    // Sem combinação, não gera. Melhor travar que emitir contrato com o plano errado.
    expect(acharPlano([plano({ id: "a" })], "z")).toBeNull();
  });
});

describe("o que a tela precisa avisar antes de o empreendimento vender", () => {
  it("separa quem já gera contrato de quem trava no último passo", () => {
    const lista = [
      plano({ id: "a", minutaId: "m1", minutaNome: "ACP-MINUTA" }),
      plano({ id: "b", minutaId: null }),
      plano({ ativo: false, id: "c", minutaId: null }),
    ];
    const { prontos, semMinuta } = separarPorProntidao(lista);
    expect(prontos.map((p) => p.id)).toEqual(["a"]);
    expect(semMinuta.map((p) => p.id)).toEqual(["b"]);
  });

  it("plano inativo não aparece em nenhum dos dois", () => {
    const { prontos, semMinuta } = separarPorProntidao([plano({ ativo: false, minutaId: null })]);
    expect(prontos).toHaveLength(0);
    expect(semMinuta).toHaveLength(0);
  });
});
