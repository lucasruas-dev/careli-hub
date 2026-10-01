import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { reguaDoCadastro } from "@/lib/hercules/regua-do-cadastro";

import {
  acharNaLista,
  type EntradaDaLista,
  montarListaDoPainel,
  slugDoNome,
} from "./painel-coordenador-lista";

// O PAINEL DO COORDENADOR PELO ID (PAN-124, F6). Cadastro, nomes do C2X e contagens de 01/10/2026
// (só SELECT). O que estes testes cobram:
//   1. os grupos do cadastro viram UM empreendimento, com o pai, todas as divisões e o group:<chave>;
//   2. o group:Lagoa Bonita, que o Number() descartava, passa a contar;
//   3. o link novo é a chave; o antigo abre por apelido; o que não casa dá null, NUNCA o primeiro.

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
  ["LOX", "Lavra do Ouro", null, null, "Lavra do Ouro"],
  ["LOU", "Lavra do Ouro · LOU", "1", "LOX"],
  ["LOS", "Lavra do Ouro · LOS", "4", "LOX"],
  ["RVP", "Villa Paris", "38", null],
  ["ACP", "Aldeia das Cachoeiras das Pedras", "42", null],
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

// Os nomes do C2X (enterprises.name), de onde saíam os slugs dos links que circulam.
const NOMES_DO_C2X = new Map<number, { code: string; name: string }>(
  (
    [
      [1, "LOU", "LAVRA DO OURO"],
      [4, "LOS", "LAVRA DO OURO"],
      [27, "LBR", "LAGOA BONITA"],
      [31, "LAB", "LAGOA BONITA - MASTERPLAN"],
      [32, "LBP", "LAGOA BONITA"],
      [33, "LBF", "LAGOA BONITA"],
      [35, "VLO", "VALE DO OURO"],
      [36, "VOL", "VALE DO OURO"],
      [37, "VOC", "VALE DO OURO"],
      [38, "RVP", "RESIDENCIAL VILLA PARIS"],
      [41, "VOR", "VALE DO OURO"],
      [42, "ACP", "ALDEIA DA CACHOEIRA DAS PEDRAS"],
      [19, "VDO", "VEREDAS DO OURO"],
    ] as const
  ).map(([id, code, name]) => [id, { code, name }]),
);

// As contagens de 01/10/2026 (CADs na esteira; vínculos de imobiliária por id).
const CADS: Array<[string, number]> = [
  ["group:Lagoa Bonita", 4], ["1", 1], ["4", 1], ["19", 5], ["27", 1], ["31", 1], ["32", 1], ["33", 1],
  ["35", 694], ["36", 2], ["37", 1], ["38", 64], ["41", 1], ["42", 21],
];
const IMOBS: Array<[string, number]> = [
  ["group:Lagoa Bonita", 8], ["19", 43], ["27", 42], ["31", 3], ["32", 21], ["33", 27], ["35", 40],
  ["36", 23], ["37", 22], ["38", 16], ["41", 2], ["42", 40],
];

function entrada(cadastro: LinhaDoCadastro[] | null = CADASTRO): EntradaDaLista {
  const esteira = CADS.flatMap(([id, n]) =>
    Array.from({ length: n }, () => ({ empreendimento: `texto ${id}`, enterprise_id: id })),
  );
  // Cada vínculo, uma imobiliária DIFERENTE por id (o total por grupo vira a soma).
  const vinculos = IMOBS.flatMap(([id, n]) =>
    Array.from({ length: n }, (_, i) => ({
      entity_id: `imob-${id}-${i}`,
      label: null,
      metadata: { enterpriseId: id },
    })),
  );
  return {
    ehImobiliaria: new Set(vinculos.map((v) => v.entity_id)),
    esteira,
    nomesDoC2x: NOMES_DO_C2X,
    regua: cadastro ? reguaDoCadastro(cadastro) : null,
    vinculos,
  };
}

const LISTA = montarListaDoPainel(entrada());
const porChave = (chave: string) => LISTA.find((item) => item.chave === chave);

