import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// A ENTRADA QUE ESTÁ NA TELA É A QUE SAI NO PAPEL (22/09/2026).
//
// Lucas, com o print na mão: *"Mesmo eu alterando o valor de entrada, quando eu mando para PDF ele
// não traz o valor que eu tinha colocado, na cecilio pode deixar tudo liberado, sem trava, somente
// com alertas, se ele quiser pagar uma entrada menor o valor da parcela tem que subir, somente
// garante essa visão."*
//
// O QUE FOI MEDIDO NO PRINT, Quadra 03 · Lote 07 do Cecílio Rocha:
//
//   NA TELA                                   NO PDF QUE SAIU
//   Entrada       R$  10.000  (digitada)      Entrada     R$  34.592
//   A financiar   R$ 322.400                  Financiado  R$ 297.808
//   Parcela       R$   3.838,10               Parcela     R$   3.545,33
//
// R$ 34.592 são os 8% de R$ 432.400: o PDF imprimia o MÍNIMO, e não o que o corretor digitou. A tela
// avisava "Abaixo do mínimo de 8% (R$ 34.592)" em vermelho e deixava seguir — era o servidor do PDF
// que trocava o número, em silêncio, depois do clique.
//
// ⚠️ ESTE É O PIOR TIPO DE DEFEITO PORQUE O PAPEL É O QUE VAI PARA O CLIENTE. O corretor apresenta
// uma conta na tela, encaminha outra impressa pelo WhatsApp e ninguém percebe a troca até o cliente
// cobrar a parcela que ele viu. Uma simulação que não confere com a própria tela vale menos que
// nenhuma.
//
// Mocks copiados de `route.revisao3.test.ts`, com uma diferença DE PROPÓSITO: o INVESTIDOR PARCELADO
// aqui tem `jurosTaxa: 0`, que é como o plano do Cecílio está cadastrado — é o que faz a parcela do
// print ser exatamente `322.400 ÷ 84`.

const estado = vi.hoisted(() => ({
  folhas: [] as unknown[],
  lotes: [] as Array<{
    codigo: string;
    preco: null | number;
    situacao: "disponivel" | "indisponivel";
  }>,
  piso: 8 as null | number,
}));

