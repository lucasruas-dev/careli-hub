import { beforeEach, describe, expect, it, vi } from "vitest";

// Os efeitos colaterais pós-upsert (fila do Prometeu, subida pro C2X) são best-effort e batem em
// outras tabelas; mockamos para o teste ficar na LÓGICA de destino/guard, não na infra.
vi.mock("./credenciado-para-fila", () => ({
  garantirNaFilaDoLancamento: vi.fn(async () => ({ entrou: false, motivo: "mock", naFila: false })),
}));
vi.mock("./credenciado-para-c2x", () => ({
  subirParaC2xAoCredenciar: vi.fn(async () => ({ detalhe: "mock", enviado: false })),
}));

import { atualizarEtapa } from "./esteira";

// Fake chainable/thenable no espírito de `cad-por-empreendimento.test.ts`. Só duas tabelas têm dado:
//   • apolo_esteira            -> a CAD atual (etapa + enterprise_id) e o upsert (gravado).
//   • apolo_enterprise_settings -> o toggle `prevenda_habilitada` do empreendimento.
function fakeClient(opts: {
  enterpriseId: string;
  etapaAtual: string;
  prevendaHabilitada: boolean;
  /** Empreendimento sem nenhuma linha em `apolo_enterprise_settings`. */
  semSettings?: boolean;
  /** Sem valor explícito, acompanha a flag: ligada = R$ 1.000, desligada = nulo. */
  valorPix?: null | number;
}) {
  const upserts: Array<{ tabela: string; valores: Record<string, unknown> }> = [];

  const client = {
    from(tabela: string) {
      let operacao: "insert" | "select" | "update" | "upsert" = "select";

      const dados = (): Record<string, unknown> | null => {
        if (operacao !== "select") return null;
        if (tabela === "apolo_esteira") {
          return { enterprise_id: opts.enterpriseId, etapa: opts.etapaAtual };
        }
        if (tabela === "apolo_enterprise_settings") {
          if (opts.semSettings) return null;
          // ⚠️ O `valor_pix` faz parte da resposta DE PROPÓSITO: desde 10/08 a pré-venda só conta
          // como ligada com a flag E o valor definido ("pré-venda só existe se estiver
          // habilitado"). Um empreendimento com a flag em true e o valor nulo é o default da
          // coluna que ninguém tocou, não configuração — e é o que fazia a cobrança nascer ligada.
          return {
            prevenda_habilitada: opts.prevendaHabilitada,
            // `in` e não `??`: `valorPix: null` é um caso do teste (flag ligada, valor em branco),
            // e o `??` o confundiria com "não informado".
            valor_pix:
              "valorPix" in opts ? opts.valorPix : opts.prevendaHabilitada ? 1000 : null,
          };
        }
        return null;
      };

      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: dados(), error: null }),
        single: async () => ({ data: dados(), error: null }),
        // upsert/insert são "thenados" direto (await client.from().upsert()).
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null })),
      };
      for (const m of ["eq", "in", "is", "limit", "neq", "not", "order", "range", "select"]) {
        builder[m] = () => builder;
      }
      builder.insert = () => {
        operacao = "insert";
        return builder;
      };
      builder.update = () => {
        operacao = "update";
        return builder;
      };
      builder.upsert = (valores: Record<string, unknown>) => {
        operacao = "upsert";
        upserts.push({ tabela, valores });
        return builder;
      };
      return builder;
    },
  };

  return { client: client as never, upserts };
}

