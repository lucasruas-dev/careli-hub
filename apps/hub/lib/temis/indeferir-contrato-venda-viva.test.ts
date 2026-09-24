import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco } from "@/lib/hercules/banco-em-memoria.para-teste";

// INDEFERIR CARD DE CONTRATO EM ASSINATURA OU NO PRÉ-FATURAMENTO, COM A VENDA VIVA: 409 NO SERVIDOR.
//
// ⚠️ A TELA JÁ NÃO OFERECIA, E O SERVIDOR ACEITAVA. O comentário de indeferimento-na-venda-server.ts
// diz que a tela não oferece Indeferir nessas etapas; o servidor só barrava card `indeferido` e
// `faturado` (trabalho-servico.ts). Agora que a venda anda junto com o card (Lucas, 24/09/2026:
// *"preciso garantir que tudo que acontece na temis reflete no hercules"*), indeferir o contrato que
// está na mão do cliente deixaria a venda em `assinatura` com o card fora do caminho, e o
// indeferimento não a devolveria (`devolverAQuemVendeu` só age em `contrato`). O caminho é voltar
// para correção (que mata o envelope e devolve a venda para contrato) ou o pedido de cancelamento.
//
// ⚠️ COM A VENDA DESFEITA CONTINUA PERMITIDO: é o card de contrato assinado que fica pendurado em
// Pré-faturamento ou Em assinatura depois de um distrato, e indeferir é a única saída dele do quadro.
//
// ⚠️ E A GUARDA OLHA A ETAPA DA VENDA, NÃO SÓ O ESTÁGIO DO CARD (revisão de 24/09/2026). Se o reflexo
// da volta para correção falhar, o card fica na Análise com a venda em `assinatura`; a guarda do
// estágio deixava passar, `devolverAQuemVendeu` não mexe (só age em `contrato`) e a venda ficava viva
// em assinatura, prendendo o lote, sem card nenhum.
//
// ⚠️ O CAMINHO DA VENDA É O DE VERDADE. A versão anterior deste arquivo trocava
// `devolverVendaNoIndeferimento` por um dublê que nunca escrevia, e a asserção "a venda não recebeu
// update" era verdadeira por construção. Agora quem roda é `devolverAQuemVendeu` contra o banco em
// memória: se ele mexer na venda, o teste vê.

const estado = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
}));

const { decidirSobreOTrabalho } = await import("./trabalho-servico");

let banco: Banco;

function montar(estagio: string, etapa: string): void {
  banco = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        cancelamento_pedido_em: null,
        codigo: "000042",
        etapa,
        etapa_desde: "2026-09-22T12:00:00.000Z",
        id: "venda-1",
        protocolo_numero: 42,
        workspace_id: "careli",
      },
    ],
    temis_envelopes: [],
    temis_trabalho_etapas: [],
    temis_trabalhos: [
      {
        criado_em: "2026-09-22T12:00:00.000Z",
        estagio,
        estagio_desde: "2026-09-23T12:00:00.000Z",
        id: "card-1",
        proposta_id: "venda-1",
        tipo: "contrato",
        workspace_id: "careli",
      },
    ],
  });
  estado.banco = banco;
}

const escreveuNaVenda = () =>
  banco.consultas.some((c) => c.tabela === "hercules_propostas" && c.operacao !== "select");

const HUB = { nome: "Nivea", papel: "coordenacao", tipo: "hub", userId: "u-nivea" } as const;

const indeferir = () =>
  decidirSobreOTrabalho(
    HUB as Parameters<typeof decidirSobreOTrabalho>[0],
    new Request("https://c2x.app.br/api/temis/trabalho", {
      body: JSON.stringify({ acao: "indeferir", id: "card-1", motivo: "documento_faltando", observacao: "Falta o RG do titular" }),
      method: "POST",
    }),
  );

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("indeferir contrato em assinatura ou no Pré-faturamento", () => {
  it.each([
    ["assinatura", "assinatura"],
    ["prazo_legal", "assinatura"],
    ["assinatura", "contrato"],
  ])("card em %s com a venda viva (%s): 409, nada gravado", async (estagio, etapa) => {
    montar(estagio, etapa);

    const r = await indeferir();

    expect(r.status).toBe(409);
    const corpo = (await r.json()) as { error: string };
    expect(corpo.error).toContain("Voltar para correção");
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe(estagio);
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe(etapa);
  });

  it.each(["distrato", "cancelado"])(
    "card de contrato em Pré-faturamento com a venda em %s: continua permitido, e a venda não é tocada",
    async (etapa) => {
      montar("prazo_legal", etapa);

      const r = await indeferir();

      expect(r.status).toBe(200);
      expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("indeferido");
      expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe(etapa);
      expect(escreveuNaVenda()).toBe(false);
    },
  );

  it("card de contrato em Análise com a venda em contrato: o Indeferir de sempre, a venda volta a quem vendeu", async () => {
    montar("analise", "contrato");
    const r = await indeferir();
    expect(r.status).toBe(200);
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("indeferido");
    // O caminho real escreveu: é a prova de que a asserção "não escreveu" acima pode falhar.
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("proposta");
    expect(escreveuNaVenda()).toBe(true);
  });
});

describe("indeferir com o card ATRÁS da venda (o reflexo da volta para correção falhou)", () => {
  it.each([
    ["analise", "assinatura"],
    ["contrato", "assinatura"],
    ["analise", "faturado"],
    ["contrato", "faturado"],
  ])("card em %s com a venda em %s: 409 com a frase, nada gravado", async (estagio, etapa) => {
    montar(estagio, etapa);

    const r = await indeferir();

    expect(r.status).toBe(409);
    const corpo = (await r.json()) as { error: string };
    expect(corpo.error).toContain("A venda deste contrato");
    expect(corpo.error).not.toMatch(/[—–]/);
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe(estagio);
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe(etapa);
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
  });

  it("a leitura da venda falha: 503, nada indeferido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    montar("analise", "assinatura");
    banco.falhar((c) => c.tabela === "hercules_propostas" && c.operacao === "select");

    const r = await indeferir();

    expect(r.status).toBe(503);
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("analise");
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
  });
});
