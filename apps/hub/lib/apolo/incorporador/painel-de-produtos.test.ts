import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  AVISO_DE_PAINEL_PARCIAL,
  type Cenario,
  cenarioVazio,
  decidirPainelDeProdutos,
  linhasReaisDoC2x,
  montarPainelDeProdutos,
  somarCenarios,
} from "./painel-de-produtos";
import { comEscritaDoFilho } from "./painel-para-apolo";

// ── Fábricas ────────────────────────────────────────────────────────────────
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

/** Cenário com `units` por balde e valor = units × 100, para a soma ser conferível de cabeça. */
function cenario(units: Partial<Record<keyof Cenario, number>>): Cenario {
  const base = cenarioVazio();
  for (const [balde, n] of Object.entries(units) as Array<[keyof Cenario, number]>) {
    base[balde] = { units: n, value: n * 100 };
  }
  return base;
}

const c2x = (
  p: Partial<ApoloEnterpriseRow> & { code: string; id: string; scenario: Cenario },
): ApoloEnterpriseRow => ({
  city: "Sete Lagoas",
  codes: [p.code],
  incorporador: null,
  mirror: false,
  mirrorLabel: null,
  mirrorNote: null,
  name: p.code,
  stages: [],
  state: "MG",
  ...p,
});

// `noUncheckedIndexedAccess`: dizer em voz alta quando a linha esperada não veio.
function unica<T>(lista: T[]): T {
  const item = lista[0];
  if (item === undefined || lista.length !== 1) {
    throw new Error(`esperava 1 linha, veio ${lista.length}`);
  }
  return item;
}

// ── O C2X como `loadApoloEnterprises` entrega ───────────────────────────────
// Vale do Ouro solto (espelho VLO parado + três divisões vivas), Garden simples, Vista Alegre
// simples, e Lagoa Bonita / Lavra do Ouro JÁ AGRUPADAS por ENTERPRISE_GROUPS (com `stages`).
//
// ⚠️ DE PROPÓSITO SOLTO, mesmo depois de 08/09/2026, quando o Vale do Ouro entrou em
// ENTERPRISE_GROUPS: o painel do Hércules agrupa pelo CADASTRO DO PANTEON e a primeira coisa que
// ele faz é desfazer o agrupamento do Apolo (`linhasReaisDoC2x`, coberto pelo teste "desfaz o
// agrupamento de ENTERPRISE_GROUPS"). A fixture solta prova que os números por enterprise_id são
// os mesmos vindo de um jeito ou do outro — é a forma que o painel produz internamente.
const VLO = c2x({
  code: "VLO",
  id: "35",
  mirror: true,
  mirrorLabel: "Histórico · mesmos lotes de VOC + VOL + VOR",
  name: "VALE DO OURO",
  // ⚠️ Os 118 "em negociação" que já viraram venda nos filhos — o número parado.
  scenario: cenario({ negociacao: 118, total: 298, vendido: 100 }),
});
const VOC = c2x({ code: "VOC", id: "37", name: "VALE DO OURO", scenario: cenario({ disponivel: 10, total: 150, vendido: 140 }) });
const VOL = c2x({ code: "VOL", id: "36", name: "VALE DO OURO", scenario: cenario({ disponivel: 5, total: 148, vendido: 143 }) });
const VOR = c2x({ code: "VOR", id: "41", name: "VALE DO OURO", scenario: cenario({ disponivel: 20, reservado: 3, total: 40, vendido: 17 }) });
const GDN = c2x({ code: "GDN", id: "39", name: "GARDEN", scenario: cenario({ bloqueado: 4, disponivel: 200, total: 405, vendido: 201 }) });
const VAL = c2x({ code: "VAL", id: "29", name: "VISTA ALEGRE", scenario: cenario({ disponivel: 80, total: 126, vendido: 46 }) });

