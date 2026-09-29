import { beforeEach, describe, expect, it, vi } from "vitest";

// A TRAVA DO LAB NA ABA DE POLÍTICAS (onda 2, leitura [0], 16/09/2026).
//
// O LAB (31) está em `EXCLUDED_ENTERPRISE_IDS` e fora do catálogo do C2X de propósito. Com
// `soDoPanteon` puro, uma sessão com o 31 o tratava como produto "só do Panteon" (próprio): o código
// entrava entre os autorizados e a aba abria as políticas dele. `linhasSoDoPanteon` é a mesma
// tradução com a trava; o produto nascido no Panteon (id >= 100000) continua passando.
//
// A rota é chamada de verdade; o banco e o catálogo são falsos.

const estado = vi.hoisted(() => ({
  permitidos: ["31", "39", "100001"] as string[],
  // Os ids com que a rota foi ao C2X pelos planos (PAN-124: pelo id, e não mais pela sigla).
  planosPorIds: [] as unknown[],
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Laboratório", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
  { c2xEnterpriseId: "100001", codigo: "JAD", id: "jad", nome: "Ed. Jade", operadoPor: "inc-cecilio", paiId: null },
]);

vi.mock("@/lib/apolo/incorporador/escopo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/escopo")>()),
  autorizar: () => ({
    ok: true,
    sessao: { incorporadorId: "inc-cecilio", slug: "cecilio-rocha", tipo: "incorporador" },
  }),
  // O que `codigosDaSessao` traduz pelo catálogo: só o Garden (o LAB está fora dele).
  codigosDaSessao: async () => ["GDN"],
  idsDaSessao: async () => estado.permitidos,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [{ codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] }],
}));

// `soDoPanteon` é o de verdade: `linhasSoDoPanteon` passa por ele antes de aplicar a trava.
vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => {
    throw new Error("a rota não deve mais ir ao C2X pela sigla");
  },
  lerPlanosDoC2xPorIds: async (ids: unknown) => {
    estado.planosPorIds.push(ids);
    return { empreendimentos: [], ok: true };
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const cadeia: Record<string, unknown> = {
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  };
  for (const metodo of ["eq", "in", "not", "order", "range", "select"]) cadeia[metodo] = () => cadeia;
  return { createApoloAdminClient: () => ({ from: () => cadeia }) };
});

import { GET } from "./route";

const abrir = (emp: string) =>
  GET(new Request(`https://c2x.app.br/api/incorporador/produto/politicas?emp=${encodeURIComponent(emp)}`));

beforeEach(() => {
  estado.permitidos = ["31", "39", "100001"];
  estado.planosPorIds = [];
});

describe("GET /api/incorporador/produto/politicas: a trava do LAB", () => {
  it("⚠️ sessão com o 31 não abre o LAB como produto próprio", async () => {
    const resposta = await abrir("31");
    expect(resposta.status).toBe(404);
  });

  it("o produto nascido no Panteon continua abrindo pela mesma tradução", async () => {
    const resposta = await abrir("100001");
    expect(resposta.status).toBe(200);
  });

  it("o produto do C2X segue como sempre", async () => {
    const resposta = await abrir("39");
    expect(resposta.status).toBe(200);
  });
});

describe("GET /api/incorporador/produto/politicas: os planos do C2X pelo id (PAN-124)", () => {
  it("🔴 vai ao C2X com o id do produto, que não muda num renome, e não com a sigla do catálogo", async () => {
    await abrir("39");
    expect(estado.planosPorIds).toEqual([["39"]]);
  });

  it("produto nascido no Panteon não vai ao C2X", async () => {
    await abrir("100001");
    expect(estado.planosPorIds).toEqual([]);
  });
});
