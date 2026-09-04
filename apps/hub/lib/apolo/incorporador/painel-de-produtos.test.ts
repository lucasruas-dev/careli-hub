import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  type Cenario,
  cenarioVazio,
  linhasReaisDoC2x,
  montarPainelDeProdutos,
  somarCenarios,
} from "./painel-de-produtos";

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
const VLO = c2x({
  code: "VLO",
  id: "35",
  mirror: true,
  mirrorLabel: "Histórico · mesmos lotes de VOC + VOL",
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
    expect(vale.aviso).toBe("Histórico · mesmos lotes de VOC + VOL");
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
    expect(vale?.aviso).toBe("Histórico · mesmos lotes de VOC + VOL");
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
