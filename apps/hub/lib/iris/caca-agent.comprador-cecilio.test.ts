import { describe, expect, it } from "vitest";

import {
  MOTIVO_HANDOFF_COMPRADOR_CECILIO,
  RESPOSTA_HANDOFF_COMPRADOR_CECILIO,
} from "@/lib/apolo/comprador-cecilio";

import {
  acessoDoCompradorCecilio,
  fichaValidadaDoCompradorCecilio,
  type CacaAgentTraceStep,
} from "./caca-agent";

// A TRAVA DA CECÍLIO NO MOTOR DETERMINÍSTICO DA CACÁ (o que roda quando CACA_ENGINE != claude).
// `resolveBoletoCustomerAccess` passa por esta função nos três pontos em que identifica o cliente
// (telefone, ficha guardada no ticket e CPF). Ela devolve o handoff, ou `null` para seguir o fluxo.

describe("acessoDoCompradorCecilio", () => {
  it("cliente da Cecílio vai para o humano, com a frase neutra e o rastro registrado", () => {
    const trace: CacaAgentTraceStep[] = [];
    const toolsUsed: string[] = [];

    const acesso = acessoDoCompradorCecilio(
      { entityId: "ficha-cecilio", profiles: ["comprador_cecilio", "pessoa_fisica"] },
      trace,
      toolsUsed,
    );

    expect(acesso).toEqual({
      reason: MOTIVO_HANDOFF_COMPRADOR_CECILIO,
      replyText: RESPOSTA_HANDOFF_COMPRADOR_CECILIO,
      statePatch: {
        awaitingCadastroConfirmation: false,
        awaitingCpfDocument: false,
        handoffRequired: true,
      },
      status: "handoff",
    });
    expect(toolsUsed).toContain("apolo_comprador_cecilio");
    expect(trace.at(-1)?.status).toBe("blocked");
  });

  it("quem também é comprador do C2X vai para o humano do mesmo jeito", () => {
    expect(
      acessoDoCompradorCecilio(
        { entityId: "ficha-dupla", profiles: ["usuario", "comprador_cecilio"] },
        [],
        [],
      )?.status,
    ).toBe("handoff");
  });

  it("sem o papel, ou sem ficha, devolve null e o fluxo segue como sempre", () => {
    expect(acessoDoCompradorCecilio({ entityId: "x", profiles: ["usuario"] }, [], [])).toBeNull();
    expect(acessoDoCompradorCecilio(null, [], [])).toBeNull();
  });
});

// Um dublê mínimo do supabase-js: devolve as linhas da tabela pedida, qualquer que seja o filtro.
function clienteFalso(tabelas: Record<string, unknown[]>) {
  return {
    from(tabela: string) {
      const consulta = {
        eq: () => consulta,
        in: () => consulta,
        limit: () => consulta,
        select: () => consulta,
        then: (resolver: (r: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: tabelas[tabela] ?? [], error: null }).then(resolver),
      };
      return consulta;
    },
  } as unknown as Parameters<typeof fichaValidadaDoCompradorCecilio>[0];
}

describe("fichaValidadaDoCompradorCecilio: a identidade que já veio pronta", () => {
  it("acha o papel pela ficha do C2X (contato ativo, state ou memória de 30 dias)", async () => {
    const client = clienteFalso({
      apolo_entity_profiles: [{ entity_id: "ficha-c2x", status: "active" }],
      apolo_source_links: [{ entity_id: "ficha-c2x" }],
    });

    await expect(fichaValidadaDoCompradorCecilio(client, { c2xClientId: "123" })).resolves.toBe("ficha-c2x");
  });

  it("papel arquivado não conta, e sem ficha nem id não consulta nada", async () => {
    const arquivado = clienteFalso({ apolo_entity_profiles: [{ entity_id: "f", status: "archived" }] });

    await expect(fichaValidadaDoCompradorCecilio(arquivado, { entityId: "f" })).resolves.toBeNull();
    await expect(fichaValidadaDoCompradorCecilio(clienteFalso({}), {})).resolves.toBeNull();
  });
});
