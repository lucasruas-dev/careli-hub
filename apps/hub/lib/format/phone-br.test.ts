import { describe, expect, it } from "vitest";

import { formatarTelefoneBR, soDigitosTelefone, telefoneCompleto } from "./phone-br";

// Formatos REAIS que vieram nas CADs do Asana. Cada um destes está no banco hoje.
describe("formatarTelefoneBR", () => {
  it("formata celular e fixo no padrão do Apolo", () => {
    expect(formatarTelefoneBR("37999569096")).toBe("(37) 99956-9096");
    expect(formatarTelefoneBR("3732311234")).toBe("(37) 3231-1234");
  });

  it("aceita o que já veio formatado, sem duplicar máscara", () => {
    expect(formatarTelefoneBR("(37) 99956-9096")).toBe("(37) 99956-9096");
    expect(formatarTelefoneBR("(37)998256365")).toBe("(37) 99825-6365");
  });

  it("tira o +55 do começo", () => {
    expect(formatarTelefoneBR("+55 37 99860-2317")).toBe("(37) 99860-2317");
    expect(formatarTelefoneBR("5537998602317")).toBe("(37) 99860-2317");
  });

  // ⚠️ "5537..." com 11 dígitos é número de Minas (DDD 55 não existe, mas o corte cego
  // transformaria (55) 37999-5690 em (37) 99956-90). Só tira o 55 quando sobra tamanho válido.
  it("não mutila número que começa com 55 e já tem tamanho nacional", () => {
    expect(soDigitosTelefone("55379995690")).toBe("55379995690");
  });

  it("tira o zero de operadora", () => {
    expect(formatarTelefoneBR("0379991251532")).toBe("(37) 99912-5153");
  });

  // Campo com dois telefones: fica o primeiro. Guardar os dois juntos não disca nem no
  // WhatsApp nem em ligação.
  it("fica com o primeiro quando vêm dois no mesmo campo", () => {
    expect(formatarTelefoneBR("3793505-0441/3799909-8584")).toBe("(37) 93505-0441");
  });

  it("vai formatando enquanto digita, sem apagar o que a pessoa escreveu", () => {
    expect(formatarTelefoneBR("3")).toBe("(3");
    expect(formatarTelefoneBR("37")).toBe("(37");
    expect(formatarTelefoneBR("37999")).toBe("(37) 999");
    expect(formatarTelefoneBR("379995690")).toBe("(37) 9995-690");
  });

  it("não quebra com vazio nem com texto", () => {
    expect(formatarTelefoneBR("")).toBe("");
    expect(formatarTelefoneBR("não tem")).toBe("");
  });
});

describe("telefoneCompleto", () => {
  it("aceita fixo e celular; recusa o resto", () => {
    expect(telefoneCompleto("(37) 99956-9096")).toBe(true);
    expect(telefoneCompleto("3732311234")).toBe(true);
    expect(telefoneCompleto("37999")).toBe(false);
    expect(telefoneCompleto("")).toBe(false);
  });
});
