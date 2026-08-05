import { describe, expect, it } from "vitest";

import {
  calcularEspera,
  formatarEspera,
  minutosUteisEntre,
} from "./espera";

// O erro que estamos consertando é pintar de vermelho quem NÃO está esperando (19 de 19 tickets
// aguardando o cliente apareciam como "Vencido") e contar madrugada e fim de semana como espera.
// Cada caso abaixo trava uma dessas.

// Segunda-feira, 27/07/2026, 10h (dentro do expediente).
const SEGUNDA_10H = new Date(2026, 6, 27, 10, 0, 0);

describe("minutosUteisEntre", () => {
  it("conta o intervalo cheio dentro do expediente", () => {
    expect(
      minutosUteisEntre(new Date(2026, 6, 27, 9, 0), new Date(2026, 6, 27, 11, 0)),
    ).toBe(120);
  });

  it("NÃO conta a madrugada: das 17h às 9h do dia seguinte só valem 2h", () => {
    // 17h→18h = 60min do dia 27; 8h→9h = 60min do dia 28. Total 120.
    expect(
      minutosUteisEntre(new Date(2026, 6, 27, 17, 0), new Date(2026, 6, 28, 9, 0)),
    ).toBe(120);
  });

  it("NÃO conta o fim de semana: sexta 17h a segunda 9h dá 2h", () => {
    // Sexta 24/07 17h→18h = 60min; sábado e domingo = 0; segunda 27/07 8h→9h = 60min.
    expect(
      minutosUteisEntre(new Date(2026, 6, 24, 17, 0), new Date(2026, 6, 27, 9, 0)),
    ).toBe(120);
  });

  it("intervalo inteiro fora do expediente é zero", () => {
    expect(
      minutosUteisEntre(new Date(2026, 6, 25, 10, 0), new Date(2026, 6, 26, 10, 0)),
    ).toBe(0); // sábado inteiro
  });

  it("fim antes do início não gera tempo negativo", () => {
    expect(
      minutosUteisEntre(new Date(2026, 6, 27, 12, 0), new Date(2026, 6, 27, 10, 0)),
    ).toBe(0);
  });
});

describe("calcularEspera", () => {
  it("bola com o CLIENTE não gera espera nem cor (o bug dos 19 de 19)", () => {
    const e = calcularEspera({
      agora: SEGUNDA_10H,
      bolaConosco: false,
      desde: new Date(2026, 6, 20, 10, 0).toISOString(),
    });

    expect(e.faixa).toBe("sem_espera");
    expect(e.rotulo).toBe("");
    expect(e.minutos).toBe(0);
  });

  it("espera curta fica normal, sem alarme", () => {
    const e = calcularEspera({
      agora: SEGUNDA_10H,
      bolaConosco: true,
      desde: new Date(2026, 6, 27, 9, 30).toISOString(),
    });

    expect(e.faixa).toBe("normal");
    expect(e.minutos).toBe(30);
    expect(e.rotulo).toBe("esperando 30min");
  });

  it("2h vira atenção", () => {
    const e = calcularEspera({
      agora: SEGUNDA_10H,
      bolaConosco: true,
      desde: new Date(2026, 6, 27, 8, 0).toISOString(),
    });

    expect(e.faixa).toBe("atencao");
    expect(e.rotulo).toBe("esperando 2h");
  });

  it("8h úteis vira atrasado", () => {
    // Sexta 16h → segunda 10h: sexta 2h + segunda 2h = 4h (ainda atenção, não atrasado).
    const quatroHoras = calcularEspera({
      agora: SEGUNDA_10H,
      bolaConosco: true,
      desde: new Date(2026, 6, 24, 16, 0).toISOString(),
    });
    expect(quatroHoras.faixa).toBe("atencao");

    // Quinta 10h → segunda 10h: quinta 8h + sexta 10h + segunda 2h = 20h.
    const vinteHoras = calcularEspera({
      agora: SEGUNDA_10H,
      bolaConosco: true,
      desde: new Date(2026, 6, 23, 10, 0).toISOString(),
    });
    expect(vinteHoras.faixa).toBe("atrasado");
  });

  it("mensagem de sábado não conta como espera na segunda de manhã", () => {
    // Cliente escreveu sábado 14h; às 8h de segunda ainda não esperou nada útil.
    const e = calcularEspera({
      agora: new Date(2026, 6, 27, 8, 0),
      bolaConosco: true,
      desde: new Date(2026, 6, 25, 14, 0).toISOString(),
    });

    expect(e.minutos).toBe(0);
    expect(e.faixa).toBe("normal");
  });

  // O cronômetro precisa ANDAR mesmo fora do expediente, senão parece quebrado à noite (foi o
  // que aconteceu no teste às 23h: tudo mostrava "esperando agora"). A cor é que não corre.
  it("à noite o TEXTO mostra o tempo corrido, mas a COR não acusa", () => {
    const e = calcularEspera({
      agora: new Date(2026, 6, 27, 23, 0), // segunda, 23h
      bolaConosco: true,
      desde: new Date(2026, 6, 27, 20, 0).toISOString(), // cliente escreveu às 20h
    });

    expect(e.minutosCorridos).toBe(180); // 3h de relógio de parede
    expect(e.rotulo).toBe("esperando 3h");
    expect(e.minutos).toBe(0); // nada de expediente entre 20h e 23h
    expect(e.faixa).toBe("normal"); // ninguém é acusado por não responder de madrugada
  });

  it("o texto conta o fim de semana inteiro, a cor não", () => {
    const e = calcularEspera({
      agora: new Date(2026, 6, 27, 9, 0), // segunda 9h
      bolaConosco: true,
      desde: new Date(2026, 6, 25, 9, 0).toISOString(), // sábado 9h
    });

    expect(e.minutosCorridos).toBe(2880); // 2 dias corridos
    expect(e.rotulo).toBe("esperando 2d0h");
    expect(e.minutos).toBe(60); // só a primeira hora de segunda
    expect(e.faixa).toBe("normal");
  });

  it("sem data não inventa espera", () => {
    expect(calcularEspera({ bolaConosco: true, desde: null }).faixa).toBe(
      "sem_espera",
    );
    expect(calcularEspera({ bolaConosco: true, desde: "ontem" }).faixa).toBe(
      "sem_espera",
    );
  });
});

describe("formatarEspera", () => {
  it("formata em minuto, hora e dia", () => {
    expect(formatarEspera(0)).toBe("agora");
    expect(formatarEspera(45)).toBe("45min");
    expect(formatarEspera(60)).toBe("1h");
    expect(formatarEspera(134)).toBe("2h14");
    expect(formatarEspera(1500)).toBe("1d1h");
  });
});
