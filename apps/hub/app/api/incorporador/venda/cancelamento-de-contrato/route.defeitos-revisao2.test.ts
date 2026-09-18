import { beforeEach, describe, expect, it, vi } from "vitest";

// ACHADO DA REVISÃO ADVERSARIAL DA RODADA 2 (18/09/2026) — teste VERMELHO de propósito.
//
// Medido em produção agora: VOL1106 (venda ca03bbcb…) e VOC0306 (venda 82011db5…) têm o card de
// cancelamento E o de contrato INDEFERIDOS (17/09, antes desta rodada), a venda em `contrato`, a
// reserva em `proposta`, o cadastro `reservada` — e a MARCA do pedido (`cancelamento_pedido_em`)
// ainda de pé, porque o indeferimento daquela época não a limpava. Depois do deploy:
//   • a conclusão recusa card indeferido ("peça o cancelamento de novo no Hércules");
//   • o Indeferir recusa card já indeferido;
//   • o pedido novo (esta rota) responde 409 "Já existe um pedido" por causa da marca;
//   • "Cancelar proposta" só vale em `proposta`, e a venda está em `contrato`.
// Nenhuma saída pela tela. O mesmo estado nasce de novo sempre que `recusarOPedido` não consegue
// gravar a história ou limpar a marca ("Avise o time do Panteon").
//
// O mock é o de `route.test.ts`, com a marca do pedido parametrizada.

type Resposta = { data: unknown; error: null | { code: string; message: string } };

const estado = vi.hoisted(() => ({
  abertos: [] as Array<Record<string, unknown>>,
  cardDeContrato: { data: [], error: null } as { data: unknown; error: null | { code: string; message: string } },
  carimbos: 0,
  /** A marca do pedido na venda. */
  marca: null as null | string,
  naFila: { data: [], error: null } as { data: unknown; error: null | { code: string; message: string } },
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
]);

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
    return { id: "trab-novo", ok: true };
  },
  ehColunaDoDonoAusente: () => false,
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let colunas = "";
    let atualizando = false;
    const resposta = (): Resposta => {
      if (atualizando) {
        estado.carimbos += 1;
        return { data: [{ id: "prop-1" }], error: null };
      }
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_propostas") {
        return {
          data: {
            cancelamento_pedido_em: estado.marca,
            cliente_documento: "52998224725",
            cliente_nome: "MARIA DA SILVA",
            codigo: null,
            data_assinatura: null,
            data_ato: null,
            data_faturamento: null,
            empreendimento_codigo: "VOC",
            empreendimento_id: "voc",
            etapa: "contrato",
            id: "prop-1",
            origem: "panteon",
            protocolo_numero: 21,
          },
          error: null,
        };
      }
      if (tabela === "temis_trabalhos" && colunas === "operado_por") return estado.cardDeContrato as Resposta;
      if (tabela === "temis_trabalhos" && colunas === "id, tipo, estagio") return estado.naFila as Resposta;
      return { data: [], error: null };
    };
    const cadeia: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    for (const metodo of ["eq", "in", "is", "limit", "maybeSingle", "neq", "not", "order", "insert"]) {
      cadeia[metodo] = () => cadeia;
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

beforeEach(() => {
  estado.abertos = [];
  estado.cardDeContrato = { data: [], error: null };
  estado.carimbos = 0;
  estado.marca = null;
  estado.naFila = { data: [], error: null };
  estado.sessao = GURGEL;
  estado.unidade = { codigo: "VOC0306", enterprise_id: "37", id: "u-1", lote: "06", quadra: "03" };
});

describe("revisão rodada 2: a marca do pedido sem nenhum card de pedido aberto", () => {
  it("controle: sem marca, o pedido nasce", async () => {
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(estado.abertos).toHaveLength(1);
  });

  it("corrigido na rodada 3: marca de pé com o pedido já indeferido (VOL1106/VOC0306) trava o pedido novo para sempre", async () => {
    // Os dois cards de pedido da venda estão indeferidos: `cardsAbertosDaProposta` não acha nenhum.
    estado.marca = "2026-09-16T18:03:03.000Z";
    estado.naFila = { data: [], error: null };

    const resposta = await pedir();

    // A marca sem card aberto é resto de um indeferimento que não a limpou: o pedido novo tem que
    // nascer (gravando antes a história do pedido velho), senão o lote fica preso sem saída.
    expect(resposta.status).toBe(200);
    expect(estado.abertos).toHaveLength(1);
  });

  it("⚠️ marca que acabou de nascer, com o card ainda a caminho: o segundo clique não abre outro card", async () => {
    // A rota grava a marca ANTES de criar o card. Um segundo clique nesse intervalo vê a marca sem
    // card; tratá-la como resto limparia o pedido em curso e abriria o segundo card do mesmo contrato.
    estado.marca = new Date(Date.now() - 10_000).toISOString();
    estado.naFila = { data: [], error: null };

    const resposta = await pedir();

    expect(resposta.status).toBe(409);
    expect(estado.abertos).toHaveLength(0);
    expect(estado.carimbos).toBe(0);
  });
});