describe("atualizarEtapa — guard de crédito reprovado (PROBLEMA 2) e toggle da pré-venda (PROBLEMA 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("BARRA o clique manual que tira reprovado de revisao para prevenda", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: true,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", { enterpriseId: "35" });

    expect(r.bloqueado).toBe(true);
    expect(r.etapa).toBe("revisao");
    // E NÃO gravou nada: a ficha continua travada.
    expect(upserts.length).toBe(0);
  });

  it("também barra revisao -> credenciado sem autorização", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: false,
    });

    const r = await atualizarEtapa(client, "ent-1", "credenciado", { enterpriseId: "35" });

    expect(r.bloqueado).toBe(true);
    expect(upserts.length).toBe(0);
  });

  it("deixa passar o avanço AUTOMÁTICO (cônjuge aprovado resgata)", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: true,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      automatico: true,
      enterpriseId: "35",
      nuncaRebaixar: true,
    });

    expect(r.bloqueado).toBeFalsy();
    expect(r.etapa).toBe("prevenda");
    expect(upserts[0]?.valores.etapa).toBe("prevenda");
  });

  it("OVERRIDE destrava e respeita o toggle: pré-venda LIGADA -> prevenda", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: true,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      enterpriseId: "35",
      saidaDeRevisaoAutorizada: true,
    });

    expect(r.bloqueado).toBeFalsy();
    expect(r.etapa).toBe("prevenda");
    expect(upserts[0]?.valores.etapa).toBe("prevenda");
  });

  it("OVERRIDE destrava e respeita o toggle: pré-venda DESLIGADA -> credenciado", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: false,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      enterpriseId: "35",
      saidaDeRevisaoAutorizada: true,
    });

    expect(r.bloqueado).toBeFalsy();
    // PROBLEMA 1: pré-venda off -> pula a cobrança, vai direto pra credenciado.
    expect(r.etapa).toBe("credenciado");
    expect(upserts[0]?.valores.etapa).toBe("credenciado");
  });

  it("movimento LATERAL (revisao -> credito, reabrir) continua livre", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "revisao",
      prevendaHabilitada: true,
    });

    const r = await atualizarEtapa(client, "ent-1", "credito", { enterpriseId: "35" });

    expect(r.bloqueado).toBeFalsy();
    expect(r.etapa).toBe("credito");
    expect(upserts[0]?.valores.etapa).toBe("credito");
  });

  it("fora de revisao, o toggle off também pula prevenda -> credenciado (avanço normal do crédito)", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "35",
      etapaAtual: "credito",
      prevendaHabilitada: false,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      automatico: true,
      enterpriseId: "35",
      nuncaRebaixar: true,
    });

    expect(r.etapa).toBe("credenciado");
    expect(upserts[0]?.valores.etapa).toBe("credenciado");
  });

  // ⬇️ REGRA DO LUCAS, 10/08: "pré-venda só existe se estiver habilitado". Os três casos abaixo são
  // os que faziam a cobrança NASCER LIGADA — e é por eles que VOL, VOC e Garden amanheceram com o
  // PIX de R$ 1.000 ativo sem ninguém ter ligado.

  it("flag LIGADA mas SEM valor de PIX não é pré-venda: vai para credenciado", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "39",
      etapaAtual: "credito",
      prevendaHabilitada: true,
      valorPix: null,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      automatico: true,
      enterpriseId: "39",
      nuncaRebaixar: true,
    });

    expect(r.etapa).toBe("credenciado");
    expect(upserts[0]?.valores.etapa).toBe("credenciado");
  });

  it("valor de PIX ZERO também não é pré-venda", async () => {
    const { client } = fakeClient({
      enterpriseId: "39",
      etapaAtual: "credito",
      prevendaHabilitada: true,
      valorPix: 0,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      automatico: true,
      enterpriseId: "39",
      nuncaRebaixar: true,
    });

    expect(r.etapa).toBe("credenciado");
  });

  it("empreendimento SEM linha de settings nasce com a pré-venda desligada (fail-closed)", async () => {
    const { client, upserts } = fakeClient({
      enterpriseId: "41",
      etapaAtual: "credito",
      prevendaHabilitada: true,
      semSettings: true,
    });

    const r = await atualizarEtapa(client, "ent-1", "prevenda", {
      automatico: true,
      enterpriseId: "41",
      nuncaRebaixar: true,
    });

    expect(r.etapa).toBe("credenciado");
    expect(upserts[0]?.valores.etapa).toBe("credenciado");
  });
});
