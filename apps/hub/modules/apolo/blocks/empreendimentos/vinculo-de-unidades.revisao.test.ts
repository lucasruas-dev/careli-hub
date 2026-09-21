import { beforeEach, describe, expect, it, vi } from "vitest";

// REVISÃO DA ONDA (21/09/2026) — o transporte da tela em massa, pela lente do VOLUME.
//
// Nasceu falhando de propósito e foi fechado na mesma data: o que se lê aqui agora é a régua.

const simulado = vi.hoisted(() => ({ getApoloAccessToken: vi.fn(async () => "token") }));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { aplicar } = await import("./vinculo-de-unidades");

function respostasEmSequencia(respostas: { corpo: unknown; ok: boolean }[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const atual = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    return { json: async () => atual?.corpo, ok: atual?.ok ?? true } as unknown as Response;
  }) as unknown as typeof fetch;
}

const aplicacao = (gravadas: number) => ({
  data: {
    avisos: [],
    gravadas,
    movidas: 0,
    naoMovidas: 0,
    planilha: null,
    porParentesco: 0,
    recusas: [],
    semCarimbo: false,
    terrenos: gravadas,
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("a gravação em blocos quando um bloco falha", () => {
  it("o bloco que JÁ GRAVOU volta junto do erro, para a tela dizer o que entrou", async () => {
    // Cidade Jardim tem 532 terrenos (medido em produção, 21/09/2026): "Marcar os 532 visíveis"
    // vira dois blocos de 500 + 32. O primeiro grava; o segundo cai (timeout da Vercel, por
    // exemplo).
    respostasEmSequencia([
      { corpo: aplicacao(500), ok: true },
      { corpo: { error: "Não foi possível concluir o vínculo agora." }, ok: false },
    ]);

    const r = await aplicar({
      categoriaId: "cccccccc-0000-4000-8000-000000000001",
      enterpriseId: "22",
      origem: "massa",
      unidadeIds: Array.from({ length: 532 }, (_, i) => `u-${i}`),
    });

    // O cabeçalho de `aplicar` promete "PARA NO PRIMEIRO ERRO E DEVOLVE O QUE JÁ ENTROU", e até
    // 21/09/2026 ele devolvia só `{ erro }`, jogando o acumulador fora: as 500 linhas que entraram
    // não apareciam em lugar nenhum, a tela não recarregava a lista (`gravar()` saa antes de
    // `carregar()`) e o operador clicava de novo em cima de um retrato velho.
    expect("erro" in r && r.erro).toContain("Não foi possível concluir");
    expect("parcial" in r && r.parcial.gravadas).toBe(500);
  });
});
