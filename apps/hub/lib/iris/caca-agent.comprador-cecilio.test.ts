import { describe, expect, it } from "vitest";

import {
  MOTIVO_HANDOFF_COMPRADOR_CECILIO,
  RESPOSTA_HANDOFF_COMPRADOR_CECILIO,
} from "@/lib/apolo/comprador-cecilio";

import { acessoDoCompradorCecilio, type CacaAgentTraceStep } from "./caca-agent";

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
