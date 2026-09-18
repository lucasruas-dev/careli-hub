import { describe, expect, it, vi } from "vitest";

// QUEM TEM TODAS AS DIVISÕES DE UM GRUPO É DONO DO CONJUNTO — e alcança o id do grupo.
//
// Caso real (18/09/2026): a CAD do FÁBIO COSTA CHAVES foi credenciada no Lagoa Bonita pelo CAD
// público, que grava o empreendimento como "group:Lagoa Bonita" (para quem está de fora o
// loteamento é um só). O portal da Gurgel é comercial, e as contas dele recebem os ids das
// divisões (33, 27, 32), nunca o do grupo. `idsDaSessao` só devolvia o id do grupo para quem o
// tinha explicitamente, e a proposta respondia "Este cliente não tem CAD neste empreendimento"
// com a CAD credenciada no Apolo.
//
// Estes testes chamam a `idsDaSessao` DE VERDADE (escopo.ts), com o catálogo real do C2X.

vi.mock("@/lib/apolo/catalogo-empreendimentos", async () => {
  const real = await vi.importActual<typeof import("@/lib/apolo/catalogo-empreendimentos")>(
    "@/lib/apolo/catalogo-empreendimentos",
  );
  const catalogo = real.agrupar([
    { code: "LBF", id: 33, name: "LAGOA BONITA" },
    { code: "LBR", id: 27, name: "LAGOA BONITA" },
    { code: "LBP", id: 32, name: "LAGOA BONITA" },
    { code: "VOC", id: 37, name: "VALE DO OURO" },
    { code: "VOL", id: 36, name: "VALE DO OURO" },
    { code: "VOR", id: 41, name: "VALE DO OURO - EXTRAS" },
    { code: "JDG", id: 40, name: "JARDIM DAS GERAIS" },
  ]);
  return { ...real, catalogoDeEmpreendimentos: async () => catalogo };
});

import { idsDaSessao } from "./escopo";
import type { SessaoIncorporador } from "./sessao";

function sessao(ids: string[]): SessaoIncorporador {
  return {
    enterpriseIds: ids,
    enterpriseIdsComCarteira: ids,
    exp: Math.floor(Date.parse("2026-09-18T00:00:00Z") / 1000),
    incorporadorId: "inc-gurgel",
    incorporadorNome: "Gurgel",
    slug: "gurgel",
    tipo: "comercial",
    usuarioId: "user-1",
    usuarioNome: "Coordenador",
  };
}

describe("idsDaSessao: grupo completo", () => {
  it("⚠️ quem tem as TRÊS divisões do Lagoa Bonita alcança o id do grupo", async () => {
    // A conta da Gurgel medida em 18/09/2026: 27, 32, 33 (e outros empreendimentos).
    const ids = await idsDaSessao(sessao(["27", "32", "33", "38"]));
    expect(ids).toContain("group:Lagoa Bonita");
  });

  it("a gleba sozinha continua sem o grupo: a CAD do grupo pode ser de outra gleba", async () => {
    expect(await idsDaSessao(sessao(["33"]))).not.toContain("group:Lagoa Bonita");
  });

  it("duas glebas de três também continuam sem o grupo", async () => {
    expect(await idsDaSessao(sessao(["33", "27"]))).not.toContain("group:Lagoa Bonita");
  });

  it("o VOC sozinho segue sem o grupo do Vale do Ouro, que tem o VOL de outro sócio", async () => {
    const ids = await idsDaSessao(sessao(["37"]));
    expect(ids).not.toContain("group:Vale do Ouro");
    expect(ids).not.toContain("36");
  });

  it("quem tem VOC, VOL e VOR alcança o grupo do Vale do Ouro", async () => {
    expect(await idsDaSessao(sessao(["37", "36", "41"]))).toContain("group:Vale do Ouro");
  });

  it("quem já tem o grupo segue com o grupo e as divisões", async () => {
    const ids = await idsDaSessao(sessao(["group:Lagoa Bonita"]));
    expect(ids).toEqual(expect.arrayContaining(["group:Lagoa Bonita", "33", "27", "32"]));
  });
});
