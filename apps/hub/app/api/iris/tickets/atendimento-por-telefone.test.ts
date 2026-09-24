import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA ACHANDO O ATENDIMENTO DO CLIENTE PELO TELEFONE (chamado TI-000137, 23/09/2026).
//
// ⚠️ ESTE TESTE CHAMA O `GET` DE VERDADE, o mesmo que o painel do Hades bate. O que é falso aqui
// é só o cliente do Supabase (um espião que devolve linhas e anota as consultas) e a autorização.
// A decisão que importa, "qual ticket o painel recebe", é a da rota.
//
// Por que o telefone: medido em 23/09/2026, dos 8.180 tickets ZERO tem `source_module='hades'`,
// ZERO tem `metadata.hadesClientId` e ZERO tem `source_context.clientId`; 8.180 de 8.180 têm
// `contact_id`, e o contato se acha pelo número.

vi.mock("@/lib/iris/meta-server", () => ({
  authorizeIrisMetaRequest: async () => ({
    client: clienteFalso,
    ok: true,
    user: { id: "operador-1" },
  }),
}));

type Consulta = {
  filtros: { coluna: string; tipo: string; valor: unknown }[];
  limite: null | number;
  tabela: string;
};

let consultas: Consulta[] = [];
let contatosPorNumero: string[] = [];
let ticketsAbertos: Record<string, unknown>[] = [];
let ticketsQuaisquer: Record<string, unknown>[] = [];
let mensagens: Record<string, unknown>[] = [];

