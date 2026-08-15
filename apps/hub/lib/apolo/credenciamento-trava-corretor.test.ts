import { describe, expect, it } from "vitest";

import {
  chaveDoCorretor,
  conflitosDeCorretor,
  explicarConflitos,
  type VinculoDeCorretor,
} from "./credenciamento-trava-corretor";

const vinculo = (
  chave: string,
  enterpriseId: string,
  imobiliariaId: string,
  imobiliariaNome: string,
  nome = "Fulano",
): VinculoDeCorretor => ({ chave, enterpriseId, imobiliariaId, imobiliariaNome, nome });

describe("trava do corretor", () => {
  it("acusa o corretor que já trabalha o MESMO empreendimento por outra imobiliária", () => {
    const conflitos = conflitosDeCorretor({
      corretores: [{ cpf: "11144477735", nome: "João da Silva" }],
      empreendimentos: [{ enterpriseId: "35", label: "VALE DO OURO" }],
      imobiliariaId: "imob-nova",
      jaVinculados: [vinculo("11144477735", "35", "imob-antiga", "BELTRAO IMOVEIS")],
    });

    expect(conflitos).toHaveLength(1);
    expect(conflitos[0]).toMatchObject({
      corretor: "João da Silva",
      empreendimento: "VALE DO OURO",
      imobiliariaAtual: "BELTRAO IMOVEIS",
    });
  });

  it("NÃO acusa quando é outro empreendimento: isso é comum e legítimo", () => {
    const conflitos = conflitosDeCorretor({
      corretores: [{ cpf: "11144477735", nome: "João da Silva" }],
      empreendimentos: [{ enterpriseId: "40", label: "GARDEN" }],
      jaVinculados: [vinculo("11144477735", "35", "imob-antiga", "BELTRAO IMOVEIS")],
      imobiliariaId: "imob-nova",
    });

    expect(conflitos).toEqual([]);
  });

  it("não conflita consigo mesma: reenviar o próprio corretor é normal", () => {
    const conflitos = conflitosDeCorretor({
      corretores: [{ cpf: "11144477735", nome: "João" }],
      empreendimentos: [{ enterpriseId: "35", label: "VALE DO OURO" }],
      imobiliariaId: "imob-a",
      jaVinculados: [vinculo("11144477735", "35", "imob-a", "A MESMA")],
    });

    expect(conflitos).toEqual([]);
  });

  it("corretor em TRÊS imobiliárias vira UM conflito por empreendimento, não três", () => {
    const conflitos = conflitosDeCorretor({
      corretores: [{ cpf: "11144477735", nome: "João" }],
      empreendimentos: [{ enterpriseId: "35", label: "VALE DO OURO" }],
      imobiliariaId: "imob-nova",
      jaVinculados: [
        vinculo("11144477735", "35", "imob-1", "UMA"),
        vinculo("11144477735", "35", "imob-2", "OUTRA"),
        vinculo("11144477735", "35", "imob-3", "MAIS UMA"),
      ],
    });

    expect(conflitos).toHaveLength(1);
  });

  it("casa por CPF mesmo com máscara diferente", () => {
    expect(chaveDoCorretor({ cpf: "111.444.777-35" })).toBe("11144477735");
    expect(chaveDoCorretor({ cpf: "11144477735" })).toBe("11144477735");
  });

  it("sem CPF, casa por nome normalizado (acento e espaço não podem furar a trava)", () => {
    const conflitos = conflitosDeCorretor({
      corretores: [{ nome: "joão  da   SILVA" }],
      empreendimentos: [{ enterpriseId: "35", label: "VALE DO OURO" }],
      imobiliariaId: "imob-nova",
      jaVinculados: [
        vinculo(chaveDoCorretor({ nome: "JOAO DA SILVA" }), "35", "outra", "OUTRA IMOB"),
      ],
    });

    expect(conflitos).toHaveLength(1);
  });

  it("a explicação diz QUEM e ONDE, para dar o que fazer", () => {
    const texto = explicarConflitos([
      {
        corretor: "João da Silva",
        empreendimento: "VALE DO OURO",
        enterpriseId: "35",
        imobiliariaAtual: "BELTRAO IMOVEIS",
      },
    ]);

    expect(texto).toContain("João da Silva");
    expect(texto).toContain("VALE DO OURO");
    expect(texto).toContain("BELTRAO IMOVEIS");
  });

  it("sem conflito, não devolve texto", () => {
    expect(explicarConflitos([])).toBe("");
  });
});
