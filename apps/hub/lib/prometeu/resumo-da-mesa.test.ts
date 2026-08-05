import { describe, expect, it } from "vitest";

import { derivarResumoDaMesa } from "./data";

// OS DOIS INDICADORES DA MESA saem de um cruzamento, não de uma coluna: a chamada diz quando a
// pessoa SENTOU (`atendido_em`) e a movimentação de etapa diz quando ela LEVANTOU. O risco desta
// conta é contar errado justamente no dia do lançamento — daí os testes serem sobre a DECISÃO
// (quantos contaram, qual a média, quem ficou de fora), não sobre a consulta.

const MESA = [
  { atendidoEm: "2026-08-01T13:00:00.000Z", credenciadoId: "ana" },
  { atendidoEm: "2026-08-01T13:30:00.000Z", credenciadoId: "bruno" },
];

describe("derivarResumoDaMesa", () => {
  it("conta os encerrados e tira a média entre sentar e sair", () => {
    const r = derivarResumoDaMesa(MESA, [
      // Ana: 20 minutos. Bruno: 10.
      { credenciadoId: "ana", em: "2026-08-01T13:20:00.000Z" },
      { credenciadoId: "bruno", em: "2026-08-01T13:40:00.000Z" },
    ]);

    expect(r.atendimentosHoje).toBe(2);
    expect(r.tempoMedioMs).toBe(15 * 60_000);
    expect(r.emAtendimentoDesde).toBeNull();
  });

  // QUEM ESTÁ SENTADO AGORA não terminou: entrar na média puxaria o tempo médio para baixo a cada
  // atendimento que começa, e o número na tela oscilaria sem ninguém ter feito nada.
  it("deixa de fora quem ainda está na cadeira e devolve a hora em que ele sentou", () => {
    const r = derivarResumoDaMesa(MESA, [
      { credenciadoId: "ana", em: "2026-08-01T13:20:00.000Z" },
    ]);

    expect(r.atendimentosHoje).toBe(1);
    expect(r.tempoMedioMs).toBe(20 * 60_000);
    expect(r.emAtendimentoDesde).toBe("2026-08-01T13:30:00.000Z");
  });

  // Movimentação ANTERIOR ao atendimento é a etapa que trouxe a pessoa até aqui (o bip da
  // secretaria, por exemplo). Tomá-la como fim daria duração negativa.
  it("ignora movimentação anterior ao começo do atendimento", () => {
    const r = derivarResumoDaMesa(
      [{ atendidoEm: "2026-08-01T13:00:00.000Z", credenciadoId: "ana" }],
      [
        { credenciadoId: "ana", em: "2026-08-01T12:10:00.000Z" },
        { credenciadoId: "ana", em: "2026-08-01T13:05:00.000Z" },
      ],
    );

    expect(r.atendimentosHoje).toBe(1);
    expect(r.tempoMedioMs).toBe(5 * 60_000);
  });

  // A MESMA PESSOA pode voltar à mesa no mesmo dia (foi direcionada e retornou). Cada passagem
  // fecha com a movimentação seguinte a ELA, não com a primeira do dia.
  it("fecha cada passagem com a saída correspondente quando a pessoa volta", () => {
    const r = derivarResumoDaMesa(
      [
        { atendidoEm: "2026-08-01T13:00:00.000Z", credenciadoId: "ana" },
        { atendidoEm: "2026-08-01T15:00:00.000Z", credenciadoId: "ana" },
      ],
      [
        { credenciadoId: "ana", em: "2026-08-01T13:10:00.000Z" },
        { credenciadoId: "ana", em: "2026-08-01T15:30:00.000Z" },
      ],
    );

    expect(r.atendimentosHoje).toBe(2);
    expect(r.tempoMedioMs).toBe(20 * 60_000);
  });

  // Dia sem nenhum atendimento fechado: travessão na tela, não "0:00".
  it("devolve média nula quando nada encerrou", () => {
    const r = derivarResumoDaMesa(
      [{ atendidoEm: "2026-08-01T13:00:00.000Z", credenciadoId: "ana" }],
      [],
    );

    expect(r.atendimentosHoje).toBe(0);
    expect(r.tempoMedioMs).toBeNull();
    expect(r.emAtendimentoDesde).toBe("2026-08-01T13:00:00.000Z");
  });
});
