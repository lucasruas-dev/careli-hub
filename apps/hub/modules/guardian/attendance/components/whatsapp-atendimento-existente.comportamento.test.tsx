// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueClient } from "@/modules/guardian/attendance/types";

// O PAINEL DO HADES ACHANDO O ATENDIMENTO QUE JÁ EXISTE (chamado TI-000137, 23/09/2026).
//
// ⚠️ ESTE TESTE MONTA O COMPONENTE COM AS PROPS QUE A TELA REALMENTE PASSA, E É ESSE O PONTO.
// A rodada anterior ficou verde testando um efeito que dependia de `linkedAttendanceProtocol`,
// que NUNCA chega preenchido em produção. Aqui as props são as de
// `AttendancePage.tsx` (linha 832): `client`, `initialAttendanceProtocol`, `onClose`,
// `onTimelineEvent`, `open`. `initialOrigin` NÃO é passado, igual à tela. E:
//
//   • `initialAttendanceProtocol` é `null` porque o único chamador com cliente é
//     `onOpenWhatsApp={() => openWhatsApp(selectedClient.id)}` (`AttendancePage.tsx:991`), sem
//     protocolo, e os parâmetros de URL que `openWhatsApp` leria (`?at=`, `?atProtocol=`,
//     `?attendanceProtocol=`) não são gerados por NENHUM arquivo do repo (grep em 23/09/2026);
//   • `client.timeline` é `[]` porque é isso que o servidor devolve
//     (`lib/guardian/read-model.ts:560`), então o caminho alternativo
//     `findLatestAttendanceProtocol(client)` também volta nulo.
//
// O teste PROVA essas duas coisas olhando a rede: com as props reais, o painel NÃO consulta
// `?protocol=` (não há protocolo nenhum) e consulta `?clientPhone=`. Se alguém um dia reintroduzir
// a dependência do protocolo, a chamada por telefone some e este teste cai.
//
// O cliente da fixture tem a forma que `c2x_guardian_attendance_queue` entrega: telefone COM
// máscara e 10 dígitos, sem o 9º. O atendimento é a forma real do AT-010419 (perfil `cobranca`,
// `waiting_operator`, com `relatedInstallments` no metadata).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "token-do-hub" } },
        error: null,
      }),
    },
  }),
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

const { WhatsAppConversationPanel } = await import("./WhatsAppConversationPanel");

const CAMPO_VAZIO = "-";
const PERFIL_COBRANCA = "65041f33-0c1f-4b40-9b08-c2bc8d669438";
const FILA_COBRANCA = "11111111-1111-4111-8111-111111111111";
const CANAL_WHATSAPP = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_META = "33333333-3333-4333-8333-333333333333";
const TICKET_EXISTENTE = "44444444-4444-4444-8444-444444444444";

// A estrutura que `GET /api/iris/tickets` (sem query) devolve, no formato do banco.
const OPCOES_DA_IRIS = {
  channels: [
    {
      id: CANAL_WHATSAPP,
      kind: "whatsapp",
      name: "WhatsApp Careli",
      provider: "meta",
      slug: "whatsapp-careli",
      status: "active",
    },
  ],
  operator: { label: "Isac Santa Fé" },
  operators: [],
  profiles: [
    {
      category: "Cobrança",
      description: null,
      id: PERFIL_COBRANCA,
      name: "Cobrança",
      priority: "high",
      queue_id: FILA_COBRANCA,
      required_fields: ["contact_id", "queue_id", "priority"],
      sla_first_response_minutes: 30,
      sla_resolution_minutes: 480,
      slug: "cobranca",
      status: "active",
    },
  ],
  queues: [
    {
      default_priority: "high",
      id: FILA_COBRANCA,
      name: "Cobrança",
      sla_first_response_minutes: 30,
      sla_resolution_minutes: 480,
      slug: "cobranca",
      status: "active",
    },
  ],
  templates: [
    {
      body: "Olá {{1}}, podemos falar sobre as parcelas em aberto?",
      category: "UTILITY",
      id: TEMPLATE_META,
      language: "pt_BR",
      metaStatus: "APPROVED",
      name: "Cobrança amigável",
      slug: "cobranca_amigavel",
      templateName: "cobranca_amigavel",
    },
  ],
};

