import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro as LinhaDoMercado } from "@/lib/apolo/empreendimento-de-mercado";
import {
  mapaDeNomesDeMercado,
  nomeDoEmpreendimentoPorId,
} from "@/lib/apolo/nome-de-mercado-por-id";
import { ENTERPRISE_GROUPS, EXCLUDED_ENTERPRISE_IDS } from "@/lib/guardian/c2x-analytics";

import type { LinhaDoCadastro } from "./cadastro";
import {
  empreendimentoPorId,
  grupoPeloId,
  idDoCadastro,
  reguaDoCadastro,
} from "./regua-do-cadastro";

// A RÉGUA DO CADASTRO (PAN-124, F1). O que estes testes cobram:
//   1. os grupos saem de `pai_id` e batem, como CONJUNTO, com `ENTERPRISE_GROUPS.ids`;
//   2. os filhos saem na ordem (ordem, codigo) do cadastro: Lagoa Bonita = LBF, LBP, LBR;
//   3. o VLO (35) é entrada simples E o grupo Vale do Ouro também;
//   4. o LAB (31) fica fora das entradas;
//   5. o nome de mercado bate com `nomeDoEmpreendimentoPorId` nas 38 linhas do cadastro.

type Crua = [codigo: string, nome: string, c2x: null | string, pai: null | string, ordem: number, vendendo: boolean];

// Fotografia de produção de 26/09/2026 (SELECT em hercules_empreendimentos, workspace careli): as 38
// linhas, com o uuid trocado por "u-<sigla>". Em ordem alfabética de sigla, de propósito: a régua é
// quem ordena.
const CRUAS: Crua[] = [
  ["ACP", "Aldeia das Cachoeiras das Pedras", "42", null, 0, true],
  ["CDJ", "Cidade Jardim", "22", null, 9, false],
  ["EDL", "Estancia do Lago", "17", null, 10, false],
  ["GDN", "Garden", "39", null, 1, true],
  ["HDP", "Haras do Passo", "26", null, 11, false],
  ["JDG", "Jardim das Gerais", "40", null, 2, true],
  ["LAB", "Lagoa Bonita", "31", null, 3, true],
  ["LBF", "Lagoa Bonita · LBF", "33", "LAB", 0, true],
  ["LBP", "Lagoa Bonita · LBP", "32", "LAB", 1, true],
  ["LBR", "Lagoa Bonita · LBR", "27", "LAB", 2, true],
  ["LOS", "Lavra do Ouro · LOS", "4", "LOX", 0, false],
  ["LOU", "Lavra do Ouro · LOU", "1", "LOX", 1, false],
  ["LOX", "Lavra do Ouro", null, null, 12, false],
  ["MDB", "Morada da Brisa", "21", null, 15, false],
  ["MDS", "Morada da Serra", "3", null, 16, false],
  ["MLC", "Milenium Mall", "18", null, 14, false],
  ["MLN", "Milenium", "12", null, 13, false],
  ["PDI", "Portal do Ibituruna", "43", null, 19, false],
  ["PDV", "Portal dos Vales · PDV", "7", "PDX", 0, false],
  ["PDX", "Portal dos Vales", null, null, 17, false],
  ["PRI", "Privilege Residence", "24", null, 18, false],
  ["PVS", "Portal dos Vales · PVS", "10", "PDX", 1, false],
  ["RDP", "Rio de Pedras · RDP", "13", "RDX", 0, false],
  ["RDX", "Rio de Pedras", null, null, 20, false],
  ["REP", "Recanto do Pará", "20", null, 4, true],
  ["RPC", "Rio de Pedras · RPC", "15", "RDX", 1, false],
  ["RPS", "Rio de Pedras · RPS", "14", "RDX", 2, false],
  ["RVP", "Villa Paris", "38", null, 7, true],
  ["SOU", "Soul Ipanema", "23", null, 21, false],
  ["TST", "ZZ TESTE - nao e empreendimento real", "9001", null, 999, true],
  ["VAL", "Vista Alegre", "29", null, 8, true],
  ["VBL", "Viva Boulevard", "11", null, 23, false],
  ["VDO", "Veredas do Ouro", "19", null, 6, true],
  ["VDP", "Vistas da Praia", "28", null, 22, false],
  ["VLO", "Vale do Ouro", "35", null, 5, true],
  ["VOC", "Vale do Ouro · VOC", "37", "VLO", 0, true],
  ["VOL", "Vale do Ouro · VOL", "36", "VLO", 1, true],
  ["VOR", "Vale do Ouro · VOR", "41", "VLO", 2, true],
];

