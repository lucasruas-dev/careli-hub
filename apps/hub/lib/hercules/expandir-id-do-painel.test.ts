import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";

import type { LinhaDoCadastro } from "./cadastro";
import {
  alcanceDoPai,
  codigosDosIdsDoC2x,
  ehIdDoPai,
  expandirIdDoPainel,
  filhosDoCadastro,
  idDoPainelDoPai,
} from "./expandir-id-do-painel";

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

// O cadastro REAL de 02/09/2026, nos quatro casos que importam.
const CADASTRO: LinhaDoCadastro[] = [
  // Vale do Ouro: pai = espelho VLO 35 (parado no C2X) + três visões.
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", ordem: 1, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", ordem: 2, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "41", codigo: "VOR", id: "vor", ordem: 3, paiId: "vlo" }),
  // Lagoa Bonita: pai = espelho LAB 31 + as três glebas.
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Lagoa Bonita" }),
  linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", ordem: 1, paiId: "lab" }),
  linha({ c2xEnterpriseId: "27", codigo: "LBR", id: "lbr", ordem: 2, paiId: "lab" }),
  linha({ c2xEnterpriseId: "32", codigo: "LBP", id: "lbp", ordem: 3, paiId: "lab" }),
  // Garden: pai sem filho.
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  // Lavra do Ouro: pai SÓ no Panteon (sem id do C2X) + duas fases.
  linha({ codigo: "LOX", id: "lox", nome: "Lavra do Ouro" }),
  linha({ c2xEnterpriseId: "4", codigo: "LOS", id: "los", ordem: 1, paiId: "lox" }),
  linha({ c2xEnterpriseId: "1", codigo: "LOU", id: "lou", ordem: 2, paiId: "lox" }),
];

const TUDO = new Set(["35", "37", "36", "41", "31", "33", "27", "32", "39", "4", "1"]);

describe("o id do pai", () => {
  it("nasce com o prefixo e é reconhecido por ele", () => {
    expect(idDoPainelDoPai("abc")).toBe("pai:abc");
    expect(ehIdDoPai("pai:abc")).toBe(true);
    expect(ehIdDoPai("  pai:abc")).toBe(true);
    expect(ehIdDoPai("35")).toBe(false);
    expect(ehIdDoPai("group:Lagoa Bonita")).toBe(false);
    expect(ehIdDoPai(null)).toBe(false);
  });
});

describe("filhosDoCadastro", () => {
  it("indexa por pai e ordena por `ordem`, depois código", () => {
    const filhos = filhosDoCadastro([
      linha({ codigo: "B", id: "b", ordem: 0, paiId: "p" }),
      linha({ codigo: "A", id: "a", ordem: 0, paiId: "p" }),
      linha({ codigo: "Z", id: "z", ordem: -1, paiId: "p" }),
      linha({ codigo: "P", id: "p" }),
    ]);

    expect(filhos.get("p")?.map((f) => f.codigo)).toEqual(["Z", "A", "B"]);
    expect(filhos.has("a")).toBe(false);
  });
});

describe("alcanceDoPai", () => {
  const vlo = linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro" });
  const filhos = CADASTRO.filter((l) => l.paiId === "vlo");

  it("⚠️ com filho autorizado o espelho fica de FORA, mesmo autorizado", () => {
    expect(alcanceDoPai(vlo, filhos, TUDO)).toEqual({
      espelho: null,
      filhos: filhos,
    });
  });

  it("só os filhos autorizados entram: o Cecílio (VOC) não alcança o Lino (VOL)", () => {
    const alcance = alcanceDoPai(vlo, filhos, new Set(["37"]));
    expect(alcance.filhos.map((f) => f.codigo)).toEqual(["VOC"]);
    expect(alcance.espelho).toBeNull();
  });

  it("sessão que só carrega o espelho recebe o espelho (único número que ela alcança)", () => {
    expect(alcanceDoPai(vlo, filhos, new Set(["35"]))).toEqual({ espelho: "35", filhos: [] });
  });

  it("nada autorizado = nada", () => {
    expect(alcanceDoPai(vlo, filhos, new Set(["39"]))).toEqual({ espelho: null, filhos: [] });
  });
});

