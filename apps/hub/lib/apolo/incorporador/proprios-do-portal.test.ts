import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { idsDosProprios, lidosDoPanteon, montarPropriosDoPortal } from "./proprios-do-portal";

// O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON, NA PEÇA COMUM ÀS ROTAS DA FICHA.
//
// ⚠️ O DEFEITO QUE ISTO TRAVA: a ficha do produto nascido no Panteon (o ZZ TESTE, id 9001) abria o
// Resumo e respondia "Nao encontrado." nas outras abas, porque só a rota /venda somava os próprios
// aos códigos do catálogo do C2X. A tradução é a mesma da /venda; o que se testa aqui é que ela
// continua SÓ tradução (nunca abre o que a sessão não traz) e o que acontece quando o cadastro cai.

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
  ...p,
});

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn" }),
  linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "tst" }),
  // Outro produto só do Panteon, de OUTRA sessão.
  linha({ c2xEnterpriseId: "9002", codigo: "OUT", id: "out" }),
];

// O catálogo do C2X conhece o VOC e o Garden; o 9001 e o 9002 não existem no legado.
const CATALOGO = [{ stageIds: ["37"] }, { stageIds: ["39"] }];

describe("montarPropriosDoPortal", () => {
  it("soma aos autorizados o produto do Panteon que a sessão já traz", () => {
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["VOC", "GDN"],
      idsDaSessao: ["37", "39", "9001"],
    });

    expect(r.proprios).toEqual([{ codigo: "TST", enterpriseId: "9001" }]);
    expect(r.codesComProprios).toEqual(["VOC", "GDN", "TST"]);
  });

  it("⚠️ não amplia: o produto do Panteon de outra sessão não entra", () => {
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["VOC"],
      idsDaSessao: ["37"],
    });

    expect(r.proprios).toEqual([]);
    expect(r.codesComProprios).toEqual(["VOC"]);
  });

  it("o que o C2X conhece não vira próprio (não duplica o código)", () => {
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["VOC", "GDN"],
      idsDaSessao: ["37", "39"],
    });

    expect(r.proprios).toEqual([]);
    expect(r.codesComProprios).toEqual(["VOC", "GDN"]);
  });

  it("sessão só com produto do Panteon: os códigos deixam de vir vazios (a rota não dá 503)", () => {
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: [],
      idsDaSessao: ["9001"],
    });

    expect(r.codesComProprios).toEqual(["TST"]);
  });

  it("⚠️ cadastro fora do ar DEGRADA para sem próprios, e avisa quem chama pelo `cadastro: null`", () => {
    const r = montarPropriosDoPortal({
      cadastro: null,
      catalogo: CATALOGO,
      codesAutorizados: ["VOC"],
      idsDaSessao: ["37", "9001"],
    });

    // O produto do C2X continua respondendo; o do Panteon fica sem tradução, e a rota responde 503
    // (e não 404) quando o pedido não sobra nada — ver as obrigações no arquivo.
    expect(r.cadastro).toBeNull();
    expect(r.proprios).toEqual([]);
    expect(r.codesComProprios).toEqual(["VOC"]);
  });

  it("⚠️ a trava do LAB: sessão com o 31 não ganha o espelho da Lagoa Bonita como produto próprio", () => {
    // O catálogo do C2X esconde o LAB (EXCLUDED_ENTERPRISE_CODES), e "não está no catálogo" não quer
    // dizer "só existe no Panteon".
    const r = montarPropriosDoPortal({
      cadastro: [...CADASTRO, linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab" })],
      catalogo: CATALOGO,
      codesAutorizados: ["VOC"],
      idsDaSessao: ["31", "37", "9001"],
    });

    expect(r.proprios).toEqual([{ codigo: "TST", enterpriseId: "9001" }]);
    expect(r.codesComProprios).toEqual(["VOC", "TST"]);
  });

  it("devolve o escopo expandido que recebeu, para a rota não ler duas vezes", () => {
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["VOC"],
      idsDaSessao: ["37", "9001"],
    });

    expect(r.idsDaSessao).toEqual(["37", "9001"]);
  });
});

describe("idsDosProprios", () => {
  const PROPRIOS = [
    { codigo: "TST", enterpriseId: "9001" },
    { codigo: "ZZZ", enterpriseId: "9003" },
  ];

  it("só os ids dos próprios cujo código está no recorte", () => {
    expect(idsDosProprios(PROPRIOS, ["VOC", "tst"])).toEqual(["9001"]);
  });

  it("recorte sem produto do Panteon não traz id nenhum", () => {
    expect(idsDosProprios(PROPRIOS, ["VOC", "GDN"])).toEqual([]);
    expect(idsDosProprios(PROPRIOS, [])).toEqual([]);
  });
});

describe("lidosDoPanteon", () => {
  // O Garden é da Cecílio (D2): tem dono marcado e o estoque dele passou a ser mantido no Panteon.
  const COM_DONO: LinhaDoCadastro[] = [
    linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", operadoPor: null }),
    linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", operadoPor: "inc-cecilio" }),
    linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "tst" }),
  ];
  const PROPRIOS = [{ codigo: "TST", enterpriseId: "9001" }];

  it("⚠️ o produto com dono do recorte é lido do Panteon, junto com os próprios", () => {
    expect(
      lidosDoPanteon({ cadastro: COM_DONO, codes: ["VOC", "GDN", "TST"], idsDaSessao: ["37", "39", "9001"], proprios: PROPRIOS }),
    ).toEqual([
      { codigo: "TST", enterpriseId: "9001" },
      { codigo: "GDN", enterpriseId: "39" },
    ]);
  });

  it("⚠️ o produto sem dono (VOC) continua no C2X", () => {
    expect(lidosDoPanteon({ cadastro: COM_DONO, codes: ["VOC"], idsDaSessao: ["37", "39"], proprios: [] })).toEqual([]);
  });

  it("⚠️ não amplia: código fora do pedido ou id fora da sessão não entra", () => {
    expect(lidosDoPanteon({ cadastro: COM_DONO, codes: ["VOC"], idsDaSessao: ["37", "39"], proprios: [] })).toEqual([]);
    expect(lidosDoPanteon({ cadastro: COM_DONO, codes: ["GDN"], idsDaSessao: ["37"], proprios: [] })).toEqual([]);
  });

  it("cadastro fora do ar (ou sem a 0170, dono nulo): sobra só o que já era próprio", () => {
    expect(lidosDoPanteon({ cadastro: null, codes: ["GDN", "TST"], idsDaSessao: ["39", "9001"], proprios: PROPRIOS })).toEqual(PROPRIOS);
    const sem0170 = COM_DONO.map((l) => ({ ...l, operadoPor: null }));
    expect(lidosDoPanteon({ cadastro: sem0170, codes: ["GDN"], idsDaSessao: ["39"], proprios: [] })).toEqual([]);
  });
});