function uuid(sigla: string): string {
  return `u-${sigla.toLowerCase()}`;
}

function linha([codigo, nome, c2x, pai, ordem, vendendo]: Crua): LinhaDoCadastro {
  return {
    c2xEnterpriseId: c2x,
    cidade: null,
    codigo,
    id: uuid(codigo),
    nome,
    ordem,
    paiId: pai ? uuid(pai) : null,
    uf: null,
    vendendo,
  };
}

const CADASTRO: LinhaDoCadastro[] = CRUAS.map(linha);

// O mesmo cadastro no formato que o sync do Apolo lê (`lerNomesDeMercado`: colunas cruas, por uuid).
const CADASTRO_DO_SYNC: LinhaDoMercado[] = [...CADASTRO]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((l) => ({ c2x_enterprise_id: l.c2xEnterpriseId, id: l.id, nome: l.nome, pai_id: l.paiId }));

const REGUA = reguaDoCadastro(CADASTRO);

describe("fotografia do cadastro", () => {
  it("tem as 38 linhas de 26/09/2026, 35 com id do C2X", () => {
    expect(CADASTRO).toHaveLength(38);
    expect(CADASTRO.filter((l) => l.c2xEnterpriseId)).toHaveLength(35);
  });
});

describe("grupos derivados de pai_id", () => {
  it("são os cinco de ENTERPRISE_GROUPS, com os mesmos ids como CONJUNTO", () => {
    expect(REGUA.grupos.map((g) => g.chave).sort()).toEqual(
      ENTERPRISE_GROUPS.map((g) => g.display).sort(),
    );

    for (const constante of ENTERPRISE_GROUPS) {
      const grupo = REGUA.grupos.find((g) => g.chave === constante.display);
      expect(grupo, constante.display).toBeDefined();
      expect(new Set(grupo?.ids), constante.display).toEqual(new Set(constante.ids.map(String)));
      expect(new Set(grupo?.siglas), constante.display).toEqual(new Set(constante.codes));
      expect(grupo?.id).toBe(`group:${constante.display}`);
    }
  });

  it("os conjuntos medidos: LOX {1,4}, PDX {7,10}, RDX {13,14,15}, LAB {27,32,33}, VLO {36,37,41}", () => {
    const porSiglaDoPai = Object.fromEntries(
      REGUA.grupos.map((g) => [g.pai.sigla, [...g.ids].map(Number).sort((a, b) => a - b)]),
    );
    expect(porSiglaDoPai).toEqual({
      LAB: [27, 32, 33],
      LOX: [1, 4],
      PDX: [7, 10],
      RDX: [13, 14, 15],
      VLO: [36, 37, 41],
    });
  });

  it("os filhos saem na ordem (ordem, codigo) do cadastro, e não na da constante", () => {
    const lagoa = grupoPeloId(REGUA, "group:Lagoa Bonita");
    expect(lagoa?.siglas).toEqual(["LBF", "LBP", "LBR"]);
    expect(lagoa?.ids).toEqual(["33", "32", "27"]);
    // A constante diz LBF, LBR, LBP (c2x-analytics.ts). Quem compara com ela compara como conjunto.
    expect(ENTERPRISE_GROUPS.find((g) => g.display === "Lagoa Bonita")?.codes).toEqual(["LBF", "LBR", "LBP"]);

    expect(grupoPeloId(REGUA, "group:Vale do Ouro")?.siglas).toEqual(["VOC", "VOL", "VOR"]);
    expect(grupoPeloId(REGUA, "group:Rio de Pedras")?.siglas).toEqual(["RDP", "RPC", "RPS"]);
    expect(grupoPeloId(REGUA, "group:Lavra do Ouro")?.siglas).toEqual(["LOS", "LOU"]);
    expect(grupoPeloId(REGUA, "group:Portal dos Vales")?.siglas).toEqual(["PDV", "PVS"]);
  });

  it("a ordem é a do campo `ordem`, e o código só desempata (a mesma do Hércules)", () => {
    const trocada = CADASTRO.map((l) =>
      l.codigo === "LBP" ? { ...l, ordem: 5 } : l.codigo === "LBR" ? { ...l, ordem: 1 } : l,
    );
    expect(grupoPeloId(reguaDoCadastro(trocada), "group:Lagoa Bonita")?.siglas).toEqual(["LBF", "LBR", "LBP"]);

    const empatada = CADASTRO.map((l) => (l.paiId === uuid("VLO") ? { ...l, ordem: 0 } : l));
    expect(grupoPeloId(reguaDoCadastro(empatada), "group:Vale do Ouro")?.siglas).toEqual(["VOC", "VOL", "VOR"]);
  });

  it("não depende da ordem em que o cadastro chega", () => {
    const invertida = reguaDoCadastro([...CADASTRO].reverse());
    expect(invertida.grupos.map((g) => [g.chave, g.siglas])).toEqual(REGUA.grupos.map((g) => [g.chave, g.siglas]));
    expect(invertida.entradas.map((e) => e.id)).toEqual(REGUA.entradas.map((e) => e.id));
  });

  it("acha o grupo sem diferença de caixa nem de acento, e só pelo prefixo group:", () => {
    expect(grupoPeloId(REGUA, "GROUP:lagoa bonita")?.chave).toBe("Lagoa Bonita");
    expect(grupoPeloId(REGUA, " group:Vale do Ouro ")?.chave).toBe("Vale do Ouro");
    expect(grupoPeloId(REGUA, "Lagoa Bonita")).toBeNull();
    expect(grupoPeloId(REGUA, "group:")).toBeNull();
    expect(grupoPeloId(REGUA, "group:Garden")).toBeNull();
    expect(grupoPeloId(REGUA, "35")).toBeNull();
  });
});

