import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DO CANCELAMENTO DE CONTRATO — quem pode chamar, e o que a resposta leva.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*.
//
// ⚠️ A RÉGUA É A NOMINAL, E É A MESMA DE QUEM ALTERA O CONTRATO À MÃO (`temis-contrato-editar`, hoje
// só Nívea e Northon). Cancelar mata o contrato, cancela o envelope na Clicksign e solta o lote: não
// pode ser mais barato do que reescrever uma cláusula. O teste roda a régua DE VERDADE (só a sessão e
// o banco são dublados), porque o valor dela está em recusar o `leader` da coordenação — que passa em
// `autorizarEmissaoDeContrato` e NÃO passa aqui.
//
// ⚠️ E A RECUSA NÃO PODE CHAMAR O SERVIÇO. Um 403 depois de a venda cair seria pior do que nenhum
// 403: por isso o teste confere que o serviço não foi tocado.

const estado = vi.hoisted(() => ({
  concessao: null as null | { permission_id: string },
  papel: "leader",
  status: "active",
}));

const mocks = vi.hoisted(() => ({
  apurar: vi.fn(),
  cancelar: vi.fn(),
}));

vi.mock("@/lib/apolo/server", () => {
  const cliente = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (tabela: string) => {
      const resposta =
        tabela === "hub_user_permissions"
          ? { data: estado.concessao, error: null }
          : {
              data: {
                display_name: "Nivea Careli",
                id: "user-1",
                role: estado.papel,
                status: estado.status,
              },
              error: null,
            };
      const proprios: Record<string, unknown> = { maybeSingle: async () => resposta };
      const builder: Record<string, unknown> = new Proxy(proprios, {
        get: (alvo, prop) => (prop in alvo ? alvo[prop as string] : () => builder),
      });
      return builder;
    },
  };
  return { createApoloAdminClient: () => cliente, createApoloUserClient: () => cliente };
});

vi.mock("@/lib/temis/cancelar-contrato-servico", () => ({
  apurarCancelamentoDoContrato: mocks.apurar,
  cancelarContratoDoCard: mocks.cancelar,
}));

import { GET, POST } from "@/app/api/temis/trabalho/cancelar-contrato/route";

const SUCESSO = {
  avisos: [],
  cardDoPedido: "card-pedido-novo",
  classificacao: {
    devolveValores: false,
    porque: "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
    tipo: "cancelamento" as const,
  },
  conclusao: {
    avisos: [],
    cardConcluido: true,
    codigo: "000021",
    contratosIndeferidos: ["card-contrato"],
    copiasEncerradas: 0,
    envelopeCancelado: "env-maura",
    jaEstavaDesfeita: false,
    ok: true as const,
    recado: "Cancelamento concluído: a venda COD 000021 (Quadra 03 · Lote 06) foi cancelada e a unidade voltou para a disponibilidade.",
    tipo: "cancelamento" as const,
    unidade: { frase: "a unidade voltou para a disponibilidade", voltou: true },
  },
  ok: true as const,
};

function post(corpo: unknown): Request {
  return new Request("https://c2x.app.br/api/temis/trabalho/cancelar-contrato", {
    body: JSON.stringify(corpo),
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    method: "POST",
  });
}

function get(busca: string): Request {
  return new Request(`https://c2x.app.br/api/temis/trabalho/cancelar-contrato${busca}`, {
    headers: { authorization: "Bearer tok" },
  });
}

/** Quem tem a permissão nominal: hoje a Nívea e o Northon. */
function comPermissao(): void {
  estado.concessao = { permission_id: "temis-contrato-editar" };
}

beforeEach(() => {
  estado.concessao = null;
  estado.papel = "leader";
  estado.status = "active";
  mocks.apurar.mockReset();
  mocks.cancelar.mockReset();
  mocks.cancelar.mockResolvedValue(SUCESSO);
  mocks.apurar.mockResolvedValue({
    classificacao: SUCESSO.classificacao,
    codigo: "000021",
    fatos: {
      assinaturaCompleta: false,
      comoSoube: {
        assinatura: "nenhuma assinatura registrada",
        pagamento: "nenhum pagamento registrado",
      },
      houvePagamento: false,
    },
    ok: true,
    pedidoAberto: null,
    vendaDoLegado: false,
  });
});

