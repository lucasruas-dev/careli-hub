import { describe, expect, it } from "vitest";

import { cadastroEfetivo } from "./cadastro-efetivo";

describe("cadastroEfetivo", () => {
  it("a correção humana ganha do cadastro importado", () => {
    const c = cadastroEfetivo({
      cadastro: { creci: "123", telefone: "(31) 99496-2518" },
      cadastroEditado: { telefone: "(31) 97311-9741" },
    });

    expect(c.telefone).toBe("(31) 97311-9741");
    // o que não foi editado continua vindo da camada de baixo
    expect(c.creci).toBe("123");
  });

  it("troca o array de socios inteiro quando ele foi editado", () => {
    // O caso real: telefone do representante corrigido na tela e o disparo tem que enxergar.
    const c = cadastroEfetivo({
      cadastro: { socios: [{ nome: "BEATRIZ", representanteLegal: true, telefone: "(31) 994962518" }] },
      cadastroEditado: {
        socios: [{ nome: "BEATRIZ", representanteLegal: true, telefone: "(31) 97311-9741" }],
      },
    });

    const socios = c.socios as { telefone: string }[];
    expect(socios[0]?.telefone).toBe("(31) 97311-9741");
  });

  it("sem edição, devolve o cadastro como está", () => {
    const c = cadastroEfetivo({ cadastro: { telefone: "(31) 3852-3113" } });

    expect(c).toEqual({ telefone: "(31) 3852-3113" });
  });

  it("aguenta metadata nulo, vazio ou com tipo errado sem estourar", () => {
    expect(cadastroEfetivo(null)).toEqual({});
    expect(cadastroEfetivo({})).toEqual({});
    expect(cadastroEfetivo({ cadastro: "texto solto" })).toEqual({});
    expect(cadastroEfetivo({ cadastro: ["lista"], cadastroEditado: null })).toEqual({});
  });
});
