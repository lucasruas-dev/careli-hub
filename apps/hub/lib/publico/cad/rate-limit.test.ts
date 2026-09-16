import { describe, expect, it } from "vitest";

import { consumir } from "./rate-limit";

// O CONTADOR DAS TORNEIRAS PAGAS SOB RAJADA (revisão do conjunto do portal, 16/09/2026).
//
// O que se trava: chamadas simultâneas na mesma chave não leem todas o mesmo contador e gravam N+1.
// O banco de mentira abaixo imita o que importa do PostgREST: o insert recusa a chave duplicada
// (23505) e o update só grava a linha que casa com TODOS os filtros (o `contador` lido inclusive).
// Cada ida ao banco cede a vez (`await` numa macrotarefa), para as chamadas se intercalarem como na
// Vercel.

type Linha = { balde: string; chave_hash: string; contador: number; janela_inicio: string };

function bancoDeMentira(opcoes: { falharLeitura?: boolean } = {}) {
  const linhas: Linha[] = [];
  const ceder = () => new Promise((resolve) => setTimeout(resolve, 0));

  const client = {
    from() {
      const filtros: Array<[string, unknown]> = [];
      let operacao: "insert" | "select" | "update" = "select";
      let valores: Record<string, unknown> = {};
      const casa = (linha: Linha) =>
        filtros.every(([coluna, valor]) => (linha as unknown as Record<string, unknown>)[coluna] === valor);

      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        eq: (coluna: string, valor: unknown) => {
          filtros.push([coluna, valor]);
          return cadeia;
        },
        insert: async (linha: Linha) => {
          await ceder();
          const existe = linhas.some(
            (l) =>
              l.balde === linha.balde && l.chave_hash === linha.chave_hash && l.janela_inicio === linha.janela_inicio,
          );
          if (existe) return { data: null, error: { code: "23505", message: "duplicate key value" } };
          linhas.push({ ...linha });
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          await ceder();
          if (opcoes.falharLeitura) return { data: null, error: { message: "timeout" } };
          const achada = linhas.find(casa);
          return { data: achada ? { contador: achada.contador } : null, error: null };
        },
        select: () => {
          if (operacao === "update") {
            return (async () => {
              await ceder();
              const alvo = linhas.filter(casa);
              for (const linha of alvo) Object.assign(linha, valores);
              return { data: alvo.map((l) => ({ contador: l.contador })), error: null };
            })();
          }
          return cadeia;
        },
        update: (novos: Record<string, unknown>) => {
          operacao = "update";
          valores = novos;
          return cadeia;
        },
      });
      return cadeia;
    },
  };

  return { client: client as unknown as Parameters<typeof consumir>[0], linhas };
}

describe("consumir (o teto das torneiras)", () => {
  it("chamadas em sequência contam uma a uma e recusam acima do teto", async () => {
    const { client, linhas } = bancoDeMentira();
    const vereditos = [];
    for (let i = 0; i < 4; i += 1) vereditos.push(await consumir(client, "ocr", "chave-a", { teto: 3 }));
    expect(vereditos.map((v) => v.permitido)).toEqual([true, true, true, false]);
    expect(linhas[0]?.contador).toBe(4);
  });

  it("⚠️ rajada em paralelo: nenhuma soma se perde, e só o teto passa", async () => {
    const { client, linhas } = bancoDeMentira();
    const vereditos = await Promise.all(
      Array.from({ length: 12 }, () => consumir(client, "ocr", "chave-rajada", { teto: 5 })),
    );
    const passaram = vereditos.filter((v) => v.permitido).length;
    expect(passaram).toBeLessThanOrEqual(5);
    // O contador conta toda chamada que conseguiu somar; nenhuma soma sobrescreve outra.
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.contador).toBeGreaterThanOrEqual(passaram);
  });

  it("leitura que falha deixa passar sem contar (o legítimo não fica refém do contador)", async () => {
    const { client, linhas } = bancoDeMentira({ falharLeitura: true });
    expect((await consumir(client, "ocr", "chave-b")).permitido).toBe(true);
    expect(linhas).toHaveLength(0);
  });

  it("chaves diferentes não dividem o contador", async () => {
    const { client } = bancoDeMentira();
    await consumir(client, "creci", "conta-1", { teto: 1 });
    expect((await consumir(client, "creci", "conta-2", { teto: 1 })).permitido).toBe(true);
    expect((await consumir(client, "creci", "conta-1", { teto: 1 })).permitido).toBe(false);
  });
});