const BASE_DO_PLANO = {
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 0,
  sistemaAmortizacao: "sacoc",
} as const;

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => {
  const cadeia = {
    eq: () => cadeia,
    in: () => cadeia,
    maybeSingle: async () => ({
      data: {
        area: 450,
        codigo: "CER0307",
        lote: "07",
        preco_tabela: 470_000,
        quadra: "03",
        situacao: "disponivel",
      },
      error: null,
    }),
    select: () => cadeia,
  };
  const client = {
    from: () => cadeia,
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: { message: "sem logo" } }),
      }),
    },
  };
  return {
    abrirEspelho: async (token: null | string) =>
      token
        ? {
            espelho: {
              client,
              codigo: "cecilio-rocha",
              filhosC2xIds: [],
              masterplan: null,
              nome: "Cecílio Rocha",
              paiC2xId: "41",
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

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    {
      ...BASE_DO_PLANO,
      anuaisQuantidade: 5,
      anuaisValor: 25_000,
      descontoPercentual: 0,
      entradaPercentual: 10,
      nome: "NORMAL",
      parcelas: 60,
    },
    {
      ...BASE_DO_PLANO,
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      descontoPercentual: 8,
      entradaPercentual: 8,
      nome: "INVESTIDOR PARCELADO",
      parcelas: 84,
    },
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

const ultimaFolha = () =>
  estado.folhas.at(-1) as PropostaParaPdf & {
    condicoes: Array<{ rotulo: string; valor: string }>;
    destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
  };
const destaque = (rotulo: string) =>
  ultimaFolha().destaques.find((d) => d.rotulo === rotulo)?.valor;

/**
 * O corpo que a tela manda (`EspelhoPublico`, `baixarPdf`) para a Quadra 03 · Lote 07 do print: o
 * INVESTIDOR PARCELADO em 84 vezes, 4 anuais de R$ 25.000 e a entrada DIGITADA de R$ 10.000.
 */
const DO_PRINT = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  codigo: "CER0307",
  entrada: 10_000,
  entradaVezes: 1,
  parcelas: 84,
  plano: "INVESTIDOR PARCELADO",
  valor: 432_400,
};

beforeEach(() => {
  estado.folhas.length = 0;
  estado.lotes = [{ codigo: "CER0307", preco: 470_000, situacao: "disponivel" }];
  estado.piso = 8;
});

describe("o PDF imprime a entrada que está na tela, e não o mínimo", () => {
  it("⚠️ o print do Lucas: R$ 10.000 digitados saem R$ 10.000, e não os R$ 34.592 do piso de 8%", async () => {
    const r = await pedir(DO_PRINT);
    expect(r.status).toBe(200);

    // Os três números do print, lado a lado.
    expect(destaque("Entrada")).toBe("R$ 10.000,00");
    expect(destaque("Financiado")).toBe("R$ 322.400,00");
    expect(destaque("Parcela mensal")).toBe("R$ 3.838,10");

    // E a conta continua fechando com o valor do lote: 10.000 + 322.400 + 4 × 25.000 = 432.400.
    expect(destaque("Valor da unidade")).toBe("R$ 432.400,00");
  });

  it("entrada menor, parcela maior: é a régua que o Lucas pediu ('somente garante essa visão')", async () => {
    // Metade da entrada do print: o que sai do ato entra na mensal.
    await pedir({ ...DO_PRINT, entrada: 5_000 });
    expect(destaque("Entrada")).toBe("R$ 5.000,00");
    expect(destaque("Financiado")).toBe("R$ 327.400,00");
    // 327.400 ÷ 84 = 3.897,62, acima dos 3.838,10 da entrada cheia.
    expect(destaque("Parcela mensal")).toBe("R$ 3.897,62");
  });

  it("entrada acima do mínimo continua intacta (o caminho que já funcionava)", async () => {
    await pedir({ ...DO_PRINT, entrada: 50_000 });
    expect(destaque("Entrada")).toBe("R$ 50.000,00");
    expect(destaque("Financiado")).toBe("R$ 282.400,00");
  });

  it("⚠️ a entrada nunca passa do valor da unidade: acima disso não existe cronograma", async () => {
    // Aqui prender CONTINUA certo: `montarCronograma` recusa entrada maior que o valor, e a folha
    // não sairia de jeito nenhum. É trava de sanidade, não régua comercial.
    await pedir({ ...DO_PRINT, anuaisQuantidade: 0, entrada: 999_999 });
    expect(destaque("Entrada")).toBe("R$ 432.400,00");
  });

  it("entrada ausente, vazia ou lixo continua caindo na sugestão do plano (8%)", async () => {
    // ⚠️ SÓ UM CORPO ESCRITO À MÃO PRODUZ ESTES CASOS, e por isso eles caem na sugestão: não há tela
    // nenhuma dizendo o contrário. A tela SEMPRE manda um número — inclusive o zero, que é o campo
    // apagado e tem o teste logo abaixo.
    for (const entrada of [undefined, null, "abc", -5, ""]) {
      await pedir({ ...DO_PRINT, entrada });
      expect(destaque("Entrada")).toBe("R$ 34.592,00");
    }
  });

  it("⚠️ campo APAGADO (entrada zero) sai zero, e não a sugestão: era o último pedaço do item 4", async () => {
    // A TELA, com o campo de entrada vazio nos números do print: entrada R$ 0,00, a financiar
    // R$ 332.400 (432.400 − 4 × 25.000) e parcela R$ 3.957,14 (332.400 ÷ 84). Até 22/09/2026 o papel
    // saía com R$ 34.592, R$ 297.808 e R$ 3.545,33 — e em zero a tela nem pintava o aviso vermelho,
    // porque `abaixoDoMinimo` exigia `valor > 0`. Eram duas metades do mesmo silêncio.
    const r = await pedir({ ...DO_PRINT, entrada: 0 });
    expect(r.status).toBe(200);
    expect(destaque("Entrada")).toBe("R$ 0,00");
    expect(destaque("Financiado")).toBe("R$ 332.400,00");
    expect(destaque("Parcela mensal")).toBe("R$ 3.957,14");
    expect(destaque("Valor da unidade")).toBe("R$ 432.400,00");
  });
});

describe("a entrada MONTADA à mão também vai para o papel", () => {
  // ⚠️ O BOTÃO "MONTAR VALORES" EXISTE NO ESPELHO PÚBLICO. Ele aparece sempre que a entrada tem mais
  // de uma parcela (`SimuladorDeProposta.tsx`), e o cartão grande passa a anunciar "4× · 1ª de
  // R$ 10.000". O corpo do PDF não levava a lista: a folha imprimia a divisão igual, e quem montou
  // 10.000 + 7.000 + 7.000 + 7.000 encaminhava um papel dizendo 4 × R$ 7.750. Mesmo defeito do item
  // 4 do Lucas, em outro campo.
  const detalheDaEntrada = () =>
    ultimaFolha().destaques.find((d) => d.rotulo === "Entrada")?.detalhe;

  it("⚠️ 10.000 + 7.000 + 7.000 + 7.000 sai assim, e não 4 × R$ 7.750", async () => {
    const r = await pedir({
      ...DO_PRINT,
      entrada: 31_000,
      entradaParcelas: [10_000, 7_000, 7_000, 7_000],
      entradaVezes: 4,
    });
    expect(r.status).toBe(200);
    expect(destaque("Entrada")).toBe("R$ 31.000,00");
    expect(detalheDaEntrada()).toContain("4×, a 1ª de R$ 10.000,00");
  });

  it("sem montagem, a divisão igual de sempre", async () => {
    await pedir({ ...DO_PRINT, entrada: 31_000, entradaVezes: 4 });
    expect(detalheDaEntrada()).toContain("4× de R$ 7.750,00");
  });

  it("⚠️ montagem que não soma a entrada é ignorada: o papel não briga consigo mesmo", async () => {
    // O destaque diz R$ 31.000 e o fluxo listaria R$ 10; a folha vai para o cliente.
    await pedir({
      ...DO_PRINT,
      entrada: 31_000,
      entradaParcelas: [1, 2, 3, 4],
      entradaVezes: 4,
    });
    expect(destaque("Entrada")).toBe("R$ 31.000,00");
    expect(detalheDaEntrada()).toContain("4× de R$ 7.750,00");
  });
});
