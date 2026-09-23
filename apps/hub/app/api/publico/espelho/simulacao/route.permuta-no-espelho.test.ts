import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// A FOLHA DO ESPELHO IMPRIME OS BENS QUE ESTÃO NA TELA (23/09/2026).
//
// Lucas, sobre eu ter deixado a permuta de fora da rodada do desconto: *"permuta tem que entrar,
// não entendi sua colocação"*.
//
// ⚠️ OS NÚMEROS DESTE ARQUIVO SÃO OS DA TELA: mesmo lote (R$ 435.000), mesmo plano (INVESTIDOR
// PARCELADO, 84x, 8%), os mesmos 10% digitados à mão (R$ 391.500) e o mesmo carro de R$ 80.000 de
// `SimuladorDeProposta.permuta-no-espelho.comportamento.test.tsx`. Lá a tela produz os números;
// aqui a folha os imprime. É assim que a tela e o papel ficam amarrados um ao outro — e o defeito
// que isto impede é o do Lucas de 22/09 (*"mesmo eu alterando o valor de entrada (...) ele não traz
// o valor que eu tinha colocado"*), agora com o bem: a tela abate R$ 80.000 e o PDF não.
//
// Mocks copiados de `route.desconto-no-espelho.test.ts`.

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
    atualizadoEm: "2026-09-23T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    { ...BASE_DO_PLANO, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60 },
    { ...BASE_DO_PLANO, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84 },
  ],
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));

const { POST } = await import("./route");

function pedir(corpo: Record<string, unknown>) {
  return POST(
    new Request("https://c2x.app.br/api/publico/espelho/simulacao?e=tok", {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

const ultimaFolha = () => estado.folhas.at(-1) as PropostaParaPdf & {
  bensEPermutas: Array<{ comoEntra: string; descricao: string; tipo: string; valor: string }>;
  bensEPermutasTotal: string;
  destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
};
const destaque = (rotulo: string) => ultimaFolha().destaques.find((d) => d.rotulo === rotulo)?.valor;
const erro = async (r: Response) => ((await r.json()) as { error: string }).error;

/** O carro do exemplo do Lucas, do jeito que a tela do espelho o manda. */
const CARRO = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada",
  tipo: "bem",
  valor: 80_000,
};

/** O que a tela do espelho manda: INVESTIDOR PARCELADO, 10% à mão, R$ 0 de entrada em dinheiro. */
const DA_TELA = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  codigo: "GDN1110",
  entrada: 0,
  entradaVezes: 1,
  parcelas: 84,
  plano: "INVESTIDOR PARCELADO",
  valor: 391_500,
};

beforeEach(() => {
  estado.folhas.length = 0;
  estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "disponivel" }];
  estado.piso = 8;
});

