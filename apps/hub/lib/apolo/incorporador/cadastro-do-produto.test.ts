import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  cadastroDoPanteon,
  cadastroParaOPortal,
  codigosParaOC2x,
  montarCadastrosDoProduto,
  playerParaOPortal,
} from "./cadastro-do-produto";

// O CADASTRO DO EMPREENDIMENTO QUE ATRAVESSA PARA O PORTAL — a allowlist campo a campo.
//
// ⚠️ O QUE SE TRAVA AQUI É O QUE NÃO SAI. A tela do portal é a mesma `RelacionamentosTab` do Apolo,
// e ela desenha o que vier: se o telefone do captador chegar no JSON, ele aparece no portal do
// cliente (e na aba Rede do navegador, mesmo que a tela esconda).

const FICHA_DO_C2X: ApoloEnterpriseCadastro = {
  actValue: 12_000,
  city: "SETE LAGOAS",
  code: "VOC",
  createdAt: "2024-01-10T00:00:00.000Z",
  divulgationName: "VALE DO OURO CECILIO",
  expectedDelivery: "2027-06-30T00:00:00.000Z",
  focalEmail: "focal@exemplo.com",
  focalName: "MARIA FOCAL",
  focalPhone: "31999990000",
  kind: "LOTEAMENTO",
  name: "VALE DO OURO",
  players: [
    {
      address: "Rua A, 10, Centro, Sete Lagoas, MG",
      document: "123.456.789-09",
      email: "incorporador@exemplo.com",
      entityId: "uuid-incorporador",
      name: "CECILIO ROCHA",
      phone: "31988880000",
      relation: "incorporador",
    },
    {
      address: null,
      document: "98.765.432/0001-10",
      email: "coord@exemplo.com",
      entityId: "uuid-coord",
      name: "LUNA NEGOCIOS",
      phone: "31977770000",
      relation: "coordenador_vendas",
    },
    {
      address: null,
      document: null,
      email: "errado@exemplo.com",
      entityId: "uuid-errado",
      name: "PLAYER ERRADO DO C2X",
      phone: "31966660000",
      relation: "coordenador_c2x",
    },
  ],
  state: "MG",
  tableKind: "PRICE",
};

describe("cadastroParaOPortal", () => {
  const r = cadastroParaOPortal(FICHA_DO_C2X);

  it("mantém o que a aba Cadastro desenha", () => {
    expect(r).toMatchObject({
      city: "SETE LAGOAS",
      code: "VOC",
      divulgationName: "VALE DO OURO CECILIO",
      expectedDelivery: "2027-06-30T00:00:00.000Z",
      kind: "LOTEAMENTO",
      name: "VALE DO OURO",
      state: "MG",
      tableKind: "PRICE",
    });
  });

  it("⚠️ o contato focal sai só com o NOME", () => {
    expect(r.focalName).toBe("MARIA FOCAL");
    expect(r.focalPhone).toBeNull();
    expect(r.focalEmail).toBeNull();
  });

  it("⚠️ nenhum player leva telefone, e-mail, documento, endereço ou id interno", () => {
    for (const player of r.players) {
      expect(player).toEqual({
        address: null,
        document: null,
        email: null,
        entityId: "",
        name: player.name,
        phone: null,
        relation: player.relation,
      });
    }
  });

  it("⚠️ o coordenador errado do C2X nem entra no JSON (allowlist de papéis)", () => {
    expect(r.players.map((p) => p.relation)).toEqual(["incorporador", "coordenador_vendas"]);
  });

  it("valor do ato e data de criação não atravessam", () => {
    expect(r.actValue).toBeNull();
    expect(r.createdAt).toBeNull();
  });

  it("⚠️ nenhum valor de contato sobra em lugar nenhum do payload serializado", () => {
    const json = JSON.stringify(r);
    for (const proibido of [
      "31999990000",
      "focal@exemplo.com",
      "31988880000",
      "incorporador@exemplo.com",
      "123.456.789-09",
      "98.765.432/0001-10",
      "uuid-incorporador",
      "uuid-coord",
      "Rua A",
      "PLAYER ERRADO",
    ]) {
      expect(json).not.toContain(proibido);
    }
  });

  it("não muta a ficha de entrada (a tela interna segue recebendo tudo)", () => {
    expect(FICHA_DO_C2X.players[0]?.phone).toBe("31988880000");
    expect(playerParaOPortal(FICHA_DO_C2X.players[0]!).phone).toBeNull();
  });
});

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

