import { describe, expect, it } from "vitest";

import { expandirCamposComCaminho } from "./campos-aninhados";

const CADASTRO = {
  nomeFantasia: "Imob Teste",
  socios: [
    { cpf: "111", nome: "FERNANDO SILVA", representanteLegal: true, telefone: "(31) 3852-3113" },
    { cpf: "222", endereco: { cep: "35500-000", cidade: "Divinópolis" }, nome: "ANA" },
  ],
};

describe("expandirCamposComCaminho", () => {
  it("troca o telefone do representante sem tocar no resto do sócio", () => {
    const saida = expandirCamposComCaminho(
      { "socios.0.telefone": "(31) 97250-6566" },
      CADASTRO,
    );

    expect(saida["socios.0.telefone"]).toBeUndefined();
    const socios = saida.socios as Record<string, unknown>[];
    expect(socios[0]).toEqual({
      cpf: "111",
      nome: "FERNANDO SILVA",
      representanteLegal: true,
      telefone: "(31) 97250-6566",
    });
  });

  it("acumula VÁRIOS campos do mesmo sócio", () => {
    const saida = expandirCamposComCaminho(
      { "socios.0.nome": "Fernando Silva", "socios.0.telefone": "(31) 97250-6566" },
      CADASTRO,
    );

    const socios = saida.socios as Record<string, unknown>[];
    // o segundo campo não pode recomeçar do original e apagar o primeiro
    expect(socios[0]?.nome).toBe("Fernando Silva");
    expect(socios[0]?.telefone).toBe("(31) 97250-6566");
  });

  it("acumula campos de sócios DIFERENTES no mesmo array", () => {
    const saida = expandirCamposComCaminho(
      { "socios.0.telefone": "A", "socios.1.telefone": "B" },
      CADASTRO,
    );

    const socios = saida.socios as Record<string, unknown>[];
    expect(socios[0]?.telefone).toBe("A");
    expect(socios[1]?.telefone).toBe("B");
    expect(socios).toHaveLength(2);
  });

  it("grava no endereço do sócio preservando o que já estava lá", () => {
    const saida = expandirCamposComCaminho({ "socios.1.endereco.numero": "480" }, CADASTRO);

    const socios = saida.socios as Record<string, unknown>[];
    expect(socios[1]?.endereco).toEqual({
      cep: "35500-000",
      cidade: "Divinópolis",
      numero: "480",
    });
  });

  it("cria o endereço quando o sócio ainda não tem", () => {
    const saida = expandirCamposComCaminho({ "socios.0.endereco.cep": "35500-000" }, CADASTRO);

    const socios = saida.socios as Record<string, unknown>[];
    expect(socios[0]?.endereco).toEqual({ cep: "35500-000" });
  });

  it("não altera o cadastro original (o array vem clonado)", () => {
    expandirCamposComCaminho({ "socios.0.telefone": "novo" }, CADASTRO);

    expect(CADASTRO.socios[0]?.telefone).toBe("(31) 3852-3113");
  });

  it("deixa as chaves planas passarem intactas", () => {
    const saida = expandirCamposComCaminho({ nomeFantasia: "Outro" }, CADASTRO);

    expect(saida).toEqual({ nomeFantasia: "Outro" });
  });

  it("ignora caminho para índice que não existe, em vez de inventar sócio", () => {
    const saida = expandirCamposComCaminho({ "socios.9.telefone": "x" }, CADASTRO);

    // some a chave (senão viraria um campo literal "socios.9.telefone" no cadastro) e o array
    // nem é reescrito, porque não há nada legítimo para gravar
    expect(saida["socios.9.telefone"]).toBeUndefined();
    expect(saida.socios).toBeUndefined();
  });

  it("ignora caminho cuja raiz não é array (não estraga o campo plano)", () => {
    const saida = expandirCamposComCaminho({ "nomeFantasia.0.x": "y" }, CADASTRO);

    expect(saida["nomeFantasia.0.x"]).toBe("y");
    expect(saida.nomeFantasia).toBeUndefined();
  });
});
