import { beforeEach, describe, expect, it, vi } from "vitest";

// O TRANSPORTE DA TELA DO VÍNCULO.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • a seleção maior que o teto do servidor vai em BLOCOS (o Lagoa Bonita tem 907 na família);
//   • a prévia dos blocos é SOMADA, e não a do primeiro bloco;
//   • falha de rede não vira "nada a mudar";
//   • o envio para no primeiro erro, em vez de somar bloco que gravou com bloco que não gravou.

const simulado = vi.hoisted(() => ({ getApoloAccessToken: vi.fn(async () => "token") }));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { aplicar, conferir, emBlocos, somarPrevisoes, TETO_POR_CHAMADA } = await import(
  "./vinculo-de-unidades"
);

type Corpo = { acao: string; unidadeIds?: string[] };

const chamadas: Corpo[] = [];

function responder(respostas: { corpo: unknown; ok: boolean }[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    chamadas.push(JSON.parse(String(init?.body ?? "{}")) as Corpo);
    const atual = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    return {
      json: async () => atual?.corpo,
      ok: atual?.ok ?? true,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function previaDe(terrenos: number, ids: string[]) {
  return {
    data: {
      avisos: [],
      categorias: [
        {
          categoriaId: "cat",
          nome: "Condomínio",
          previa: {
            ids,
            jaEstao: 0,
            porParentesco: 1,
            semCategoria: terrenos,
            terrenos,
            trocamDeCategoria: [{ de: "Loteamento", terrenos: 1 }],
            vendaAndando: 0,
          },
        },
      ],
      divisoes: [],
      planilha: null,
      recusas: [],
      resumo: { linhas: ids.length, movem: 0, terrenos },
    },
  };
}

beforeEach(() => {
  chamadas.length = 0;
  vi.clearAllMocks();
});

describe("emBlocos", () => {
  it("divide no teto do servidor", () => {
    expect(emBlocos(Array.from({ length: 1201 }, (_, i) => i)).map((b) => b.length)).toEqual([
      TETO_POR_CHAMADA,
      TETO_POR_CHAMADA,
      201,
    ]);
  });

  it("lista vazia ainda é uma chamada", () => {
    expect(emBlocos([])).toEqual([[]]);
  });
});

describe("somarPrevisoes", () => {
  // ⚠️ SOMA, E NÃO A DO PRIMEIRO BLOCO: uma prévia que fala de 500 lotes quando o operador marcou
  // 907 dá confiança na metade errada do número.
  it("junta os grupos da mesma categoria", () => {
    const soma = somarPrevisoes([
      previaDe(2, ["a", "b"]).data,
      previaDe(3, ["c", "d", "e"]).data,
    ]);
    expect(soma.categorias).toHaveLength(1);
    expect(soma.categorias[0]?.previa.terrenos).toBe(5);
    expect(soma.categorias[0]?.previa.ids).toHaveLength(5);
    expect(soma.categorias[0]?.previa.trocamDeCategoria).toEqual([
      { de: "Loteamento", terrenos: 2 },
    ]);
    expect(soma.resumo.terrenos).toBe(5);
  });
});

describe("conferir", () => {
  it("manda a seleção grande em blocos e soma a resposta", async () => {
    responder([previaDe(1, ["x"])].map((corpo) => ({ corpo, ok: true })));
    const ids = Array.from({ length: TETO_POR_CHAMADA + 3 }, (_, i) => `u${i}`);
    const r = await conferir({ categoriaId: "cat", enterpriseId: "31", origem: "massa", unidadeIds: ids });

    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]?.unidadeIds).toHaveLength(TETO_POR_CHAMADA);
    expect(chamadas[1]?.unidadeIds).toHaveLength(3);
    expect("data" in r && r.data.categorias[0]?.previa.terrenos).toBe(2);
  });

  // ⚠️ FALHA FECHADA: cair para um objeto vazio faria a tela dizer "nada a mudar" a partir de um
  // timeout, e alguém aplicaria tudo de novo por cima.
  it("erro do servidor vira frase, nunca lista vazia", async () => {
    responder([{ corpo: { error: "Categoria não encontrada." }, ok: false }]);
    const r = await conferir({ categoriaId: "x", enterpriseId: "31", origem: "massa", unidadeIds: ["a"] });
    expect(r).toEqual({ erro: "Categoria não encontrada." });
  });
});

describe("aplicar", () => {
  const gravado = (n: number) => ({
    data: {
      avisos: [],
      gravadas: n,
      movidas: 0,
      naoMovidas: 0,
      planilha: null,
      porParentesco: 0,
      recusas: [],
      semCarimbo: false,
      terrenos: n,
    },
  });

  it("soma o que cada bloco gravou", async () => {
    responder([{ corpo: gravado(4), ok: true }]);
    const ids = Array.from({ length: TETO_POR_CHAMADA + 1 }, (_, i) => `u${i}`);
    const r = await aplicar({ categoriaId: "cat", enterpriseId: "31", origem: "massa", unidadeIds: ids });
    expect(chamadas).toHaveLength(2);
    expect("data" in r && r.data.gravadas).toBe(8);
  });

  // ⚠️ PARA NO PRIMEIRO ERRO: seguir em frente depois de um 409 faria a mensagem final somar bloco
  // que gravou com bloco que não gravou. Mas o que JÁ ENTROU volta junto, em `parcial`: a tela
  // precisa dizer "500 lotes já foram gravados antes da falha" e recarregar a lista.
  it("para no primeiro erro, e devolve o que já entrou", async () => {
    responder([
      { corpo: gravado(4), ok: true },
      { corpo: { error: "Mudar a divisão precisa de confirmação." }, ok: false },
    ]);
    const ids = Array.from({ length: TETO_POR_CHAMADA * 2 + 1 }, (_, i) => `u${i}`);
    const r = await aplicar({ categoriaId: "cat", enterpriseId: "31", origem: "massa", unidadeIds: ids });
    expect(chamadas).toHaveLength(2);
    expect("erro" in r && r.erro).toBe("Mudar a divisão precisa de confirmação.");
    expect("parcial" in r && r.parcial.gravadas).toBe(4);
  });

  // ⚠️ A PLANILHA TAMBÉM VAI EM BLOCOS (21/09/2026), e o CSV é lido AQUI, no navegador, com a
  // MESMA `lerCsvDeVinculo` do servidor. Até essa data ela ia inteira numa chamada só, e a
  // planilha de um loteamento de 532 lotes era recusada por inteiro — com uma frase mandando
  // usar um filtro de quadra ou faixa que a aba da planilha não tem.
  it("a planilha pequena vai numa chamada só, já lida em linhas", async () => {
    responder([{ corpo: gravado(2), ok: true }]);
    await aplicar({ csv: "Quadra;Lote\nC;01\n", enterpriseId: "31", origem: "planilha" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ acao: "aplicar", origem: "planilha" });
    expect(chamadas[0]).not.toHaveProperty("unidadeIds");
    // O servidor recebe as LINHAS, e não o texto cru: um leitor de CSV só, dos dois lados.
    expect(chamadas[0]).toMatchObject({ linhas: [{ lote: "01", quadra: "C" }] });
  });

  it("a planilha de um loteamento inteiro vai em blocos, como os ids", async () => {
    responder([{ corpo: gravado(500), ok: true }, { corpo: gravado(32), ok: true }]);
    const csv = [
      "Quadra;Lote;Categoria",
      ...Array.from({ length: 532 }, (_, i) => `A;${i + 1};Condomínio`),
    ].join("\n");
    const r = await aplicar({ csv, enterpriseId: "22", origem: "planilha" });
    expect(chamadas).toHaveLength(2);
    expect((chamadas[0] as unknown as { linhas: unknown[] }).linhas).toHaveLength(TETO_POR_CHAMADA);
    expect((chamadas[1] as unknown as { linhas: unknown[] }).linhas).toHaveLength(32);
    expect("data" in r && r.data.gravadas).toBe(532);
  });
});
