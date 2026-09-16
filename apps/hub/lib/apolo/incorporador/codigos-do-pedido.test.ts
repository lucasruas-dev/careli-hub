import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  pedidoPrecisaDeExpansao,
  pedidoPrecisaDoCadastro,
  resolverCodigosDoPedido,
} from "./codigos-do-pedido";
import { empreendimentosDoPortal } from "./empreendimentos-do-portal";

// O catálogo REAL do C2X: a Lagoa Bonita chega AGRUPADA ("group:Lagoa Bonita", sem linha "33").
// ⚠️ O VALE DO OURO TAMBÉM, DESDE 08/09/2026 — VOC/VOL/VOR entraram em ENTERPRISE_GROUPS, então
// aqui eles chegam como "group:Vale do Ouro". O VLO (35) é ESPELHO e continua linha solta.
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

// ── O PRODUTO DO PANTEON SEM `proprios` (16/09/2026) ────────────────────────
//
// ⚠️ `codigosDaSessao` passou a devolver o código do produto nascido no Panteon, e as rotas que
// nunca somaram `soDoPanteon` (vendas, vendas/contratos, carteira) chamam a tradução SEM `proprios`.
// Sem isto, o código chegava autorizado e a tradução do `emp` o jogava fora nos dois caminhos.
describe("resolverCodigosDoPedido · produto do Panteon sem `proprios`", () => {
  const JADE = linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "uuid-jad" });
  const RUBI = linha({ c2xEnterpriseId: "100001", codigo: "RUB", id: "uuid-rub" });
  const COM_PREDIOS = [...CADASTRO, JADE, RUBI];
  // O que `codigosDaSessao` devolve para a sessão da Cecílio com o VOC e o Ed. Jade.
  const AUTORIZADOS = ["VOC", "JAD"];
  const PERMITIDOS_CECILIO = new Set(["37", "100000"]);

  const resolverSemProprios = (
    pedido: null | string,
    extra: { cadastro?: LinhaDoCadastro[]; codes?: string[]; permitidos?: Set<string> } = {},
  ) =>
    resolverCodigosDoPedido({
      cadastro: extra.cadastro ?? COM_PREDIOS,
      catalogo: CATALOGO,
      codesAutorizados: extra.codes ?? AUTORIZADOS,
      empreendimentos: empreendimentosDoPortal(CATALOGO, extra.codes ?? AUTORIZADOS),
      pedido,
      permitidos: extra.permitidos ?? PERMITIDOS_CECILIO,
    });

  it("⚠️ sem pedido: o produto do Panteon entra em 'todos'", () => {
    expect(resolverSemProprios(null).sort()).toEqual(["JAD", "VOC"]);
  });

  it("pedido pelo CÓDIGO do produto do Panteon", () => {
    expect(resolverSemProprios("JAD")).toEqual(["JAD"]);
    expect(resolverSemProprios("jad")).toEqual(["JAD"]);
  });

  it("⚠️ pedido pelo id numérico: o código sai do cadastro", () => {
    expect(resolverSemProprios("100000")).toEqual(["JAD"]);
  });

  it("⚠️ pedido pelo pai do cadastro", () => {
    expect(resolverSemProprios("pai:uuid-jad")).toEqual(["JAD"]);
  });

  it("⚠️ fail-closed nas duas camadas: prédio de fora da sessão, ou fora dos autorizados, some", () => {
    // O Ed. Rubi não está na sessão: a expansão não o libera.
    expect(resolverSemProprios("100001")).toEqual([]);
    expect(resolverSemProprios("pai:uuid-rub")).toEqual([]);
    // Na sessão, mas o código não veio de `codigosDaSessao`: a segunda camada segura.
    expect(resolverSemProprios("100000", { codes: ["VOC"] })).toEqual([]);
    // Pedir outro produto (código) não traz o do Panteon junto.
    expect(resolverSemProprios("RUB")).toEqual([]);
    expect(resolverSemProprios("group:Lagoa Bonita")).toEqual([]);
  });

  it("⚠️ o LAB (31) que o C2X exclui não vira código pelo cadastro: não está nos autorizados", () => {
    expect(resolverSemProprios("31", { permitidos: new Set(["31"]) })).toEqual([]);
  });

  it("⚠️ idempotente: a rota que ainda manda `proprios` recebe o MESMO resultado, sem repetir", () => {
    const comProprios = (pedido: null | string) =>
      resolverCodigosDoPedido({
        cadastro: COM_PREDIOS,
        catalogo: CATALOGO,
        codesAutorizados: [...AUTORIZADOS, "JAD"],
        empreendimentos: empreendimentosDoPortal(CATALOGO, AUTORIZADOS),
        pedido,
        permitidos: PERMITIDOS_CECILIO,
        proprios: [{ codigo: "jad", enterpriseId: "100000" }],
      });

    for (const pedido of [null, "JAD", "100000", "pai:uuid-jad", "37"]) {
      const saida = comProprios(pedido);
      expect(saida.sort()).toEqual(resolverSemProprios(pedido).sort());
      expect(new Set(saida).size).toBe(saida.length);
    }
  });

  it("C2X fora do ar (catálogo vazio): o código autorizado pelo cadastro responde sem pedido", () => {
    const codes = resolverCodigosDoPedido({
      cadastro: [],
      catalogo: [],
      codesAutorizados: AUTORIZADOS,
      empreendimentos: [],
      pedido: null,
      permitidos: new Set(),
    });
    expect(codes.sort()).toEqual(["JAD", "VOC"]);
  });
});

describe("pedidoPrecisaDoCadastro", () => {
  const permitidos = new Set(["37", "100000"]);

  it("pai sempre; id numérico só quando é da sessão E o catálogo não traduz", () => {
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: "pai:x", permitidos })).toBe(true);
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: "100000", permitidos })).toBe(true);
    // O filho do C2X não depende do Supabase.
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: "37", permitidos })).toBe(false);
    // Id de fora da sessão não lê nada: vira 404.
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: "100001", permitidos })).toBe(false);
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: "group:Lagoa Bonita", permitidos })).toBe(false);
    expect(pedidoPrecisaDoCadastro({ catalogo: CATALOGO, pedido: null, permitidos })).toBe(false);
  });

  it("C2X fora do ar: até o id do legado precisa do cadastro para virar código", () => {
    expect(pedidoPrecisaDoCadastro({ catalogo: [], pedido: "37", permitidos })).toBe(true);
  });
});
