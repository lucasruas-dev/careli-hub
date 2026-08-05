import { describe, expect, it } from "vitest";

import { derivarUnidades } from "./acao-resposta";

// Os botões do template do convite são fixos: "1 unidade" / "2 a 3" / "acima de 3". A resposta do
// cliente chega como o TEXTO do botão (message.button.text) e precisa virar a opção de unidades.
describe("derivarUnidades", () => {
  it("mapeia os três botões do convite", () => {
    expect(derivarUnidades("1 unidade")).toBe("1");
    expect(derivarUnidades("2 a 3")).toBe("2_3");
    expect(derivarUnidades("acima de 3")).toBe("acima_3");
  });

  it("tolera caixa, acento e espaços da Meta", () => {
    expect(derivarUnidades("  1 UNIDADE ")).toBe("1");
    expect(derivarUnidades("Acima de 3")).toBe("acima_3");
    expect(derivarUnidades("2-3")).toBe("2_3");
    expect(derivarUnidades("2 a 3 unidades")).toBe("2_3");
  });

  it("devolve null quando o texto não é um dos botões", () => {
    expect(derivarUnidades("quero falar com um corretor")).toBeNull();
    expect(derivarUnidades("")).toBeNull();
    expect(derivarUnidades("obrigado")).toBeNull();
  });
});