const LBF = c2x({ code: "LBF", id: "33", name: "LAGOA BONITA", scenario: cenario({ disponivel: 7, total: 47, vendido: 40 }) });
const LBR = c2x({ code: "LBR", id: "27", name: "LAGOA BONITA", scenario: cenario({ disponivel: 100, total: 240, vendido: 140 }) });
const LBP = c2x({ code: "LBP", id: "32", name: "LAGOA BONITA", scenario: cenario({ disponivel: 25, total: 125, vendido: 100 }) });
const GRUPO_LAGOA = c2x({
  code: "LBF + LBR + LBP",
  codes: ["LBF", "LBR", "LBP"],
  id: "group:Lagoa Bonita",
  name: "Lagoa Bonita",
  scenario: somarCenarios([LBF.scenario, LBR.scenario, LBP.scenario]),
  stages: [LBF, LBR, LBP],
});

const LOS = c2x({ code: "LOS", id: "4", name: "LAVRA DO OURO", scenario: cenario({ disponivel: 30, total: 300, vendido: 270 }) });
const LOU = c2x({ code: "LOU", id: "1", name: "LAVRA DO OURO", scenario: cenario({ disponivel: 4, total: 384, vendido: 380 }) });
const GRUPO_LAVRA = c2x({
  code: "LOS + LOU",
  codes: ["LOS", "LOU"],
  id: "group:Lavra do Ouro",
  name: "Lavra do Ouro",
  scenario: somarCenarios([LOS.scenario, LOU.scenario]),
  stages: [LOS, LOU],
});

const C2X = [VLO, VOC, VOL, VOR, GDN, VAL, GRUPO_LAGOA, GRUPO_LAVRA];

