import { describe, expect, it } from "vitest";

import { identidadeCanonicaDoCredenciado } from "./identidade-do-credenciado";

type Resposta = { data: unknown };

// Stub encadeável do Supabase: toda chamada de filtro devolve o próprio objeto, e o resultado
// vem do mapa por tabela. É o bastante para provar a PRECEDÊNCIA (vínculo → de-para → coluna),
// que é a regra de negócio; o SQL em si é exercitado pelas rotas.
function clienteFalso(porTabela: Record<string, Resposta>, registrar?: string[]) {
  const construir = (tabela: string) => {
    const alvo: Record<string, unknown> = {};
    const encadeia = new Proxy(alvo, {
      get(_alvo, prop: string) {
        if (prop === "maybeSingle") {
          return () => Promise.resolve(porTabela[tabela] ?? { data: null });
        }
        if (prop === "then") {
          // `await` direto no builder (é o caso do `.in()` de apolo_entities).
          return (resolver: (r: Resposta) => unknown) =>
            Promise.resolve(resolver(porTabela[tabela] ?? { data: null }));
        }
        return () => encadeia;
      },
    });
    return encadeia;
  };
  return {
    from: (tabela: string) => {
      registrar?.push(tabela);
      return construir(tabela);
    },
  } as never;
}

const PESSOA = "11111111-1111-1111-1111-111111111111";
const IMOB = "22222222-2222-2222-2222-222222222222";

describe("a identidade que o tótem mostra", () => {
  it("o VÍNCULO do Apolo manda: credenciado com a coluna de texto vazia ganha a imobiliária", async () => {
    const identidade = await identidadeCanonicaDoCredenciado(
      clienteFalso({
        apolo_entities: {
          data: [
            { display_name: "Flavia C. Andrade", id: PESSOA, legal_name: "Flavia Caldeira Andrade", trade_name: null },
            { display_name: "RR Soluções", id: IMOB, legal_name: "RR SOLUCOES IMOBILIARIAS LTDA", trade_name: null },
          ],
        },
        apolo_relationships: { data: { label: null, related_entity_id: IMOB } },
      }),
      { corretor: null, entity_id: PESSOA, imobiliaria: null, nome: "FLAVIA ANDRADE" },
    );
    expect(identidade.imobiliaria).toBe("RR Soluções");
    // Mesma composição da fila e da etiqueta: legal_name na frente, MAIÚSCULAS.
    expect(identidade.nome).toBe("FLAVIA CALDEIRA ANDRADE");
  });

  it("sem vínculo, o de-para por texto resolve — e a grafia vira a canônica da entidade", async () => {
    const identidade = await identidadeCanonicaDoCredenciado(
      clienteFalso({
        apolo_entities: {
          data: [{ display_name: "RR Soluções", id: IMOB, legal_name: null, trade_name: null }],
        },
        apolo_imobiliaria_match: { data: { entity_id: IMOB } },
        apolo_relationships: { data: null },
      }),
      {
        corretor: "Rômulo",
        entity_id: null,
        imobiliaria: "RR SOLUCOES IMOBILIARIAS LTDA",
        nome: "FLAVIA ANDRADE",
      },
    );
    expect(identidade.imobiliaria).toBe("RR Soluções");
    expect(identidade.corretor).toBe("Rômulo");
  });

  it("sem entidade nenhuma, fica o que está na coluna — o tótem não perde informação", async () => {
    const identidade = await identidadeCanonicaDoCredenciado(
      clienteFalso({
        apolo_entities: { data: [] },
        apolo_imobiliaria_match: { data: null },
        apolo_relationships: { data: null },
      }),
      { corretor: null, entity_id: null, imobiliaria: "Imobiliária do Zé", nome: "FLAVIA ANDRADE" },
    );
    expect(identidade).toEqual({
      corretor: null,
      imobiliaria: "Imobiliária do Zé",
      nome: "FLAVIA ANDRADE",
    });
  });

  it("credenciado sem entidade e sem imobiliária não consulta o Apolo à toa", async () => {
    const tabelas: string[] = [];
    const identidade = await identidadeCanonicaDoCredenciado(
      clienteFalso({}, tabelas),
      { corretor: null, entity_id: null, imobiliaria: "  ", nome: "FLAVIA ANDRADE" },
    );
    expect(tabelas).toEqual([]);
    expect(identidade.nome).toBe("FLAVIA ANDRADE");
  });

  it("consulta que explode não derruba o bip: cai nas colunas cruas", async () => {
    const clienteQuebrado = {
      from: () => {
        throw new Error("Apolo indisponível");
      },
    } as never;
    const identidade = await identidadeCanonicaDoCredenciado(clienteQuebrado, {
      corretor: null,
      entity_id: PESSOA,
      imobiliaria: "RR Soluções",
      nome: "FLAVIA ANDRADE",
    });
    expect(identidade).toEqual({
      corretor: null,
      imobiliaria: "RR Soluções",
      nome: "FLAVIA ANDRADE",
    });
  });
});
