import { describe, expect, it } from "vitest";

import { telefonePadrao, telefoneUtilizavel } from "./telefone-padrao";

describe("telefonePadrao", () => {
  // ⚠️ O CASO CARO: DDD mais OITO dígitos é o formato antigo. Sem o nono, a Meta responde 131026
  // e a pessoa não recebe nada — com o erro parecendo "esse número não tem WhatsApp".
  it("insere o nono dígito nos celulares antigos", () => {
    expect(telefonePadrao("37 9905-3938")).toBe("(37) 99905-3938");
    expect(telefonePadrao("+55 37 9912-3556")).toBe("(37) 99912-3556");
    expect(telefonePadrao("31 8822-3571")).toBe("(31) 98822-3571");
    expect(telefonePadrao("3162998662")).toBe("(31) 96299-8662");
  });

  it("mantém quem já tem o nono", () => {
    expect(telefonePadrao("62998662052")).toBe("(62) 99866-2052");
    expect(telefonePadrao("37 99109-7380")).toBe("(37) 99109-7380");
    expect(telefonePadrao("+55 31 98350-7431")).toBe("(31) 98350-7431");
  });

  // ⚠️ FIXO COMEÇA COM 2-5 E NÃO LEVA NONO. Um 9 aqui produz número que não existe.
  it("não mexe em telefone fixo", () => {
    expect(telefonePadrao("37 3521-4400")).toBe("(37) 3521-4400");
    expect(telefonePadrao("11 2345-6789")).toBe("(11) 2345-6789");
  });

  it("aceita o DDI e o descarta", () => {
    expect(telefonePadrao("5537999053938")).toBe("(37) 99905-3938");
    expect(telefonePadrao("55 37 9905-3938")).toBe("(37) 99905-3938");
  });

  // ⚠️ E-MAIL NÃO VIRA TELEFONE: passado por replace(/\D/g) produziria dígitos plausíveis, que
  // seriam o número de outra pessoa.
  it("devolve e-mail intacto", () => {
    expect(telefonePadrao("financeiro02@elmig.com.br")).toBe("financeiro02@elmig.com.br");
  });

  it("devolve intacto o que não reconhece", () => {
    expect(telefonePadrao("não fazer")).toBe("não fazer");
    expect(telefonePadrao("123")).toBe("123");
    expect(telefonePadrao("")).toBeNull();
    expect(telefonePadrao(null)).toBeNull();
  });

  it("é idempotente: aplicar duas vezes não muda", () => {
    for (const t of ["37 9905-3938", "62998662052", "37 3521-4400", "+55 31 98350-7431"]) {
      const uma = telefonePadrao(t);
      expect(telefonePadrao(uma)).toBe(uma);
    }
  });
});

describe("telefoneUtilizavel", () => {
  it("só aceita celular com o nono dígito", () => {
    expect(telefoneUtilizavel("37 9905-3938")).toBe(true);
    expect(telefoneUtilizavel("62998662052")).toBe(true);
    expect(telefoneUtilizavel("37 3521-4400")).toBe(false);
    expect(telefoneUtilizavel("financeiro02@elmig.com.br")).toBe(false);
    expect(telefoneUtilizavel(null)).toBe(false);
  });
});