describe("a lista do painel, agrupada pelo cadastro", () => {
  it("o Vale do Ouro é um só, com o pai, as três divisões (o VOR entra) e o group:", () => {
    const vale = porChave("group:Vale do Ouro")!;

    expect([...vale.ids].sort((a, b) => a - b)).toEqual([35, 36, 37, 41]);
    expect(vale.idsGravados).toContain("group:Vale do Ouro");
    expect(vale.cads).toBe(694 + 2 + 1 + 1);
    expect(vale.imobiliarias).toBe(40 + 23 + 22 + 2);
    expect(vale.nome).toBe("Vale do Ouro");
    expect(LISTA.filter((item) => item.ids.some((id) => [35, 36, 37, 41].includes(id)))).toHaveLength(1);
  });

  it("🔴 a Lagoa Bonita junta LAB, as três glebas e o group: que o Number() descartava", () => {
    const lagoa = porChave("group:Lagoa Bonita")!;

    expect([...lagoa.ids].sort((a, b) => a - b)).toEqual([27, 31, 32, 33]);
    expect(lagoa.cads).toBe(4 + 1 + 1 + 1 + 1);
    expect(lagoa.imobiliarias).toBe(8 + 42 + 3 + 21 + 27);
  });

  it("o pai só do Panteon (LOX) agrupa as divisões dele; o simples fica sozinho", () => {
    expect([...porChave("group:Lavra do Ouro")!.ids].sort((a, b) => a - b)).toEqual([1, 4]);
    expect(porChave("38")?.ids).toEqual([38]);
    expect(porChave("38")?.nome).toBe("Villa Paris");
    // Sem cadastro, o nome vem do C2X.
    expect(porChave("19")?.nome).toBe("VEREDAS DO OURO");
  });

  it("sem cadastro, nada agrupa, mas nada some: cada id no seu lugar", () => {
    const semCadastro = montarListaDoPainel(entrada(null));
    const total = (lista: typeof LISTA) => lista.reduce((soma, item) => soma + item.cads, 0);

    expect(total(semCadastro)).toBe(total(LISTA));
    expect(semCadastro.find((item) => item.chave === "35")?.cads).toBe(694);
  });

  it("ordem: mais CADs primeiro", () => {
    expect(LISTA[0]?.chave).toBe("group:Vale do Ouro");
    expect(LISTA[1]?.chave).toBe("38");
  });
});

describe("o link (?emp=)", () => {
  it("a chave nova abre direto, e não muda com renome do pai", () => {
    expect(acharNaLista(LISTA, "group:Vale do Ouro")?.chave).toBe("group:Vale do Ouro");
    expect(acharNaLista(LISTA, "GROUP:vale do ouro")?.chave).toBe("group:Vale do Ouro");
    expect(acharNaLista(LISTA, "38")?.chave).toBe("38");

    const renomeado = CADASTRO.map((l) => (l.codigo === "VLO" ? { ...l, nome: "Vale do Ouro Premium" } : l));
    const listaNova = montarListaDoPainel(entrada(renomeado));
    expect(acharNaLista(listaNova, "group:Vale do Ouro")?.nome).toBe("Vale do Ouro Premium");
  });

  it("o link de uma divisão abre o empreendimento inteiro", () => {
    expect(acharNaLista(LISTA, "37")?.chave).toBe("group:Vale do Ouro");
    expect(acharNaLista(LISTA, "31")?.chave).toBe("group:Lagoa Bonita");
  });

  it("os links antigos, pelo slug do nome do C2X, continuam abrindo", () => {
    expect(acharNaLista(LISTA, "vale-do-ouro")?.chave).toBe("group:Vale do Ouro");
    expect(acharNaLista(LISTA, "residencial-villa-paris")?.chave).toBe("38");
    expect(acharNaLista(LISTA, "villa-paris")?.chave).toBe("38");
    // O plano: ?emp=lagoa-bonita abre o grupo, e não o LAB 31 sozinho.
    expect(acharNaLista(LISTA, "lagoa-bonita")?.chave).toBe("group:Lagoa Bonita");
    expect(acharNaLista(LISTA, "lagoa-bonita-masterplan")?.chave).toBe("group:Lagoa Bonita");
  });

  it("depois de um renome, o nome antigo continua abrindo pelo apelido", () => {
    const renomeado = CADASTRO.map((l) => (l.codigo === "RVP" ? { ...l, nome: "Paris Residencial" } : l));
    const listaNova = montarListaDoPainel(entrada(renomeado));

    expect(acharNaLista(listaNova, "paris-residencial")?.chave).toBe("38");
    expect(acharNaLista(listaNova, "residencial-villa-paris")?.chave).toBe("38");
  });

  it("os nomes anteriores do C2X (retrato do vigia) também abrem", () => {
    const comAnteriores = montarListaDoPainel({
      ...entrada(),
      nomesAnteriores: new Map([["42", ["ALDEIA DAS CACHOEIRAS DAS PEDRAS"]]]),
    });
    expect(acharNaLista(comAnteriores, "aldeia-das-cachoeiras-das-pedras")?.chave).toBe("42");
  });

  it("⚠️ o que não casa dá null, e NUNCA o primeiro da lista", () => {
    expect(acharNaLista(LISTA, "nao-existe")).toBeNull();
    expect(acharNaLista(LISTA, "")).toBeNull();
    expect(acharNaLista(LISTA, null)).toBeNull();
    expect(acharNaLista(LISTA, "999")).toBeNull();
    expect(acharNaLista(LISTA, "group:Nao Existe")).toBeNull();
  });

  it("apelido que casa com dois empreendimentos, sem um ser o nome de hoje, dá null", () => {
    const ambigua = montarListaDoPainel({
      ...entrada(),
      nomesAnteriores: new Map([
        ["38", ["Bairro Antigo"]],
        ["42", ["Bairro Antigo"]],
      ]),
    });
    expect(acharNaLista(ambigua, slugDoNome("Bairro Antigo"))).toBeNull();
  });
});
