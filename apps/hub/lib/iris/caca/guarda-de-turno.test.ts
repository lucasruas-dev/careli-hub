import { describe, expect, it } from "vitest";

import { decidirTurno } from "./guarda-de-turno";

// Cada caso abaixo e' um jeito de a CACA falar duas vezes com o cliente (ou calar quando
// deveria falar). Os timestamps saem do caso real AT-000923, onde a cliente recebeu duas
// respostas com 8 segundos de diferenca.
const MINHA = "2026-07-21T15:52:24.000Z";

describe("decidirTurno", () => {
  it("responde quando minha mensagem e' a ultima e ninguem respondeu ainda", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: MINHA,
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: "2026-07-21T15:51:48.000Z", // resposta anterior, mais antiga
      }),
    ).toEqual({ responder: true });
  });

  it("cala na RAJADA: chegou mensagem mais nova do cliente, quem responde e' a execucao dela", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: "2026-07-21T15:52:52.000Z",
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: null,
      }),
    ).toEqual({ motivo: "rajada", responder: false });
  });

  it("cala na CORRIDA: ja' existe resposta nossa depois da mensagem que eu processo", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: MINHA,
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: "2026-07-21T15:52:28.000Z", // o legado respondeu 4s depois
      }),
    ).toEqual({ motivo: "ja_respondido", responder: false });
  });

  it("rajada tem precedencia sobre corrida (nao duplica nem responde velho)", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: "2026-07-21T15:53:35.000Z",
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: "2026-07-21T15:52:36.000Z",
      }),
    ).toEqual({ motivo: "rajada", responder: false });
  });

  it("sem ancora de tempo, responde: silencio e' pior que risco de duplicata", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: "2026-07-21T15:53:35.000Z",
        minhaInboundEm: null,
        outboundMaisRecenteEm: "2026-07-21T15:53:00.000Z",
      }),
    ).toEqual({ motivo: "mensagem_desconhecida", responder: true });
  });

  it("atendimento novo (nenhuma outra mensagem) responde normalmente", () => {
    expect(
      decidirTurno({
        inboundMaisRecenteEm: null,
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: null,
      }),
    ).toEqual({ responder: true });
  });

  it("empate exato NAO cala: minha mensagem e' a mais recente, so' nao ha' nada depois", () => {
    // A leitura do inbound mais recente devolve a MINHA mensagem quando ela e' a ultima.
    // Comparacao tem que ser estritamente maior, senao a CACA nunca responderia.
    expect(
      decidirTurno({
        inboundMaisRecenteEm: MINHA,
        minhaInboundEm: MINHA,
        outboundMaisRecenteEm: MINHA,
      }),
    ).toEqual({ responder: true });
  });
});