// ── O cadastro do Panteon (02/09/2026) ──────────────────────────────────────
const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "35", cidade: "Sete Lagoas", codigo: "VLO", id: "vlo", nome: "Vale do Ouro", uf: "MG" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "Vale do Ouro (Cecílio)", ordem: 1, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", nome: "Vale do Ouro (Lino)", ordem: 2, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "41", codigo: "VOR", id: "vor", nome: "Vale do Ouro (Reserva)", ordem: 3, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Lagoa Bonita" }),
  linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", nome: "Lagoa Bonita (Fernando)", ordem: 1, paiId: "lab" }),
  linha({ c2xEnterpriseId: "27", codigo: "LBR", id: "lbr", nome: "Lagoa Bonita (Raposo)", ordem: 2, paiId: "lab" }),
  linha({ c2xEnterpriseId: "32", codigo: "LBP", id: "lbp", nome: "Lagoa Bonita (Paulo)", ordem: 3, paiId: "lab" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  linha({ codigo: "LOX", id: "lox", nome: "Lavra do Ouro", vendendo: false }),
  linha({ c2xEnterpriseId: "4", codigo: "LOS", id: "los", nome: "Lavra do Ouro (Sul)", ordem: 1, paiId: "lox" }),
  linha({ c2xEnterpriseId: "1", codigo: "LOU", id: "lou", nome: "Lavra do Ouro (Um)", ordem: 2, paiId: "lox" }),
];

const permitir = (...ids: string[]) => new Set(ids);

/**
 * O estoque na forma nova, montado das MESMAS linhas do C2X que estes testes já usavam.
 *
 * ⚠️ A FONTE DOS NÚMEROS MUDOU PARA O PANTEON (04/09/2026), mas o que estes testes medem é o
 * AGRUPAMENTO (pai, filhos, espelho, escopo) — e ele não mudou. Derivar o mapa das linhas de
 * sempre mantém os números idênticos e deixa cada teste continuar falando do que ele fala.
 */
const estoqueDeTeste = new Map(
  [...linhasReaisDoC2x(C2X).entries()].map(([id, linha]) => [id, linha.scenario]),
);

describe("linhasReaisDoC2x", () => {
  it("desfaz o agrupamento de ENTERPRISE_GROUPS: uma linha por enterprise_id real", () => {
    const reais = linhasReaisDoC2x(C2X);
    expect(reais.get("33")?.code).toBe("LBF");
    expect(reais.get("4")?.code).toBe("LOS");
    expect(reais.get("39")?.code).toBe("GDN");
    expect(reais.has("group:Lagoa Bonita")).toBe(false);
  });
});

describe("Vale do Ouro: pai com espelho + 3 filhos", () => {
  const painel = montarPainelDeProdutos({
    cadastro: CADASTRO,
    estoque: estoqueDeTeste,
    linhasDoC2x: C2X,
    permitidos: permitir("35", "37", "36", "41"),
  });

  it("é UMA linha, com o id do pai e os códigos dos filhos", () => {
    const vale = unica(painel.linhas);
    expect(vale.id).toBe("pai:vlo");
    expect(vale.nome).toBe("Vale do Ouro");
    expect(vale.codigo).toBe("VOC + VOL + VOR");
    expect(vale.codes).toEqual(["VOC", "VOL", "VOR"]);
    expect(vale.cidade).toBe("Sete Lagoas");
    expect(vale.uf).toBe("MG");
    expect(vale.etapas).toBe(3);
    expect(vale.filhos.map((f) => [f.id, f.codigo, f.nome])).toEqual([
      ["37", "VOC", "Vale do Ouro (Cecílio)"],
      ["36", "VOL", "Vale do Ouro (Lino)"],
      ["41", "VOR", "Vale do Ouro (Reserva)"],
    ]);
  });

  it("⚠️ o cenário é a SOMA dos filhos; os 118 em negociação do espelho não aparecem", () => {
    const vale = unica(painel.linhas);
    expect(vale.scenario.total).toEqual({ units: 338, value: 33_800 });
    expect(vale.scenario.vendido).toEqual({ units: 300, value: 30_000 });
    expect(vale.scenario.disponivel).toEqual({ units: 35, value: 3_500 });
    expect(vale.scenario.reservado).toEqual({ units: 3, value: 300 });
    expect(vale.scenario.negociacao).toEqual({ units: 0, value: 0 });
  });

  it("⚠️ o espelho autorizado NÃO vira segunda linha nem entra nos cards", () => {
    expect(painel.linhas).toHaveLength(1);
    expect(painel.cards).toEqual(unica(painel.linhas).scenario);
  });

  it("sessão que só carrega o espelho vê o pai com o número do espelho, sem etapas", () => {
    const soEspelho = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("35"),
    });
    const vale = unica(soEspelho.linhas);
    expect(vale.id).toBe("pai:vlo");
    expect(vale.codigo).toBe("VLO");
    expect(vale.etapas).toBe(0);
    expect(vale.scenario.negociacao.units).toBe(118);
    // ⚠️ Número parado apresentado como vivo: a linha avisa, com o rótulo do C2X.
    expect(vale.aviso).toBe("Histórico · mesmos lotes de VOC + VOL + VOR");
  });

  it("pai pela soma dos filhos, e pai sem filho (Garden), não têm aviso", () => {
    expect(unica(painel.linhas).aviso).toBeNull();
    const garden = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("39"),
    });
    expect(unica(garden.linhas).aviso).toBeNull();
  });

  it("espelho SEM rótulo no C2X (LAB 31) ganha o aviso genérico quando tem filho cadastrado", () => {
    const soLab = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: [...C2X, c2x({ code: "LAB", id: "31", name: "LAGOA BONITA", scenario: cenario({ total: 412 }) })],
      permitidos: permitir("31"),
    });
    const lagoa = unica(soLab.linhas);
    expect(lagoa.id).toBe("pai:lab");
    expect(lagoa.aviso).toBe("Visão consolidada · números podem estar defasados");
  });
});

describe("Garden: pai sem filho", () => {
  it("usa o cenário do próprio c2x id, com o código do pai", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("39"),
    });
    const garden = unica(painel.linhas);
    expect(garden.id).toBe("pai:gdn");
    expect(garden.codigo).toBe("GDN");
    expect(garden.codes).toEqual(["GDN"]);
    expect(garden.etapas).toBe(0);
    expect(garden.filhos).toEqual([]);
    expect(garden.scenario).toEqual(GDN.scenario);
    expect(painel.cards).toEqual(GDN.scenario);
  });
});

