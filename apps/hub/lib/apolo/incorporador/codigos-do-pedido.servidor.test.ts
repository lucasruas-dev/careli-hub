import { beforeEach, describe, expect, it, vi } from "vitest";

// A CASCA `codigosDoPedido`: QUANDO ela lê o cadastro do Panteon, e o que responde quando ele cai.
//
// ⚠️ A decisão antiga continua de pé e é o que mais se testa aqui: o id numérico de um filho do C2X
// NÃO lê o cadastro, para um pico do Supabase não derrubar o produto do legado. O que é novo
// (16/09/2026): o id numérico de um produto do Panteon, pedido por rota que não manda `proprios`,
// precisa do cadastro para virar código — e sem cadastro a resposta é 503, nunca 404.

const estado = vi.hoisted(() => ({
  cadastroFora: false,
  idsDaSessao: [] as string[],
  leituras: 0,
}));

vi.mock("./escopo", () => ({
  idsDaSessao: async () => estado.idsDaSessao,
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => {
    estado.leituras += 1;
    if (estado.cadastroFora) throw new Error("supabase fora");
    return [
      {
        c2xEnterpriseId: "37",
        cidade: null,
        codigo: "VOC",
        id: "voc",
        nome: "VOC",
        ordem: 0,
        paiId: null,
        uf: null,
        vendendo: true,
      },
      {
        c2xEnterpriseId: "100000",
        cidade: "Ipatinga",
        codigo: "JAD",
        id: "jad",
        nome: "Ed. Jade",
        ordem: 0,
        paiId: null,
        uf: "MG",
        vendendo: true,
      },
    ];
  },
}));

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";

import { codigosDoPedido } from "./codigos-do-pedido";
import { empreendimentosDoPortal } from "./empreendimentos-do-portal";
import type { SessaoIncorporador } from "./sessao";

const CATALOGO = agrupar([
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "GDN", id: 39, name: "GARDEN" },
]);

const SESSAO = { enterpriseIds: ["37", "100000"] } as SessaoIncorporador;
const AUTORIZADOS = ["VOC", "JAD"];

function pedir(pedido: null | string, extra: { proprios?: { codigo: string; enterpriseId: string }[] } = {}) {
  return codigosDoPedido({
    catalogo: CATALOGO,
    codesAutorizados: AUTORIZADOS,
    empreendimentos: empreendimentosDoPortal(CATALOGO, AUTORIZADOS),
    pedido,
    ...(extra.proprios ? { proprios: extra.proprios } : {}),
    sessao: SESSAO,
  });
}

beforeEach(() => {
  estado.cadastroFora = false;
  estado.idsDaSessao = ["37", "100000"];
  estado.leituras = 0;
});

describe("codigosDoPedido · quando lê o cadastro", () => {
  it("⚠️ id numérico do produto do Panteon, sem `proprios`: lê o cadastro e acha o código", async () => {
    const r = await pedir("100000");
    expect(r).toEqual({ codes: ["JAD"], ok: true });
    expect(estado.leituras).toBe(1);
  });

  it("⚠️ id numérico do filho do C2X: NÃO lê o cadastro (um pico do Supabase não derruba o filho)", async () => {
    estado.cadastroFora = true;
    const r = await pedir("37");
    expect(r).toEqual({ codes: ["VOC"], ok: true });
    expect(estado.leituras).toBe(0);
  });

  it("id que a sessão não tem: não lê nada e volta vazio (a rota responde 404)", async () => {
    const r = await pedir("100001");
    expect(r).toEqual({ codes: [], ok: true });
    expect(estado.leituras).toBe(0);
  });

  it("a rota que já manda `proprios` responde pela própria queda: a casca não relê", async () => {
    const r = await pedir("100000", { proprios: [{ codigo: "JAD", enterpriseId: "100000" }] });
    expect(r).toEqual({ codes: ["JAD"], ok: true });
    expect(estado.leituras).toBe(0);
  });

  it("sem pedido e pelo código: nada de cadastro, o código vem dos autorizados", async () => {
    expect(await pedir(null)).toEqual({ codes: ["VOC", "JAD"], ok: true });
    expect(await pedir("JAD")).toEqual({ codes: ["JAD"], ok: true });
    expect(estado.leituras).toBe(0);
  });
});

describe("codigosDoPedido · cadastro fora do ar", () => {
  it("⚠️ produto do Panteon pelo id: 503, nunca 404 ('não é seu' seria afirmação errada)", async () => {
    estado.cadastroFora = true;
    const r = await pedir("100000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });

  it("pai do cadastro: 503, como sempre foi", async () => {
    estado.cadastroFora = true;
    const r = await pedir("pai:jad");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });
});
