import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A TRAVA DA CACÁ PARA O CLIENTE DA CECÍLIO (02/10/2026), no motor que está ligado (Claude).
//
// ⚠️ O BURACO QUE ELA FECHA: com a ficha criada no Apolo, o CPF do cliente da Cecílio passa a ser
// achado. CPF e nome conferiam, a identidade virava "confirmada" com c2xClientId nulo, e o
// financeiro respondia "sem carteira" para quem está em atraso. Agora a identidade NÃO é confirmada
// e a transferência sai registrada pelo código, sem depender de o modelo obedecer à instrução.
//
// O dublê troca só a busca por documento: o resto da `validarIdentidade` roda de verdade.

const lookupApoloByDocument = vi.fn();

vi.mock("@/lib/iris/caca-agent", () => ({ lookupApoloByDocument }));

const { buildCacaTools, describeApoloProfile, PERFIL_DESCRITO_COMPRADOR_CECILIO } = await import(
  "./executors"
);
const { MOTIVO_HANDOFF_COMPRADOR_CECILIO } = await import("@/lib/apolo/comprador-cecilio");

type Contexto = Parameters<typeof buildCacaTools>[0];

function contexto(): Contexto {
  return {
    boletosGerados: [],
    businessHoursOpen: true,
    c2xClientId: null,
    client: {} as SupabaseClient,
    contactId: null,
    customerName: null,
    customerProfileLabel: null,
    entityId: null,
    handoff: { reason: null, requested: false },
    identityVerified: false,
    imobiliariaC2xClientId: null,
    imobiliariaName: null,
    nextContactLabel: "amanhã às 8h",
    validationSource: null,
  };
}

async function validar(ctx: Contexto, input: Record<string, unknown>) {
  const ferramenta = buildCacaTools(ctx).find(
    (tool) => tool.definition.name === "validar_identidade",
  );
  if (!ferramenta) throw new Error("validar_identidade sumiu da lista de ferramentas");
  const resposta = await ferramenta.run(input);
  return typeof resposta === "string" ? resposta : resposta.content;
}

beforeEach(() => {
  lookupApoloByDocument.mockReset();
});

describe("validar_identidade com cliente da Cecílio", () => {
  it("NÃO confirma a identidade e registra a transferência, mesmo com CPF e nome certos", async () => {
    lookupApoloByDocument.mockResolvedValue({
      c2xClientId: null,
      displayName: "MARIA DE TESTE DA SILVA",
      documentMasked: "***.***.***-00",
      entityId: "ficha-cecilio",
      hasBuyerProfile: false,
      hasUnitPortfolio: false,
      profiles: ["comprador_cecilio", "pessoa_fisica"],
      unitLabels: [],
    });
    const ctx = contexto();

    const resposta = await validar(ctx, {
      documento: "000.000.000-00",
      nome_titular: "Maria de Teste da Silva",
    });

    expect(ctx.identityVerified).toBe(false);
    expect(ctx.validationSource).toBeNull();
    expect(ctx.handoff).toEqual({ reason: MOTIVO_HANDOFF_COMPRADOR_CECILIO, requested: true });
    expect(ctx.customerProfileLabel).toBe(PERFIL_DESCRITO_COMPRADOR_CECILIO);
    expect(resposta).toMatch(/identidade NÃO foi confirmada/);
    expect(resposta).not.toMatch(/Identidade confirmada/);
  });

  it("quem também é comprador do C2X vai para o humano do mesmo jeito", async () => {
    lookupApoloByDocument.mockResolvedValue({
      c2xClientId: "123",
      displayName: "JOAO DE TESTE",
      documentMasked: "***.***.***-00",
      entityId: "ficha-dupla",
      hasBuyerProfile: true,
      hasUnitPortfolio: true,
      profiles: ["usuario", "comprador_cecilio"],
      unitLabels: ["VLO 0101"],
    });
    const ctx = contexto();

    await validar(ctx, { documento: "00000000000", nome_titular: "Joao de Teste" });

    expect(ctx.identityVerified).toBe(false);
    expect(ctx.c2xClientId).toBeNull();
    expect(ctx.handoff.requested).toBe(true);
  });

  it("o comprador só do C2X continua sendo confirmado como antes", async () => {
    lookupApoloByDocument.mockResolvedValue({
      c2xClientId: "456",
      displayName: "ANA DE TESTE",
      documentMasked: "***.***.***-00",
      entityId: "ficha-c2x",
      hasBuyerProfile: true,
      hasUnitPortfolio: true,
      profiles: ["usuario", "pessoa_fisica"],
      unitLabels: ["LBF 0101"],
    });
    const ctx = contexto();

    const resposta = await validar(ctx, { documento: "00000000000", nome_titular: "Ana de Teste" });

    expect(ctx.identityVerified).toBe(true);
    expect(ctx.c2xClientId).toBe("456");
    expect(ctx.handoff.requested).toBe(false);
    expect(resposta).toMatch(/Identidade confirmada/);
  });
});

describe("as ferramentas que acham a ficha só pelo documento", () => {
  it("consultar_cadastro_imobiliaria com CNPJ de cliente da Cecílio não entrega nada e transfere", async () => {
    lookupApoloByDocument.mockResolvedValue({
      c2xClientId: null,
      displayName: "EMPRESA DE TESTE LTDA",
      documentMasked: "**.***.***/****-81",
      entityId: "ficha-pj",
      hasBuyerProfile: false,
      hasUnitPortfolio: false,
      profiles: ["comprador_cecilio", "pessoa_juridica"],
      unitLabels: [],
    });
    const ctx = contexto();
    const ferramenta = buildCacaTools(ctx).find((t) => t.definition.name === "consultar_cadastro_imobiliaria");
    if (!ferramenta) throw new Error("consultar_cadastro_imobiliaria sumiu da lista de ferramentas");

    const resposta = await ferramenta.run({ cnpj: "11.222.333/0001-81" });
    const texto = typeof resposta === "string" ? resposta : resposta.content;

    expect(texto).not.toMatch(/EMPRESA DE TESTE|comprador_cecilio|Razão/);
    expect(ctx.handoff).toEqual({ reason: MOTIVO_HANDOFF_COMPRADOR_CECILIO, requested: true });
  });
});

describe("describeApoloProfile", () => {
  it("descreve o cliente da Cecílio antes do comprador do C2X", () => {
    expect(describeApoloProfile(["comprador_cecilio"])).toBe(PERFIL_DESCRITO_COMPRADOR_CECILIO);
    expect(describeApoloProfile(["usuario", "comprador_cecilio"])).toBe(
      PERFIL_DESCRITO_COMPRADOR_CECILIO,
    );
    expect(describeApoloProfile(["usuario"])).toBe("comprador (tem carteira/parcelas)");
  });
});
