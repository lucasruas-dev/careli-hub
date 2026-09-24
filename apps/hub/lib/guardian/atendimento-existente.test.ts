import { describe, expect, it, vi } from "vitest";

import {
  decidirOQuePainelFazComOAtendimento,
  hidratarTicketDoAtendimento,
  mensagensDoAtendimento,
  resolverAtendimentoDoCliente,
  resolverAtendimentoDoPainel,
  resolverAtendimentoExistente,
  statusDoTicketNoPainel,
  telefoneDoCliente,
  type LinhaDeMensagemDaIris,
} from "./atendimento-existente";

/**
 * Formato REAL, medido em 23/09/2026 no ticket AT-015189 da fila Cobrança. Os corpos foram
 * trocados por texto neutro (é conversa de cliente), mas direção, tipo, status de entrega e a
 * relação entre `created_at` e `sent_at` são exatamente os do banco.
 */
function linhasReais(): LinhaDeMensagemDaIris[] {
  return [
    {
      body: "Olá, seguem as parcelas em aberto.",
      created_at: "2026-09-23T17:55:16.724422+00:00",
      delivery_status: "read",
      direction: "outbound",
      id: "msg-1",
      message_type: "template",
      sender_type: "operator",
      sent_at: "2026-09-23T17:55:18.430016+00:00",
    },
    {
      body: "Quero negociar",
      created_at: "2026-09-23T18:14:40.050399+00:00",
      delivery_status: "delivered",
      direction: "inbound",
      id: "msg-2",
      message_type: "button",
      sender_type: "customer",
      sent_at: "2026-09-23T18:14:39.174579+00:00",
    },
    {
      body: "Posso te oferecer entrada reduzida.",
      created_at: "2026-09-23T18:16:27.552348+00:00",
      delivery_status: "read",
      direction: "outbound",
      id: "msg-3",
      message_type: "text",
      sender_type: "operator",
      sent_at: "2026-09-23T18:16:31.152220+00:00",
    },
    {
      body: "Consigo pagar dia 10.",
      created_at: "2026-09-23T18:23:44.447983+00:00",
      delivery_status: "delivered",
      direction: "inbound",
      id: "msg-4",
      message_type: "text",
      sender_type: "customer",
      sent_at: "2026-09-23T18:23:44.085172+00:00",
    },
  ];
}

function respostaFalsa(corpo: unknown, status = 200) {
  return {
    json: async () => corpo,
    ok: status >= 200 && status < 300,
    status,
  };
}

const TICKET_DO_BANCO = {
  id: "11111111-2222-3333-4444-555555555555",
  metadata: { relatedInstallments: ["parcela-3"], selectedUnitIds: ["unidade-1"] },
  opened_at: "2026-09-23T17:55:00.000Z",
  priority: "high",
  profile_id: "perfil-cobranca",
  protocol: "AT-015189",
  queue_id: "fila-cobranca",
  source_context: {},
  status: "waiting_customer",
};

const PERFIS = [
  {
    category: "Cobrança",
    id: "perfil-cobranca",
    name: "Negociação de parcelas",
    priority: "high" as const,
    queueId: "fila-cobranca",
    slaFirstResponseMinutes: 120,
  },
];

