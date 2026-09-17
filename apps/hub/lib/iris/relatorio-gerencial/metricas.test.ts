import { describe, expect, it } from "vitest";

import {
  classificarBacklog,
  desempenhoPorFila,
  falhasDeEntrega,
  mediana,
  type MensagemDaJanela,
  movimentoPorHora,
  paresDeResposta,
  quemAtendeu,
  resumoDoBacklog,
  resumoDoDia,
  semRespostaAoFim,
  type TicketDaJanela,
} from "./metricas";

// A janela do dia 17/09/2026, das 08h às 18h30 de São Paulo (UTC-3).
const JANELA = {
  fim: new Date("2026-09-17T21:30:00.000Z"),
  inicio: new Date("2026-09-17T11:00:00.000Z"),
};

function msg(p: Partial<MensagemDaJanela> & { criadoEm: string; direcao: string }): MensagemDaJanela {
  return {
    daCaca: false,
    entrega: "delivered",
    erroCodigo: null,
    fila: "Atendimento",
    ticketId: "t1",
    tipo: "text",
    usuarioId: null,
    ...p,
  };
}

function ticket(p: Partial<TicketDaJanela> & { id: string }): TicketDaJanela {
  return { abertoEm: null, daCaca: false, fechadoEm: null, fila: "Atendimento", ...p };
}

describe("tempo de resposta", () => {
  it("mede da mensagem do cliente até a PRÓXIMA nossa no mesmo ticket", () => {
    const pares = paresDeResposta(
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T12:06:00.000Z", direcao: "outbound" }),
      ],
      JANELA,
    );

    expect(pares).toHaveLength(1);
    expect(pares[0]?.minutos).toBe(6);
  });

  it("resposta em OUTRO ticket não conta", () => {
    const pares = paresDeResposta(
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound", ticketId: "a" }),
        msg({ criadoEm: "2026-09-17T12:01:00.000Z", direcao: "outbound", ticketId: "b" }),
      ],
      JANELA,
    );

    expect(pares[0]?.minutos).toBeNull();
  });

  it("⚠️ a resposta DEPOIS do fim da janela conta — senão o recado das 18h25 vira abandono", () => {
    const pares = paresDeResposta(
      [
        msg({ criadoEm: "2026-09-17T21:25:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T21:40:00.000Z", direcao: "outbound" }),
      ],
      JANELA,
    );

    expect(pares[0]?.minutos).toBe(15);
  });

  it("recado FORA da janela não entra na conta", () => {
    const pares = paresDeResposta(
      [
        msg({ criadoEm: "2026-09-17T09:00:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T09:10:00.000Z", direcao: "outbound" }),
      ],
      JANELA,
    );

    expect(pares).toHaveLength(0);
  });

  it("mensagem interna e de sistema não são conversa", () => {
    const pares = paresDeResposta(
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T12:01:00.000Z", direcao: "internal" }),
        msg({ criadoEm: "2026-09-17T12:09:00.000Z", direcao: "outbound" }),
      ],
      JANELA,
    );

    expect(pares[0]?.minutos).toBe(9);
  });

  it("a mediana de uma lista par é a média dos dois do meio", () => {
    expect(mediana([1, 2, 3, 10])).toBe(2.5);
    expect(mediana([5])).toBe(5);
    expect(mediana([])).toBeNull();
  });
});

describe("o dia em números", () => {
  it("conta abertos, fechados e mensagens dentro da janela", () => {
    const resumo = resumoDoDia(
      [
        ticket({ abertoEm: "2026-09-17T12:00:00.000Z", id: "a" }),
        ticket({ abertoEm: "2026-09-17T09:00:00.000Z", fechadoEm: "2026-09-17T13:00:00.000Z", id: "b" }),
      ],
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T12:05:00.000Z", direcao: "outbound" }),
        msg({ criadoEm: "2026-09-17T22:00:00.000Z", direcao: "outbound" }),
      ],
      JANELA,
    );

    expect(resumo.abertos).toBe(1);
    expect(resumo.fechados).toBe(1);
    expect(resumo.mensagensEntrada).toBe(1);
    // A das 19h (22h UTC) ficou fora da janela.
    expect(resumo.mensagensSaida).toBe(1);
    expect(resumo.recadosRecebidos).toBe(1);
    expect(resumo.recadosRespondidos).toBe(1);
    expect(resumo.medianaMinutos).toBe(5);
  });
});

describe("por fila", () => {
  const tickets = [
    ticket({ abertoEm: "2026-09-17T12:00:00.000Z", fila: "Cobrança", id: "c1" }),
    ticket({ abertoEm: "2026-09-17T12:00:00.000Z", daCaca: true, id: "k1" }),
  ];
  const mensagens = [
    msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound", fila: "Cobrança", ticketId: "c1" }),
    msg({ criadoEm: "2026-09-17T12:30:00.000Z", direcao: "outbound", fila: "Cobrança", ticketId: "c1" }),
    msg({ criadoEm: "2026-09-17T13:00:00.000Z", daCaca: true, direcao: "inbound", ticketId: "k1" }),
    msg({
      criadoEm: "2026-09-17T13:00:06.000Z",
      daCaca: true,
      direcao: "outbound",
      ticketId: "k1",
      tipo: "audio",
    }),
  ];

  it("⚠️ a CACÁ é uma LINHA, não uma fila: o ticket dela também conta no Atendimento", () => {
    const linhas = desempenhoPorFila(tickets, mensagens, JANELA);
    const atendimento = linhas.find((l) => l.fila === "Atendimento");
    const caca = linhas.find((l) => l.fila === "CACÁ");

    expect(atendimento?.abertos).toBe(1);
    expect(caca?.abertos).toBe(1);
    expect(caca?.medianaMinutos).toBe(0.1);
  });

  it("mede o pior caso e a fatia de resposta em áudio", () => {
    const linhas = desempenhoPorFila(tickets, mensagens, JANELA);
    expect(linhas.find((l) => l.fila === "Cobrança")?.piorCasoMinutos).toBe(30);
    expect(linhas.find((l) => l.fila === "CACÁ")?.audioPercentual).toBe(100);
    expect(linhas.find((l) => l.fila === "Cobrança")?.audioPercentual).toBe(0);
  });
});

