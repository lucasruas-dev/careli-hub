import { describe, expect, it } from "vitest";

import { agoraNoEvento, filaDaRecepcao } from "./data";
import type { PrometeuCredenciado } from "./types";

// A regra da fila da recepcao e o coracao do dia do lancamento e nao pode falhar: os exemplos
// abaixo sao os que o Lucas descreveu (19/jul), escritos como teste pra travar o comportamento.
//
//   - bipado DENTRO da janela -> ordena pela fila do evento (ordem do PIX). A fila REORDENA a
//     cada bip: quem chega depois, mas pagou antes, assume a frente.
//   - bipado DEPOIS da janela -> ordem de chegada, sempre atras de todo o primeiro grupo.

function credenciado(input: {
  entrouEm?: string | null;
  naJanela?: boolean | null;
  nome: string;
  posicao: number | null;
}): PrometeuCredenciado {
  return {
    corretor: null,
    credenciadoNaJanela: input.naJanela ?? null,
    documento: null,
    entityId: null,
    entrouEm: input.entrouEm ?? null,
    etapa: "recepcao",
    etapaDesde: "2026-08-01T11:00:00Z",
    etiquetaImpressaEm: null,
    eventoId: "evento-1",
    id: input.nome,
    imobiliaria: null,
    nome: input.nome,
    ordemFila: input.posicao,
    ordemMotivo: null,
    origem: "teste",
    pagoEm: input.posicao === null ? null : "2026-07-20T10:00:00Z",
    posicao: input.posicao,
    unidades: [],
  };
}

const nomes = (lista: PrometeuCredenciado[]) => lista.map((c) => c.nome);

describe("filaDaRecepcao", () => {
  it("so mostra quem ja fez check-in (quem nao chegou fica de fora)", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T11:00:00Z", naJanela: true, nome: "Chegou", posicao: 2 }),
      credenciado({ nome: "Habilitado, nao chegou", posicao: 1 }),
    ]);

    expect(nomes(fila)).toEqual(["Chegou"]);
  });

  // O exemplo do Lucas: "eu sou o 2 da fila de evento e cheguei as 8:00, na fila da recepcao eu
  // sou o primeiro pois o Lucas que e o primeiro ainda nao chegou".
  it("quem chegou primeiro lidera enquanto o dono da vaga nao aparece", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T11:00:00Z", naJanela: true, nome: "Segundo", posicao: 2 }),
    ]);

    expect(nomes(fila)).toEqual(["Segundo"]);
  });

  // "...se ele chegar dentro do periodo ele fica em primeiro e eu vou para o segundo".
  it("dentro da janela, quem pagou antes assume a frente mesmo chegando depois", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T11:00:00Z", naJanela: true, nome: "Segundo", posicao: 2 }),
      credenciado({ entrouEm: "2026-08-01T11:40:00Z", naJanela: true, nome: "Primeiro", posicao: 1 }),
    ]);

    expect(nomes(fila)).toEqual(["Primeiro", "Segundo"]);
  });

  // "...agora se ele chega depois eu sou o primeiro".
  it("fora da janela, quem pagou antes perde a vaga e vai pro fim", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T11:00:00Z", naJanela: true, nome: "Segundo", posicao: 2 }),
      credenciado({ entrouEm: "2026-08-01T12:05:00Z", naJanela: false, nome: "Primeiro", posicao: 1 }),
    ]);

    expect(nomes(fila)).toEqual(["Segundo", "Primeiro"]);
  });

  // "quem chegar depois vai ficar atras dele" — apos a janela vale so ordem de chegada.
  it("depois da janela a ordem e de chegada, ignorando a fila do evento", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T12:30:00Z", naJanela: false, nome: "Chegou 9h30", posicao: 1 }),
      credenciado({ entrouEm: "2026-08-01T12:05:00Z", naJanela: false, nome: "Chegou 9h05", posicao: 9 }),
      credenciado({ entrouEm: "2026-08-01T12:20:00Z", naJanela: false, nome: "Chegou 9h20", posicao: 5 }),
    ]);

    expect(nomes(fila)).toEqual(["Chegou 9h05", "Chegou 9h20", "Chegou 9h30"]);
  });

  // "pode ir um cliente que nao pagou Pix, entao ele sempre vai estar na ultima posicao durante
  // do periodo do lancamento" — sem PIX cai no fim do grupo da janela, nao no fim de tudo.
  it("sem PIX fica no fim do grupo da janela, mas ainda na frente de quem chegou atrasado", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T12:10:00Z", naJanela: false, nome: "Atrasado", posicao: 3 }),
      credenciado({ entrouEm: "2026-08-01T11:05:00Z", naJanela: true, nome: "Sem PIX", posicao: 99 }),
      credenciado({ entrouEm: "2026-08-01T11:30:00Z", naJanela: true, nome: "Com PIX", posicao: 1 }),
    ]);

    expect(nomes(fila)).toEqual(["Com PIX", "Sem PIX", "Atrasado"]);
  });

  // Cenario completo do dia, juntando as duas regras de uma vez.
  it("monta a fila do dia com os dois regimes convivendo", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T12:40:00Z", naJanela: false, nome: "E · 9h40 s/ PIX", posicao: 50 }),
      credenciado({ entrouEm: "2026-08-01T11:02:00Z", naJanela: true, nome: "B · 8h02 PIX#3", posicao: 3 }),
      credenciado({ entrouEm: "2026-08-01T12:06:00Z", naJanela: false, nome: "D · 9h06 PIX#1", posicao: 1 }),
      credenciado({ entrouEm: "2026-08-01T11:50:00Z", naJanela: true, nome: "A · 8h50 PIX#2", posicao: 2 }),
      credenciado({ entrouEm: "2026-08-01T11:15:00Z", naJanela: true, nome: "C · 8h15 s/ PIX", posicao: 80 }),
    ]);

    expect(nomes(fila)).toEqual([
      "A · 8h50 PIX#2", // pagou melhor, chegou tarde, mas dentro da janela
      "B · 8h02 PIX#3",
      "C · 8h15 s/ PIX", // sem PIX fecha o grupo da janela
      "D · 9h06 PIX#1", // perdeu a janela: o PIX#1 nao vale mais
      "E · 9h40 s/ PIX",
    ]);
  });
});

describe("agoraNoEvento", () => {
  // O servidor roda em UTC e o evento em Brasilia: errar isso desloca a janela em 3 horas e
  // bagunca a ordem da fila inteira no dia.
  it("converte para o horario de Brasilia, nao UTC", () => {
    // 2026-08-01T11:30:00Z = 08:30 em Brasilia (UTC-3).
    const { data, hora } = agoraNoEvento(new Date("2026-08-01T11:30:00Z"));

    expect(data).toBe("2026-08-01");
    expect(hora).toBe("08:30:00");
  });

  it("nao vira o dia cedo demais (23h59 em Brasilia ainda e o mesmo dia)", () => {
    // 2026-08-02T02:59:00Z = 23:59 do dia 01 em Brasilia.
    const { data, hora } = agoraNoEvento(new Date("2026-08-02T02:59:00Z"));

    expect(data).toBe("2026-08-01");
    expect(hora).toBe("23:59:00");
  });
});
