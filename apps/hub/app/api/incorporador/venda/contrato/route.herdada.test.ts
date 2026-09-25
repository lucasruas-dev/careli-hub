import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

// ENVIAR PARA CONTRATO A PROPOSTA HERDADA DO C2X — a outra metade do "dar seguimento".
//
// Lucas, 25/09/2026: *"As reservas que foram herdadas do c2x, nao estamos conseguindo cancelar ou
// dar seguimento na proposta. Essas reservas tem que comportar iguais as outras"*.
//
// ⚠️ O MOTIVO ESCRITO NA PORTA MORREU. O filtro `origem = 'panteon'` desta rota existia porque "o
// Panteon não tem como escrever a mudança de volta lá": a carga do C2X foi ENCERRADA em 21/09/2026, e
// é a mesma razão pela qual o Lucas já tinha decidido em 16/09/2026 que o contrato herdado se cancela
// aqui (*"será feito aqui"*, registrado em `lib/hercules/acao-de-cancelamento.ts`).
//
// ⚠️ MEDIDO EM 25/09/2026 (projeto bxgukywoxgivlrhjkwjx, só SELECT): são 2 as propostas herdadas em
// etapa `proposta` numa linha VIVA de unidade (CDJ0403 e MDB1306). As outras 11 estão em `reservado` e
// não passam por aqui.
//
// ⚠️ POR QUE UM ARQUIVO NOVO, E NÃO UM CASO EM `route.test.ts`. O dublê de banco de lá responde a
// mesma linha a qualquer consulta (os `.eq` não filtram nada), então um teste de recorte por `origem`
// passaria verde antes e depois. Aqui o banco é o de memória, que honra os filtros.

const estado = vi.hoisted(() => ({
  abertos: [] as Array<Record<string, unknown>>,
  banco: null as null | { cliente: unknown },
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "37", codigo: "VOC", id: "emp-voc", nome: "VOC", operadoPor: null, paiId: null, vendendo: true },
]);

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({
    ok: true,
    sessao: { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" },
  }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["37"],
  };
});

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/temis/trabalhos-db", () => ({
  abrirTrabalho: async (novo: Record<string, unknown>) => {
    estado.abertos.push(novo);
    return { id: "trab-1", ok: true };
  },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

const { POST } = await import("@/app/api/incorporador/venda/contrato/route");

const unidade = (id: string, codigo: string, extra: Linha = {}): Linha => ({
  atualizado_em: "2026-09-01T00:00:00.000Z",
  codigo,
  enterprise_id: "37",
  espelho_de: null,
  id,
  lote: "03",
  origem_c2x_id: null,
  quadra: "04",
  situacao: "vendida",
  workspace_id: "careli",
  ...extra,
});

let banco: Banco;

/** O retrato da CDJ0403: proposta herdada, sem código, sem condições, sem reserva. */
function montarHerdada(extra: Linha = {}): void {
  banco = criarBanco({
    hercules_propostas: [
      {
        aberta: true,
        cliente_documento: "09656703685",
        cliente_nome: "ADALBERTO ANDRADE VILARINO",
        codigo: null,
        condicoes: null,
        empreendimento_codigo: "VOC",
        empreendimento_id: "emp-voc",
        etapa: "proposta",
        etapa_desde: "2026-08-20T10:00:00.000Z",
        id: "venda-c2x",
        origem: "c2x",
        origem_c2x_id: 3567,
        preco_tabela: null,
        protocolo_numero: null,
        reserva_id: null,
        unidade_id: "voc-0403",
        workspace_id: "careli",
        ...extra,
      },
    ],
    hercules_reservas: [],
    hercules_unidades: [unidade("voc-0403", "VOC0403")],
    prometeu_reservas: [],
  });
  estado.banco = banco;
}

