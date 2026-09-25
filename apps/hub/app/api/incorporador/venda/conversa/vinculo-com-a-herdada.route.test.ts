import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

// A CONVERSA E OS DOCUMENTOS NÃO PERDEM O VÍNCULO COM A VENDA HERDADA DO C2X.
//
// Lucas, 25/09/2026: *"essas reservas tem que comportar iguais as outras"*.
//
// ⚠️ ERA DEFEITO SILENCIOSO. `vendaDoLote` das duas rotas filtrava `origem = 'panteon'`, não achava a
// herdada, caía no fallback de `hercules_reservas` e não achava nada (a carga nunca criou a reserva:
// ZERO linhas para as 13, medido em 25/09/2026 no projeto bxgukywoxgivlrhjkwjx). A mensagem e o
// documento nasciam com `proposta_id` e `empreendimento_codigo` NULOS: nada quebra na cara de quem
// usa, e nada fica ligado à venda. Aparece meses depois, quando alguém procura o documento.
//
// ⚠️ E A ETAPA `reservado` ENTRA NA LISTA. Tirar só o filtro de origem alcançaria 2 das 13: as outras
// 11 estão em etapa `reservado`, que a lista de etapas desta leitura não tinha. Nenhuma venda NATIVA
// mora em `hercules_propostas` na etapa `reservado` (a reserva do Hércules é linha de
// `hercules_reservas`), então o alargamento só alcança a herdada.

const estado = vi.hoisted(() => ({ banco: null as null | { cliente: unknown } }));

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

/** O Storage responde que o arquivo existe e tem 10 bytes: o registro só precisa disso. */
const storage = {
  from: () => ({
    info: async () => ({ data: { size: 10 }, error: null }),
    remove: async () => ({ data: null, error: null }),
  }),
};

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => {
    const cliente = estado.banco?.cliente as null | { from: (t: string) => unknown };
    return cliente ? { from: (t: string) => cliente.from(t), storage } : null;
  },
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

const { POST: postarMensagem } = await import("@/app/api/incorporador/venda/conversa/route");
const { POST: registrarDocumento } = await import("@/app/api/incorporador/venda/documentos/route");

let banco: Banco;

/** O retrato de uma das 11: proposta herdada em `reservado`, sem reserva e sem protocolo. */
function montarHerdada(etapa = "reservado"): void {
  banco = criarBanco({
    hercules_propostas: [
      {
        cliente_documento: "09656703685",
        cliente_entity_id: "cad-nivea",
        cliente_nome: "NIVEA CARELI PEREIRA DE AVELAR",
        codigo: null,
        empreendimento_codigo: "VOC",
        empreendimento_id: "emp-voc",
        etapa,
        etapa_desde: "2026-06-27T10:00:00.000Z",
        id: "venda-c2x",
        origem: "c2x",
        origem_c2x_id: 4234,
        protocolo_numero: null,
        reserva_id: null,
        unidade_id: "voc-0305",
        workspace_id: "careli",
      },
    ],
    hercules_reservas: [],
    hercules_unidades: [
      {
        atualizado_em: "2026-09-01T00:00:00.000Z",
        codigo: "VOC0305",
        enterprise_id: "37",
        espelho_de: null,
        id: "voc-0305",
        lote: "05",
        quadra: "03",
        situacao: "reservada",
        workspace_id: "careli",
      },
    ],
    prometeu_reservas: [],
  });
  estado.banco = banco;
}

const mandarMensagem = () =>
  postarMensagem(
    new Request("https://c2x.app.br/api/incorporador/venda/conversa", {
      body: JSON.stringify({ texto: "Cliente pediu o extrato", tipo: "nota", unidadeId: "voc-0305" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

const mandarDocumento = () =>
  registrarDocumento(
    new Request("https://c2x.app.br/api/incorporador/venda/documentos", {
      body: JSON.stringify({
        acao: "registrar",
        caminho: "hercules/documentos/voc-0305/abc-rg.pdf",
        nome: "rg.pdf",
        unidadeId: "voc-0305",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

const primeira = (tabela: string): Linha => {
  const linhas = banco.linhas(tabela);
  expect(linhas).toHaveLength(1);
  return linhas[0]!;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("a mensagem da venda herdada nasce ligada à proposta", () => {
  it.each(["reservado", "proposta"])("⚠️ etapa %s: proposta_id e empreendimento preenchidos", async (etapa) => {
    montarHerdada(etapa);

    const r = await mandarMensagem();

    expect(r.status).toBe(200);
    expect(primeira("hercules_conversas")).toMatchObject({
      empreendimento_codigo: "VOC",
      proposta_id: "venda-c2x",
      unidade_id: "voc-0305",
    });
  });

  it("a venda herdada CANCELADA não é vínculo nenhum", async () => {
    montarHerdada("cancelado");

    expect((await mandarMensagem()).status).toBe(200);
    expect(primeira("hercules_conversas").proposta_id).toBeNull();
  });
});

describe("o documento da venda herdada nasce ligado à proposta", () => {
  it.each(["reservado", "proposta"])("⚠️ etapa %s: proposta_id e a CAD do cliente vêm da venda", async (etapa) => {
    montarHerdada(etapa);

    const r = await mandarDocumento();

    expect(r.status).toBe(200);
    expect(primeira("hercules_documentos")).toMatchObject({
      cliente_entity_id: "cad-nivea",
      empreendimento_codigo: "VOC",
      proposta_id: "venda-c2x",
    });
  });
});