describe("expandirIdDoPainel", () => {
  it("pai com filhos → os c2x ids dos filhos, na ordem do cadastro (espelho 35 fora)", () => {
    expect(expandirIdDoPainel("pai:vlo", CADASTRO, TUDO)).toEqual(["37", "36", "41"]);
    expect(expandirIdDoPainel("pai:lab", CADASTRO, TUDO)).toEqual(["33", "27", "32"]);
  });

  it("escopo parcial: só o que a sessão tem (a gleba do Fernando, e nada do Raposo)", () => {
    expect(expandirIdDoPainel("pai:lab", CADASTRO, new Set(["33"]))).toEqual(["33"]);
  });

  it("pai sem filho (Garden) → o próprio c2x id", () => {
    expect(expandirIdDoPainel("pai:gdn", CADASTRO, TUDO)).toEqual(["39"]);
    expect(expandirIdDoPainel("pai:gdn", CADASTRO, new Set(["35"]))).toEqual([]);
  });

  it("pai sem c2x (Lavra do Ouro) → os filhos; sem filho autorizado, nada", () => {
    expect(expandirIdDoPainel("pai:lox", CADASTRO, TUDO)).toEqual(["4", "1"]);
    expect(expandirIdDoPainel("pai:lox", CADASTRO, new Set(["1"]))).toEqual(["1"]);
    expect(expandirIdDoPainel("pai:lox", CADASTRO, new Set(["39"]))).toEqual([]);
  });

  it("pai com filhos mas sessão só com o espelho → o espelho", () => {
    expect(expandirIdDoPainel("pai:vlo", CADASTRO, new Set(["35"]))).toEqual(["35"]);
  });

  it("⚠️ uuid inventado, ou uuid de FILHO, não abre nada", () => {
    expect(expandirIdDoPainel("pai:nao-existe", CADASTRO, TUDO)).toEqual([]);
    expect(expandirIdDoPainel("pai:voc", CADASTRO, TUDO)).toEqual([]);
    expect(expandirIdDoPainel("pai:", CADASTRO, TUDO)).toEqual([]);
  });

  it("valor que não é pai passa direto, só se autorizado", () => {
    expect(expandirIdDoPainel("37", CADASTRO, TUDO)).toEqual(["37"]);
    expect(expandirIdDoPainel(" 37 ", CADASTRO, TUDO)).toEqual(["37"]);
    expect(expandirIdDoPainel("99", CADASTRO, TUDO)).toEqual([]);
    expect(expandirIdDoPainel("", CADASTRO, TUDO)).toEqual([]);
    expect(expandirIdDoPainel(null, CADASTRO, TUDO)).toEqual([]);
  });
});

describe("codigosDosIdsDoC2x", () => {
  // Catálogo REAL do C2X (o mesmo dos testes do escopo): Lagoa Bonita vem AGRUPADA.
  const CATALOGO = agrupar([
    { code: "LBF", id: 33, name: "LAGOA BONITA" },
    { code: "LBR", id: 27, name: "LAGOA BONITA" },
    { code: "LBP", id: 32, name: "LAGOA BONITA" },
    { code: "VOC", id: 37, name: "VALE DO OURO" },
    { code: "VOL", id: 36, name: "VALE DO OURO" },
    { code: "GDN", id: 39, name: "GARDEN" },
  ]);

  it("acha o código da DIVISÃO dentro do grupo, e o do simples", () => {
    // A ordem é a do catálogo (por nome: Garden antes de Lagoa Bonita), não a dos ids pedidos —
    // a leitura de vendas recebe a lista num `in (...)`, onde ordem não importa.
    expect(codigosDosIdsDoC2x(CATALOGO, ["33", "39"])).toEqual(["GDN", "LBF"]);
  });

  it("id que o catálogo não conhece some, sem inventar código", () => {
    expect(codigosDosIdsDoC2x(CATALOGO, ["99"])).toEqual([]);
    expect(codigosDosIdsDoC2x(CATALOGO, [])).toEqual([]);
  });

  it("não repete código", () => {
    expect(codigosDosIdsDoC2x(CATALOGO, ["37", "37", " 37"])).toEqual(["VOC"]);
  });
});