describe("regra 1: o VLO (35) é entrada simples E o grupo Vale do Ouro também", () => {
  it("as duas entradas existem", () => {
    const simples = REGUA.entradas.find((e) => e.id === "35");
    const grupo = REGUA.entradas.find((e) => e.id === "group:Vale do Ouro");

    expect(simples).toMatchObject({ ids: ["35"], nomeDeMercado: "Vale do Ouro", siglas: ["VLO"], tipo: "simples" });
    expect(grupo).toMatchObject({ ids: ["37", "36", "41"], nomeDeMercado: "Vale do Ouro", tipo: "grupo" });
    // Os dois apontam para o mesmo pai do cadastro.
    expect(simples?.panteonId).toBe(uuid("VLO"));
    expect(grupo?.panteonId).toBe(uuid("VLO"));
  });

  it("o 35 responde como pai do grupo, com os filhos na ordem", () => {
    const vlo = empreendimentoPorId(REGUA, "35");
    expect(vlo).toMatchObject({ chaveDoGrupo: "Vale do Ouro", excluido: false, pai: null, sigla: "VLO" });
    expect(vlo?.filhos.map((f) => f.sigla)).toEqual(["VOC", "VOL", "VOR"]);
  });

  it("o espelho não entra nas divisões do grupo (somaria o loteamento duas vezes)", () => {
    expect(grupoPeloId(REGUA, "group:Vale do Ouro")?.ids).not.toContain("35");
  });
});