function construtor(tabela: string) {
  const consulta: Consulta = { filtros: [], limite: null, tabela };
  consultas.push(consulta);

  const alvo = {
    eq(coluna: string, valor: unknown) {
      consulta.filtros.push({ coluna, tipo: "eq", valor });
      return alvo;
    },
    in(coluna: string, valor: unknown) {
      consulta.filtros.push({ coluna, tipo: "in", valor });
      return alvo;
    },
    limit(valor: number) {
      consulta.limite = valor;
      return alvo.resolver();
    },
    order() {
      return alvo;
    },
    resolver() {
      return Promise.resolve({ data: alvo.linhas(), error: null });
    },
    select() {
      return alvo;
    },
    linhas() {
      if (tabela === "caredesk_contacts") {
        const coluna = consulta.filtros[0]?.coluna;
        const pedidos = (consulta.filtros[0]?.valor ?? []) as string[];

        // Só o `whatsapp_phone` casa neste cenário, como nos 1.650 contatos que guardam E.164.
        return coluna === "whatsapp_phone" &&
          pedidos.some((numero) => contatosPorNumero.includes(numero))
          ? [{ id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" }]
          : [];
      }

      if (tabela === "caredesk_tickets") {
        const pediuAberto = consulta.filtros.some((filtro) => filtro.coluna === "status");

        return pediuAberto ? ticketsAbertos : ticketsQuaisquer;
      }

      if (tabela === "caredesk_messages") {
        return mensagens;
      }

      return [];
    },
  };

  return alvo;
}

const clienteFalso = { from: (tabela: string) => construtor(tabela) };

const { GET } = await import("./route");

function pedido(telefone: string) {
  return {
    url: `https://c2x.app.br/api/iris/tickets?clientPhone=${encodeURIComponent(telefone)}`,
  } as never;
}

const TICKET_ABERTO = {
  id: "44444444-4444-4444-8444-444444444444",
  metadata: { relatedInstallments: ["parcela-3"] },
  opened_at: "2026-08-26T17:24:36.269+00:00",
  priority: "high",
  profile_id: "65041f33-0c1f-4b40-9b08-c2bc8d669438",
  protocol: "AT-010419",
  queue_id: "11111111-1111-4111-8111-111111111111",
  source_context: { collectionProtocol: "CB-000419" },
  status: "waiting_operator",
};

const TICKET_ENCERRADO = {
  ...TICKET_ABERTO,
  id: "66666666-6666-4666-8666-666666666666",
  protocol: "AT-009000",
  status: "closed",
};

beforeEach(() => {
  consultas = [];
  contatosPorNumero = [];
  ticketsAbertos = [];
  ticketsQuaisquer = [];
  mensagens = [];
});

describe("GET /api/iris/tickets?clientPhone", () => {
  // ⚠️ CASO REAL MEDIDO: a fila do Hades guarda "(31) 8964-7019" (10 dígitos, sem o 9º) e o
  // contato do atendimento ABERTO AT-010419 guarda "5531989647019" (13, com o 9). Sem cruzar as
  // duas formas, esse atendimento não é encontrado e o operador continua sem conseguir falar.
  it("⚠️ acha o contato mesmo quando a fila guarda o número SEM o 9º dígito", async () => {
    contatosPorNumero = ["5531989647019"];
    ticketsAbertos = [TICKET_ABERTO];

    const resposta = await GET(pedido("553189647019"));
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.ticket.protocol).toBe("AT-010419");

    const buscaDeContato = consultas.find(
      (consulta) => consulta.tabela === "caredesk_contacts",
    );
    const candidatos = buscaDeContato?.filtros[0]?.valor as string[];

    expect(candidatos).toContain("553189647019");
    expect(candidatos).toContain("5531989647019");
  });

  // ⚠️ 20 DOS 1.670 CONTATOS GUARDAM O NÚMERO COM MÁSCARA, no mesmo formato da fila do Hades
  // (medido em 23/09/2026; 6 deles batem letra a letra com um telefone da fila). Por isso o valor
  // cru entra junto com as variantes E.164.
  it("⚠️ leva também o número CRU, porque parte dos contatos guarda com máscara", async () => {
    contatosPorNumero = ["(31) 99232-6981"];
    ticketsAbertos = [TICKET_ABERTO];

    const resposta = await GET(pedido("(31) 99232-6981"));

    expect(resposta.status).toBe(200);

    const candidatos = consultas.find((consulta) => consulta.tabela === "caredesk_contacts")
      ?.filtros[0]?.valor as string[];

    expect(candidatos).toContain("(31) 99232-6981");
    expect(candidatos).toContain("5531992326981");
  });

  // ⚠️ O ABERTO GANHA DO MAIS RECENTE, E POR CONSULTA PRÓPRIA. 7 contatos têm mais de 40 tickets
  // (o maior tem 1.118): filtrar na memória uma janela das últimas linhas deixaria o atendimento
  // aberto deles invisível.
  it("⚠️ pergunta pelo ABERTO primeiro, e só cai no último quando não existe nenhum vivo", async () => {
    contatosPorNumero = ["5531989647019"];
    ticketsAbertos = [TICKET_ABERTO];
    ticketsQuaisquer = [TICKET_ENCERRADO];

    const corpo = await (await GET(pedido("553189647019"))).json();

    expect(corpo.ticket.protocol).toBe("AT-010419");

    const buscasDeTicket = consultas.filter(
      (consulta) => consulta.tabela === "caredesk_tickets",
    );

    expect(buscasDeTicket).toHaveLength(1);
    expect(
      buscasDeTicket[0]?.filtros.find((filtro) => filtro.coluna === "status")?.valor,
    ).toEqual(["new", "open", "waiting_customer", "waiting_operator", "pending"]);
  });

  it("sem atendimento vivo, devolve o último para a tela saber o que aconteceu", async () => {
    contatosPorNumero = ["5531989647019"];
    ticketsAbertos = [];
    ticketsQuaisquer = [TICKET_ENCERRADO];

    const corpo = await (await GET(pedido("553189647019"))).json();

    expect(corpo.ticket.protocol).toBe("AT-009000");
    expect(corpo.ticket.status).toBe("closed");
    expect(
      consultas.filter((consulta) => consulta.tabela === "caredesk_tickets"),
    ).toHaveLength(2);
  });

  it("devolve a conversa do ticket, ordenada no banco por created_at", async () => {
    contatosPorNumero = ["5531989647019"];
    ticketsAbertos = [TICKET_ABERTO];
    mensagens = [{ body: "Quero negociar", created_at: "2026-08-26T18:02:11+00:00", id: "m1" }];

    const corpo = await (await GET(pedido("553189647019"))).json();

    expect(corpo.mensagens).toHaveLength(1);
    expect(corpo.collectionProtocol).toBe("CB-000419");

    const buscaDeMensagens = consultas.find(
      (consulta) => consulta.tabela === "caredesk_messages",
    );

    expect(buscaDeMensagens?.filtros[0]).toEqual({
      coluna: "ticket_id",
      tipo: "eq",
      valor: TICKET_ABERTO.id,
    });
  });

  it("cliente sem contato na Iris devolve 404, e nunca cria nada", async () => {
    contatosPorNumero = [];

    const resposta = await GET(pedido("553189647019"));

    expect(resposta.status).toBe(404);
    expect(
      consultas.filter((consulta) => consulta.tabela === "caredesk_tickets"),
    ).toHaveLength(0);
  });

  it("telefone impossível devolve 400 sem bater no banco", async () => {
    const resposta = await GET(pedido("3199"));

    expect(resposta.status).toBe(400);
    expect(consultas).toHaveLength(0);
  });
});
