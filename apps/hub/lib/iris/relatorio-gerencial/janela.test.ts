import { describe, expect, it } from "vitest";

import { dataNaCasa, diaNaCasa, ehDiaUtil, horaNaCasa, instanteNaCasa, janelaDoDia } from "./janela";

describe("a janela do expediente", () => {
  it("08h00 e 18h30 de São Paulo viram 11h e 21h30 em UTC", () => {
    const janela = janelaDoDia("2026-09-17");
    expect(janela.inicio.toISOString()).toBe("2026-09-17T11:00:00.000Z");
    expect(janela.fim.toISOString()).toBe("2026-09-17T21:30:00.000Z");
  });

  it("⚠️ o cron é 21h30 UTC: a janela termina na hora em que o e-mail sai", () => {
    // Se alguém trocar para `30 18` no vercel.json, o disparo cai às 15h30 de Brasília e este
    // fim de janela (21h30 UTC) mostra o buraco de três horas.
    expect(janelaDoDia("2026-09-17").fim.getUTCHours()).toBe(21);
    expect(janelaDoDia("2026-09-17").fim.getUTCMinutes()).toBe(30);
  });

  it("o dia da casa vem do fuso da casa, e não do UTC", () => {
    // 22h30 de São Paulo já é o dia seguinte em UTC — e o relatório é do dia daqui.
    expect(diaNaCasa(new Date("2026-09-18T01:30:00.000Z"))).toBe("2026-09-17");
  });

  it("escreve o dia como a capa mostra", () => {
    expect(janelaDoDia("2026-09-17").rotuloDoDia).toBe("Quinta-feira, 17 de setembro de 2026");
    expect(dataNaCasa("2026-09-17")).toBe("17/09/2026");
  });

  it("a hora sai no relógio da casa", () => {
    expect(horaNaCasa("2026-09-17T11:07:00.000Z")).toBe("08:07");
  });

  it("sábado e domingo não têm relatório", () => {
    expect(ehDiaUtil("2026-09-17")).toBe(true);
    expect(ehDiaUtil("2026-09-19")).toBe(false);
    expect(ehDiaUtil("2026-09-20")).toBe(false);
  });

  it("meia-noite da casa não escorrega para o dia anterior", () => {
    expect(instanteNaCasa("2026-09-17", 0).toISOString()).toBe("2026-09-17T03:00:00.000Z");
  });
});
