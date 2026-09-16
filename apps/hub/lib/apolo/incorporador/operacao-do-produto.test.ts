import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  MENSAGEM_PRODUTO_SO_CONSULTA,
  operadorDoEnterprise,
  podeCadastrarNoProduto,
  podeCadastrarNosEnterprises,
  podeEscreverNoProduto,
  podeEscreverNosEnterprises,
  type PortalDaEscrita,
} from "./operacao-do-produto";

// A RÉGUA DE ESCRITA DO PORTAL (decisão do Lucas, 16/09/2026): no portal que confecciona, escrita só
// no produto que ele opera. VOC (37) e VOR (41) só consulta para a Cecílio; Garden (39) e o que
// nasce no portal (100000+) são dela. O comercial escreve como hoje e não cadastra. Sem a 0170,
// ninguém do portal que confecciona escreve.

const CECILIO_ID = "5f0c2b1e-8d7a-4c3b-9e21-aa00bb11cc22";

const CECILIO: PortalDaEscrita = { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: PortalDaEscrita = { incorporadorId: "gurgel-id", slug: "gurgel", tipo: "comercial" };
const CER: PortalDaEscrita = { incorporadorId: CECILIO_ID, slug: "cer", tipo: "incorporador" };
const MMENDES: PortalDaEscrita = { incorporadorId: CECILIO_ID, slug: "mmendes", tipo: "incorporador" };

function linha(dados: Partial<LinhaDoCadastro> & Pick<LinhaDoCadastro, "codigo" | "id">): LinhaDoCadastro {
  return {
    c2xEnterpriseId: null,
    cidade: null,
    nome: dados.codigo,
    operadoPor: null,
    ordem: 0,
    paiId: null,
    tipoProduto: "loteamento",
    uf: null,
    vendendo: true,
    ...dados,
  };
}

const PAI_VLO = "11111111-1111-4111-8111-111111111111";
const PAI_GARDEN = "22222222-2222-4222-8222-222222222222";
const PAI_JADE = "33333333-3333-4333-8333-333333333333";
const PAI_MISTO = "44444444-4444-4444-8444-444444444444";

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: PAI_VLO }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "f-voc", paiId: PAI_VLO }),
  linha({ c2xEnterpriseId: "41", codigo: "VOR", id: "f-vor", paiId: PAI_VLO }),
  linha({ c2xEnterpriseId: "39", codigo: "JDG", id: PAI_GARDEN, operadoPor: CECILIO_ID }),
  linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: PAI_JADE, operadoPor: `  ${CECILIO_ID.toUpperCase()} ` }),
  // Pai "da Cecílio" com um filho da Careli: o pai não pode dar escrita no filho por tabela.
  linha({ c2xEnterpriseId: "100001", codigo: "MIX", id: PAI_MISTO, operadoPor: CECILIO_ID }),
  linha({ c2xEnterpriseId: "100002", codigo: "MXA", id: "f-mxa", operadoPor: CECILIO_ID, paiId: PAI_MISTO }),
  linha({ c2xEnterpriseId: "100003", codigo: "MXB", id: "f-mxb", operadoPor: null, paiId: PAI_MISTO }),
];

