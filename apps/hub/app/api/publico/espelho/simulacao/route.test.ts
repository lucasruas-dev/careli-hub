import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// A ROTA DO PDF DA SIMULAÇÃO DO ESPELHO PÚBLICO, exercitada (18/09/2026).
//
// A página não tem login e o PDF sai com a marca da casa. Até aqui a rota aceitava o `valor` e a
// `entrada` do corpo sem piso nenhum, e para qualquer lote: dava para baixar uma folha "Desconto 50%"
// ou simular um lote vendido. Agora ela recusa o lote que o espelho não pinta de verde (a mesma régua,
// `estadoDoEspelho`), prende o valor entre o menor preço de plano do lote e a tabela, e a entrada no
// piso do empreendimento.
//
// ⚠️ O QUE É DUBLÊ: o token (`abrirEspelho`), o estado do espelho, os planos e o piso (leituras do
// banco) e o desenhista do PDF, que só guarda a folha que recebeu. `montarCronograma` e
// `montarFolhaDaProposta` são os de verdade: é a folha que se confere.

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

describe("POST /api/publico/espelho/simulacao", () => {
  it("o pedido da tela sai como a tela mostrou: preço do plano, desconto, entrada e parcela", async () => {
    const r = await pedir(DA_TELA);
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 400.200,00");
    expect(condicao("Valor de tabela")).toBe("R$ 435.000,00");
    expect(condicao("Desconto")).toBe("8% · R$ 34.800,00");
    expect(destaque("Entrada")).toBe("R$ 32.016,00");
    expect(destaque("Parcela mensal")).toBe("R$ 3.192,67");
  });

  it("⚠️ recusa lote que o espelho não dá como disponível (vendido, reservado, com proposta)", async () => {
    estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "indisponivel" }];
    const r = await pedir(DA_TELA);
    expect(r.status).toBe(409);
    expect(estado.folhas).toHaveLength(0);
  });

  it("recusa lote que o espelho não conhece, ou sem preço de tabela", async () => {
    estado.lotes = [];
    expect((await pedir(DA_TELA)).status).toBe(409);
    estado.lotes = [{ codigo: "GDN1110", preco: null, situacao: "disponivel" }];
    expect((await pedir(DA_TELA)).status).toBe(409);
    expect(estado.folhas).toHaveLength(0);
  });

  it("⚠️ o valor nunca fica abaixo do menor preço de plano do lote (tabela − 12% do INVESTIDOR)", async () => {
    // O corpo escrito à mão pedindo "Desconto 50%".
    const r = await pedir({ ...DA_TELA, entrada: 150_000, valor: 217_500 });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 382.800,00");
    expect(condicao("Desconto")).toBe("12% · R$ 52.200,00");
  });

  it("e nunca acima da tabela (no espelho não existe acréscimo)", async () => {
    await pedir({ ...DA_TELA, plano: "NORMAL", parcelas: 60, anuaisQuantidade: 5, valor: 999_999 });
    expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");
    expect(condicao("Valor de tabela")).toBeUndefined();
  });

  it("⚠️ a entrada respeita o piso do empreendimento", async () => {
    await pedir({ ...DA_TELA, entrada: 1_000 });
    // 8% de R$ 400.200 = R$ 32.016,00.
    expect(destaque("Entrada")).toBe("R$ 32.016,00");
    // Sem piso cadastrado (ou falha na leitura), vale o padrão da casa: 10%.
    estado.piso = null;
    await pedir({ ...DA_TELA, entrada: 0 });
    expect(destaque("Entrada")).toBe("R$ 40.020,00");
  });

  it("sem token é 401, sem lote é 400", async () => {
    expect((await pedir(DA_TELA, null)).status).toBe(401);
    expect((await pedir({ ...DA_TELA, codigo: "" })).status).toBe(400);
  });
});