describe("resolver o atendimento que já existe", () => {
  // ⚠️ A RÉGUA DA CASA É UM ATENDIMENTO ABERTO POR CLIENTE. Este repo já produziu o cliente com
  // dois cards na Iris. Resolver pelo protocolo é LEITURA: tem que encontrar o que existe e, se
  // não encontrar, desistir — nunca abrir um segundo atendimento pelas costas do operador.
  it("⚠️ só LÊ: manda GET com o protocolo e NUNCA um POST que abriria outro atendimento", async () => {
    const chamadas: { metodo: string; url: string }[] = [];
    const buscar = vi.fn(async (url: string, init: { method: string }) => {
      chamadas.push({ metodo: init.method, url });
      return respostaFalsa({ ok: true, ticket: TICKET_DO_BANCO, mensagens: linhasReais() });
    });

    const resultado = await resolverAtendimentoExistente({
      buscar,
      protocolo: "AT-015189",
      token: "token-de-teste",
    });

    expect(resultado.encontrado).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.metodo).toBe("GET");
    expect(chamadas[0]?.url).toContain("protocol=AT-015189");
    // A prova negativa: nenhum método de escrita saiu daqui.
    expect(chamadas.every((chamada) => chamada.metodo === "GET")).toBe(true);
  });

  it("⚠️ protocolo não localizado NÃO vira abertura de atendimento novo", async () => {
    const chamadas: string[] = [];
    const buscar = vi.fn(async (_url: string, init: { method: string }) => {
      chamadas.push(init.method);
      return respostaFalsa({ error: "Protocolo nao localizado na Iris." }, 404);
    });

    const resultado = await resolverAtendimentoExistente({
      buscar,
      protocolo: "AT-099999",
    });

    expect(resultado.encontrado).toBe(false);
    expect(chamadas).toEqual(["GET"]);
  });

  it("protocolo fora do formato nem chega a bater na rota", async () => {
    const buscar = vi.fn(async () => respostaFalsa({ ok: true }));

    const resultado = await resolverAtendimentoExistente({ buscar, protocolo: "  " });

    expect(resultado.encontrado).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("a chave que existe de verdade: o telefone do cliente", () => {
  // ⚠️ OS DOIS LADOS GUARDAM O NÚMERO DIFERENTE. Medido em 23/09/2026: as 25.320 linhas de
  // `c2x_guardian_attendance_queue` guardam com máscara e NENHUMA só com dígitos; 1.650 dos 1.670
  // contatos da Iris guardam E.164. Sem tirar a máscara e sem o DDI, nenhum dos dois se acha.
  it("⚠️ tira a máscara da fila e devolve E.164, que é o formato do contato da Iris", () => {
    expect(telefoneDoCliente("(31) 99232-6981")).toBe("5531992326981");
    // Caso real medido: a fila guarda 10 dígitos, sem o 9º, e o contato do AT-010419 guarda 13.
    // Quem cruza as duas formas é o servidor; aqui o trabalho é chegar em E.164 sem inventar.
    expect(telefoneDoCliente("(31) 8964-7019")).toBe("553189647019");
    expect(telefoneDoCliente("5531983989407")).toBe("5531983989407");
  });

  it("telefone vazio ou truncado não vira chave", () => {
    expect(telefoneDoCliente("-")).toBeNull();
    expect(telefoneDoCliente("")).toBeNull();
    expect(telefoneDoCliente("3199")).toBeNull();
    expect(telefoneDoCliente(null)).toBeNull();
  });

  it("⚠️ resolver pelo cliente também só LÊ: um GET, nenhum POST", async () => {
    const chamadas: { metodo: string; url: string }[] = [];
    const buscar = vi.fn(async (url: string, init: { method: string }) => {
      chamadas.push({ metodo: init.method, url });
      return respostaFalsa({ ok: true, ticket: TICKET_DO_BANCO, mensagens: linhasReais() });
    });

    const resultado = await resolverAtendimentoDoCliente({
      buscar,
      telefone: "(31) 8964-7019",
      token: "token-de-teste",
    });

    expect(resultado.encontrado).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.metodo).toBe("GET");
    expect(chamadas[0]?.url).toContain("clientPhone=553189647019");
    expect(chamadas.every((chamada) => chamada.metodo === "GET")).toBe(true);
  });

  it("cliente sem telefone nem chega a bater na rota", async () => {
    const buscar = vi.fn(async () => respostaFalsa({ ok: true }));

    const resultado = await resolverAtendimentoDoCliente({ buscar, telefone: "-" });

    expect(resultado.encontrado).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("a porta única do painel", () => {
  // ⚠️ É ESTE O CAMINHO REAL DA TELA: sem protocolo, porque a prop nunca chega preenchida.
  it("⚠️ sem protocolo, vai direto no telefone e nem tenta a rota de protocolo", async () => {
    const urls: string[] = [];
    const buscar = vi.fn(async (url: string, init: { method: string }) => {
      urls.push(url);
      expect(init.method).toBe("GET");
      return respostaFalsa({ ok: true, ticket: TICKET_DO_BANCO, mensagens: [] });
    });

    const resultado = await resolverAtendimentoDoPainel({
      buscar,
      protocolo: null,
      telefone: "(31) 8964-7019",
    });

    expect(resultado.encontrado).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("clientPhone=");
    expect(urls.some((url) => url.includes("protocol="))).toBe(false);
  });

  it("com protocolo válido, o protocolo vem primeiro", async () => {
    const urls: string[] = [];
    const buscar = vi.fn(async (url: string) => {
      urls.push(url);
      return respostaFalsa({ ok: true, ticket: TICKET_DO_BANCO, mensagens: [] });
    });

    await resolverAtendimentoDoPainel({
      buscar,
      protocolo: "AT-015189",
      telefone: "(31) 8964-7019",
    });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("protocol=AT-015189");
  });

  it("protocolo que não bate cai no telefone em vez de desistir", async () => {
    const urls: string[] = [];
    const buscar = vi.fn(async (url: string) => {
      urls.push(url);

      return url.includes("protocol=")
        ? respostaFalsa({ error: "Protocolo nao localizado na Iris." }, 404)
        : respostaFalsa({ ok: true, ticket: TICKET_DO_BANCO, mensagens: [] });
    });

    const resultado = await resolverAtendimentoDoPainel({
      buscar,
      protocolo: "AT-099999",
      telefone: "(31) 8964-7019",
    });

    expect(resultado.encontrado).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("clientPhone=");
  });
});

describe("o que a tela faz com o atendimento encontrado", () => {
  // ⚠️ 8.163 DOS 8.180 TICKETS ESTÃO `closed` (99,8%, medido em 23/09/2026). Se encerrado
  // contasse como "assumir", o painel ofereceria envio em canal fechado em quase todo cliente.
  it("⚠️ encerrado e cancelado viram histórico; vivo a tela assume", () => {
    expect(decidirOQuePainelFazComOAtendimento("closed")).toBe("so-historico");
    expect(decidirOQuePainelFazComOAtendimento("resolved")).toBe("so-historico");
    expect(decidirOQuePainelFazComOAtendimento("cancelled")).toBe("so-historico");
    expect(decidirOQuePainelFazComOAtendimento("waiting_customer")).toBe("assumir");
    expect(decidirOQuePainelFazComOAtendimento("waiting_operator")).toBe("assumir");
    expect(decidirOQuePainelFazComOAtendimento("open")).toBe("assumir");
    expect(decidirOQuePainelFazComOAtendimento("new")).toBe("assumir");
    expect(decidirOQuePainelFazComOAtendimento("pending")).toBe("assumir");
  });
});

describe("as mensagens de verdade do atendimento", () => {
  it("lê o histórico real em vez do placeholder vazio", () => {
    const mensagens = mensagensDoAtendimento(linhasReais(), {
      operador: "Isac Santa Fé",
      protocolo: "AT-015189",
    });

    expect(mensagens).toHaveLength(4);
    expect(mensagens.map((mensagem) => mensagem.author)).toEqual([
      "operator",
      "client",
      "operator",
      "client",
    ]);
    expect(mensagens[1]?.body).toBe("Quero negociar");
    expect(mensagens.every((mensagem) => mensagem.ticketProtocol === "AT-015189")).toBe(true);
    // O placeholder antigo era uma única mensagem de corpo "-".
    expect(mensagens.some((mensagem) => mensagem.body === "-")).toBe(false);
  });

  // ⚠️ A ORDEM É `created_at`, NUNCA `sent_at`. Medido em 23/09/2026 na fila Cobrança: ordenar
  // por `sent_at` tira 2.511 mensagens do lugar, em 319 das 2.509 conversas. As duas linhas
  // abaixo são o caso real do ticket AT-011401: o provedor entregou duas mensagens do cliente
  // com `sent_at` defasado (11 e 26 minutos antes do `created_at`) e em ordem trocada, então por
  // `sent_at` a segunda fala aparece ANTES da primeira. As 99 internas ainda têm `sent_at` NULO.
  it("⚠️ ordena pelo created_at: por sent_at a conversa do AT-011401 inverte", () => {
    const comoNoBanco: LinhaDeMensagemDaIris[] = [
      {
        body: "Primeira fala do cliente.",
        created_at: "2026-09-01T11:55:16.527758+00:00",
        delivery_status: "delivered",
        direction: "inbound",
        id: "primeira",
        message_type: "text",
        sender_type: "customer",
        sent_at: "2026-09-01T11:44:33+00:00",
      },
      {
        body: "Segunda fala do cliente.",
        created_at: "2026-09-01T12:10:12.398234+00:00",
        delivery_status: "delivered",
        direction: "inbound",
        id: "segunda",
        message_type: "text",
        sender_type: "customer",
        sent_at: "2026-09-01T11:44:25+00:00",
      },
    ];

    const mensagens = mensagensDoAtendimento(comoNoBanco, { protocolo: "AT-011401" });

    expect(mensagens.map((mensagem) => mensagem.id)).toEqual(["primeira", "segunda"]);
  });

  it("entrega em ordem mesmo recebendo a lista embaralhada", () => {
    const foraDeOrdem = [linhasReais()[2]!, linhasReais()[1]!, linhasReais()[0]!, linhasReais()[3]!];

    const mensagens = mensagensDoAtendimento(foraDeOrdem, { protocolo: "AT-015189" });

    expect(mensagens.map((mensagem) => mensagem.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ]);
  });

  it("mensagem interna sem sent_at entra no lugar certo e não derruba a leitura", () => {
    const comNota: LinhaDeMensagemDaIris[] = [
      ...linhasReais(),
      {
        body: "Cliente pediu retorno na segunda.",
        created_at: "2026-09-23T18:40:00.000000+00:00",
        delivery_status: "sent",
        direction: "internal",
        id: "msg-nota",
        message_type: "note",
        sender_type: "operator",
        sent_at: null,
      },
    ];

    const mensagens = mensagensDoAtendimento(comNota, { protocolo: "AT-015189" });

    expect(mensagens).toHaveLength(5);
    expect(mensagens.at(-1)?.id).toBe("msg-nota");
  });

  it("traduz os tipos e os status de entrega que o banco usa", () => {
    const variados: LinhaDeMensagemDaIris[] = [
      {
        body: "",
        created_at: "2026-09-23T10:00:00.000Z",
        delivery_status: "read",
        direction: "outbound",
        id: "doc",
        message_type: "document",
        sender_type: "operator",
        sent_at: "2026-09-23T10:00:01.000Z",
      },
      {
        body: "audio",
        created_at: "2026-09-23T10:01:00.000Z",
        delivery_status: "delivered",
        direction: "inbound",
        id: "aud",
        message_type: "audio",
        sender_type: "customer",
        sent_at: "2026-09-23T10:00:59.000Z",
      },
      {
        body: "template que não entregou",
        created_at: "2026-09-23T10:02:00.000Z",
        delivery_status: "failed",
        direction: "outbound",
        id: "fal",
        message_type: "template",
        sender_type: "operator",
        sent_at: "2026-09-23T10:02:01.000Z",
      },
    ];

    const mensagens = mensagensDoAtendimento(variados, { protocolo: "AT-015189" });

    expect(mensagens[0]?.kind).toBe("document");
    expect(mensagens[0]?.status).toBe("lida");
    expect(mensagens[1]?.kind).toBe("audio");
    expect(mensagens[2]?.kind).toBe("text");
    // ⚠️ 183 templates da fila Cobrança estão `failed`. Mostrar como enviada seria a tela
    // afirmando uma entrega que não houve — o mesmo defeito, mais quieto.
    expect(mensagens[2]?.status).toBe("falhou");
  });
});

describe("hidratar o ticket para o operador poder falar", () => {
  it("⚠️ atendimento já aberto destrava o envio sem passar por abertura", () => {
    const hidratado = hidratarTicketDoAtendimento({
      perfis: PERFIS,
      ticket: TICKET_DO_BANCO,
    });

    expect(hidratado.irisTicketId).toBe(TICKET_DO_BANCO.id);
    expect(hidratado.protocol).toBe("AT-015189");
    expect(hidratado.attendanceProtocol).toBe("AT-015189");
    expect(hidratado.status).toBe("Aguardando cliente");
    // O que o composer exige: perfil, prioridade e SLA preenchidos, e o ticket fora de "Pendente".
    expect(hidratado.profileId).toBe("perfil-cobranca");
    expect(hidratado.profileName).toBe("Negociação de parcelas");
    expect(hidratado.priority).toBe("Alta");
    expect(hidratado.slaHours).toBeGreaterThan(0);
    expect(hidratado.relatedInstallments).toEqual(["parcela-3"]);
  });

  it("ticket encerrado no banco chega encerrado na tela", () => {
    const hidratado = hidratarTicketDoAtendimento({
      perfis: PERFIS,
      ticket: { ...TICKET_DO_BANCO, status: "closed" },
    });

    expect(hidratado.status).toBe("Encerrado");
  });

  it("traduz os status que a Iris realmente grava", () => {
    expect(statusDoTicketNoPainel("waiting_customer")).toBe("Aguardando cliente");
    expect(statusDoTicketNoPainel("waiting_operator")).toBe("Aguardando operador");
    expect(statusDoTicketNoPainel("closed")).toBe("Encerrado");
    expect(statusDoTicketNoPainel("resolved")).toBe("Encerrado");
    expect(statusDoTicketNoPainel("cancelled")).toBe("Cancelado");
    expect(statusDoTicketNoPainel("open")).toBe("Em atendimento");
    expect(statusDoTicketNoPainel("coisa-que-nao-existe")).toBe("Em atendimento");
  });

  it("perfil que não está no catálogo carregado não inventa nome", () => {
    const hidratado = hidratarTicketDoAtendimento({
      perfis: [],
      ticket: TICKET_DO_BANCO,
    });

    expect(hidratado.irisTicketId).toBe(TICKET_DO_BANCO.id);
    expect(hidratado.profileName).toBe("-");
  });
});