describe("o PDF do espelho traz os bens, iguais aos da tela", () => {
  it("⚠️ sem o carro o financiado é R$ 391.500; com ele, R$ 311.500 — os R$ 80.000 abatem", async () => {
    await pedir({ ...DA_TELA });
    expect(destaque("Financiado")).toBe("R$ 391.500,00");

    const r = await pedir({ ...DA_TELA, bensEPermutas: [CARRO] });
    expect(r.status).toBe(200);
    expect(destaque("Financiado")).toBe("R$ 311.500,00");
  });

  it("o carro sai impresso na folha, com tipo, descrição, valor e onde entra", async () => {
    await pedir({ ...DA_TELA, bensEPermutas: [CARRO] });
    expect(ultimaFolha().bensEPermutas).toEqual([
      {
        comoEntra: "Entrada",
        descricao: "Ford Ka 2019 placa ABC1D23",
        tipo: "Bem",
        valor: "R$ 80.000,00",
      },
    ]);
    expect(ultimaFolha().bensEPermutasTotal).toBe("R$ 80.000,00");
  });

  it("⚠️ o desconto à mão e o bem andam JUNTOS no mesmo papel", async () => {
    // As duas peças desta rodada na mesma folha: o preço ajustado de R$ 391.500 (10% sobre a
    // tabela) E o carro de R$ 80.000 abatendo o saldo.
    await pedir({ ...DA_TELA, bensEPermutas: [CARRO] });
    expect(destaque("Valor da unidade")).toBe("R$ 391.500,00");
    expect(ultimaFolha().bensEPermutasTotal).toBe("R$ 80.000,00");
    expect(destaque("Financiado")).toBe("R$ 311.500,00");
  });

  it("uma permuta de abatimento entra na folha com a palavra dela", async () => {
    await pedir({
      ...DA_TELA,
      bensEPermutas: [
        { ...CARRO, descricao: "Lote 12 da quadra 4", entraComo: "abatimento", tipo: "permuta", valor: 20_000 },
      ],
    });
    expect(ultimaFolha().bensEPermutas[0]).toMatchObject({
      comoEntra: "Abatimento",
      tipo: "Permuta",
    });
  });

  it("sem bem nenhum a seção não existe no papel, como sempre foi", async () => {
    await pedir({ ...DA_TELA });
    expect(ultimaFolha().bensEPermutas).toEqual([]);
    expect(ultimaFolha().bensEPermutasTotal).toBe("");
  });
});

describe("⚠️ o corpo escrito à mão não passa por cima da régua dos bens", () => {
  it("bem com valor VAZIO é 422 com a frase, e nenhuma folha sai", async () => {
    // `Number("")` é zero, e nesta casa isso já virou cobrança de R$ 0,00 emitida.
    const r = await pedir({ ...DA_TELA, bensEPermutas: [{ ...CARRO, valor: "" }] });
    expect(r.status).toBe(422);
    expect(await erro(r)).toMatch(/valor do bem ou permuta na posição 1/i);
    expect(estado.folhas).toHaveLength(0);
  });

  it("bem sem descrição, com tipo inventado ou com `entraComo` inventado: 422, sem folha", async () => {
    for (const torto of [
      { ...CARRO, descricao: "   " },
      { ...CARRO, tipo: "veiculo" },
      { ...CARRO, entraComo: "desconto" },
    ]) {
      const r = await pedir({ ...DA_TELA, bensEPermutas: [torto] });
      expect([torto, r.status]).toEqual([torto, 422]);
    }
    expect(estado.folhas).toHaveLength(0);
  });

  it("onze itens é 422, e dez passam", async () => {
    const lista = (n: number) => Array.from({ length: n }, () => ({ ...CARRO, valor: 1_000 }));
    expect((await pedir({ ...DA_TELA, bensEPermutas: lista(11) })).status).toBe(422);
    expect(estado.folhas).toHaveLength(0);
    expect((await pedir({ ...DA_TELA, bensEPermutas: lista(10) })).status).toBe(200);
  });

  it("⚠️ um bem que vale mais que o lote não imprime folha: é a recusa do motor, com a frase", async () => {
    const r = await pedir({ ...DA_TELA, bensEPermutas: [{ ...CARRO, valor: 900_000 }] });
    expect(r.status).toBe(422);
    expect(await erro(r)).toMatch(/não fecha/i);
    expect(estado.folhas).toHaveLength(0);
  });
});

describe("a folha COM bem continua dizendo que não vincula", () => {
  it("⚠️ a frase da simulação sai no papel mesmo com desconto e permuta livres", async () => {
    // É a única coisa entre um número inventado numa página sem login e um papel que parece oferta.
    const frase =
      "Esta é uma simulação de pagamento: não constitui proposta, não reserva a unidade e não vincula as partes.";

    await pedir({ ...DA_TELA, bensEPermutas: [CARRO] });
    expect(ultimaFolha().observacoes.map((o) => o.texto).join(" ")).toContain(frase);
    expect(ultimaFolha().observacoes.map((o) => o.titulo)).toContain("Sobre esta simulação.");
    expect(ultimaFolha().simulacao).toBe(true);
  });
});
