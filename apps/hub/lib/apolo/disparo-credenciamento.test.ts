import { describe, expect, it } from "vitest";

import { telefoneDaImobiliaria, telefoneParaEnvio } from "./disparo-credenciamento";

describe("telefoneDaImobiliaria", () => {
  it("prefere o representante legal ao contato da empresa", () => {
    // O contato da empresa costuma ser FIXO, e o WhatsApp não entrega em fixo.
    expect(
      telefoneDaImobiliaria(["(31) 99496-2518", "(31) 3852-3113"]),
    ).toBe("(31) 99496-2518");
  });

  it("cai no contato da empresa quando não há representante", () => {
    // O caso real das fichas vindas do C2X: elas não têm `socios[]` no cadastro, e o celular da
    // empresa é a única fonte. Sem este passo, 3 imobiliárias habilitadas em 16/08 não receberam
    // nada, tendo celular gravado o tempo todo.
    expect(telefoneDaImobiliaria([null, "(33) 98303-3877"])).toBe("(33) 98303-3877");
  });

  it("PULA STRING VAZIA, que é o que o `??` deixava passar", () => {
    // `normalizarTelefone(undefined)` devolve "", e `"" ?? x` continua "" — a origem do
    // "sem telefone" com o número cadastrado logo ali.
    expect(telefoneDaImobiliaria(["", "(31) 99212-5520"])).toBe("(31) 99212-5520");
    expect(telefoneDaImobiliaria(["   ", "31985104553"])).toBe("31985104553");
  });

  it("devolve null quando nenhuma fonte tem valor, em vez de string vazia", () => {
    expect(telefoneDaImobiliaria([])).toBeNull();
    expect(telefoneDaImobiliaria([null, undefined, "", "  "])).toBeNull();
  });
});

describe("telefoneParaEnvio", () => {
  it("acrescenta o DDI ao número nacional", () => {
    expect(telefoneParaEnvio("(31) 99212-5520")).toBe("5531992125520");
    expect(telefoneParaEnvio("3185104553")).toBe("553185104553");
  });

  it("mantém o número que já vem com DDI", () => {
    expect(telefoneParaEnvio("5531992125520")).toBe("5531992125520");
  });

  it("recusa o que não dá para entregar, em vez de mandar para o número errado", () => {
    expect(telefoneParaEnvio("")).toBeNull();
    expect(telefoneParaEnvio(null)).toBeNull();
    expect(telefoneParaEnvio("31 9999")).toBeNull();
  });
});
