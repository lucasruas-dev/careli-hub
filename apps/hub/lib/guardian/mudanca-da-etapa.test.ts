import { describe, expect, it } from "vitest";

import { mudancaDaEtapa } from "./mudanca-da-etapa";

// O CASO MEDIDO (24/09/2026): cliente 3954, Vitorino Energy Ltda, promessa PR-000015 vencida em
// 18/09 e sem etapa manual. A etapa do read-model é "A acionar" e a derivada do motor passou a ser
// "A acionar" também — etapa igual, frase diferente. Com a comparação só de etapa, o copiloto
// mostrava "Registrar retorno e confirmar canal prioritario" enquanto o card do detalhe mostrava
// "Promessa vencida em 18/09 sem baixa registrada".

const DO_READ_MODEL = "Registrar retorno e confirmar canal prioritario.";
const DO_MOTOR =
  "Promessa vencida em 18/09 sem baixa registrada. Confirmar o pagamento no C2X e retomar o contato.";

describe("mudancaDaEtapa", () => {
  it("etapa IGUAL e próxima ação diferente reescreve só a frase, sem carimbar histórico", () => {
    expect(
      mudancaDaEtapa(
        { nextAction: DO_READ_MODEL, stage: "A acionar" },
        { nextAction: DO_MOTOR, stage: "A acionar" },
      ),
    ).toEqual({ escreveEtapa: false, escreveProximaAcao: true });
  });

  it("etapa diferente reescreve tudo e carimba o histórico", () => {
    expect(
      mudancaDaEtapa(
        { nextAction: DO_READ_MODEL, stage: "A acionar" },
        { nextAction: "Acompanhar o pagamento das parcelas do acordo.", stage: "Acordo" },
      ),
    ).toEqual({ escreveEtapa: true, escreveProximaAcao: false });
  });

  it("nada muda quando etapa e frase já são as do motor (idempotente, sem loop de render)", () => {
    expect(
      mudancaDaEtapa(
        { nextAction: DO_MOTOR, stage: "A acionar" },
        { nextAction: DO_MOTOR, stage: "A acionar" },
      ),
    ).toEqual({ escreveEtapa: false, escreveProximaAcao: false });
  });

  it("etapa escolhida à mão não é tocada nem na frase (o chamado TI-000138)", () => {
    expect(
      mudancaDaEtapa(
        { nextAction: DO_READ_MODEL, stage: "Acordo", stageManual: true },
        { nextAction: DO_MOTOR, stage: "A acionar" },
      ),
    ).toEqual({ escreveEtapa: false, escreveProximaAcao: false });
  });

  it("sem etapa derivada o motor não opina", () => {
    expect(mudancaDaEtapa({ nextAction: DO_READ_MODEL, stage: "A acionar" }, null)).toEqual({
      escreveEtapa: false,
      escreveProximaAcao: false,
    });
  });

  it("frase vazia do motor não apaga a frase que está na tela", () => {
    expect(
      mudancaDaEtapa(
        { nextAction: DO_READ_MODEL, stage: "A acionar" },
        { nextAction: "", stage: "A acionar" },
      ),
    ).toEqual({ escreveEtapa: false, escreveProximaAcao: false });
  });
});
