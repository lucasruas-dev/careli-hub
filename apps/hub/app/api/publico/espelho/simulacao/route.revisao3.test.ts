import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// REVISÃO 3 (18/09/2026): FORJANDO O CORPO DA ROTA PÚBLICA DO PDF DA SIMULAÇÃO.
//
// A página não tem login e a folha sai com a marca da casa. A rodada 2 pôs um chão no valor: nunca
// abaixo da tabela com o MAIOR desconto de plano do empreendimento. Só que o chão era o do
// empreendimento, e não o do plano que o corpo escolheu: o simulador da tela (`ajusteDaTela`, modo
// simulação) prende o desconto ao do PLANO escolhido e só no PRAZO dele (`descontoDoPlanoNoPrazo`).
// Os três casos abaixo eram DEFEITO (corpos escritos à mão que a tela nunca produz e que a rota
// aceitava); CORRIGIDOS NA RODADA 3 (18/09/2026): o piso agora é o desconto do plano escolhido, no
// prazo do corpo (`valoresDaSimulacaoPublica`).
//
// Mocks copiados de `route.test.ts`.

const estado = vi.hoisted(() => ({
  folhas: [] as unknown[],
  lotes: [] as Array<{ codigo: string; preco: null | number; situacao: "disponivel" | "indisponivel" }>,
  piso: 8 as null | number,
}));

const BASE_DO_PLANO = {
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
} as const;

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => {
  // A unidade que o `select` de `hercules_unidades` devolve, e o storage sem logo.
  const cadeia = {
    eq: () => cadeia,
    in: () => cadeia,
    maybeSingle: async () => ({
      data: {
        area: 420,
        codigo: "GDN1110",
        lote: "10",
        preco_tabela: 435_000,
        quadra: "11",
        situacao: "disponivel",
      },
      error: null,
    }),
    select: () => cadeia,
  };
  const client = {
    from: () => cadeia,
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "sem logo" } }) }) },
  };
  return {
    abrirEspelho: async (token: null | string) =>
      token
        ? {
            espelho: {
              client,
              codigo: "garden",
              filhosC2xIds: [],
              masterplan: null,
              nome: "Garden",
              paiC2xId: "39",
            },
            ok: true,
          }
        : { erro: "sem_token", ok: false },
    ERRO_GENERICO: "Link inválido ou indisponível.",
  };
});

vi.mock("@/lib/hercules/espelho/estado-do-espelho", () => ({
  estadoDoEspelho: async () => ({
    atualizadoEm: "2026-09-18T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    { ...BASE_DO_PLANO, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60 },
    { ...BASE_DO_PLANO, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84 },
    { ...BASE_DO_PLANO, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36 },
  ],
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));

const { POST } = await import("./route");

function pedir(corpo: Record<string, unknown>, token: null | string = "tok") {
  return POST(
    new Request(`https://c2x.app.br/api/publico/espelho/simulacao${token ? `?e=${token}` : ""}`, {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

const ultimaFolha = () => estado.folhas.at(-1) as PropostaParaPdf & {
  condicoes: Array<{ rotulo: string; valor: string }>;
  destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
};
const destaque = (rotulo: string) => ultimaFolha().destaques.find((d) => d.rotulo === rotulo)?.valor;
const condicao = (rotulo: string) => ultimaFolha().condicoes.find((c) => c.rotulo === rotulo)?.valor;

/** O que a tela manda para o INVESTIDOR PARCELADO do lote de R$ 435.000. */
const DA_TELA = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  codigo: "GDN1110",
  entrada: 32_016,
  entradaVezes: 1,
  parcelas: 84,
  plano: "INVESTIDOR PARCELADO",
  valor: 400_200,
};

beforeEach(() => {
  estado.folhas.length = 0;
  estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "disponivel" }];
  estado.piso = 8;
});


describe("revisão 3: o que um corpo forjado consegue imprimir na folha pública", () => {
  it("NORMAL (plano sem desconto) não sai com 'Desconto 12%', o desconto do INVESTIDOR", async () => {
    // A tela, no NORMAL, simula sempre a R$ 435.000 (sem desconto à mão no modo simulação).
    const r = await pedir({ ...DA_TELA, anuaisQuantidade: 5, entrada: 43_500, parcelas: 60, plano: "NORMAL", valor: 1 });
    expect(r.status).toBe(200);
    expect(condicao("Desconto")).toBeUndefined();
    expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");
  });

  it("INVESTIDOR PARCELADO (8%) não sai com 12% de desconto", async () => {
    await pedir({ ...DA_TELA, valor: 1 });
    expect(destaque("Valor da unidade")).toBe("R$ 400.200,00");
    expect(condicao("Desconto")).toBe("8% · R$ 34.800,00");
  });

  // ⚠️ O PRAZO DESTE CASO MUDOU DE 180 PARA 30 NA RODADA 3, E NÃO SÓ O NOME. O item 3 da mesma
  // rodada passou a recusar (422) prazo além do plano, e 180 vezes num plano de 36 não chega mais a
  // imprimir folha (ver o caso logo abaixo). O que este caso mede continua o mesmo: fora do prazo do
  // plano os 12% não valem. 30 vezes cabe no INVESTIDOR (vai até 36) e não é o prazo dele.
  it("INVESTIDOR fora do prazo dele (30x) não mantém os 12% (a tela zera o desconto fora do prazo do plano)", async () => {
    const r = await pedir({ ...DA_TELA, anuaisQuantidade: 3, anuaisValor: 30_000, parcelas: 30, plano: "INVESTIDOR", valor: 382_800 });
    expect(r.status).toBe(200);
    expect(condicao("Parcelas mensais")).toBe("30");
    expect(condicao("Desconto")).toBeUndefined();
    expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");
  });

  it("INVESTIDOR levado a 180x (o corpo original do defeito): 422, e nenhuma folha com os 12%", async () => {
    const r = await pedir({ ...DA_TELA, anuaisQuantidade: 3, anuaisValor: 30_000, parcelas: 180, plano: "INVESTIDOR", valor: 382_800 });
    expect(r.status).toBe(422);
    expect(estado.folhas).toHaveLength(0);
  });

  it("entrada zero cai no piso do empreendimento (8% do valor), e lote fora do verde é 409", async () => {
    await pedir({ ...DA_TELA, entrada: 0 });
    expect(destaque("Entrada")).toBe("R$ 32.016,00");
    estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "indisponivel" }];
    expect((await pedir(DA_TELA)).status).toBe(409);
  });

  it("valor lixo, negativo ou ausente vira a tabela", async () => {
    for (const valor of ["abc", -5, null, undefined, ""]) {
      await pedir({ ...DA_TELA, plano: "NORMAL", parcelas: 60, anuaisQuantidade: 5, entrada: 43_500, valor });
      expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");
    }
  });

  // Era "medição (não é defeito desta rodada)": a rota aceitava o piso do empreendimento (8%,
  // R$ 30.624) no lugar dos 40% do plano, e a folha imprimia 10 anuais num contrato de 36 meses.
  // CORRIGIDO NA RODADA 3 (item 3).
  it("INVESTIDOR 36x com entrada zero e 10 anuais: a entrada sobe aos 40% do plano e as anuais param em 3", async () => {
    const r = await pedir({ ...DA_TELA, anuaisQuantidade: 10, anuaisValor: 10_000, entrada: 0, parcelas: 36, plano: "INVESTIDOR", valor: 382_800 });
    expect(r.status).toBe(200);
    expect(destaque("Entrada")).toBe("R$ 153.120,00");
    expect(condicao("Parcelas anuais")).toBe("3 de R$ 10.000,00");
  });
});
