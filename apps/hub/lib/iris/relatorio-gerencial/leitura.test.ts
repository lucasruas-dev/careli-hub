import { describe, expect, it } from "vitest";

import { janelaDoDia } from "./janela";
import { type ConversaParaLeitura, selecionarConversas, validarLeitura } from "./leitura";
import type { MensagemDaJanela, TicketDaJanela } from "./metricas";

const JANELA = janelaDoDia("2026-09-17");

function msg(p: Partial<MensagemDaJanela> & { criadoEm: string; direcao: string }): MensagemDaJanela {
  return {
    daCaca: false,
    entrega: "delivered",
    erroCodigo: null,
    fila: "Atendimento",
    texto: "oi",
    ticketId: "t1",
    tipo: "text",
    usuarioId: null,
    ...p,
  };
}

function ticket(p: Partial<TicketDaJanela> & { id: string }): TicketDaJanela {
  return {
    abertoEm: "2026-09-17T12:00:00.000Z",
    cliente: "Maria",
    daCaca: false,
    fechadoEm: null,
    fila: "Atendimento",
    protocolo: `AT-${p.id}`,
    ...p,
  };
}

describe("escolher o que vai para leitura", () => {
  it("cliente contrariado entra na frente da conversa tranquila", () => {
    const tickets = [ticket({ id: "001" }), ticket({ id: "002" })];
    const mensagens = [
      // Conversa tranquila, com troca.
      ...Array.from({ length: 14 }, (_, i) =>
        msg({
          criadoEm: `2026-09-17T12:${String(i).padStart(2, "0")}:00.000Z`,
          direcao: i % 2 === 0 ? "inbound" : "outbound",
          ticketId: "001",
        }),
      ),
      msg({
        criadoEm: "2026-09-17T13:00:00.000Z",
        direcao: "inbound",
        texto: "isso é um absurdo, já falei três vezes",
        ticketId: "002",
      }),
      msg({ criadoEm: "2026-09-17T13:05:00.000Z", direcao: "outbound", ticketId: "002" }),
    ];

    const escolhidas = selecionarConversas(tickets, mensagens, JANELA);
    expect(escolhidas[0]?.protocolo).toBe("AT-002");
    expect(escolhidas.map((c) => c.protocolo)).toContain("AT-001");
  });

  it("⚠️ ticket sem protocolo fica de fora: sem ele a leitura não teria como ser conferida", () => {
    const escolhidas = selecionarConversas(
      [ticket({ id: "003", protocolo: null })],
      [
        msg({ criadoEm: "2026-09-17T13:00:00.000Z", direcao: "inbound", texto: "processar vocês", ticketId: "003" }),
      ],
      JANELA,
    );
    expect(escolhidas).toEqual([]);
  });

  it("a transcrição sai com hora da casa e diz quem falou", () => {
    const escolhidas = selecionarConversas(
      [ticket({ id: "004" })],
      [
        msg({ criadoEm: "2026-09-17T13:00:00.000Z", direcao: "inbound", texto: "não recebi o boleto, que descaso", ticketId: "004" }),
        msg({ criadoEm: "2026-09-17T13:02:00.000Z", daCaca: true, direcao: "outbound", texto: "já te mando", ticketId: "004" }),
      ],
      JANELA,
    );

    expect(escolhidas[0]?.transcricao).toContain("10:00 cliente: não recebi o boleto");
    expect(escolhidas[0]?.transcricao).toContain("10:02 CACÁ: já te mando");
    expect(escolhidas[0]?.cliente).toBe("Maria");
  });

  it("conversa de uma mensagem só, sem sinal nenhum, não ocupa vaga", () => {
    const escolhidas = selecionarConversas(
      [ticket({ id: "005" })],
      [msg({ criadoEm: "2026-09-17T13:00:00.000Z", direcao: "outbound", texto: "ok", ticketId: "005" })],
      JANELA,
    );
    expect(escolhidas).toEqual([]);
  });
});

describe("conferir o que o modelo escreveu", () => {
  const conversas: ConversaParaLeitura[] = [
    {
      cliente: "Maria",
      fila: "Atendimento",
      minutosAteResposta: 4,
      protocolo: "AT-014375",
      transcricao: "17:52 CACÁ: Me passa o CPF, só os números.\n17:56 cliente: claro",
    },
  ];

  it("⚠️ item com protocolo que não existe é DESCARTADO e contado", () => {
    const leitura = validarLeitura(
      {
        acoes: [{ acao: "Fazer X", motivo: "porque sim", protocolos: ["AT-999999", "AT-014375"] }],
        descartados: 0,
        insatisfeitos: [],
        modelo: "claude-sonnet-5",
        negativos: [{ detalhe: "inventado", protocolo: "AT-999999", titulo: "Caso que não houve" }],
        positivos: [{ detalhe: "pediu CPF antes de mandar fatura", protocolo: "AT-014375", titulo: "Conferiu identidade" }],
      },
      conversas,
    );

    expect(leitura.negativos).toEqual([]);
    expect(leitura.positivos).toHaveLength(1);
    expect(leitura.descartados).toBe(1);
    // O protocolo inventado também sai da ação.
    expect(leitura.acoes[0]?.protocolos).toEqual(["AT-014375"]);
  });

  it("citação que não está na conversa cai, mas o item fica", () => {
    const leitura = validarLeitura(
      {
        acoes: [],
        descartados: 0,
        insatisfeitos: [],
        modelo: "claude-sonnet-5",
        negativos: [],
        positivos: [
          {
            citacao: "prometi que resolveria em 24 horas",
            detalhe: "conferiu identidade",
            protocolo: "AT-014375",
            titulo: "Conferiu identidade",
          },
        ],
      },
      conversas,
    );

    expect(leitura.positivos[0]?.citacao).toBeNull();
    expect(leitura.positivos[0]?.titulo).toBe("Conferiu identidade");
  });

  it("citação literal sobrevive, com acento e aspas diferentes", () => {
    const leitura = validarLeitura(
      {
        acoes: [],
        descartados: 0,
        insatisfeitos: [],
        modelo: "claude-sonnet-5",
        negativos: [],
        positivos: [
          {
            citacao: "“Me passa o CPF, so os numeros.”",
            detalhe: "conferiu identidade",
            protocolo: "at-014375",
            titulo: "Conferiu identidade",
          },
        ],
      },
      conversas,
    );

    expect(leitura.positivos[0]?.citacao).toContain("Me passa o CPF");
  });
});