describe("podeEscreverNoProduto", () => {
  it("comercial escreve em qualquer produto, com ou sem dono e sem a 0170", () => {
    expect(podeEscreverNoProduto(GURGEL, null, false)).toBe(true);
    expect(podeEscreverNoProduto(GURGEL, CECILIO_ID, true)).toBe(true);
    expect(podeEscreverNoProduto(GURGEL, "outro", true)).toBe(true);
  });

  it("cecilio-rocha escreve no produto que opera, mesmo com caixa e espaços diferentes", () => {
    expect(podeEscreverNoProduto(CECILIO, CECILIO_ID, true)).toBe(true);
    expect(podeEscreverNoProduto(CECILIO, ` ${CECILIO_ID.toUpperCase()}  `, true)).toBe(true);
    expect(
      podeEscreverNoProduto({ ...CECILIO, incorporadorId: ` ${CECILIO_ID.toUpperCase()}` }, CECILIO_ID, true),
    ).toBe(true);
  });

  it("⚠️ cecilio-rocha NÃO escreve em produto sem dono, de outro ou sem a 0170", () => {
    expect(podeEscreverNoProduto(CECILIO, null, true)).toBe(false);
    expect(podeEscreverNoProduto(CECILIO, undefined, true)).toBe(false);
    expect(podeEscreverNoProduto(CECILIO, "   ", true)).toBe(false);
    expect(podeEscreverNoProduto(CECILIO, "outro-incorporador", true)).toBe(false);
    expect(podeEscreverNoProduto(CECILIO, CECILIO_ID, false)).toBe(false);
  });

  it("⚠️ sem o id do incorporador na sessão, nada casa (nem vazio com vazio)", () => {
    expect(podeEscreverNoProduto({ ...CECILIO, incorporadorId: "" }, "", true)).toBe(false);
    expect(podeEscreverNoProduto({ ...CECILIO, incorporadorId: null }, null, true)).toBe(false);
  });

  it("portal padrão (cer, mmendes) não escreve nem no produto marcado com o id dele", () => {
    expect(podeEscreverNoProduto(CER, CECILIO_ID, true)).toBe(false);
    expect(podeEscreverNoProduto(MMENDES, CECILIO_ID, true)).toBe(false);
  });
});

describe("podeCadastrarNoProduto", () => {
  it("⚠️ o comercial nunca cadastra produto nem unidade", () => {
    expect(podeCadastrarNoProduto(GURGEL, null, true)).toBe(false);
    expect(podeCadastrarNoProduto(GURGEL, "gurgel-id", true)).toBe(false);
  });

  it("cecilio-rocha cadastra só no que opera, com a 0170", () => {
    expect(podeCadastrarNoProduto(CECILIO, CECILIO_ID, true)).toBe(true);
    expect(podeCadastrarNoProduto(CECILIO, null, true)).toBe(false);
    expect(podeCadastrarNoProduto(CECILIO, CECILIO_ID, false)).toBe(false);
    expect(podeCadastrarNoProduto(CER, CECILIO_ID, true)).toBe(false);
  });
});

describe("operadorDoEnterprise", () => {
  it("id do C2X ('39') casa pelo c2xEnterpriseId", () => {
    expect(operadorDoEnterprise(CADASTRO, "39")).toEqual({ achado: true, operadoPor: CECILIO_ID });
    expect(operadorDoEnterprise(CADASTRO, 39)).toEqual({ achado: true, operadoPor: CECILIO_ID });
    expect(operadorDoEnterprise(CADASTRO, " 37 ")).toEqual({ achado: true, operadoPor: null });
  });

  it("'pai:<uuid>' casa pelo id da linha", () => {
    expect(operadorDoEnterprise(CADASTRO, `pai:${PAI_GARDEN}`)).toEqual({
      achado: true,
      operadoPor: CECILIO_ID,
    });
    expect(operadorDoEnterprise(CADASTRO, `pai:${PAI_VLO.toUpperCase()}`)).toEqual({
      achado: true,
      operadoPor: null,
    });
  });

  it("'group:Vale do Ouro' e id desconhecido não são achados", () => {
    expect(operadorDoEnterprise(CADASTRO, "group:Vale do Ouro")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, "999")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, "pai:nao-existe")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, "pai:")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, "VOC")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, "")).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, null)).toEqual({ achado: false });
    expect(operadorDoEnterprise(CADASTRO, { id: "39" })).toEqual({ achado: false });
  });

  it("⚠️ pai com filho de outro dono não tem operador (pelo pai ou pelo espelho)", () => {
    expect(operadorDoEnterprise(CADASTRO, `pai:${PAI_MISTO}`)).toEqual({ achado: true, operadoPor: null });
    expect(operadorDoEnterprise(CADASTRO, "100001")).toEqual({ achado: true, operadoPor: null });
    // O filho, sozinho, continua com o dono dele.
    expect(operadorDoEnterprise(CADASTRO, "100002")).toEqual({ achado: true, operadoPor: CECILIO_ID });
  });

  it("⚠️ duas linhas com o mesmo id do C2X só valem quando concordam", () => {
    const duplicado = [
      ...CADASTRO,
      linha({ c2xEnterpriseId: "39", codigo: "JDX", id: "dup", operadoPor: null }),
    ];
    expect(operadorDoEnterprise(duplicado, "39")).toEqual({ achado: true, operadoPor: null });
  });
});