describe("Lavra do Ouro: pai SEM c2x, filhos com", () => {
  it("aparece pelos filhos e soma os dois, mesmo com o C2X entregando o grupo agrupado", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("4", "1"),
    });
    const lavra = unica(painel.linhas);
    expect(lavra.id).toBe("pai:lox");
    expect(lavra.codigo).toBe("LOS + LOU");
    expect(lavra.etapas).toBe(2);
    expect(lavra.scenario.total.units).toBe(684);
    expect(lavra.scenario.vendido.units).toBe(650);
  });

  it("pai sem c2x e sem filho autorizado não aparece", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("39"),
    });
    expect(painel.linhas.map((l) => l.id)).toEqual(["pai:gdn"]);
  });
});

describe("escopo parcial: a gleba do Fernando", () => {
  it("Lagoa Bonita com 1 etapa e SÓ a soma dela — nada do Raposo nem do Paulo", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("33"),
    });
    const lagoa = unica(painel.linhas);
    expect(lagoa.id).toBe("pai:lab");
    expect(lagoa.nome).toBe("Lagoa Bonita");
    expect(lagoa.codigo).toBe("LBF");
    expect(lagoa.etapas).toBe(1);
    expect(lagoa.filhos.map((f) => f.codigo)).toEqual(["LBF"]);
    expect(lagoa.scenario).toEqual(LBF.scenario);
    expect(painel.cards.total.units).toBe(47);
  });

  it("o dono do conjunto (sessão com o grupo expandido) vê as três glebas", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      // `idsDaSessao` devolve o id do grupo E as divisões; o grupo não tem linha real e cai fora.
      permitidos: permitir("group:Lagoa Bonita", "33", "27", "32"),
    });
    const lagoa = unica(painel.linhas);
    expect(lagoa.codigo).toBe("LBF + LBR + LBP");
    expect(lagoa.etapas).toBe(3);
    expect(lagoa.scenario.total.units).toBe(412);
  });
});

describe("empreendimento fora do cadastro", () => {
  it("vira linha simples com o nome do C2X apresentável", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("29"),
    });
    const vista = unica(painel.linhas);
    expect(vista.id).toBe("29");
    expect(vista.codigo).toBe("VAL");
    expect(vista.codes).toEqual(["VAL"]);
    expect(vista.nome).toBe("Vista Alegre");
    expect(vista.cidade).toBe("Sete Lagoas");
    expect(vista.uf).toBe("MG");
    expect(vista.etapas).toBe(0);
    expect(vista.scenario).toEqual(VAL.scenario);
  });

  it("sem cadastro nenhum, tudo vira linha simples (degradação)", () => {
    const painel = montarPainelDeProdutos({
      cadastro: [],
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("39", "33"),
    });
    expect(painel.linhas.map((l) => [l.id, l.codigo])).toEqual([
      ["39", "GDN"],
      ["33", "LBF"],
    ]);
  });

  it("⚠️ na degradação o espelho VLO NÃO vira linha ao lado de VOC/VOL/VOR (contaria em dobro)", () => {
    // A sessão natural do coordenador: a tela de gestão lista `enterprises` sem agrupar, então
    // o 35 vem junto com as divisões. Sem cadastro, o VLO (298) somava com os 338 dos filhos.
    const painel = montarPainelDeProdutos({
      cadastro: [],
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("35", "37", "36", "41", "39", "33"),
    });
    expect(painel.linhas.map((l) => l.id).sort()).toEqual(["33", "36", "37", "39", "41"]);
    expect(painel.cards.total.units).toBe(338 + 405 + 47);
    expect(painel.cards.negociacao.units).toBe(0);
  });

  it("na degradação, espelho SOZINHO na sessão continua aparecendo, com o aviso de histórico", () => {
    const painel = montarPainelDeProdutos({
      cadastro: [],
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("35", "39"),
    });
    const vale = painel.linhas.find((l) => l.id === "35");
    expect(vale?.codigo).toBe("VLO");
    expect(vale?.aviso).toBe("Histórico · mesmos lotes de VOC + VOL + VOR");
    expect(painel.linhas.find((l) => l.id === "39")?.aviso).toBeNull();
  });

  it("id autorizado que o C2X não tem não vira linha", () => {
    const painel = montarPainelDeProdutos({
      cadastro: CADASTRO,
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("999", "group:Nada"),
    });
    expect(painel.linhas).toEqual([]);
    expect(painel.cards).toEqual(cenarioVazio());
  });
});

