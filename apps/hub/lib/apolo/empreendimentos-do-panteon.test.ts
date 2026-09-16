import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { linhasDoPanteonParaApolo } from "./empreendimentos-do-panteon";

// APOLO > EMPREENDIMENTOS E O PRODUTO QUE NASCEU NO PANTEON (achado 27 da onda 2).
//
// ⚠️ O DEFEITO TRAVADO AQUI: o prédio criado no Panteon (id a partir de 100000) não aparecia na lista
// do hub, que lia só o C2X, e ficava sem ficha, sem unidades e sem Setup. A regra soma só o que o C2X
// não tem, para o legado continuar sendo a fonte das linhas dele.

const linha = (p: Partial<LinhaDoCadastro> & { codigo: string; id: string }): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  operadoPor: null,
  ordem: 0,
  paiId: null,
  tipoProduto: "loteamento",
  uf: null,
  vendendo: true,
  ...p,
});

const zero = { units: 0, value: 0 };

const doC2x = (p: Partial<ApoloEnterpriseRow> & { code: string; id: string }): ApoloEnterpriseRow => ({
  city: null,
  codes: [p.code],
  incorporador: null,
  mirror: false,
  mirrorLabel: null,
  mirrorNote: null,
  name: p.code,
  scenario: { bloqueado: zero, disponivel: zero, negociacao: zero, reservado: zero, total: { units: 10, value: 100 }, vendido: zero },
  state: null,
  stages: [],
  ...p,
});

const C2X: ApoloEnterpriseRow[] = [
  doC2x({ code: "GDN", id: "39", name: "GARDEN" }),
  doC2x({
    code: "VLO",
    id: "35",
    name: "VALE DO OURO",
    stages: [doC2x({ code: "VOC", id: "37" }), doC2x({ code: "VOL", id: "36" })],
  }),
];

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", paiId: "vlo" }),
  // ZZ TESTE: escrito à mão, abaixo de 100000. É legado para a régua, e não vira linha.
  linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "tst", nome: "ZZ TESTE" }),
  linha({
    c2xEnterpriseId: "100000",
    cidade: " Goiânia ",
    codigo: "jad",
    id: "jad",
    nome: "Ed. Jade",
    operadoPor: "inc-cecilio",
    tipoProduto: "vertical",
    uf: "go",
  }),
  // Pai só do Panteon, sem id: não há o que abrir.
  linha({ codigo: "LOX", id: "lox", nome: "Lavra do Ouro" }),
];

describe("linhasDoPanteonParaApolo", () => {
  it("⚠️ só o produto do Panteon vira linha, com código, nome, cidade e UF do cadastro e cenário zerado", () => {
    expect(linhasDoPanteonParaApolo(CADASTRO, C2X)).toEqual([
      {
        city: "Goiânia",
        code: "JAD",
        codes: ["JAD"],
        id: "100000",
        incorporador: null,
        mirror: false,
        mirrorLabel: null,
        mirrorNote: null,
        name: "Ed. Jade",
        scenario: { bloqueado: zero, disponivel: zero, negociacao: zero, reservado: zero, total: zero, vendido: zero },
        state: "GO",
        stages: [],
      },
    ]);
  });

  it("não repete id que o C2X já desenha, nem na linha nem nas etapas de um grupo", () => {
    const c2xComPanteon = [
      ...C2X,
      doC2x({ code: "VLX", id: "40", stages: [doC2x({ code: "RUB", id: "100001" })] }),
      doC2x({ code: "JAD", id: "100000" }),
    ];
    const cadastro = [...CADASTRO, linha({ c2xEnterpriseId: "100001", codigo: "RUB", id: "rub" })];

    expect(linhasDoPanteonParaApolo(cadastro, c2xComPanteon)).toEqual([]);
  });

  it("id repetido no cadastro vira uma linha só; sem código, a chave é o id", () => {
    const cadastro = [
      linha({ c2xEnterpriseId: " 100002 ", codigo: "", id: "a", nome: "" }),
      linha({ c2xEnterpriseId: "100002", codigo: "OUT", id: "b", nome: "Outro" }),
    ];

    const linhas = linhasDoPanteonParaApolo(cadastro, []);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ code: "100002", codes: ["100002"], id: "100002", name: "100002" });
  });

  it("C2X sem linhas (lista vazia) não inventa nada além do Panteon; cadastro vazio devolve vazio", () => {
    expect(linhasDoPanteonParaApolo([], C2X)).toEqual([]);
    expect(linhasDoPanteonParaApolo(CADASTRO, []).map((l) => l.id)).toEqual(["100000"]);
  });
});