describe("regra 2: o LAB (31) continua fora", () => {
  it("nenhuma entrada tem o 31, e a Lagoa Bonita aparece só como grupo", () => {
    expect(EXCLUDED_ENTERPRISE_IDS).toEqual([2, 31, 34]);
    expect(REGUA.entradas.filter((e) => e.ids.includes("31"))).toEqual([]);
    expect(REGUA.entradas.find((e) => e.id === "31")).toBeUndefined();
    expect(REGUA.entradas.filter((e) => e.nomeDeMercado === "Lagoa Bonita").map((e) => e.id)).toEqual([
      "group:Lagoa Bonita",
    ]);
  });

  it("pelo id a régua ainda responde o 31, marcado como excluído (o sync do Apolo lê o nome dele)", () => {
    expect(empreendimentoPorId(REGUA, 31)).toMatchObject({
      chaveDoGrupo: "Lagoa Bonita",
      excluido: true,
      nomeDeMercado: "Lagoa Bonita",
      sigla: "LAB",
    });
  });

  it("com a exclusão vazia, o 31 volta a ser entrada simples (a regra é a lista, não o id fixo)", () => {
    const semExclusao = reguaDoCadastro(CADASTRO, { excluir: [] });
    expect(semExclusao.entradas.find((e) => e.id === "31")?.tipo).toBe("simples");
    expect(empreendimentoPorId(semExclusao, "31")?.excluido).toBe(false);
  });

  it("divisão excluída fica no grupo como divisão, mas não nos ids", () => {
    const regua = reguaDoCadastro(CADASTRO, { excluir: [27] });
    const lagoa = grupoPeloId(regua, "group:Lagoa Bonita");
    expect(lagoa?.divisoes.map((d) => d.sigla)).toEqual(["LBF", "LBP", "LBR"]);
    expect(lagoa?.ids).toEqual(["33", "32"]);
    expect(lagoa?.siglas).toEqual(["LBF", "LBP"]);
  });
});

describe("as entradas, no molde do catálogo", () => {
  it("5 grupos e 21 simples: filho não vira entrada simples", () => {
    expect(REGUA.entradas.filter((e) => e.tipo === "grupo")).toHaveLength(5);
    expect(REGUA.entradas.filter((e) => e.tipo === "simples")).toHaveLength(21);

    const filhos = CADASTRO.filter((l) => l.paiId).map((l) => l.c2xEnterpriseId);
    expect(REGUA.entradas.filter((e) => e.tipo === "simples" && filhos.includes(e.id))).toEqual([]);
  });

  it("pai só do Panteon (LOX, PDX, RDX) aparece só como grupo", () => {
    for (const sigla of ["LOX", "PDX", "RDX"]) {
      const doPai = REGUA.entradas.filter((e) => e.panteonId === uuid(sigla));
      expect(doPai.map((e) => e.tipo), sigla).toEqual(["grupo"]);
    }
  });

  it("saem na ordem do cadastro, o simples do pai antes do grupo dele", () => {
    const ids = REGUA.entradas.map((e) => e.id);
    expect(ids.slice(0, 7)).toEqual(["42", "39", "40", "group:Lagoa Bonita", "20", "35", "group:Vale do Ouro"]);
  });

  it("filho cujo pai não veio na leitura fica como simples, com o nome pelo prefixo", () => {
    const semOPai = CADASTRO.filter((l) => l.codigo !== "LOX");
    const regua = reguaDoCadastro(semOPai);
    expect(regua.grupos.map((g) => g.chave)).not.toContain("Lavra do Ouro");
    expect(regua.entradas.find((e) => e.id === "4")).toMatchObject({ nomeDeMercado: "Lavra do Ouro", tipo: "simples" });
    expect(empreendimentoPorId(regua, "4")).toMatchObject({ chaveDoGrupo: null, pai: null });
  });
});