describe("podeEscreverNosEnterprises", () => {
  it("comercial: sempre, sem olhar o cadastro", () => {
    expect(podeEscreverNosEnterprises(GURGEL, [], ["37"], false)).toBe(true);
    expect(podeEscreverNosEnterprises(GURGEL, CADASTRO, [], true)).toBe(true);
  });

  it("Garden e produto nascido no portal: a Cecílio escreve", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["39"], true)).toBe(true);
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["100000", `pai:${PAI_GARDEN}`], true)).toBe(true);
  });

  it("⚠️ VOC (37) e VOR (41) ficam só consulta para a Cecílio", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["37"], true)).toBe(false);
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["41"], true)).toBe(false);
  });

  it("⚠️ lista vazia ou só grupo não é permissão", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, [], true)).toBe(false);
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["group:Vale do Ouro", "", "  "], true)).toBe(false);
  });

  it("o grupo e os vazios são ignorados quando há id que conta", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["group:Garden", "", "39"], true)).toBe(true);
  });

  it("⚠️ um id fora recusa o pedido inteiro", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["39", "37"], true)).toBe(false);
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["39", "999"], true)).toBe(false);
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, [`pai:${PAI_MISTO}`], true)).toBe(false);
  });

  it("⚠️ sem a 0170 a Cecílio não escreve nem no Garden", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, ["39"], false)).toBe(false);
  });

  it("portal padrão não escreve", () => {
    expect(podeEscreverNosEnterprises(CER, CADASTRO, ["39"], true)).toBe(false);
    expect(podeEscreverNosEnterprises(MMENDES, CADASTRO, ["39"], true)).toBe(false);
  });

  it("aceita qualquer iterável (Set)", () => {
    expect(podeEscreverNosEnterprises(CECILIO, CADASTRO, new Set(["39", "100000"]), true)).toBe(true);
  });
});

describe("podeCadastrarNosEnterprises", () => {
  it("⚠️ o comercial não cadastra em produto nenhum", () => {
    expect(podeCadastrarNosEnterprises(GURGEL, CADASTRO, ["39"], true)).toBe(false);
  });

  it("a Cecílio cadastra só no que opera", () => {
    expect(podeCadastrarNosEnterprises(CECILIO, CADASTRO, ["100000"], true)).toBe(true);
    expect(podeCadastrarNosEnterprises(CECILIO, CADASTRO, ["37"], true)).toBe(false);
    expect(podeCadastrarNosEnterprises(CECILIO, CADASTRO, [], true)).toBe(false);
    expect(podeCadastrarNosEnterprises(CECILIO, CADASTRO, ["39"], false)).toBe(false);
    expect(podeCadastrarNosEnterprises(CER, CADASTRO, ["39"], true)).toBe(false);
  });
});

describe("a mensagem", () => {
  it("é PT-BR com acento e sem travessão", () => {
    expect(MENSAGEM_PRODUTO_SO_CONSULTA).toBe("Este produto está disponível só para consulta no seu portal.");
    expect(MENSAGEM_PRODUTO_SO_CONSULTA).not.toMatch(/[—–]/);
  });
});
