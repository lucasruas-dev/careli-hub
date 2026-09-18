import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { IDADE_MINIMA_DO_RESTO_MS, marcaEhResto, soltarMarcasQueSobraram } from "./marca-de-pedido";

const agora = new Date("2026-09-18T20:00:00.000Z");
const haUmDia = "2026-09-17T12:00:00.000Z";

describe("marcaEhResto", () => {
  it("VOL1106: marca de ontem, card indeferido, nenhum card aberto: é resto e o botão volta", () => {
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: haUmDia })).toBe(true);
  });

  it("com card de pedido aberto na Têmis, a marca é o pedido", () => {
    expect(marcaEhResto({ agora, cardsAbertos: 1, marca: haUmDia })).toBe(false);
  });

  it("⚠️ leitura dos cards que falhou: a marca segura o botão, nunca libera", () => {
    expect(marcaEhResto({ agora, cardsAbertos: null, marca: haUmDia })).toBe(false);
  });

  it("⚠️ marca que acabou de nascer, ainda sem card: é o pedido a caminho, não resto", () => {
    const agoraMesmo = new Date(agora.getTime() - 2_000).toISOString();
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: agoraMesmo })).toBe(false);
  });

  it("a idade mínima é o limite exato", () => {
    const noLimite = new Date(agora.getTime() - IDADE_MINIMA_DO_RESTO_MS).toISOString();
    const umPoucoAntes = new Date(agora.getTime() - IDADE_MINIMA_DO_RESTO_MS + 1).toISOString();
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: noLimite })).toBe(true);
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: umPoucoAntes })).toBe(false);
  });

  it("sem marca não há resto; marca ilegível segura o botão", () => {
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: null })).toBe(false);
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: "" })).toBe(false);
    expect(marcaEhResto({ agora, cardsAbertos: 0, marca: "ontem" })).toBe(false);
  });
});

/** Um PostgREST de mentira: devolve os cards abertos pedidos e guarda cada consulta. */
function banco(abertos: string[], falha: null | string = null) {
  const consultas: Array<{ filtros: string[]; tabela: string }> = [];
  const cliente = {
    from(tabela: string) {
      const consulta = { filtros: [] as string[], tabela };
      consultas.push(consulta);
      let ids: string[] = [];
      const q = {
        eq: (c: string, v: string) => (consulta.filtros.push(`eq:${c}=${v}`), q),
        in: (c: string, v: string[]) => {
          consulta.filtros.push(`in:${c}=${v.join(",")}`);
          if (c === "proposta_id") ids = v;
          return q;
        },
        not: (c: string, op: string, v: string) => (consulta.filtros.push(`not:${c} ${op} ${v}`), q),
        select: () => q,
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve(
            falha
              ? { data: null, error: { message: falha } }
              : { data: ids.filter((id) => abertos.includes(id)).map((id) => ({ proposta_id: id })), error: null },
          ).then(ok),
      };
      return q;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

describe("soltarMarcasQueSobraram", () => {
  it("solta a marca sem card aberto, mantém a do pedido que anda e a que acabou de nascer", async () => {
    const recente = new Date(agora.getTime() - 60_000).toISOString();
    const propostas = [
      { cancelamento_pedido_em: haUmDia, etapa: "contrato", id: "vol1106" },
      { cancelamento_pedido_em: haUmDia, etapa: "assinatura", id: "rvpb02" },
      { cancelamento_pedido_em: recente, etapa: "contrato", id: "pedido-agora" },
      { cancelamento_pedido_em: null, etapa: "contrato", id: "sem-marca" },
    ];
    const b = banco(["rvpb02"]);

    await soltarMarcasQueSobraram(b.cliente, propostas, agora);

    expect(propostas.map((p) => p.cancelamento_pedido_em)).toEqual([null, haUmDia, recente, null]);
    // A pergunta é a mesma régua de "aberto" da Têmis: pedido (cancelamento ou distrato) fora de
    // faturado e indeferido, só das vendas marcadas.
    expect(b.consultas).toHaveLength(1);
    expect(b.consultas[0]).toEqual({
      filtros: [
        "eq:workspace_id=careli",
        "in:proposta_id=vol1106,rvpb02,pedido-agora",
        "in:tipo=cancelamento,distrato",
        "not:estagio in (faturado,indeferido)",
      ],
      tabela: "temis_trabalhos",
    });
  });

  it("⚠️ leitura que falha deixa todas as marcas: o botão fica apagado, como antes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const propostas = [{ cancelamento_pedido_em: haUmDia, etapa: "contrato", id: "vol1106" }];
    await soltarMarcasQueSobraram(banco([], "timeout").cliente, propostas, agora);
    expect(propostas[0]?.cancelamento_pedido_em).toBe(haUmDia);
  });

  it("⚠️ a venda que já caiu guarda a marca como história, e ela nem é perguntada", async () => {
    const propostas = [
      { cancelamento_pedido_em: haUmDia, etapa: "cancelado", id: "cancelada" },
      { cancelamento_pedido_em: haUmDia, etapa: "distrato", id: "distratada" },
      { cancelamento_pedido_em: haUmDia, etapa: "proposta", id: "em-proposta" },
    ];
    const b = banco([]);
    await soltarMarcasQueSobraram(b.cliente, propostas, agora);
    expect(propostas.map((p) => p.cancelamento_pedido_em)).toEqual([haUmDia, haUmDia, haUmDia]);
    expect(b.consultas).toHaveLength(0);
  });

  it("sem venda marcada, não pergunta nada à Têmis", async () => {
    const b = banco([]);
    await soltarMarcasQueSobraram(b.cliente, [{ cancelamento_pedido_em: null, etapa: "contrato", id: "x" }], agora);
    expect(b.consultas).toHaveLength(0);
  });

  it("pergunta em lotes de 100 ids", async () => {
    const propostas = Array.from({ length: 250 }, (_, i) => ({ cancelamento_pedido_em: haUmDia, etapa: "contrato", id: `v${i}` }));
    const b = banco(["v5", "v150", "v249"]);
    await soltarMarcasQueSobraram(b.cliente, propostas, agora);
    expect(b.consultas).toHaveLength(3);
    const presas = propostas.filter((p) => p.cancelamento_pedido_em).map((p) => p.id);
    expect(presas).toEqual(["v5", "v150", "v249"]);
  });
});
