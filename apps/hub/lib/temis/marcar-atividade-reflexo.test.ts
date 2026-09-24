import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

// MARCAR ATIVIDADE: O CARD ANDA E A VENDA VAI JUNTO — e o PEDIDO nunca chega a Concluído por aqui.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"* e
// *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse
// reflexo"*.
//
// ⚠️ DUAS COISAS TRAVADAS AQUI:
//   1. a última atividade do Pré-faturamento leva o card a Faturado e a venda de `assinatura` para
//      `faturado`, SEM tocar no cadastro da unidade nem em `data_faturamento` (decisão pendente do
//      Lucas: `data_faturamento` é previsão no legado, e `vendida` prenderia o lote num distrato);
//   2. o card de cancelamento ou de distrato NÃO chega a Concluído pela marcação: o Concluído dele
//      é o botão Concluir, que derruba a venda e solta o lote. Pela marcação, o quadro diria
//      "Concluído" com a venda viva e o lote preso.

const estado = vi.hoisted(() => ({ banco: null as null | { cliente: unknown } }));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
}));

vi.mock("./contrato-guardado-db", () => ({
  contratosDasPropostas: async () => new Map(),
}));

const { marcarAtividade } = await import("./trabalhos-db");
const { ATIVIDADES } = await import("./trabalhos");

let banco: Banco;

function montar(card: Linha, venda: Linha = {}): Banco {
  banco = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        data_assinatura: "2026-09-10",
        data_faturamento: null,
        etapa: "assinatura",
        id: "venda-1",
        unidade_id: "uni-1",
        workspace_id: "careli",
        ...venda,
      },
    ],
    hercules_unidades: [{ codigo: "VOL0101", enterprise_id: "40", id: "uni-1", situacao: "reservada", workspace_id: "careli" }],
    temis_trabalho_etapas: [],
    temis_trabalhos: [
      {
        atividades_feitas: [],
        canal: "hercules",
        cliente_nome: "VITORIA",
        criado_em: "2026-09-01T12:00:00.000Z",
        enterprise_codigo: "VOL",
        enterprise_id: "40",
        enterprise_nome: "Vale do Ouro Lagoa",
        estagio: "prazo_legal",
        estagio_desde: "2026-09-12T12:00:00.000Z",
        id: "card-1",
        proposta_id: "venda-1",
        tipo: "contrato",
        unidade: "Quadra 01 · Lote 01",
        workspace_id: "careli",
        ...card,
      },
    ],
  });
  estado.banco = banco;
  return banco;
}

/** As atividades de um estágio: todas menos a última, e a última (a que faz o card andar). */
function doEstagio(tipo: keyof typeof ATIVIDADES, estagio: string): { antes: string[]; ultima: string } {
  const textos = ATIVIDADES[tipo].filter((a) => a.estagio === estagio).map((a) => a.texto);
  return { antes: textos.slice(0, -1), ultima: textos[textos.length - 1] ?? "" };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("a marcação que leva o card de contrato adiante leva a venda junto", () => {
  it("última atividade do Pré-faturamento: card em Faturado e venda de assinatura para faturado, sem tocar no cadastro nem em data_faturamento", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1", quem: "u-nivea", quemNome: "Nivea" });

    expect(r).toMatchObject({ andou: true, estagio: "faturado", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")).toMatchObject({
      data_faturamento: null,
      etapa: "faturado",
      etapa_por: "Nivea",
    });
    expect(banco.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({ autor_nome: "Nivea", de: "assinatura", motivo: "Contrato faturado na Têmis", para: "faturado" }),
    ]);
    expect(banco.linha("hercules_unidades", "uni-1")?.situacao).toBe("reservada");
    expect(banco.consultas.some((c) => c.tabela === "hercules_unidades")).toBe(false);
  });

  it("contrato para assinatura pela marcação (sem envelope): a venda vai de contrato para assinatura", async () => {
    const { antes, ultima } = doEstagio("contrato", "contrato");
    montar({ atividades_feitas: antes, estagio: "contrato" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1", quemNome: "Nivea" });

    expect(r).toMatchObject({ estagio: "assinatura", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("assinatura");
  });

  it("venda ainda em contrato com card faturando: o card anda, a venda NÃO pula duas etapas", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ estagio: "faturado", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("contrato");
  });

  it("marcar sem fechar o estágio não lê a venda para refletir nem escreve nela", async () => {
    const { antes } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: [] });

    await marcarAtividade({ atividade: antes[0] ?? "", feita: true, id: "card-1" });

    expect(banco.consultas.some((c) => c.tabela === "hercules_propostas" && c.operacao === "update")).toBe(false);
    expect(banco.linhas("hercules_proposta_etapas")).toEqual([]);
  });
});

describe("o pedido de cancelamento ou de distrato não chega a Concluído pela marcação", () => {
  it.each([
    ["cancelamento", "contrato"],
    ["distrato", "assinatura"],
  ] as const)("card de %s no último estágio antes do fim: a última atividade é RECUSADA, com o recado de usar Concluir", async (tipo, estagio) => {
    const { antes, ultima } = doEstagio(tipo, estagio);
    montar({ atividades_feitas: antes, estagio, tipo }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Concluir");
    // Nada gravado: nem o estágio, nem a atividade, nem a venda.
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe(estagio);
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
  });

  it("marcar ou desmarcar atividade do pedido SEM avançar continua livre", async () => {
    const { antes } = doEstagio("distrato", "contrato");
    montar({ atividades_feitas: [], estagio: "contrato", tipo: "distrato" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: antes[0] ?? "", feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: false, ok: true });
  });

  it("o pedido anda de Análise para Contrato pela marcação, como sempre (não é o fim)", async () => {
    const { antes, ultima } = doEstagio("cancelamento", "analise");
    montar({ atividades_feitas: antes, estagio: "analise", tipo: "cancelamento" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: true, estagio: "contrato", ok: true });
    // E a venda não se mexe: o pedido nunca reflete (a marca do pedido é quem pinta em_cancelamento).
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("contrato");
  });
});
