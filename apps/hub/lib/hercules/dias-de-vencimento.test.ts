import { describe, expect, it } from "vitest";

import {
  conferirDiasDeVencimento,
  diasDoBanco,
  diasDoEmpreendimento,
  diasPorExtenso,
  empreendimentoDoCadastro,
  paiNoCadastro,
  primeiroDia,
} from "./dias-de-vencimento";

// OS DIAS DE VENCIMENTO POR EMPREENDIMENTO — a regra pura (Lucas, 02/10/2026).
//
// O Vale do Ouro é o exemplo porque é o produto dividido que a casa mais conhece: VLO (35) é o pai,
// VOC (37), VOL (36) e VOR (41) são os filhos. Os dias usados (5, 15, 25) são de propósito diferentes
// de 10 e 20: um teste que passasse com os dias de antes não provaria que a lista foi lida.

const VLO = "35";
const VOC = "37";

describe("os dias que valem para o empreendimento", () => {
  it("com cadastro no próprio empreendimento: os dele, na ordem", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: VLO }, [
      { dias: [25, 5, 15], enterpriseId: VOC },
    ]);
    expect(dias).toEqual({ cadastrado: true, dias: [5, 15, 25], origem: "filho" });
    expect(primeiroDia(dias)).toBe(5);
  });

  it("sem cadastro nenhum: 10 e 20, marcado como NÃO cadastrado (a proposta avisa)", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: VLO }, []);
    expect(dias).toEqual({ cadastrado: false, dias: [10, 20], origem: null });
    expect(primeiroDia(dias)).toBe(10);
  });

  it("linha que existe com a coluna nula também é 'sem cadastro', e não lista vazia", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: null }, [
      { dias: null, enterpriseId: VOC },
    ]);
    expect(dias.cadastrado).toBe(false);
    expect(dias.dias).toEqual([10, 20]);
  });

  it("o filho sem cadastro HERDA os dias do pai", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: VLO }, [
      { dias: [15], enterpriseId: VLO },
    ]);
    expect(dias).toEqual({ cadastrado: true, dias: [15], origem: "pai" });
  });

  it("o filho que cadastrou vence o pai, sem juntar as duas listas", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: VLO }, [
      { dias: [15, 25], enterpriseId: VLO },
      { dias: [5], enterpriseId: VOC },
    ]);
    expect(dias).toEqual({ cadastrado: true, dias: [5], origem: "filho" });
  });

  it("o cadastro de OUTRO empreendimento não vaza", () => {
    const dias = diasDoEmpreendimento({ enterpriseId: VOC, paiEnterpriseId: VLO }, [
      { dias: [5], enterpriseId: "36" },
    ]);
    expect(dias.cadastrado).toBe(false);
  });
});

describe("a conferência do cadastro", () => {
  it("aceita de 1 a 28 e ordena", () => {
    expect(conferirDiasDeVencimento([28, 1, 15])).toEqual({ dias: [1, 15, 28], ok: true });
  });

  it.each([0, 29, 30, 31, -5])("recusa o dia %i, fora de 1 a 28", (dia) => {
    const r = conferirDiasDeVencimento([10, dia]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain(`dia ${dia}`);
  });

  it("recusa dia repetido em vez de sumir com ele calado", () => {
    const r = conferirDiasDeVencimento([10, 20, 10]);
    expect(r).toEqual({ erro: "O dia 10 está repetido.", ok: false });
  });

  it.each([[10.5], ["10"], [true], [null]])("recusa o que não é inteiro (%j)", (valor) => {
    expect(conferirDiasDeVencimento([valor]).ok).toBe(false);
  });

  it("lista vazia e nulo são o mesmo pedido: voltar a herdar (nulo)", () => {
    expect(conferirDiasDeVencimento([])).toEqual({ dias: null, ok: true });
    expect(conferirDiasDeVencimento(null)).toEqual({ dias: null, ok: true });
  });

  it("o que não é lista é recusado", () => {
    expect(conferirDiasDeVencimento("10,20").ok).toBe(false);
    expect(conferirDiasDeVencimento(10).ok).toBe(false);
  });
});

describe("a leitura da coluna", () => {
  it("limpa o que veio torto do banco: fora da faixa, repetido, fora de ordem", () => {
    expect(diasDoBanco([20, 31, 10, 10, 0])).toEqual([10, 20]);
  });

  it("nada que preste vira nulo, e não lista vazia", () => {
    expect(diasDoBanco([31])).toBeNull();
    expect(diasDoBanco(null)).toBeNull();
    expect(diasDoBanco("x")).toBeNull();
  });
});

const CADASTRO = [
  { c2xEnterpriseId: VLO, codigo: "VLO", id: "u-vlo", paiId: null },
  { c2xEnterpriseId: VOC, codigo: "VOC", id: "u-voc", paiId: "u-vlo" },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "u-vol", paiId: "u-vlo" },
  { c2xEnterpriseId: "31", codigo: "LAB", id: "u-lab", paiId: null },
  { c2xEnterpriseId: "33", codigo: "LBF", id: "u-lbf", paiId: "u-lab" },
  { c2xEnterpriseId: "27", codigo: "LBR", id: "u-lbr", paiId: "u-lab" },
  { c2xEnterpriseId: null, codigo: "LOX", id: "u-lox", paiId: null },
  { c2xEnterpriseId: "4", codigo: "LOS", id: "u-los", paiId: "u-lox" },
];

describe("o pai no cadastro do Panteon", () => {
  it("o filho aponta o id do C2X do pai", () => {
    expect(paiNoCadastro(CADASTRO, VOC)).toBe(VLO);
  });

  it("o pai não tem pai", () => {
    expect(paiNoCadastro(CADASTRO, VLO)).toBeNull();
  });

  it("pai sem id do C2X (o LOX) é 'sem pai': não há configuração dele para herdar", () => {
    expect(paiNoCadastro(CADASTRO, "4")).toBeNull();
  });
});

describe("o agrupamento da lista do Apolo", () => {
  it("id de verdade passa direto", () => {
    expect(empreendimentoDoCadastro(CADASTRO, VLO, ["VOC", "VOL"])).toBe(VLO);
  });

  it("`group:` vira o pai comum das divisões", () => {
    expect(empreendimentoDoCadastro(CADASTRO, "group:Lagoa Bonita", ["LBF", "LBR"])).toBe("31");
  });

  it("divisões de pais diferentes, ou desconhecidas, não viram ninguém", () => {
    expect(empreendimentoDoCadastro(CADASTRO, "group:X", ["LBF", "VOC"])).toBeNull();
    expect(empreendimentoDoCadastro(CADASTRO, "group:X", ["LBF", "ZZZ"])).toBeNull();
    expect(empreendimentoDoCadastro(CADASTRO, "group:X", [])).toBeNull();
  });
});

describe("a frase curta", () => {
  it("um, dois e três dias", () => {
    expect(diasPorExtenso([5])).toBe("dia 5");
    expect(diasPorExtenso([10, 20])).toBe("dias 10 e 20");
    expect(diasPorExtenso([5, 10, 15])).toBe("dias 5, 10 e 15");
  });
});