function atendimentoDaIris(status: string) {
  return {
    collectionProtocol: null,
    mensagens: [
      {
        body: "Olá, seguem as parcelas em aberto.",
        created_at: "2026-08-26T17:24:40.000000+00:00",
        delivery_status: "read",
        direction: "outbound",
        id: "msg-1",
        message_type: "template",
        sender_type: "operator",
        sent_at: "2026-08-26T17:24:44.000000+00:00",
      },
      {
        body: "Consigo pagar dia 10.",
        created_at: "2026-08-26T18:02:11.000000+00:00",
        delivery_status: "delivered",
        direction: "inbound",
        id: "msg-2",
        message_type: "text",
        sender_type: "customer",
        sent_at: "2026-08-26T18:02:03.000000+00:00",
      },
    ],
    ok: true,
    ticket: {
      id: TICKET_EXISTENTE,
      metadata: { relatedInstallments: ["parcela-3", "parcela-4"] },
      opened_at: "2026-08-26T17:24:36.269+00:00",
      priority: "high",
      profile_id: PERFIL_COBRANCA,
      protocol: "AT-010419",
      queue_id: FILA_COBRANCA,
      source_context: {},
      status,
    },
  };
}

// A forma que `lib/guardian/read-model.ts` monta a partir de `c2x_guardian_attendance_queue`.
// ⚠️ `timeline: []` E O TELEFONE COM MÁSCARA SÃO O PONTO, não detalhe de fixture.
// ⚠️ TIPADA COMO `QueueClient`, DE PROPÓSITO: se a fila do Hades mudar de forma, o `tsc`
// derruba esta fixture em vez de deixar o teste provar coisa sobre um cliente que não existe.
function clienteDaFila(): QueueClient {
  const unidade = {
    area: CAMPO_VAZIO,
    empreendimento: "Lavra do Ouro",
    id: "c2x-unit-9001",
    imobiliariaCorretor: CAMPO_VAZIO,
    lote: "38",
    matricula: "Q01 · Lote 38",
    quadra: "Q01",
    statusVenda: CAMPO_VAZIO,
    unidadeLote: "Q01 · Lote 38",
    valorTabela: CAMPO_VAZIO,
  };

  return {
    agreement: {
      aiSuggestion: {
        breakChance: 0,
        composition: CAMPO_VAZIO,
        nextAction: CAMPO_VAZIO,
        operationalRisk: "Moderado",
      },
      breakRate: 0,
      client: "Cliente da Fila",
      discount: "R$ 0,00",
      dueDates: [],
      enterprise: "Lavra do Ouro",
      entry: "R$ 0,00",
      id: "acordo-9001",
      installmentsCount: 0,
      negotiatedValue: "R$ 0,00",
      operator: CAMPO_VAZIO,
      originalDebt: "R$ 3.692,28",
      recoveredValue: "R$ 0,00",
      recoveryRate: 0,
      risk: "Moderado",
      status: "Em negociação",
      unit: "Q01 · Lote 38",
    },
    aiSuggestion: CAMPO_VAZIO,
    atrasoDias: 225,
    // A parcela vencida que a `AttendancePage` carrega do C2X para dentro do cliente; é dela que
    // o formulário de abertura monta a lista de "Parcelas relacionadas" do perfil Cobrança.
    c2xInstallments: [
      {
        acquisitionRequestId: "9001",
        dueDate: "10/02/2026",
        dueDateInput: "2026-02-10",
        id: "parcela-3",
        number: "3",
        overdueDays: 225,
        reference: "Parcela 3",
        referenceValue: 461.54,
        status: "Vencida" as const,
        unitCode: "Q01 · Lote 38",
        unitId: "c2x-unit-9001",
        unitLabel: "Q01 · Lote 38",
        value: "R$ 461,54",
        valueNumber: 461.54,
      },
    ],
    c2xInstallmentsLoaded: true,
    carteira: {
      empreendimento: "Lavra do Ouro",
      imobiliariaCorretor: CAMPO_VAZIO,
      unidades: [unidade],
    },
    commitments: [],
    cpf: "000.000.000-00",
    // O mesmo formato compacto (e o mesmo cast) que `buildCompactDados360` produz no read model.
    dados360: {
      conjugeDados: {},
      relacionamento: CAMPO_VAZIO,
      // ⚠️ COM MÁSCARA E COM 10 DÍGITOS, COMO A FILA GUARDA. Medido em 23/09/2026: as 25.320
      // linhas de `c2x_guardian_attendance_queue` guardam assim, NENHUMA só com dígitos.
      telefone: "(31) 8700-1234",
      tipoPessoa: CAMPO_VAZIO,
    } as QueueClient["dados360"],
    id: "c2x-client-9001",
    nome: "Cliente da Fila",
    parcelas: {
      abertas: 8,
      proximaAcao: CAMPO_VAZIO,
      ultimaParcela: "R$ 461,54",
      vencidas: 8,
    },
    prioridade: "Crítica",
    responsavel: CAMPO_VAZIO,
    saldoDevedor: "R$ 3.692,28",
    scoreRisco: 76,
    segmento: CAMPO_VAZIO,
    // ⚠️ VAZIA, COMO O SERVIDOR DEVOLVE (`lib/guardian/read-model.ts:560`). É por isso que
    // `findLatestAttendanceProtocol(client)` não acha protocolo nenhum no caminho real.
    timeline: [],
    workflow: {
      history: [],
      nextAction: CAMPO_VAZIO,
      owner: CAMPO_VAZIO,
      stage: "A acionar",
      updatedAt: CAMPO_VAZIO,
    },
  };
}

