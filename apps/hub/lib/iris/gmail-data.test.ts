import { describe, expect, it } from "vitest";

import { paraIso, parseGmailMessage } from "./gmail";

// O QUE ESTE TESTE PROTEGE: a data que sai do e-mail e entra no banco.
//
// Em 10/08 a produção acumulou 240 falhas por dia com `invalid input syntax for type timestamp
// with time zone: "Sun, 9 Aug 2026 09:11:25 -0300 (BRT)"`. A causa era uma linha só: o cabeçalho
// `Date` do e-mail, que é do protocolo e não do banco, ia CRU para uma coluna timestamptz. Duas
// mensagens ficaram presas desde 09/08, repetindo o erro a cada ciclo do cron, para sempre.
//
// Aqui a regra fica travada: o carimbo do Gmail (`internalDate`, epoch) manda; o cabeçalho é o
// segundo recurso e SEMPRE normalizado; e nada sai daqui que o Postgres recuse.

const CABECALHO_QUE_QUEBROU = "Sun, 9 Aug 2026 09:11:25 -0300 (BRT)";

function mensagem({
  cabecalhoDate,
  internalDate,
}: {
  cabecalhoDate?: string;
  internalDate?: string;
}) {
  return {
    id: "abc",
    internalDate,
    payload: {
      headers: [
        { name: "From", value: "Cliente <cliente@exemplo.com>" },
        ...(cabecalhoDate ? [{ name: "Date", value: cabecalhoDate }] : []),
      ],
    },
    threadId: "t1",
  };
}

describe("paraIso", () => {
  it("converte o formato de e-mail que derrubava o cron", () => {
    const iso = paraIso(CABECALHO_QUE_QUEBROU);

    expect(iso).toBe("2026-08-09T12:11:25.000Z");
  });

  it("aceita os outros formatos que aparecem em cabeçalho de e-mail", () => {
    expect(paraIso("9 Aug 2026 09:11:25 -0300")).toBe("2026-08-09T12:11:25.000Z");
    expect(paraIso("Sun, 09 Aug 2026 12:11:25 GMT")).toBe("2026-08-09T12:11:25.000Z");
    expect(paraIso("2026-08-09T12:11:25.000Z")).toBe("2026-08-09T12:11:25.000Z");
  });

  it("devolve null para data inválida, em vez de propagar lixo", () => {
    // Null faz o fluxo cair no horário de processamento e a mensagem ENTRA. Texto cru faria o
    // Postgres recusar a linha inteira, que é o defeito que este teste existe para impedir.
    expect(paraIso("data quebrada")).toBeNull();
    expect(paraIso("")).toBeNull();
    expect(paraIso(null)).toBeNull();
    expect(paraIso(undefined)).toBeNull();
  });
});

describe("parseGmailMessage: a data", () => {
  it("prefere o carimbo do Gmail ao cabeçalho do e-mail", () => {
    const parsed = parseGmailMessage(
      mensagem({ cabecalhoDate: CABECALHO_QUE_QUEBROU, internalDate: "1786000000000" }),
    );

    expect(parsed.date).toBe(new Date(1786000000000).toISOString());
  });

  it("sem carimbo do Gmail, normaliza o cabeçalho", () => {
    const parsed = parseGmailMessage(mensagem({ cabecalhoDate: CABECALHO_QUE_QUEBROU }));

    expect(parsed.date).toBe("2026-08-09T12:11:25.000Z");
  });

  it("NUNCA devolve o cabeçalho cru", () => {
    // O teste que teria evitado o incidente: qualquer coisa que não seja ISO aqui vira erro
    // 22007 no banco quando a linha for gravada.
    const parsed = parseGmailMessage(mensagem({ cabecalhoDate: CABECALHO_QUE_QUEBROU }));

    expect(parsed.date).not.toBe(CABECALHO_QUE_QUEBROU);
    expect(parsed.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("sem data nenhuma, devolve null e a mensagem ainda entra", () => {
    expect(parseGmailMessage(mensagem({})).date).toBeNull();
    expect(parseGmailMessage(mensagem({ cabecalhoDate: "sexta que vem" })).date).toBeNull();
  });
});
