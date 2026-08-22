import { describe, expect, it } from "vitest";

import { paraInstante } from "./reservas-c2x";

// O ERRO DE 3 HORAS DA COLUNA "TEMPO NA RESERVA".
//
// O servidor MySQL do C2X roda em UTC, mas a aplicação Rails grava o relógio de BRASÍLIA dentro
// de um DATETIME — que não guarda fuso. O pool do Hades usa `timezone: "Z"`, então o driver lia
// aquele horário como se fosse UTC e todo "há quanto tempo" saía 3 horas maior: a reserva do
// Raylander aparecia como 20h46 parada quando o real era 17h46, e o alerta "+30 min" acendia
// para a lista inteira.
//
// Medido em 22/08/2026 com a sequência do mesmo cliente, cruzando Postgres (timestamptz, fuso
// explícito) e C2X: check-in 09:13 → reserva 09:25 → contrato 10:01 → concluído 10:09. Lido como
// UTC, a reserva cairia às 06:25 — antes do check-in, o que é impossível.

describe("paraInstante", () => {
  it("lê o horário do C2X como Brasília, não como UTC", () => {
    // 17:17 em Brasília é 20:17 UTC. Era exatamente aqui que nasciam as 3 horas a mais.
    expect(paraInstante("2026-08-21T17:17:00")).toBe("2026-08-21T20:17:00.000Z");
  });

  it("aceita o formato com espaço, que é como o MySQL costuma devolver", () => {
    expect(paraInstante("2026-08-22 09:25:59")).toBe("2026-08-22T12:25:59.000Z");
  });

  it("reproduz a sequência real do evento sem inverter a ordem dos fatos", () => {
    // check-in 09:13 (Postgres) tem que vir ANTES da reserva 09:25 (C2X).
    const checkIn = new Date("2026-08-22T12:13:05.027Z").getTime();
    const reserva = new Date(paraInstante("2026-08-22 09:25:59")).getTime();
    const contrato = new Date(paraInstante("2026-08-22 10:01:44")).getTime();
    const concluido = new Date("2026-08-22T13:09:16.040Z").getTime();
    expect(checkIn).toBeLessThan(reserva);
    expect(reserva).toBeLessThan(contrato);
    expect(contrato).toBeLessThan(concluido);
  });

  it("respeita a data que já vem com fuso, em vez de somar o offset de novo", () => {
    expect(paraInstante("2026-08-22T12:25:59.000Z")).toBe("2026-08-22T12:25:59.000Z");
    expect(paraInstante("2026-08-22T09:25:59-03:00")).toBe("2026-08-22T12:25:59.000Z");
  });

  it("devolve vazio para entrada vazia ou inválida, sem quebrar a tela", () => {
    expect(paraInstante("")).toBe("");
    expect(paraInstante("   ")).toBe("");
    expect(paraInstante("banana")).toBe("");
  });

  it("o tempo de espera calculado bate com o relógio de quem está no salão", () => {
    // Reserva às 09:00 de Brasília, agora 11:00 de Brasília = 2h parada (não 5h).
    const criado = new Date(paraInstante("2026-08-22 09:00:00")).getTime();
    const agora = new Date("2026-08-22T14:00:00.000Z").getTime(); // 11:00 em Brasília
    expect((agora - criado) / 3600000).toBe(2);
  });
});