type Chamada = { body?: Record<string, unknown>; method: string; url: string };

let chamadas: Chamada[] = [];
let respostaDoAtendimento: { corpo: unknown; status: number };
let atendimentoPendente: null | ((corpo: unknown) => void) = null;
let raiz: Root;
let hospedeiro: HTMLDivElement;

function resposta(corpo: unknown, status = 200) {
  return {
    json: async () => corpo,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

beforeEach(() => {
  chamadas = [];
  atendimentoPendente = null;
  respostaDoAtendimento = { corpo: atendimentoDaIris("waiting_operator"), status: 200 };

  globalThis.fetch = vi.fn(async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada);
    const method = init?.method ?? "GET";

    chamadas.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      method,
      url,
    });

    if (url.startsWith("/api/iris/tickets?clientPhone=")) {
      if (atendimentoPendente !== null) {
        return new Promise<Response>((resolver) => {
          atendimentoPendente = (corpo: unknown) => resolver(resposta(corpo, 200));
        });
      }

      return resposta(respostaDoAtendimento.corpo, respostaDoAtendimento.status);
    }

    if (url.startsWith("/api/iris/tickets?protocol=")) {
      return resposta({ error: "Protocolo nao localizado na Iris." }, 404);
    }

    if (url === "/api/iris/tickets" && method === "POST") {
      return resposta({
        collectionProtocol: "CB-000900",
        messageId: "meta-1",
        ticket: {
          id: "55555555-5555-4555-8555-555555555555",
          opened_at: "2026-09-23T12:00:00.000Z",
          protocol: "AT-099001",
        },
      });
    }

    if (url === "/api/iris/tickets") {
      return resposta(OPCOES_DA_IRIS);
    }

    if (url === "/api/iris/meta/messages") {
      return resposta({ message: { id: "msg-enviada" } });
    }

    return resposta({ error: `Rota nao mapeada no teste: ${url}` }, 500);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  hospedeiro?.remove();
  vi.restoreAllMocks();
});

async function assentar() {
  for (let volta = 0; volta < 8; volta += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ⚠️ AS PROPS SÃO AS DE `AttendancePage.tsx:832`, NADA A MAIS. `initialOrigin` fica de fora
// porque a tela também não passa.
async function montarComoATelaMonta(protocoloDaRota: null | string = null) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);

  await act(async () => {
    raiz.render(
      React.createElement(WhatsAppConversationPanel, {
        client: clienteDaFila(),
        initialAttendanceProtocol: protocoloDaRota,
        onClose: () => {},
        onTimelineEvent: () => {},
        open: true,
      }),
    );
  });

  await assentar();
}

function composer() {
  return hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
}

function botaoPorTexto(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((botao) =>
    (botao.textContent ?? "").includes(texto),
  );
}

describe("o painel do Hades acha o atendimento que já existe", () => {
  it("⚠️ resolve pelo TELEFONE do cliente, porque protocolo nenhum chega nas props da tela", async () => {
    await montarComoATelaMonta();

    const porTelefone = chamadas.filter((chamada) =>
      chamada.url.startsWith("/api/iris/tickets?clientPhone="),
    );
    const porProtocolo = chamadas.filter((chamada) =>
      chamada.url.startsWith("/api/iris/tickets?protocol="),
    );

    // A chave antiga não existe no caminho real: sem prop e com `timeline: []`, nada a consultar.
    expect(porProtocolo).toHaveLength(0);
    // A chave nova existe: saiu do telefone do cliente, normalizado em E.164.
    // ⚠️ E É UMA CHAMADA SÓ, NÃO DUAS. `irisOptionsLoading` nasce `false`, então "ainda não
    // comecei" e "já terminei" são o mesmo valor: gatilho nele dispara uma resolução ANTES do
    // catálogo de perfis chegar, e essa hidrata o ticket com perfil "-" e trava o composer de
    // novo. Por isso a guarda é `irisOptionsReady`.
    expect(porTelefone).toHaveLength(1);
    expect(porTelefone[0]?.url).toContain("clientPhone=553187001234");
    expect(porTelefone[0]?.method).toBe("GET");
  });

  it("⚠️ atendimento ABERTO destrava o envio do script, que é o TI-000137", async () => {
    await montarComoATelaMonta();

    expect(composer().placeholder).toBe("Escrever mensagem WhatsApp...");
    expect(composer().disabled).toBe(false);
    expect(hospedeiro.textContent).toContain("AT-010419");
    expect(hospedeiro.textContent).toContain("Aguardando operador");
    // O formulário de abertura saiu da frente: o atendimento já existe.
    expect(botaoPorTexto("Abrir ticket pela Iris")).toBeUndefined();
  });

  it("mostra a conversa real do atendimento, em ordem de created_at", async () => {
    await montarComoATelaMonta();

    const texto = hospedeiro.textContent ?? "";

    expect(texto).toContain("Olá, seguem as parcelas em aberto.");
    expect(texto).toContain("Consigo pagar dia 10.");
    expect(texto.indexOf("Olá, seguem as parcelas em aberto.")).toBeLessThan(
      texto.indexOf("Consigo pagar dia 10."),
    );
  });

  it("⚠️ e o envio sai NO ticket resolvido, sem passar por abertura nenhuma", async () => {
    await montarComoATelaMonta();

    await act(async () => {
      const campo = composer();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, "Segue o script combinado.");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enviar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.getAttribute("aria-label") === "Enviar mensagem",
    );

    expect(enviar?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      enviar?.click();
    });
    await assentar();

    const envio = chamadas.find((chamada) => chamada.url === "/api/iris/meta/messages");

    expect(envio?.method).toBe("POST");
    expect(envio?.body?.ticketId).toBe(TICKET_EXISTENTE);
    // Nenhum POST de abertura saiu: resolver encontra, nunca cria.
    expect(
      chamadas.filter(
        (chamada) => chamada.url === "/api/iris/tickets" && chamada.method === "POST",
      ),
    ).toHaveLength(0);
  });
});

