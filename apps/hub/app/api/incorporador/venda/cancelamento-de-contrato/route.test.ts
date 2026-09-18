import { beforeEach, describe, expect, it, vi } from "vitest";

// O PEDIDO DE CANCELAMENTO DEPOIS DO CONTRATO — de quem é o card, e quem pode pedir.
//
// Decisão do Lucas (16/09/2026):
//   • o card do pedido HERDA o dono do card de contrato da mesma proposta: quem confeccionou o
//     contrato é quem confecciona o distrato. A Gurgel vendeu (contrato na fila da Careli) e o time
//     do Cecílio pede o cancelamento? O distrato continua com a Careli;
//   • sem a coluna (0172 pendente), nulo; sem card de contrato, a regra da origem (o Cecílio é dono
//     do que pede, a Gurgel é Careli);
//   • no VOC (37, operado pela Careli) o Cecílio só consulta.

type Resposta = { data: unknown; error: null | { code: string; message: string } };

const estado = vi.hoisted(() => ({
  abertos: [] as Array<Record<string, unknown>>,
  /** O que a leitura do card de contrato devolve. */
  cardDeContrato: { data: [], error: null } as { data: unknown; error: null | { code: string; message: string } },
  carimbos: 0,
  /** Os filtros da procura do "pedido já na fila" (`cardsAbertosDaProposta`). */
  filtrosDaFila: [] as unknown[][],
  /** O que a procura do "pedido já na fila" devolve. */
  naFila: { data: [], error: null } as { data: unknown; error: null | { code: string; message: string } },
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
]);

const CECILIO = {
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-cecilio",
  usuarioNome: "Maria do Cecílio",
};

const GURGEL = {
  incorporadorId: "inc-gurgel",
  slug: "gurgel",
  tipo: "comercial",
  usuarioId: "u-gurgel",
  usuarioNome: "Nivea",
};

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["37", "39"],
  };
});

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/temis/trabalhos-db", () => ({
  abrirTrabalho: async (novo: Record<string, unknown>) => {
    estado.abertos.push(novo);
    return { id: "trab-distrato", ok: true };
  },
  // O mesmo reconhecimento de `trabalhos-db.ts`: coluna ausente, pelo nome dela.
  ehColunaDoDonoAusente: (erro: unknown) => {
    const { code, message } = (erro ?? {}) as { code?: string; message?: string };
    return (code === "42703" || code === "PGRST204") && String(message).includes("operado_por");
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let colunas = "";
    let atualizando = false;
    const filtros: unknown[][] = [];
    const resposta = (): Resposta => {
      if (atualizando) {
        estado.carimbos += 1;
        return { data: [{ id: "prop-1" }], error: null };
      }
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_propostas") {
        return {
          data: {
            cancelamento_pedido_em: null,
            cliente_documento: "52998224725",
            cliente_nome: "MARIA DA SILVA",
            codigo: null,
            data_assinatura: null,
            data_ato: null,
            data_faturamento: null,
            empreendimento_codigo: "GDN",
            empreendimento_id: "gdn",
            etapa: "contrato",
            id: "prop-1",
            protocolo_numero: 12,
          },
          error: null,
        };
      }
      if (tabela === "temis_trabalhos" && colunas === "operado_por") {
        return estado.cardDeContrato as Resposta;
      }
      if (tabela === "temis_trabalhos" && colunas === "id, tipo, estagio") {
        estado.filtrosDaFila = filtros;
        return estado.naFila as Resposta;
      }
      // Nenhum pedido anterior na fila, nenhum evento, nenhum envelope.
      return { data: [], error: null };
    };
    const cadeia: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    for (const metodo of ["eq", "in", "is", "limit", "maybeSingle", "neq", "not", "order"]) {
      cadeia[metodo] = (...args: unknown[]) => {
        filtros.push([metodo, ...args]);
        return cadeia;
      };
    }
    cadeia.select = (lista: string) => {
      if (!atualizando) colunas = lista;
      return cadeia;
    };
    cadeia.update = () => {
      atualizando = true;
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { POST } from "./route";

const pedir = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/cancelamento-de-contrato", {
      body: JSON.stringify({ motivo: "Cliente desistiu da compra", unidadeId: "u-1" }),
      method: "POST",
    }),
  );

const unidadeEm = (enterpriseId: string) => ({
  codigo: "GDN0107",
  enterprise_id: enterpriseId,
  id: "u-1",
  lote: "07",
  quadra: "01",
});

beforeEach(() => {
  estado.abertos = [];
  estado.cardDeContrato = { data: [], error: null };
  estado.carimbos = 0;
  estado.filtrosDaFila = [];
  estado.naFila = { data: [], error: null };
  estado.sessao = CECILIO;
  estado.unidade = unidadeEm("39");
});

