import { describe, expect, it } from "vitest";

import { readBoardTicketCrm } from "./iris-ticket-queue";

// O CHIP DO BOARD DA IRIS PARA O CLIENTE DA CECÍLIO (02/10/2026).
//
// ⚠️ SEM BOLINHA, NUNCA, nem para quem também tem carteira no C2X: a adimplência da Cecílio mora no
// Asaas e a Iris não tem esse dado. Uma bolinha verde num cliente em atraso faria o atendente tratar
// a ligação de cobrança como cortesia.

describe("readBoardTicketCrm com o papel da Cecílio", () => {
  it("mostra 'Comprador Cecílio' sem bolinha, pelo rótulo que a rota do telefone devolve", () => {
    expect(
      readBoardTicketCrm({
        delinquency: null,
        profileLabel: "Comprador Cecílio",
        profiles: ["Comprador Cecílio", "Pessoa fisica"],
        status: "registered",
      }),
    ).toEqual({ dotColor: null, label: "Comprador Cecílio" });
  });

  it("aceita também o id cru do papel", () => {
    expect(
      readBoardTicketCrm({ profiles: ["comprador_cecilio"], status: "registered" }),
    ).toEqual({ dotColor: null, label: "Comprador Cecílio" });
  });

  it("quem também é comprador do C2X aparece como da Cecílio, sem a bolinha do legado", () => {
    // A bolinha mede só o C2X: verde, esconderia a dívida da Cecílio de quem vai cobrar.
    expect(
      readBoardTicketCrm({
        delinquency: "adimplente",
        profiles: ["Usuario", "Comprador Cecílio"],
        status: "registered",
      }),
    ).toEqual({ dotColor: null, label: "Comprador Cecílio" });
  });

  it("o comprador só do C2X continua com o chip e a bolinha de sempre", () => {
    expect(
      readBoardTicketCrm({ delinquency: "inadimplente", profiles: ["Usuario"], status: "registered" }),
    ).toEqual({ dotColor: "red", label: "Comprador" });
  });
});