describe("o que a tela faz com atendimento ENCERRADO", () => {
  // ⚠️ 8.163 DOS 8.180 TICKETS ESTÃO `closed` (99,8%, medido em 23/09/2026). Se encerrado
  // destravasse o composer, o painel ofereceria envio num canal fechado em quase todo cliente.
  it("⚠️ encerrado NÃO destrava o envio: a tela avisa e mantém a abertura do novo ciclo", async () => {
    respostaDoAtendimento = { corpo: atendimentoDaIris("closed"), status: 200 };

    await montarComoATelaMonta();

    expect(composer().placeholder).toBe("Ticket incompleto");
    expect(composer().disabled).toBe(true);
    // A tela diz qual foi o último atendimento e o que fazer.
    expect(hospedeiro.textContent).toContain(
      "O último atendimento deste cliente na Iris (AT-010419) está encerrado.",
    );
    // ⚠️ E NÃO ASSUME O TICKET MORTO: o protocolo da tela continua vazio, senão o `openTicket()`
    // mandaria esse protocolo no POST e a rota REESCREVERIA o atendimento encerrado.
    expect(hospedeiro.textContent).not.toContain("Consigo pagar dia 10.");
    // E abrir o PRÓXIMO ciclo segue disponível, que é a régua: um atendimento ABERTO por cliente.
    expect(botaoPorTexto("Abrir ticket pela Iris")).toBeDefined();
  });

  it("cliente sem atendimento nenhum na Iris segue no caminho de abertura", async () => {
    respostaDoAtendimento = {
      corpo: { error: "Cliente ainda nao tem contato na Iris." },
      status: 404,
    };

    await montarComoATelaMonta();

    expect(composer().placeholder).toBe("Ticket incompleto");
    expect(botaoPorTexto("Abrir ticket pela Iris")).toBeDefined();
  });
});

describe("o caminho que já funciona não pode quebrar", () => {
  // ⚠️ ABRIR E FALAR NA MESMA MONTAGEM É O ÚNICO JEITO QUE FUNCIONAVA ANTES DESTA CORREÇÃO.
  // Aqui a resolução fica PENDURADA enquanto o operador abre o ticket pela tela, e só então
  // responde: a guarda `ticket.irisTicketId` tem que impedir que o atendimento resolvido
  // sobrescreva o recém-aberto.
  it("⚠️ resolução atrasada não sobrescreve o ticket aberto na mesma montagem", async () => {
    atendimentoPendente = () => {};

    await montarComoATelaMonta();

    // O operador escolhe a parcela, como o perfil Cobrança exige.
    await act(async () => {
      const parcelas = hospedeiro.querySelector("select[multiple]") as HTMLSelectElement;
      parcelas.options[0]!.selected = true;
      parcelas.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const abrir = botaoPorTexto("Abrir ticket pela Iris");

    expect(abrir).toBeDefined();
    expect(abrir?.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      abrir?.click();
    });
    await assentar();

    expect(hospedeiro.textContent).toContain("CB-000900");

    // Agora o GET pendurado responde com o atendimento antigo.
    await act(async () => {
      atendimentoPendente?.(atendimentoDaIris("waiting_operator"));
    });
    await assentar();

    // O ticket recém-aberto continua sendo o da tela.
    expect(hospedeiro.textContent).toContain("CB-000900");
    expect(hospedeiro.textContent).not.toContain("AT-010419");
    expect(composer().disabled).toBe(false);
  });
});