describe("pelo id: nome de mercado, sigla, pai, filhos e chave do grupo", () => {
  it("o filho responde com o pai e a chave do grupo dele", () => {
    expect(empreendimentoPorId(REGUA, "37")).toMatchObject({
      chaveDoGrupo: "Vale do Ouro",
      filhos: [],
      nome: "Vale do Ouro · VOC",
      nomeDeMercado: "Vale do Ouro",
      pai: { c2xEnterpriseId: "35", panteonId: uuid("VLO"), sigla: "VLO" },
      sigla: "VOC",
    });
    // Pai só do Panteon: o filho sobe para ele do mesmo jeito.
    expect(empreendimentoPorId(REGUA, "4")).toMatchObject({
      chaveDoGrupo: "Lavra do Ouro",
      nomeDeMercado: "Lavra do Ouro",
      pai: { c2xEnterpriseId: null, sigla: "LOX" },
      sigla: "LOS",
    });
  });

  it("o empreendimento sem divisão não tem grupo", () => {
    expect(empreendimentoPorId(REGUA, "43")).toMatchObject({
      chaveDoGrupo: null,
      filhos: [],
      nomeDeMercado: "Portal do Ibituruna",
      pai: null,
      sigla: "PDI",
    });
  });

  it("aceita número, texto com espaço e Buffer, e o id fora do cadastro volta null", () => {
    expect(empreendimentoPorId(REGUA, 37)?.sigla).toBe("VOC");
    expect(empreendimentoPorId(REGUA, " 37 ")?.sigla).toBe("VOC");
    expect(empreendimentoPorId(REGUA, Buffer.from("37"))?.sigla).toBe("VOC");
    expect(empreendimentoPorId(REGUA, "30")).toBeNull();
    expect(empreendimentoPorId(REGUA, "")).toBeNull();
    expect(empreendimentoPorId(REGUA, null)).toBeNull();
    expect(idDoCadastro(undefined)).toBe("");
  });

  it("o nome de mercado bate com nomeDoEmpreendimentoPorId nas 38 linhas", () => {
    const mapa = mapaDeNomesDeMercado(CADASTRO_DO_SYNC);
    const C2X = "NOME QUE O C2X MANDOU";
    let conferidas = 0;

    for (const l of CADASTRO) {
      const id = l.c2xEnterpriseId;
      const doSync = nomeDoEmpreendimentoPorId(mapa, id, C2X);
      const daRegua = empreendimentoPorId(REGUA, id)?.nomeDeMercado || C2X;
      expect(daRegua, l.codigo).toBe(doSync);
      if (!id) expect(doSync, l.codigo).toBe(C2X);
      conferidas += 1;
    }
    expect(conferidas).toBe(38);

    // E o mapa da régua é o mesmo que o sync grava.
    expect(new Map(REGUA.nomesDeMercado)).toEqual(mapa);
  });

  it("id que o cadastro não conhece fica com o nome do C2X nos dois", () => {
    const mapa = mapaDeNomesDeMercado(CADASTRO_DO_SYNC);
    for (const id of ["2", "30", "34", "44"]) {
      expect(empreendimentoPorId(REGUA, id)).toBeNull();
      expect(nomeDoEmpreendimentoPorId(mapa, id, "DO C2X")).toBe("DO C2X");
    }
  });

  it("os nomes de mercado medidos: o filho mostra o pai, sem a divisão", () => {
    const nome = (id: string) => empreendimentoPorId(REGUA, id)?.nomeDeMercado;
    expect(["33", "32", "27", "31"].map(nome)).toEqual(Array(4).fill("Lagoa Bonita"));
    expect(["37", "36", "41", "35"].map(nome)).toEqual(Array(4).fill("Vale do Ouro"));
    expect(["4", "1"].map(nome)).toEqual(Array(2).fill("Lavra do Ouro"));
    expect(["7", "10"].map(nome)).toEqual(Array(2).fill("Portal dos Vales"));
    expect(["13", "15", "14"].map(nome)).toEqual(Array(3).fill("Rio de Pedras"));
    expect(nome("42")).toBe("Aldeia das Cachoeiras das Pedras");
    expect(nome("20")).toBe("Recanto do Pará");
  });
});
