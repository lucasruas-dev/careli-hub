import { describe, expect, it } from "vitest";

import {
  IRIS_CENTRAIS,
  centraisDisponiveis,
  centralValida,
  filaEhDaCentral,
  naoLidasPorCentral,
  ondeAbrirOTicket,
  recortarDadosPorCentral,
} from "./centrais";
import type { IrisCentral, IrisData, IrisQueueConfig, IrisTicket } from "../types/iris-types";

// Os casos abaixo travam erros que JÁ aconteceram enquanto isto foi construído, não hipóteses:
// a fila da Gurgel virou central e o mapeamento ainda só aceitava duas, então ela voltava com
// `central: null` — que por regra entra em todas as subtelas. Seria o oposto de separar.

function fila(slug: string, central: IrisCentral | null): IrisQueueConfig {
  return {
    assignmentStrategy: "manual",
    central,
    channelId: null,
    color: "#A07C3B",
    defaultPriority: "medium",
    id: `id-${slug}`,
    name: slug,
    routingStrategy: "manual",
    scopes: [],
    slaFirstResponseMinutes: 60,
    slaResolutionMinutes: 480,
    slug,
    status: "active",
  };
}

function ticket(id: string, queueSlug: string | null, unread = false): IrisTicket {
  return {
    assignedToLabel: "",
    channelLabel: "WhatsApp",
    contactLabel: "Fulano",
    createdAt: "2026-08-15T12:00:00Z",
    id,
    lastMessagePreview: "",
    messages: [],
    openedAt: "2026-08-15T12:00:00Z",
    priority: "medium",
    profileLabel: "",
    protocol: id,
    queueLabel: queueSlug ?? "Sem fila",
    queueSlug,
    sourceLabel: "",
    status: "open",
    subject: "",
    unread,
  } as IrisTicket;
}

function dados(): IrisData {
  return {
    broadcasts: [],
    channels: [],
    departments: [],
    profiles: [],
    queues: [
      fila("atendimento", "atendimento"),
      fila("relacionamento-direct", "relacionamento"),
      fila("gurgel", "gurgel"),
      fila("recem-criada", null),
    ],
    sectors: [],
    templates: [],
    tickets: [
      ticket("t-atd", "atendimento", true),
      ticket("t-rel", "relacionamento-direct"),
      ticket("t-gur", "gurgel", true),
      ticket("t-nova", "recem-criada"),
      ticket("t-orfao", null),
    ],
  };
}

describe("centrais da Iris", () => {
  it("as tres centrais aparecem na ordem que o Lucas pediu", () => {
    expect(IRIS_CENTRAIS).toEqual(["atendimento", "relacionamento", "gurgel"]);
  });

  it("a Gurgel e uma central de verdade, e nao cai nas outras", () => {
    expect(filaEhDaCentral(fila("gurgel", "gurgel"), "gurgel")).toBe(true);
    expect(filaEhDaCentral(fila("gurgel", "gurgel"), "atendimento")).toBe(false);
    expect(filaEhDaCentral(fila("gurgel", "gurgel"), "relacionamento")).toBe(false);
  });

  it("fila sem central entra em TODAS as subtelas, para nenhum ticket sumir da tela de todo mundo", () => {
    for (const central of IRIS_CENTRAIS) {
      expect(filaEhDaCentral(fila("recem-criada", null), central)).toBe(true);
    }
  });

  it("o recorte leva so as filas e os tickets da central escolhida", () => {
    const gurgel = recortarDadosPorCentral(dados(), "gurgel");

    expect(gurgel.queues.map((f) => f.slug).sort()).toEqual(["gurgel", "recem-criada"]);
    // t-orfao entra porque ticket sem fila e problema de dado, e escondê-lo seria enterrá-lo.
    expect(gurgel.tickets.map((t) => t.id).sort()).toEqual(["t-gur", "t-nova", "t-orfao"]);
  });

  it("'todas' devolve o objeto intacto", () => {
    const d = dados();
    expect(recortarDadosPorCentral(d, "todas")).toBe(d);
  });

  it("quem so tem fila de uma central nao ganha seletor", () => {
    expect(centraisDisponiveis([fila("atendimento", "atendimento")])).toEqual(["atendimento"]);
  });

  it("quem tem das tres ve as tres mais 'Todas', sempre na mesma ordem", () => {
    // De proposito fora de ordem, como o banco pode devolver.
    expect(
      centraisDisponiveis([
        fila("gurgel", "gurgel"),
        fila("atendimento", "atendimento"),
        fila("rel", "relacionamento"),
      ]),
    ).toEqual(["todas", "atendimento", "relacionamento", "gurgel"]);
  });

  it("central persistida que a pessoa perdeu cai na primeira disponivel, e nao em tela vazia", () => {
    expect(centralValida("gurgel", ["atendimento", "relacionamento"])).toBe("atendimento");
    expect(centralValida("gurgel", ["todas", "gurgel"])).toBe("gurgel");
  });

  it("as nao lidas contam a central que a pessoa NAO esta vendo", () => {
    const contagem = naoLidasPorCentral(dados(), ["atendimento", "gurgel"]);

    expect(contagem.atendimento).toBe(1);
    expect(contagem.gurgel).toBe(1);
  });
});

// ── O TICKET QUE A RECUSA VÊ E A TELA NÃO ────────────────────────────────────
//
// Chamado TI-000126: *"diz que já tem um ticket aberto, mas não aparece a conversa"*. A rota que
// barra o segundo atendimento procura sem recorte nenhum; a tela recorta por permissão e por
// central. Estes casos são os três desfechos possíveis dessa diferença.
describe("onde abrir um atendimento que já existe", () => {
  it("⚠️ ticket na OUTRA central manda trocar de aba, em vez de abrir o vazio", () => {
    expect(ondeAbrirOTicket("t-rel", dados(), "atendimento")).toEqual({
      central: "relacionamento",
      tipo: "outra_central",
    });
  });

  it("ticket da central aberta abre onde está", () => {
    expect(ondeAbrirOTicket("t-atd", dados(), "atendimento")).toEqual({ tipo: "esta_aqui" });
  });

  it("na visão 'todas', nada precisa mudar", () => {
    expect(ondeAbrirOTicket("t-rel", dados(), "todas")).toEqual({ tipo: "esta_aqui" });
  });

  // ⚠️ FORA DO ALCANCE NÃO É "OUTRA ABA". O ticket que nem chega no dado bruto está numa fila de
  // outro departamento — a régua de acesso já o tirou. Trocar de central não traria nada, e a
  // pessoa precisa ouvir que aquele atendimento não é dela.
  it("ticket que a régua não deixa ver é fora do alcance", () => {
    expect(ondeAbrirOTicket("t-de-outro-departamento", dados(), "atendimento")).toEqual({
      tipo: "fora_do_alcance",
    });
  });

  it("ticket órfão, sem fila, aparece em qualquer recorte", () => {
    expect(ondeAbrirOTicket("t-orfao", dados(), "gurgel")).toEqual({ tipo: "esta_aqui" });
  });

  it("sem ticket, não há para onde ir", () => {
    expect(ondeAbrirOTicket(null, dados(), "atendimento")).toEqual({ tipo: "esta_aqui" });
  });

  // A fila sem central entra em todos os recortes (regra do arquivo), então nunca manda trocar.
  it("fila sem central mapeada não manda trocar de aba", () => {
    expect(ondeAbrirOTicket("t-nova", dados(), "gurgel")).toEqual({ tipo: "esta_aqui" });
  });
});