describe("ordem e cards do topo", () => {
  const painel = montarPainelDeProdutos({
    cadastro: CADASTRO,
    estoque: estoqueDeTeste,
    linhasDoC2x: C2X,
    permitidos: permitir("35", "37", "36", "41", "31", "33", "27", "32", "39", "4", "1", "29"),
  });

  it("vendendo primeiro, depois total desc; fora do cadastro vai para o fim", () => {
    // Vendendo: Lagoa 412, Garden 405, Vale 338. Não vendendo: Lavra 684 (inativo), Vista
    // Alegre 126 (fora do cadastro = sem como saber se vende).
    expect(painel.linhas.map((l) => l.id)).toEqual([
      "pai:lab",
      "pai:gdn",
      "pai:vlo",
      "pai:lox",
      "29",
    ]);
  });

  it("os cards são a soma dos pais, sem repetir o espelho nem o LAB", () => {
    // 412 + 405 + 338 + 684 + 126. Nem o VLO (298) nem o LAB (31, sem linha no C2X) entram.
    expect(painel.cards.total.units).toBe(1_965);
    expect(painel.cards.total.value).toBe(196_500);
    expect(painel.cards.negociacao.units).toBe(0);
  });

  it("filho autorizado sem linha no C2X entra zerado, e não some", () => {
    const comFantasma = montarPainelDeProdutos({
      cadastro: [
        linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
        linha({ c2xEnterpriseId: "777", codigo: "GD2", id: "gd2", nome: "Garden 2", paiId: "gdn" }),
      ],
      estoque: estoqueDeTeste,
      linhasDoC2x: C2X,
      permitidos: permitir("39", "777"),
    });
    const garden = unica(comFantasma.linhas);
    expect(garden.etapas).toBe(1);
    expect(garden.scenario).toEqual(cenarioVazio());
  });
});