describe("quem pode cancelar o contrato", () => {
  // ⚠️ O `leader` É A COORDENAÇÃO, e ele passa em `autorizarEmissaoDeContrato` (gerar contrato,
  // mandar assinar, indeferir, concluir). Aqui ele NÃO passa, e é o ponto inteiro desta régua.
  it("leader da coordenação, sem a permissão nominal: 403, e o serviço nem é chamado", async () => {
    const resposta = await POST(post({ id: "card-contrato", motivo: "Cliente desistiu" }));

    expect(resposta.status).toBe(403);
    expect(mocks.cancelar).not.toHaveBeenCalled();
    const corpo = (await resposta.json()) as { erro?: string };
    expect(corpo.erro ?? "").toContain("time de contratos");
  });

  it("admin sem a permissão também não cancela", async () => {
    estado.papel = "admin";

    const resposta = await POST(post({ id: "card-contrato", motivo: "Cliente desistiu" }));

    expect(resposta.status).toBe(403);
    expect(mocks.cancelar).not.toHaveBeenCalled();
  });

  it("a prévia tem a mesma régua: sem a permissão, 403 e nada é apurado", async () => {
    const resposta = await GET(get("?id=card-contrato"));

    expect(resposta.status).toBe(403);
    expect(mocks.apurar).not.toHaveBeenCalled();
  });

  it("quem tem a permissão cancela, e o serviço recebe o autor da sessão", async () => {
    comPermissao();

    const resposta = await POST(
      post({
        declaracoes: { devolucaoAcertada: true, termoAssinado: true },
        id: "card-contrato",
        motivo: "Cliente desistiu da compra",
      }),
    );

    expect(resposta.status).toBe(200);
    expect(mocks.cancelar).toHaveBeenCalledTimes(1);
    expect(mocks.cancelar.mock.calls[0]?.[1]).toEqual({
      declaracoes: { devolucaoAcertada: true, termoAssinado: true },
      motivo: "Cliente desistiu da compra",
      trabalhoId: "card-contrato",
      usuarioId: "user-1",
      usuarioNome: "Nivea Careli",
    });
  });

  // ⚠️ O MOTIVO VAI CRU PARA O SERVIÇO, e quem o confere é ele: uma segunda conferência aqui
  // divergiria da primeira no dia em que o mínimo mudasse.
  it("o motivo vazio não é filtrado pela rota: ele chega ao serviço, que recusa", async () => {
    comPermissao();
    mocks.cancelar.mockResolvedValue({
      erro: "Diga o motivo do cancelamento do contrato.",
      ok: false,
      status: 422,
    });

    const resposta = await POST(post({ id: "card-contrato" }));

    expect(resposta.status).toBe(422);
    expect(mocks.cancelar.mock.calls[0]?.[1]).toMatchObject({ motivo: undefined });
  });
});

describe("o que a resposta leva", () => {
  it("no sucesso: o recado do motor, o envelope cancelado e o card do pedido", async () => {
    comPermissao();

    const corpo = (await (await POST(post({ id: "card-contrato", motivo: "Desistiu" }))).json()) as {
      cardDoPedido?: string;
      envelopeCancelado?: string;
      ok?: boolean;
      recado?: string;
      tipo?: string;
      unidade?: { voltou?: boolean };
    };

    expect(corpo).toMatchObject({
      cardDoPedido: "card-pedido-novo",
      envelopeCancelado: "env-maura",
      ok: true,
      tipo: "cancelamento",
      unidade: { voltou: true },
    });
    expect(corpo.recado).toContain("voltou para a disponibilidade");
  });

  it("a venda do C2X e os avisos do motor viajam juntos no recado", async () => {
    comPermissao();
    mocks.cancelar.mockResolvedValue({
      ...SUCESSO,
      avisos: ["Esta venda veio do C2X: o Panteon não altera o legado."],
      conclusao: {
        ...SUCESSO.conclusao,
        avisos: ["O card de contrato continua aberto: indefira por lá."],
      },
    });

    const corpo = (await (await POST(post({ id: "card-contrato", motivo: "Desistiu" }))).json()) as {
      avisos?: string[];
      recado?: string;
    };

    expect(corpo.avisos).toEqual([
      "Esta venda veio do C2X: o Panteon não altera o legado.",
      "O card de contrato continua aberto: indefira por lá.",
    ]);
    expect(corpo.recado).toContain("C2X");
  });

  // ⚠️ SEM ISTO A TELA MANDARIA ABRIR O SEGUNDO PEDIDO. Quando a conclusão para no meio (a Clicksign
  // recusou), o card do pedido existe e é por ele que se termina.
  it("na falha com o pedido já aberto: o id do card vai na resposta", async () => {
    comPermissao();
    mocks.cancelar.mockResolvedValue({
      cardDoPedido: "card-pedido-novo",
      erro: "A Clicksign recusou o cancelamento do envelope env-maura. O pedido de cancelamento FICOU ABERTO na fila.",
      ok: false,
      status: 502,
    });

    const resposta = await POST(post({ id: "card-contrato", motivo: "Desistiu" }));
    const corpo = (await resposta.json()) as { cardDoPedido?: null | string; erro?: string };

    expect(resposta.status).toBe(502);
    expect(corpo.cardDoPedido).toBe("card-pedido-novo");
    expect(corpo.erro).toContain("FICOU ABERTO");
  });

  it("a prévia devolve a classificação para a tela escrever antes do clique", async () => {
    comPermissao();

    const corpo = (await (await GET(get("?id=card-contrato"))).json()) as {
      data?: { codigo?: string; devolveValores?: boolean; porque?: string; tipo?: string };
    };

    expect(corpo.data).toMatchObject({
      codigo: "000021",
      devolveValores: false,
      tipo: "cancelamento",
    });
    expect(corpo.data?.porque).toContain("não chegou a se formar");
  });
});