describe("POST: o dono do pedido herda o do contrato", () => {
  it("⚠️ a Gurgel vendeu (contrato da Careli) e o Cecílio pede: o pedido fica com a Careli", async () => {
    estado.cardDeContrato = { data: [{ operado_por: null }], error: null };
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(estado.abertos).toHaveLength(1);
    expect(estado.abertos[0]).toMatchObject({ abertoPor: "u-cecilio", operadoPor: null, propostaId: "prop-1" });
  });

  it("o contrato é do Cecílio: o pedido também é", async () => {
    estado.cardDeContrato = { data: [{ operado_por: "inc-cecilio" }], error: null };
    await pedir();
    expect(estado.abertos[0]?.operadoPor).toBe("inc-cecilio");
  });

  it("⚠️ contrato do Cecílio e quem pede é a Gurgel: o pedido segue com o Cecílio, não com quem clicou", async () => {
    estado.sessao = GURGEL;
    estado.cardDeContrato = { data: [{ operado_por: "inc-cecilio" }], error: null };
    await pedir();
    expect(estado.abertos[0]?.operadoPor).toBe("inc-cecilio");
  });

  it("sem a coluna (0172 pendente): nulo, e o pedido nasce como todo card nascia", async () => {
    estado.cardDeContrato = {
      data: null,
      error: { code: "42703", message: "column temis_trabalhos.operado_por does not exist" },
    };
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(estado.abertos[0]?.operadoPor).toBeNull();
  });

  it("sem card de contrato: a regra da origem (Cecílio dono do que pede, Gurgel na Careli)", async () => {
    await pedir();
    expect(estado.abertos[0]?.operadoPor).toBe("inc-cecilio");

    estado.abertos = [];
    estado.sessao = GURGEL;
    await pedir();
    expect(estado.abertos[0]?.operadoPor).toBeNull();
  });

  it("outro erro na leitura do dono não adivinha a fila: o pedido não abre e o carimbo é desfeito", async () => {
    estado.cardDeContrato = { data: null, error: { code: "57014", message: "statement timeout" } };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resposta = await pedir();
    expect(resposta.status).toBe(502);
    expect(estado.abertos).toHaveLength(0);
    // O carimbo e o desfazer do carimbo: duas escritas, nenhum card.
    expect(estado.carimbos).toBe(2);
    erro.mockRestore();
  });
});

describe("POST: quem opera o produto decide a escrita (D1)", () => {
  it("⚠️ Cecílio no VOC (37): 403 só consulta, sem carimbo e sem card", async () => {
    estado.unidade = unidadeEm("37");
    const resposta = await pedir();
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ soConsulta: true });
    expect(estado.carimbos).toBe(0);
    expect(estado.abertos).toHaveLength(0);
  });
});

// ⚠️ "ABERTO" É FORA DE `faturado` E DE `indeferido` (18/09/2026). A procura antiga excluía
// `finalizado`, um estágio que não existe desde a 0150: todo card antigo contava como aberto,
// inclusive o INDEFERIDO. Com o indeferimento limpando a marca do pedido, o pedido novo acharia o
// card indeferido, responderia "já existia" e não abriria card nenhum.
describe("POST: o pedido já na fila (D)", () => {
  it("a procura exclui Concluído e Indeferido, e não pergunta mais por `finalizado`", async () => {
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(estado.filtrosDaFila).toContainEqual(["not", "estagio", "in", "(faturado,indeferido)"]);
    expect(estado.filtrosDaFila).toContainEqual(["in", "tipo", ["cancelamento", "distrato"]]);
    expect(JSON.stringify(estado.filtrosDaFila)).not.toContain("finalizado");
    // Nenhum aberto: o pedido novo nasce.
    expect(estado.abertos).toHaveLength(1);
  });

  it("um card ainda aberto responde que o pedido já existia, sem abrir o segundo", async () => {
    estado.naFila = { data: [{ estagio: "analise", id: "trab-antigo", tipo: "cancelamento" }], error: null };
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ data: { jaExistia: true, trabalhoId: "trab-antigo" } });
    expect(estado.abertos).toHaveLength(0);
  });

  it("leitura da fila que falha não vira 'não há card': o carimbo é desfeito e nada abre", async () => {
    estado.naFila = { data: null, error: { code: "57014", message: "statement timeout" } };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resposta = await pedir();
    expect(resposta.status).toBe(502);
    expect(estado.abertos).toHaveLength(0);
    expect(estado.carimbos).toBe(2);
    erro.mockRestore();
  });
});