const enviar = (propostaId?: string) =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/contrato", {
      body: JSON.stringify({ unidadeId: "voc-0403", ...(propostaId ? { propostaId } : {}) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

beforeEach(() => {
  estado.abertos = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("POST enviar para contrato: a proposta herdada do C2X segue daqui", () => {
  it("⚠️ move a etapa e abre o card na Têmis, como a nativa", async () => {
    montarHerdada();

    const r = await enviar("venda-c2x");

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("contrato");
    expect(estado.abertos).toHaveLength(1);
    expect(estado.abertos[0]).toMatchObject({
      canal: "hercules",
      clienteNome: "ADALBERTO ANDRADE VILARINO",
      propostaId: "venda-c2x",
      tipo: "contrato",
    });
  });

  it("⚠️ a trava da aba velha continua valendo na herdada", async () => {
    montarHerdada();

    const r = await enviar("outra-proposta");

    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: string }).error).toContain("Recarregue");
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("proposta");
    expect(estado.abertos).toHaveLength(0);
  });

  it("a herdada que JÁ está em contrato não vai duas vezes", async () => {
    montarHerdada({ etapa: "contrato" });

    const r = await enviar("venda-c2x");

    expect(r.status).toBe(409);
    expect(estado.abertos).toHaveLength(0);
  });
});

// ── A LINHA ESPELHO NÃO SEGUE PARA CONTRATO (revisão de 25/09/2026) ──────────────
//
// ⚠️ O CORTE DO FILTRO `origem = 'panteon'` ABRIU ESTA PORTA. Sem ele, o recorte `etapa = 'proposta'`
// passou a alcançar também as 4 herdadas em `proposta` penduradas na sombra do pai (medido em
// 25/09/2026 no projeto bxgukywoxgivlrhjkwjx, só SELECT), e nenhuma tela mostra essa linha: abriria card
// na Têmis sobre uma venda que ninguém vê. A rota do bloqueio já recusava a linha espelho, com esta
// frase (`bloquear-unidade-server.ts`); esta não recusava nada.
//
// ⚠️ AQUI O ESPELHO ESTÁ NO MESMO `enterprise_id` só para caber no escopo do dublê. Na produção ele mora
// no PAI, e `idsDaSessao` inclui o id do grupo (`lib/apolo/incorporador/escopo.ts`): o guarda de escopo
// também não o barraria.

describe("POST enviar para contrato: a linha espelho é recusada", () => {
  it("⚠️ 409 com a frase da casa, e nenhum card é aberto", async () => {
    banco = criarBanco({
      hercules_propostas: [
        {
          aberta: true,
          cliente_nome: "ADALBERTO ANDRADE VILARINO",
          empreendimento_codigo: "VOC",
          empreendimento_id: "emp-voc",
          etapa: "proposta",
          id: "venda-c2x-do-pai",
          origem: "c2x",
          origem_c2x_id: 3567,
          unidade_id: "vlo-0403",
          workspace_id: "careli",
        },
      ],
      hercules_reservas: [],
      hercules_unidades: [unidade("vlo-0403", "VLO0403", { espelho_de: "voc-0403" })],
      prometeu_reservas: [],
    });
    estado.banco = banco;

    const r = await POST(
      new Request("https://c2x.app.br/api/incorporador/venda/contrato", {
        body: JSON.stringify({ propostaId: "venda-c2x-do-pai", unidadeId: "vlo-0403" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: string }).error).toContain("registro antigo do terreno");
    expect(banco.linha("hercules_propostas", "venda-c2x-do-pai")?.etapa).toBe("proposta");
    expect(estado.abertos).toHaveLength(0);
  });

  // ⚠️ E O ERRO DE LEITURA NÃO PODE VIRAR "NÃO HÁ PROPOSTA ABERTA". Este recorte também saiu de baixo do
  // índice `hercules_propostas_uma_viva_por_unidade` (ele só vale para `origem = 'panteon'`), e com duas
  // linhas o `maybeSingle` devolve erro com `data` nulo. Engolir o `error` mandava o coordenador procurar
  // defeito onde não há.
  it("⚠️ a leitura da proposta que falha é 503 'tente de novo', e não 409 'não há proposta'", async () => {
    montarHerdada();
    banco.falhar((c) => c.tabela === "hercules_propostas" && c.operacao === "select");

    const r = await enviar("venda-c2x");

    expect(r.status).toBe(503);
    expect(((await r.json()) as { error?: string }).error).toContain("Tente de novo");
    expect(estado.abertos).toHaveLength(0);
  });
});
