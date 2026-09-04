import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { pedidoPrecisaDeExpansao, resolverCodigosDoPedido } from "./codigos-do-pedido";
import { empreendimentosDoPortal } from "./empreendimentos-do-portal";

// O catálogo REAL do C2X: a Lagoa Bonita chega AGRUPADA ("group:Lagoa Bonita", sem linha "33");
// o Vale do Ouro vem solto (VOC/VOL/VOR não estão em ENTERPRISE_GROUPS).
const CATALOGO = agrupar([
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "VLO", id: 35, name: "VALE DO OURO" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "GDN", id: 39, name: "GARDEN" },
]);

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
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", ordem: 1, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", ordem: 2, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab" }),
  linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", ordem: 1, paiId: "lab" }),
  linha({ c2xEnterpriseId: "27", codigo: "LBR", id: "lbr", ordem: 2, paiId: "lab" }),
  linha({ c2xEnterpriseId: "32", codigo: "LBP", id: "lbp", ordem: 3, paiId: "lab" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn" }),
];

/** A sessão do dono do conjunto da Lagoa + Vale do Ouro + Garden, como `idsDaSessao` expande. */
const PERMITIDOS = new Set(["group:Lagoa Bonita", "33", "27", "32", "35", "37", "36", "39"]);
const CODES = ["LBF", "LBR", "LBP", "VLO", "VOC", "VOL", "GDN"];

function resolver(pedido: null | string, permitidos = PERMITIDOS, codes = CODES) {
  return resolverCodigosDoPedido({
    cadastro: CADASTRO,
    catalogo: CATALOGO,
    codesAutorizados: codes,
    empreendimentos: empreendimentosDoPortal(CATALOGO, codes),
    pedido,
    permitidos,
  });
}

describe("pedidoPrecisaDeExpansao", () => {
  it("pai do cadastro e id numérico solto passam pela expansão; o resto não", () => {
    expect(pedidoPrecisaDeExpansao("pai:vlo")).toBe(true);
    expect(pedidoPrecisaDeExpansao(" 33 ")).toBe(true);
    expect(pedidoPrecisaDeExpansao("group:Lagoa Bonita")).toBe(false);
    expect(pedidoPrecisaDeExpansao("")).toBe(false);
    expect(pedidoPrecisaDeExpansao(null)).toBe(false);
  });
});

describe("resolverCodigosDoPedido", () => {
  it("sem pedido: tudo o que a sessão autoriza (como sempre)", () => {
    expect(resolver(null).sort()).toEqual([...CODES].sort());
  });

  it("id do catálogo (o seletor da tela) resolve por codesDoRecorte", () => {
    expect(resolver("group:Lagoa Bonita").sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("pai com filhos → os códigos dos filhos autorizados, espelho fora", () => {
    expect(resolver("pai:vlo").sort()).toEqual(["VOC", "VOL"]);
    expect(resolver("pai:lab").sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("pai sem filho (Garden) → o próprio código", () => {
    expect(resolver("pai:gdn")).toEqual(["GDN"]);
  });

  it("⚠️ o 'Ver mais' do FILHO de grupo fixo: id numérico '33' vira LBF (codesDoRecorte não achava)", () => {
    expect(resolver("33")).toEqual(["LBF"]);
    expect(resolver("37")).toEqual(["VOC"]);
  });

  it("escopo parcial: quem só tem a gleba do Fernando não abre o Raposo, nem pelo pai", () => {
    const soFernando = new Set(["33"]);
    expect(resolver("pai:lab", soFernando, ["LBF"])).toEqual(["LBF"]);
    expect(resolver("27", soFernando, ["LBF"])).toEqual([]);
  });

  it("fail-closed em duas camadas: id autorizado na sessão mas código fora da lista some", () => {
    // Sessão que alcança o 35 mas cuja lista de códigos (por qualquer razão) não traz o VLO.
    expect(resolver("35", new Set(["35"]), ["GDN"])).toEqual([]);
  });

  it("pai inventado, uuid de filho, ou id que a sessão não tem → vazio (a rota responde 404)", () => {
    expect(resolver("pai:nao-existe")).toEqual([]);
    expect(resolver("pai:voc")).toEqual([]);
    expect(resolver("99")).toEqual([]);
  });
});

// ── O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON ───────────────────────────────
//
// ⚠️ ELE RESPONDIA 404 NOS DOIS CAMINHOS, e o sintoma enganava: o produto aparecia no seletor (que
// lê o cadastro do Panteon) e as unidades estavam gravadas, mas a Venda dizia "Produto não
// encontrado" — porque a tradução id → código passa pelo catálogo, que é um select em `enterprises`
// do MySQL do legado. Achado no empreendimento de teste do Lucas (TST/9001, 04/09/2026).
describe("resolverCodigosDoPedido · empreendimento só do Panteon", () => {
  const PROPRIOS = [{ codigo: "TST", enterpriseId: "9001" }];
  const CADASTRO = [linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "uuid-tst" })];

  it("entra em 'todos os empreendimentos'", () => {
    const codes = resolverCodigosDoPedido({
      cadastro: [],
      catalogo: CATALOGO,
      codesAutorizados: ["GDN", "TST"],
      empreendimentos: empreendimentosDoPortal(CATALOGO, ["GDN"]),
      pedido: null,
      permitidos: new Set(),
      proprios: PROPRIOS,
    });
    expect(codes).toContain("TST");
    expect(codes).toContain("GDN");
  });

  it("responde ao pedido pelo id do PAI do cadastro", () => {
    const codes = resolverCodigosDoPedido({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["TST"],
      empreendimentos: empreendimentosDoPortal(CATALOGO, []),
      pedido: "pai:uuid-tst",
      permitidos: new Set(["9001"]),
      proprios: PROPRIOS,
    });
    expect(codes).toEqual(["TST"]);
  });

  it("responde ao pedido pelo id numérico", () => {
    const codes = resolverCodigosDoPedido({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados: ["TST"],
      empreendimentos: empreendimentosDoPortal(CATALOGO, []),
      pedido: "9001",
      permitidos: new Set(["9001"]),
      proprios: PROPRIOS,
    });
    expect(codes).toEqual(["TST"]);
  });

  it("⚠️ continua FAIL-CLOSED: fora do escopo não passa", () => {
    // A expansão cruza com o escopo da sessão E o código é cruzado com os autorizados. Tirar
    // qualquer uma das duas camadas abriria produto de outro coordenador.
    expect(
      resolverCodigosDoPedido({
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        codesAutorizados: ["GDN"],
        empreendimentos: empreendimentosDoPortal(CATALOGO, ["GDN"]),
        pedido: "9001",
        permitidos: new Set(["9001"]),
        proprios: PROPRIOS,
      }),
    ).toEqual([]);

    expect(
      resolverCodigosDoPedido({
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        codesAutorizados: ["TST"],
        empreendimentos: empreendimentosDoPortal(CATALOGO, []),
        pedido: "9001",
        permitidos: new Set(),
        proprios: PROPRIOS,
      }),
    ).toEqual([]);
  });

  it("pedir OUTRO produto não traz o do Panteon junto", () => {
    const codes = resolverCodigosDoPedido({
      cadastro: [],
      catalogo: CATALOGO,
      codesAutorizados: ["GDN", "TST"],
      empreendimentos: empreendimentosDoPortal(CATALOGO, ["GDN"]),
      pedido: "GARDEN",
      permitidos: new Set(),
      proprios: PROPRIOS,
    });
    expect(codes).not.toContain("TST");
  });
});
