import { describe, expect, it } from "vitest";

import { PAIS_E_DIVISOES_DO_PANTEON_EM_25_09_2026 } from "@/lib/apolo/c2x-pelo-id.fixture";

import { type EmpreendimentoDoCadastro, idDeMercado, mesmoEmpreendimento } from "./esteira-cad";

// A RÉGUA DE MERCADO (`idDeMercado`) PELO ID DO C2X, E NÃO PELA SIGLA (PAN-124, 25/09/2026).
//
// "Excluído" e "espelho" eram decididos pela `codigo` do cadastro do Panteon contra as listas de
// siglas, e as divisões dos grupos eram achadas casando a sigla de `ENTERPRISE_GROUPS.codes` com a
// `codigo` do cadastro. A sigla muda quando alguém renomeia (no C2X ou no cadastro); o id do C2X
// não. Estes testes prendem as duas metades: com o cadastro de produção de 25/09/2026 a régua
// responde o mesmo de antes, e um renome de sigla não muda a resposta.

const CADASTRO: EmpreendimentoDoCadastro[] = [
  ...PAIS_E_DIVISOES_DO_PANTEON_EM_25_09_2026.map((linha) => ({ ...linha })),
  { c2xEnterpriseId: "19", codigo: "VDO", id: "s-vdo", nome: "Veredas do Ouro", paiId: null },
];

/** O cadastro com a sigla de UMA linha trocada (o id do C2X fica). */
function renomear(cadastro: EmpreendimentoDoCadastro[], c2x: string, codigo: string) {
  return cadastro.map((linha) => (linha.c2xEnterpriseId === c2x ? { ...linha, codigo } : linha));
}

describe("idDeMercado com o cadastro de 25/09/2026: a mesma resposta de antes", () => {
  it.each([
    ["37", "35"],
    ["36", "35"],
    ["41", "35"],
    ["35", "35"],
    ["group:Vale do Ouro", "35"],
    ["27", "group:Lagoa Bonita"],
    ["32", "group:Lagoa Bonita"],
    ["33", "group:Lagoa Bonita"],
    ["31", "group:Lagoa Bonita"],
    ["group:Lagoa Bonita", "group:Lagoa Bonita"],
    ["4", "group:Lavra do Ouro"],
    ["1", "group:Lavra do Ouro"],
    ["13", "group:Rio de Pedras"],
    ["14", "group:Rio de Pedras"],
    ["15", "group:Rio de Pedras"],
    ["7", "group:Portal dos Vales"],
    ["10", "group:Portal dos Vales"],
    ["43", "43"],
    ["19", "19"],
    ["9001", "9001"],
    ["999", "999"],
  ])("%s -> %s", (id, esperado) => {
    expect(idDeMercado(id, CADASTRO)).toBe(esperado);
  });

  it("vazio continua null", () => {
    expect(idDeMercado("", CADASTRO)).toBeNull();
  });
});

describe("idDeMercado não depende da sigla", () => {
  it("o ESPELHO renomeado continua sendo o espelho: as divisões do Vale do Ouro continuam indo ao 35", () => {
    // Pela sigla, o VLO com outra `codigo` deixava de ser espelho e a régua respondia
    // "group:Vale do Ouro": a CAD iria para um id em que o CAD público não grava.
    const renomeado = renomear(CADASTRO, "35", "VLX");
    for (const id of ["37", "36", "41", "group:Vale do Ouro"]) {
      expect(idDeMercado(id, renomeado)).toBe("35");
    }
  });

  it("as divisões de um grupo renomeadas continuam no grupo (Lavra do Ouro pelos ids 4 e 1)", () => {
    // Pela sigla, LOS e LOU com outra `codigo` sumiam do grupo, e o 4 voltava como "4".
    const renomeado = renomear(renomear(CADASTRO, "4", "LSX"), "1", "LUX");
    expect(idDeMercado("4", renomeado)).toBe("group:Lavra do Ouro");
    expect(idDeMercado("1", renomeado)).toBe("group:Lavra do Ouro");
    expect(mesmoEmpreendimento("4", "1", renomeado)).toBe(true);
  });

  it("o pai EXCLUÍDO renomeado continua excluído: o filho não sobe para ele", () => {
    // Um pai com o id do TSC (34, excluído) e um filho fora de qualquer grupo. Pela sigla, bastava
    // o pai mudar de `codigo` para o filho passar a morar num id que ninguém enxerga.
    const comPaiExcluido: EmpreendimentoDoCadastro[] = [
      ...CADASTRO,
      { c2xEnterpriseId: "34", codigo: "TSC", id: "pai-tsc", nome: "Teste", paiId: null },
      { c2xEnterpriseId: "45", codigo: "TSF", id: "f-tsf", nome: "Teste · filho", paiId: "pai-tsc" },
    ];
    expect(idDeMercado("45", comPaiExcluido)).toBe("45");
    expect(idDeMercado("45", renomear(comPaiExcluido, "34", "TSX"))).toBe("45");
  });

  it("um pai comum (não excluído, fora dos grupos) continua recebendo o filho, como antes", () => {
    const comPai: EmpreendimentoDoCadastro[] = [
      ...CADASTRO,
      { c2xEnterpriseId: "42", codigo: "ACP", id: "pai-acp", nome: "Aldeia", paiId: null },
      { c2xEnterpriseId: "30", codigo: "ACT", id: "f-act", nome: "Aldeia · termo", paiId: "pai-acp" },
    ];
    expect(idDeMercado("30", comPai)).toBe("42");
    // Pela sigla, um pai que ganhasse uma sigla da lista antiga ("LAG", que não casa com nada no C2X
    // desde 16/07/2026) passava a ser "excluído" e o filho deixava de subir. Pelo id, não.
    expect(idDeMercado("30", renomear(comPai, "42", "LAG"))).toBe("42");
  });
});