const CADASTRO_DO_PANTEON: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VALE DO OURO CECILIO" }),
  linha({
    c2xEnterpriseId: "9001",
    cidade: "Belo Horizonte",
    codigo: "TST",
    id: "tst",
    nome: "ZZ TESTE",
    uf: "MG",
  }),
];

describe("cadastroDoPanteon", () => {
  it("o produto que o C2X não conhece ganha a ficha com o que o cadastro próprio sabe", () => {
    expect(cadastroDoPanteon(CADASTRO_DO_PANTEON[1]!)).toEqual({
      actValue: null,
      city: "Belo Horizonte",
      code: "TST",
      createdAt: null,
      divulgationName: null,
      expectedDelivery: null,
      focalEmail: null,
      focalName: null,
      focalPhone: null,
      kind: null,
      name: "ZZ TESTE",
      players: [],
      state: "MG",
      tableKind: null,
    });
  });
});

describe("montarCadastrosDoProduto", () => {
  const PROPRIOS = [{ codigo: "TST", enterpriseId: "9001" }];

  it("junta as duas fontes na ordem dos códigos, já no recorte do portal", () => {
    const r = montarCadastrosDoProduto({
      cadastroDoPanteon: CADASTRO_DO_PANTEON,
      codes: ["TST", "VOC"],
      doC2x: [FICHA_DO_C2X],
      proprios: PROPRIOS,
    });

    expect(r.map((c) => c.code)).toEqual(["TST", "VOC"]);
    expect(r[1]?.focalPhone).toBeNull();
  });

  it("⚠️ o que a fonte trouxe e não está no recorte da rota NÃO sai", () => {
    const r = montarCadastrosDoProduto({
      cadastroDoPanteon: CADASTRO_DO_PANTEON,
      codes: ["TST"],
      doC2x: [FICHA_DO_C2X],
      proprios: PROPRIOS,
    });

    expect(r.map((c) => c.code)).toEqual(["TST"]);
  });

  it("código repetido não duplica a ficha, e código sem fonte some", () => {
    const r = montarCadastrosDoProduto({
      cadastroDoPanteon: CADASTRO_DO_PANTEON,
      codes: ["VOC", "voc", "GDN"],
      doC2x: [FICHA_DO_C2X],
      proprios: [],
    });

    expect(r.map((c) => c.code)).toEqual(["VOC"]);
  });

  it("⚠️ a ficha do Panteon casa pelo id E pelo código (outra linha com a mesma sigla não entra)", () => {
    const r = montarCadastrosDoProduto({
      cadastroDoPanteon: [
        linha({ c2xEnterpriseId: "9999", codigo: "TST", id: "impostor", nome: "OUTRO" }),
        ...CADASTRO_DO_PANTEON,
      ],
      codes: ["TST"],
      doC2x: [],
      proprios: PROPRIOS,
    });

    expect(r.map((c) => c.name)).toEqual(["ZZ TESTE"]);
  });
});

describe("codigosParaOC2x", () => {
  it("produto só do Panteon não vale uma ida ao legado", () => {
    expect(codigosParaOC2x(["VOC", "TST"], [{ codigo: "TST", enterpriseId: "9001" }])).toEqual([
      "VOC",
    ]);
    expect(codigosParaOC2x(["tst"], [{ codigo: "TST", enterpriseId: "9001" }])).toEqual([]);
  });
});
