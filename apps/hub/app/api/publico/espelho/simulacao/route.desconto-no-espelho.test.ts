import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// A FOLHA DO ESPELHO IMPRIME O PREÇO QUE ESTÁ NA TELA (23/09/2026).
//
// Lucas: *"sabe aquela parte do desconto que incluimos no comercial, vamos colocar para cecilio
// também"* → **"Liberar para todo mundo"**. Com o campo do lote liberado na página sem login
// (`SimuladorDeProposta.desconto-no-espelho.comportamento.test.tsx`), esta rota precisa aceitar o
// número que a tela mandou: senão a tela mostra um valor, o PDF imprime outro, e ninguém vê a troca
// até o cliente cobrar a parcela que ele leu.
//
// ⚠️ OS NÚMEROS DESTE ARQUIVO SÃO OS DAQUELE: mesmo lote (R$ 435.000), mesmo plano (INVESTIDOR
// PARCELADO, 84x, 8%), mesmos 10% digitados à mão → R$ 391.500. Lá a tela produz o número; aqui a
// folha o imprime. É assim que a tela e o papel ficam amarrados um ao outro.
//
// ⚠️ E O TETO DE DESCONTO SAIU NO MESMO DIA, DEPOIS DE ESCRITO ESTE ARQUIVO. Eu havia posto 15% e
// dois casos aqui o guardavam; perguntado sobre ele com o risco na frente, Lucas: **"pode liberar
// tudo"**. Os dois casos foram invertidos, não apagados — a recusa de preço ACIMA da tabela e o
// "recusa não imprime folha" continuam medidos, porque nada disso é o teto que saiu.
//
// Mocks copiados de `route.revisao3.test.ts`.

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
  condicoes: Array<{ rotulo: string; valor: string }>;
  destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
};
const destaque = (rotulo: string) => ultimaFolha().destaques.find((d) => d.rotulo === rotulo)?.valor;
const condicao = (rotulo: string) => ultimaFolha().condicoes.find((c) => c.rotulo === rotulo)?.valor;
const erro = async (r: Response) => ((await r.json()) as { error: string }).error;

/** O que a tela do espelho manda para o INVESTIDOR PARCELADO, com os 10% digitados à mão. */
const DA_TELA = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  codigo: "GDN1110",
  entrada: 31_320,
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

describe("o PDF do espelho traz o preço ajustado, igual ao da tela", () => {
  it("⚠️ os 10% à mão saem impressos: R$ 391.500,00, e a folha os chama de desconto de 10%", async () => {
    const r = await pedir(DA_TELA);
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 391.500,00");
    expect(condicao("Valor de tabela")).toBe("R$ 435.000,00");
    expect(condicao("Desconto")).toBe("10% · R$ 43.500,00");
  });

  it("⚠️ nenhum valor DENTRO da banda é trocado em silêncio: o que entra é o que sai", async () => {
    // Esta é a garantia de que a tela e o papel dizem o mesmo número. Fora da banda, a rota RECUSA
    // com a frase; ela nunca devolve 200 imprimindo outro valor.
    for (const valor of [435_000, 420_000, 400_200, 391_500, 382_800, 375_000, 369_750]) {
      const r = await pedir({ ...DA_TELA, entrada: 0, valor });
      expect([valor, r.status]).toEqual([valor, 200]);
      expect([valor, destaque("Valor da unidade")]).toEqual([
        valor,
        valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }).replace(/^/, "R$ "),
      ]);
    }
  });

  it("⚠️ abaixo do que era o teto a folha SAI, e o que recusa agora é só o acima da tabela", async () => {
    // ⚠️ ESTE CASO VIROU DE LADO EM 23/09/2026, E É DECISÃO, NÃO DEFEITO. Ele exigia 422 com a
    // frase "15% de desconto" para R$ 369.749,99 (um centavo abaixo do teto). Perguntado sobre o
    // teto com o risco escrito na frente, Lucas: **"pode liberar tudo"**.
    const r = await pedir({ ...DA_TELA, entrada: 0, valor: 369_749.99 });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 369.749,99");

    // ⚠️ E A METADE QUE NÃO PODE SE PERDER JUNTO É "RECUSA NÃO IMPRIME NADA". Com o teto fora, a
    // única recusa de preço que sobrou é a do valor ACIMA da tabela — e ela precisa continuar
    // saindo sem folha, senão "passou da tabela" vira uma folha com o número trocado.
    estado.folhas.length = 0;
    const acima = await pedir({ ...DA_TELA, entrada: 0, valor: 999_999 });
    expect(acima.status).toBe(422);
    expect(await erro(acima)).toMatch(/tabela/);
    expect(estado.folhas).toHaveLength(0);
  });

  it("⚠️ o corpo forjado de 18/09 (50%) agora imprime folha, e é o que a decisão custa", async () => {
    // ⚠️ ESTE ERA O DEFEITO DE 18/09/2026 EM PESSOA: metade do preço, escrito à mão, numa página
    // sem login, saindo numa folha com a marca da casa dizendo "Desconto 50%". Ele foi fechado
    // naquele dia e REABERTO de propósito em 23/09/2026: Lucas, com esse histórico na frente,
    // *"Liberar para todo mundo"* e **"pode liberar tudo"**. O caso fica aqui, invertido, para que
    // o custo da decisão esteja medido e ninguém a desfaça achando que conserta um esquecimento.
    // O que segura a folha é a frase que ela carrega, guardada no bloco de baixo deste arquivo.
    const r = await pedir({ ...DA_TELA, entrada: 0, valor: 217_500 });
    expect(r.status).toBe(200);
    expect(destaque("Valor da unidade")).toBe("R$ 217.500,00");
    expect(condicao("Desconto")).toBe("50% · R$ 217.500,00");
  });
});

describe("a folha continua dizendo que não vincula", () => {
  it("⚠️ a frase da simulação sai no papel, com e sem desconto à mão", async () => {
    // ⚠️ É A ÚNICA COISA ENTRE UM DESCONTO INVENTADO E UM PAPEL QUE PARECE OFERTA. A bandeira
    // `simulacao` de `proposta-para-pdf.ts` a escreve; nada nesta rodada encosta nela, e este teste
    // existe para que a próxima também não encoste.
    const frase =
      "Esta é uma simulação de pagamento: não constitui proposta, não reserva a unidade e não vincula as partes.";

    await pedir({ ...DA_TELA, entrada: 0, valor: 435_000 });
    expect(ultimaFolha().observacoes.map((o) => o.texto).join(" ")).toContain(frase);
    expect(ultimaFolha().observacoes.map((o) => o.titulo)).toContain("Sobre esta simulação.");

    await pedir(DA_TELA);
    expect(ultimaFolha().observacoes.map((o) => o.texto).join(" ")).toContain(frase);
    // E a tarja de prévia continua de pé, que é a outra metade da mesma proteção.
    expect(ultimaFolha().simulacao).toBe(true);
    // O papel nunca promete prazo: simulação não tem "vale até".
    expect(ultimaFolha().observacoes.map((o) => o.texto).join(" ")).not.toContain("valem até");
  });
});