// ── O PRODUTO QUE SÓ EXISTE NO PANTEON (16/09/2026) ─────────────────────────
//
// Os prédios da Cecílio nascem no cadastro do Panteon (id a partir de 100000) e nunca vão ao C2X.
// O painel já os montava pelo cadastro quando eram pai; o que se trava aqui é o resto: a linha
// avulsa que só aceitava id do C2X, e o 503 do painel inteiro quando o legado caía.
describe("produto do Panteon no painel", () => {
  const JADE = linha({
    c2xEnterpriseId: "100000",
    cidade: "Ipatinga",
    codigo: "JAD",
    id: "jad",
    nome: "Ed. Jade",
    uf: "MG",
  });
  const estoqueComJade = new Map([
    ...estoqueDeTeste,
    ["100000", cenario({ disponivel: 30, reservado: 2, total: 40, vendido: 8 })],
  ]);

  it("pai do cadastro sem linha no C2X: aparece com a moldura do cadastro e o estoque do Panteon", () => {
    const painel = montarPainelDeProdutos({
      cadastro: [...CADASTRO, JADE],
      estoque: estoqueComJade,
      linhasDoC2x: C2X,
      permitidos: permitir("37", "100000"),
    });
    const jade = painel.linhas.find((l) => l.codigo === "JAD");
    expect(jade).toMatchObject({ cidade: "Ipatinga", id: "pai:jad", nome: "Ed. Jade", uf: "MG" });
    expect(jade?.scenario.total.units).toBe(40);
  });

  it("⚠️ a linha avulsa aceita id do Panteon: filho cujo pai não veio na leitura não some", () => {
    const orfao = linha({
      c2xEnterpriseId: "100002",
      cidade: "Ipatinga",
      codigo: "CRI",
      id: "cri",
      nome: "Ed. Cristal",
      paiId: "pai-que-nao-veio",
      uf: "MG",
    });
    const painel = montarPainelDeProdutos({
      cadastro: [orfao],
      estoque: new Map([["100002", cenario({ disponivel: 12, total: 12 })]]),
      linhasDoC2x: C2X,
      permitidos: permitir("100002"),
    });
    const cristal = unica(painel.linhas);
    expect(cristal).toMatchObject({
      cidade: "Ipatinga",
      codes: ["CRI"],
      codigo: "CRI",
      id: "100002",
      nome: "Ed. Cristal",
      uf: "MG",
    });
    expect(cristal.scenario.total.units).toBe(12);
  });

  it("⚠️ a linha avulsa do Panteon continua presa à sessão: id que ela não traz não aparece", () => {
    const painel = montarPainelDeProdutos({
      cadastro: [linha({ c2xEnterpriseId: "100002", codigo: "CRI", id: "cri", paiId: "sumiu" })],
      estoque: new Map(),
      linhasDoC2x: C2X,
      permitidos: permitir("37"),
    });
    expect(painel.linhas.some((l) => l.codigo === "CRI")).toBe(false);
  });

  it("⚠️ cada linha diz se é loteamento ou prédio (a ficha monta o formulário de unidade por ele)", () => {
    const predio = { ...JADE, tipoProduto: "vertical" as const };
    const torre = linha({ c2xEnterpriseId: "100003", codigo: "RUB", id: "rub", paiId: "pai-que-nao-veio", tipoProduto: "vertical" });
    const painel = montarPainelDeProdutos({
      cadastro: [...CADASTRO, predio, torre],
      estoque: estoqueComJade,
      linhasDoC2x: [...C2X, c2x({ code: "VTA", id: "40", scenario: cenario({ total: 5 }) })],
      permitidos: permitir("37", "39", "100000", "100003", "40"),
    });
    const tipo = (codigo: string) => painel.linhas.find((l) => l.codigo === codigo)?.tipoProduto;
    expect(tipo("JAD")).toBe("vertical");
    expect(tipo("RUB")).toBe("vertical");
    // Pai do cadastro sem a coluna (fixture antiga) e linha só do C2X: loteamento.
    expect(tipo("GDN")).toBe("loteamento");
    expect(tipo("VTA")).toBe("loteamento");
    const vale = painel.linhas.find((l) => l.id === "pai:vlo");
    expect(vale?.tipoProduto).toBe("loteamento");
    expect(vale?.filhos.every((f) => f.tipoProduto === "loteamento")).toBe(true);
  });

  it("C2X fora do ar (sem linhas): o painel sai pelo cadastro, com o Panteon e o legado cadastrado", () => {
    const painel = montarPainelDeProdutos({
      cadastro: [...CADASTRO, JADE],
      estoque: estoqueComJade,
      linhasDoC2x: [],
      permitidos: permitir("37", "39", "100000"),
    });
    expect(painel.linhas.map((l) => l.id).sort()).toEqual(["pai:gdn", "pai:jad", "pai:vlo"]);
  });
});

