import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { reguaDoCadastro } from "@/lib/hercules/regua-do-cadastro";

import { type FontesDoTermo, resolverTermoDeEmpreendimento } from "./empreendimento-do-termo";

// O TERMO DE EMPREENDIMENTO EM IDS (PAN-124, F6). Cadastro e nomes do C2X de 01/10/2026.

type Crua = [codigo: string, nome: string, c2x: null | string, pai: null | string, chave?: string];

const CRUAS: Crua[] = [
  ["LAB", "Lagoa Bonita", "31", null, "Lagoa Bonita"],
  ["LBF", "Lagoa Bonita · LBF", "33", "LAB"],
  ["LBP", "Lagoa Bonita · LBP", "32", "LAB"],
  ["LBR", "Lagoa Bonita · LBR", "27", "LAB"],
  ["VLO", "Vale do Ouro", "35", null, "Vale do Ouro"],
  ["VOC", "Vale do Ouro · VOC", "37", "VLO"],
  ["VOL", "Vale do Ouro · VOL", "36", "VLO"],
  ["VOR", "Vale do Ouro · VOR", "41", "VLO"],
  ["VDO", "Veredas do Ouro", "19", null],
  ["VAL", "Vista Alegre", "29", null],
  ["RVP", "Villa Paris", "38", null],
];

const CADASTRO: LinhaDoCadastro[] = CRUAS.map(([codigo, nome, c2x, pai, chave], ordem) => ({
  c2xEnterpriseId: c2x,
  chaveDoGrupo: chave ?? null,
  cidade: null,
  codigo,
  id: `u-${codigo.toLowerCase()}`,
  nome,
  ordem,
  paiId: pai ? `u-${pai.toLowerCase()}` : null,
  uf: null,
  vendendo: true,
}));

const FONTES: FontesDoTermo = {
  nomesDoC2x: new Map(
    (
      [
        [19, "VDO", "VEREDAS DO OURO"],
        [29, "VAL", "VISTA ALEGRE"],
        [30, "ACT", "ALDEIA DA CACHOEIRA DAS PEDRAS - TERMO DE ADESAO E TRANSFERENCIA"],
        [35, "VLO", "VALE DO OURO"],
        [37, "VOC", "VALE DO OURO"],
        [38, "RVP", "RESIDENCIAL VILLA PARIS"],
      ] as const
    ).map(([id, code, name]) => [id, { code, name }]),
  ),
  regua: reguaDoCadastro(CADASTRO),
};

const ids = (termo: string, fontes = FONTES) =>
  [...(resolverTermoDeEmpreendimento(termo, fontes)?.ids ?? [])].sort();

describe("resolverTermoDeEmpreendimento", () => {
  it("'Villa Paris' e 'Residencial Villa Paris' dão o mesmo 38", () => {
    expect(ids("Villa Paris")).toEqual(["38"]);
    expect(ids("Residencial Villa Paris")).toEqual(["38"]);
    expect(resolverTermoDeEmpreendimento("residencial villa paris", FONTES)?.nome).toBe("Villa Paris");
  });

  it("o loteamento traz o pai, todas as divisões e o group:", () => {
    expect(ids("Vale do Ouro")).toEqual(["35", "36", "37", "41", "group:Vale do Ouro"].sort());
    expect(resolverTermoDeEmpreendimento("VALE DO OURO", FONTES)?.nome).toBe("Vale do Ouro");
  });

  it("a sigla de uma divisão e o id dela também trazem o grupo inteiro", () => {
    expect(ids("VOC")).toEqual(ids("Vale do Ouro"));
    expect(ids("37")).toEqual(ids("Vale do Ouro"));
    expect(ids("LBF")).toEqual(["27", "31", "32", "33", "group:Lagoa Bonita"].sort());
  });

  it("group:<chave> resolve pelo cadastro, sem caixa nem acento", () => {
    expect(ids("group:lagoa bonita")).toEqual(["27", "31", "32", "33", "group:Lagoa Bonita"].sort());
    expect(resolverTermoDeEmpreendimento("group:Nao Existe", FONTES)).toBeNull();
  });

  it("o id sem cadastro (30) resolve pelo C2X", () => {
    expect(ids("30")).toEqual(["30"]);
    expect(ids("ACT")).toEqual(["30"]);
    expect(resolverTermoDeEmpreendimento("999", FONTES)).toBeNull();
  });

  it("termo genérico casa como o ilike de antes: 'ouro' traz os dois loteamentos", () => {
    expect(ids("ouro")).toEqual(["19", "35", "36", "37", "41", "group:Vale do Ouro"].sort());
  });

  it("⚠️ a sigla curta não casa por pedaço de palavra ('valeria' não é o VAL)", () => {
    expect(resolverTermoDeEmpreendimento("valeria", FONTES)).toBeNull();
    expect(ids("vista alegre val")).toEqual(["29"]);
  });

  it("depois de um renome no Panteon, o nome novo acha (e o do C2X continua achando)", () => {
    const renomeado = CADASTRO.map((l) => (l.codigo === "RVP" ? { ...l, nome: "Paris Residencial" } : l));
    const fontes = { ...FONTES, regua: reguaDoCadastro(renomeado) };
    expect(ids("Paris Residencial", fontes)).toEqual(["38"]);
    expect(ids("Residencial Villa Paris", fontes)).toEqual(["38"]);
  });

  it("nada casou, ou termo vazio: null, e quem chama volta ao texto", () => {
    expect(resolverTermoDeEmpreendimento("Loteamento Inexistente", FONTES)).toBeNull();
    expect(resolverTermoDeEmpreendimento("", FONTES)).toBeNull();
    expect(resolverTermoDeEmpreendimento("  ", { nomesDoC2x: new Map(), regua: null })).toBeNull();
  });
});
