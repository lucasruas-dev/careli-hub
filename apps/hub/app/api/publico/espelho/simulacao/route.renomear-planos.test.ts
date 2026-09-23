import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// O QUE A TROCA DE NOME DOS PLANOS DO GARDEN FAZ COM A ROTA PÚBLICA (22/09/2026).
//
// Lucas pediu a troca: NORMAL vira INVESTIDOR, INVESTIDOR PARCELADO vira PROMOÇÃO PARCELADO,
// INVESTIDOR vira PROMOÇÃO À VISTA. O nome mora em `temis_planos.nome` (enterprise_id 39), não no
// código: a correção é um UPDATE, e este arquivo NÃO a aplica. Ele mede o que a rota faz DEPOIS
// dela, com a lista de planos já renomeada.
//
// ⚠️ O NOME NOVO DE UM É O NOME VELHO DO OUTRO, e a rota pública resolve o plano PELO NOME que o
// corpo manda (`route.ts`: `planos.find((p) => p.nome === corpo.plano)`). Enquanto houver tablet
// com a página do espelho aberta de antes da troca, o corpo chega com "INVESTIDOR" querendo dizer
// o plano de 36 vezes e 12% de desconto, e passa a CASAR, em silêncio, com o plano de 60 vezes e
// 0% que acabou de herdar esse nome. Não é o `?? planos[0]` de nome forjado: o find ACERTA, na
// linha errada. É por isso que a troca precisa de janela, e é isso que os números abaixo medem.
//
// ⚠️ O QUE É DUBLÊ: token, estado do espelho, planos e piso (leituras do banco) e o desenhista do
// PDF. `montarCronograma` e `montarFolhaDaProposta` são os de verdade: é a folha que se confere.

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
    atualizadoEm: "2026-09-22T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

// A LISTA JÁ RENOMEADA: o que `planosPublicos` devolverá depois do UPDATE. Mesma ordem do banco
// (1, 2, 3), mesmos números; só os nomes mudaram.
vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    { ...BASE_DO_PLANO, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "INVESTIDOR", parcelas: 60 },
    { ...BASE_DO_PLANO, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "PROMOÇÃO PARCELADO", parcelas: 84 },
    { ...BASE_DO_PLANO, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, jurosTaxa: 0, nome: "PROMOÇÃO À VISTA", parcelas: 36 },
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

beforeEach(() => {
  estado.folhas.length = 0;
  estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "disponivel" }];
  estado.piso = 8;
});

describe("os três nomes novos do Garden respondem na rota pública", () => {
  it("PROMOÇÃO PARCELADO é o plano de 84 vezes, com os 8% de desconto", async () => {
    const r = await pedir({
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      codigo: "GDN1110",
      entrada: 32_016,
      entradaVezes: 1,
      parcelas: 84,
      plano: "PROMOÇÃO PARCELADO",
      valor: 400_200,
    });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 400.200,00");
    expect(condicao("Desconto")).toBe("8% · R$ 34.800,00");
  });

  it("PROMOÇÃO À VISTA é o plano de 36 vezes, com os 12% de desconto", async () => {
    const r = await pedir({
      anuaisQuantidade: 3,
      anuaisValor: 30_000,
      codigo: "GDN1110",
      entrada: 153_120,
      entradaVezes: 1,
      parcelas: 36,
      plano: "PROMOÇÃO À VISTA",
      valor: 382_800,
    });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 382.800,00");
    expect(condicao("Desconto")).toBe("12% · R$ 52.200,00");
  });

  it("INVESTIDOR agora é o plano de 60 vezes, sem desconto (era o NORMAL)", async () => {
    const r = await pedir({
      anuaisQuantidade: 5,
      anuaisValor: 25_000,
      codigo: "GDN1110",
      entrada: 43_500,
      entradaVezes: 1,
      parcelas: 60,
      plano: "INVESTIDOR",
      valor: 435_000,
    });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");
    expect(condicao("Desconto")).toBeUndefined();
  });
});

describe("medição: a janela da troca, com a tela velha ainda aberta", () => {
  // ⚠️ ESTE É O CUSTO DA TROCA, EM DINHEIRO. O tablet de antes do UPDATE manda o nome velho do
  // plano de 36 vezes ("INVESTIDOR", 12% de desconto). Depois da troca esse nome é do plano de 60
  // vezes, 0%. O find casa, a rota responde 200 e a folha sai pelo preço CHEIO: nenhum erro, em
  // lugar nenhum. Travar isso no código não resolve, porque o nome que chegou É um nome válido.
  it("o nome velho do plano de 12% passa a imprimir o de 0%, sem erro", async () => {
    const r = await pedir({
      anuaisQuantidade: 3,
      anuaisValor: 30_000,
      codigo: "GDN1110",
      entrada: 153_120,
      entradaVezes: 1,
      parcelas: 36,
      plano: "INVESTIDOR",
      valor: 382_800,
    });

    // A tela velha pediu o plano de 12%; a folha sai sem desconto nenhum.
    expect(r.status).toBe(200);
    expect(condicao("Desconto")).toBeUndefined();
    expect(destaque("Valor da unidade")).toBe("R$ 435.000,00");

    // R$ 435.000 em vez de R$ 382.800: R$ 52.200 a mais na folha que o cliente recebe.
    expect(435_000 - 382_800).toBe(52_200);
  });

  it("o nome velho do parcelado deixa de existir e cai no primeiro plano", async () => {
    // "INVESTIDOR PARCELADO" não é mais nome de ninguém, então o find falha e o `?? planos[0]`
    // entrega o plano de 60 vezes: as 84 vezes viram prazo além do plano, e a rota recusa.
    const r = await pedir({
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      codigo: "GDN1110",
      entrada: 32_016,
      entradaVezes: 1,
      parcelas: 84,
      plano: "INVESTIDOR PARCELADO",
      valor: 400_200,
    });
    expect(r.status).toBe(422);
  });
});