// ── QUEM PODE ESCREVER EM CADA LINHA (decisão do Lucas, 16/09/2026) ─────────
//
// No portal que confecciona (o Cecílio), escrita só no produto que ele opera: o Garden e o que nasce
// no portal são dele; VOC e VOR ficam só consulta. O painel calcula `podeEscrever` com a MESMA régua
// das rotas, para a ficha esconder os botões; e `enterpriseId`, o produto real que a escrita recebe.
describe("podeEscrever e enterpriseId", () => {
  const CECILIO_ID = "inc-cecilio";
  const CECILIO = { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" };
  const GURGEL = { incorporadorId: "inc-gurgel", slug: "gurgel", tipo: "comercial" };

  // O cadastro de sempre, com o Garden e um prédio operados pela Cecílio.
  const OPERADO: LinhaDoCadastro[] = [
    ...CADASTRO.map((l) => (l.id === "gdn" ? { ...l, operadoPor: CECILIO_ID } : l)),
    linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", nome: "Ed. Jade", operadoPor: CECILIO_ID }),
    // Pai do Panteon com dois filhos de donos diferentes.
    linha({ c2xEnterpriseId: "100010", codigo: "MIX", id: "mix", nome: "Misto", operadoPor: CECILIO_ID }),
    linha({ c2xEnterpriseId: "100011", codigo: "MXA", id: "mxa", operadoPor: CECILIO_ID, paiId: "mix" }),
    linha({ c2xEnterpriseId: "100012", codigo: "MXB", id: "mxb", operadoPor: null, paiId: "mix" }),
    // Pai do Panteon com um filho só, da Cecílio.
    linha({ c2xEnterpriseId: null, codigo: "TOR", id: "tor", nome: "Torres", operadoPor: CECILIO_ID }),
    linha({ c2xEnterpriseId: "100020", codigo: "TRA", id: "tra", operadoPor: CECILIO_ID, paiId: "tor" }),
  ];

  const montar = (portal: typeof CECILIO | undefined, permitidos: string[], com0170 = true) =>
    montarPainelDeProdutos({
      cadastro: OPERADO,
      com0170,
      estoque: estoqueDeTeste,
      linhasDoC2x: [...C2X, c2x({ code: "VTA", id: "40", scenario: cenario({ total: 5 }) })],
      permitidos: permitir(...permitidos),
      portal,
    });
  const porCodigo = (painel: ReturnType<typeof montar>, codigo: string) =>
    painel.linhas.find((l) => l.codigo === codigo || l.codes.includes(codigo));

  it("Garden operado pela Cecílio: pode escrever, e a escrita vai para o 39", () => {
    const garden = porCodigo(montar(CECILIO, ["39"]), "GDN");
    expect(garden).toMatchObject({ enterpriseId: "39", operadoPor: CECILIO_ID, podeEscrever: true });
  });

  it("⚠️ VOC no portal da Cecílio: só consulta", () => {
    const vale = porCodigo(montar(CECILIO, ["37"]), "VOC");
    expect(vale?.id).toBe("pai:vlo");
    expect(vale).toMatchObject({ enterpriseId: "37", operadoPor: null, podeEscrever: false });
    expect(vale?.filhos[0]).toMatchObject({ id: "37", operadoPor: null, podeEscrever: false });
  });

  it("comercial: pode escrever em tudo, inclusive no VOC e sem a 0170", () => {
    const painel = montar(GURGEL, ["35", "37", "36", "41", "39", "40"], false);
    expect(painel.linhas.length).toBeGreaterThan(1);
    expect(painel.linhas.every((l) => l.podeEscrever === true)).toBe(true);
    expect(painel.linhas.flatMap((l) => l.filhos).every((f) => f.podeEscrever === true)).toBe(true);
  });

  it("⚠️ pai com dois filhos de donos diferentes: a linha não escreve; cada filho segue o dono", () => {
    const misto = porCodigo(montar(CECILIO, ["100011", "100012"]), "MXA");
    expect(misto).toMatchObject({ enterpriseId: null, operadoPor: null, podeEscrever: false });
    expect(misto?.filhos.map((f) => [f.id, f.podeEscrever])).toEqual([
      ["100011", true],
      ["100012", false],
    ]);
  });

  it("enterpriseId nos quatro formatos", () => {
    const painel = montar(CECILIO, ["39", "40", "100020", "37", "36", "41", "100000"]);
    // linha simples do C2X: o próprio id
    expect(porCodigo(painel, "VTA")?.enterpriseId).toBe("40");
    // pai sem filho: o c2x do pai
    expect(porCodigo(painel, "GDN")?.enterpriseId).toBe("39");
    expect(porCodigo(painel, "JAD")?.enterpriseId).toBe("100000");
    // pai com UM filho autorizado: o id do filho
    expect(porCodigo(painel, "TRA")).toMatchObject({ enterpriseId: "100020", id: "pai:tor", podeEscrever: true });
    // pai com vários filhos: nulo
    expect(porCodigo(painel, "VOC")?.enterpriseId).toBeNull();
  });

  it("linha avulsa do Panteon: o próprio id, com a régua", () => {
    const orfao = linha({ c2xEnterpriseId: "100030", codigo: "CRI", id: "cri", operadoPor: CECILIO_ID, paiId: "sumiu" });
    const painel = montarPainelDeProdutos({
      cadastro: [orfao],
      com0170: true,
      estoque: new Map(),
      linhasDoC2x: [],
      permitidos: permitir("100030"),
      portal: CECILIO,
    });
    expect(unica(painel.linhas)).toMatchObject({ enterpriseId: "100030", podeEscrever: true });
  });

  it("⚠️ espelho sozinho com filho cadastrado (VLO parado): sem enterpriseId", () => {
    const vale = porCodigo(montar(GURGEL, ["35"]), "VLO");
    expect(vale).toMatchObject({ enterpriseId: null, id: "pai:vlo" });
  });

  it("⚠️ sem a 0170 ou sem portal: ninguém do portal que confecciona escreve", () => {
    expect(porCodigo(montar(CECILIO, ["39"], false), "GDN")?.podeEscrever).toBe(false);
    expect(porCodigo(montar(undefined, ["39"]), "GDN")?.podeEscrever).toBe(false);
    expect(porCodigo(montar({ ...CECILIO, slug: "cer" }, ["39"]), "GDN")?.podeEscrever).toBe(false);
  });

  it("⚠️ linha só do C2X (fora do cadastro): a Cecílio não escreve", () => {
    expect(porCodigo(montar(CECILIO, ["40"]), "VTA")).toMatchObject({ operadoPor: null, podeEscrever: false });
  });
});

describe("comEscritaDoFilho", () => {
  it("a ficha aberta numa etapa leva a escrita, o enterprise e o tipo do filho", () => {
    const base = {
      aviso: null,
      cidade: null,
      codigo: "TRA",
      codes: ["TRA"],
      etapas: 0,
      filhos: [],
      id: "100020",
      nome: "Torre A",
      scenario: cenarioVazio(),
      uf: null,
    };
    expect(
      comEscritaDoFilho(base, {
        codigo: "TRA",
        id: "100020",
        nome: "Torre A",
        operadoPor: "inc-cecilio",
        podeEscrever: true,
        scenario: cenarioVazio(),
        tipoProduto: "vertical",
      }),
    ).toMatchObject({ enterpriseId: "100020", operadoPor: "inc-cecilio", podeEscrever: true, tipoProduto: "vertical" });

    expect(
      comEscritaDoFilho(base, { codigo: "TRA", id: "100020", nome: "Torre A", scenario: cenarioVazio() }),
    ).toMatchObject({ enterpriseId: "100020", operadoPor: null, podeEscrever: false });
  });
});

describe("decidirPainelDeProdutos", () => {
  const painelCom = (n: number) => ({
    cards: cenarioVazio(),
    linhas: Array.from({ length: n }, (_, i) => ({
      aviso: null,
      cidade: null,
      codigo: `P${i}`,
      codes: [`P${i}`],
      etapas: 0,
      filhos: [],
      id: `pai:${i}`,
      nome: `Produto ${i}`,
      scenario: cenarioVazio(),
      uf: null,
    })),
  });

  it("C2X respondeu: o painel, sem aviso (inclusive com o cadastro fora)", () => {
    for (const cadastroRespondeu of [true, false]) {
      const r = decidirPainelDeProdutos({ cadastroRespondeu, c2xRespondeu: true, painel: painelCom(0) });
      expect(r).toEqual({ ok: true, painel: { ...painelCom(0), avisoDaFonte: null } });
    }
  });

  it("⚠️ C2X fora com produto no cadastro: o painel sai, com o aviso (antes era 503)", () => {
    const r = decidirPainelDeProdutos({ cadastroRespondeu: true, c2xRespondeu: false, painel: painelCom(2) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.painel.linhas).toHaveLength(2);
      expect(r.painel.avisoDaFonte).toBe(AVISO_DE_PAINEL_PARCIAL);
    }
  });

  it("C2X fora e nada para mostrar, ou C2X e cadastro fora: 503", () => {
    expect(decidirPainelDeProdutos({ cadastroRespondeu: true, c2xRespondeu: false, painel: painelCom(0) }).ok).toBe(false);
    expect(decidirPainelDeProdutos({ cadastroRespondeu: false, c2xRespondeu: false, painel: painelCom(3) }).ok).toBe(false);
  });

  it("o aviso não nomeia sistema e não tem travessão", () => {
    expect(AVISO_DE_PAINEL_PARCIAL).not.toMatch(/C2X|Panteon|Supabase|—|–/);
  });
});