describe("quem atendeu", () => {
  it("conta por autor da mensagem e mostra a jornada", () => {
    const pessoas = quemAtendeu(
      [
        msg({ criadoEm: "2026-09-17T11:30:00.000Z", direcao: "outbound", ticketId: "a", usuarioId: "u1" }),
        msg({ criadoEm: "2026-09-17T20:00:00.000Z", direcao: "outbound", ticketId: "b", usuarioId: "u1" }),
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", daCaca: true, direcao: "outbound", ticketId: "k" }),
      ],
      new Map([["u1", "Beatriz Araújo"]]),
      JANELA,
    );

    expect(pessoas[0]).toMatchObject({ atendimentos: 2, mensagens: 2, pessoa: "Beatriz Araújo" });
    expect(pessoas[0]?.inicio).toBe("2026-09-17T11:30:00.000Z");
    expect(pessoas[0]?.fim).toBe("2026-09-17T20:00:00.000Z");
    expect(pessoas.some((p) => p.pessoa === "CACÁ")).toBe(true);
  });

  it("disparo automático sem autor não vira pessoa", () => {
    const pessoas = quemAtendeu(
      [msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "outbound", tipo: "template" })],
      new Map(),
      JANELA,
    );
    expect(pessoas).toEqual([]);
  });
});

describe("falhas, movimento e pendências", () => {
  it("agrupa a falha pelo código da Meta e traduz o que ele significa", () => {
    const falhas = falhasDeEntrega(
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "outbound", entrega: "failed", erroCodigo: "131026" }),
        msg({ criadoEm: "2026-09-17T12:01:00.000Z", direcao: "outbound", entrega: "failed", erroCodigo: "131026" }),
        msg({ criadoEm: "2026-09-17T12:02:00.000Z", direcao: "outbound", entrega: "failed" }),
      ],
      JANELA,
    );

    expect(falhas[0]).toEqual({ codigo: "131026", quantidade: 2, rotulo: "número sem WhatsApp ativo" });
    expect(falhas[1]?.codigo).toBe("sem código");
  });

  it("o movimento agrupa por hora da casa", () => {
    const horas = movimentoPorHora(
      [
        msg({ criadoEm: "2026-09-17T12:00:00.000Z", direcao: "inbound" }),
        msg({ criadoEm: "2026-09-17T12:30:00.000Z", direcao: "outbound" }),
        msg({ criadoEm: "2026-09-17T13:00:00.000Z", direcao: "inbound" }),
      ],
      JANELA,
      (iso) => new Date(iso).getUTCHours() - 3,
    );

    expect(horas).toEqual([
      { entraram: 1, hora: 9, sairam: 1 },
      { entraram: 1, hora: 10, sairam: 0 },
    ]);
  });

  it("o recado sem resposta aparece por fila", () => {
    const pendentes = semRespostaAoFim(
      [msg({ criadoEm: "2026-09-17T21:00:00.000Z", direcao: "inbound", fila: "Cobrança" })],
      JANELA,
    );
    expect(pendentes).toEqual([{ fila: "Cobrança", quantidade: 1 }]);
  });
});

describe("o backlog do Atendimento", () => {
  it("separa cliente de fornecedor e de robô — foi o que os 83 de 17/09 esconderam", () => {
    expect(classificarBacklog({ assunto: "[Asaas] Re: Solicitação", email: "x@asaas.com.br" })).toBe(
      "fornecedor",
    );
    expect(classificarBacklog({ assunto: "Report Domain: careli", email: "dmarc@careli.adm.br" })).toBe(
      "automatico",
    );
    expect(classificarBacklog({ assunto: "Boleto Vale do Ouro", email: "cliente@hotmail.com" })).toBe(
      "cliente",
    );
    // ⚠️ Cliente que escreve do trabalho continua cliente: foi o caso do educacao.mg.gov.br,
    // esperando desde julho.
    expect(
      classificarBacklog({ assunto: "Re: Recebemos o seu PIX", email: "pessoa@educacao.mg.gov.br" }),
    ).toBe("cliente");
    // Robô ganha do domínio: a notificação de falha de entrega vem de um gmail qualquer.
    expect(
      classificarBacklog({ assunto: "Delivery Status Notification (Failure)", email: "x@googlemail.com" }),
    ).toBe("automatico");
  });

  it("o resumo conta cada classe e a espera mais longa de CLIENTE", () => {
    const resumo = resumoDoBacklog([
      { assunto: null, classe: "cliente", diasParado: 56, email: null, protocolo: "AT-001131" },
      { assunto: null, classe: "cliente", diasParado: 3, email: null, protocolo: "AT-009992" },
      { assunto: null, classe: "fornecedor", diasParado: 90, email: null, protocolo: "AT-008517" },
      { assunto: null, classe: "automatico", diasParado: 120, email: null, protocolo: "AT-007872" },
    ]);

    expect(resumo).toEqual({
      automatico: 1,
      cliente: 2,
      fornecedor: 1,
      // ⚠️ 56, e não 120: a espera que importa é a do cliente, não a da newsletter parada.
      maisAntigoEmDias: 56,
      total: 4,
    });
  });
});
