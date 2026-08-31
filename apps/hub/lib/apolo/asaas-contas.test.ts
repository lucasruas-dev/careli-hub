import { afterEach, describe, expect, it } from "vitest";

import {
  ambienteDaChave,
  chaveDaConta,
  contaDoEmpreendimento,
  estadoDaConta,
  rotuloDaConta,
} from "./asaas-contas";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe("cada conta lê a SUA variável", () => {
  it("garden não cai na chave da gurgel", () => {
    process.env.ASAAS_GURGEL_API_KEY = "$aact_prod_gurgel";
    delete process.env.ASAAS_GARDEN_API_KEY;
    expect(chaveDaConta("gurgel")).toBe("$aact_prod_gurgel");
    // ⚠️ O ponto do módulo: sem chave própria, o Garden NÃO emite — nunca herda a de outra
    // conta. Herdar faria o boleto sair no CNPJ errado e o dinheiro cair na conta errada.
    expect(chaveDaConta("garden")).toBeNull();
  });

  it("cada conta tem seu rótulo para a tela mostrar antes do clique", () => {
    expect(rotuloDaConta("garden")).toBe("Garden");
    expect(rotuloDaConta("gurgel")).toBe("Gurgel");
    expect(rotuloDaConta("careli")).toBe("Careli");
  });
});

describe("o ambiente sai do prefixo da chave", () => {
  it("reconhece produção e sandbox", () => {
    process.env.ASAAS_GARDEN_API_KEY = "$aact_prod_000abc";
    expect(ambienteDaChave("garden")).toBe("producao");
    process.env.ASAAS_GARDEN_API_KEY = "$aact_hmlg_000abc";
    expect(ambienteDaChave("garden")).toBe("sandbox");
  });

  it("chave fora do padrão é 'desconhecido', não 'produção'", () => {
    // Chutar produção faria a tela liberar a emissão de verdade com uma chave que ninguém sabe
    // de onde é. Na dúvida, ela avisa.
    process.env.ASAAS_GARDEN_API_KEY = "chave-antiga-sem-prefixo";
    expect(ambienteDaChave("garden")).toBe("desconhecido");
  });

  it("sem chave, não inventa ambiente", () => {
    delete process.env.ASAAS_GARDEN_API_KEY;
    expect(ambienteDaChave("garden")).toBe("desconhecido");
  });
});

describe("o estado que vai para a tela não carrega a chave", () => {
  it("diz se está configurada e de que ambiente é, e nada mais", () => {
    process.env.ASAAS_GARDEN_API_KEY = "$aact_prod_segredo";
    const e = estadoDaConta("garden");
    expect(e).toEqual({
      ambiente: "producao",
      configurada: true,
      conta: "garden",
      rotulo: "Garden",
      variavel: "ASAAS_GARDEN_API_KEY",
    });
    expect(JSON.stringify(e)).not.toContain("segredo");
  });
});

describe("empreendimento sem conta NÃO emite", () => {
  it("Garden aponta para a conta do Garden", () => {
    expect(contaDoEmpreendimento("Garden")).toBe("garden");
  });

  it("empreendimento desconhecido devolve null, e não uma conta padrão", () => {
    expect(contaDoEmpreendimento("Vale do Sol")).toBeNull();
    expect(contaDoEmpreendimento("")).toBeNull();
  });
});
