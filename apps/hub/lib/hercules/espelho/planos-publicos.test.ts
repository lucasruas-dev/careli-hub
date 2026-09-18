import { describe, expect, it } from "vitest";

import {
  pisoDoEspelho,
  planosPublicos,
  semPlanosRepetidos,
  type PlanoPublico,
} from "./planos-publicos";

// O PISO DO ESPELHO (18/09/2026): o Garden aparecia com "entrada R$ 41.000 (8%)" num lote de
// R$ 410.000 porque o espelho usava o padrão da casa (10%) e não os 8% do empreendimento.
describe("pisoDoEspelho", () => {
  it("o piso cadastrado vale, e chega como o numeric do banco (texto)", () => {
    expect(pisoDoEspelho(["8.00"])).toBe(8);
  });

  it("ninguém cadastrou: nulo, que é o padrão da casa", () => {
    expect(pisoDoEspelho([])).toBeNull();
    expect(pisoDoEspelho([null, undefined, ""])).toBeNull();
  });

  it("⚠️ zero é decisão, não ausência", () => {
    expect(pisoDoEspelho(["0.00"])).toBe(0);
    expect(pisoDoEspelho([null, 0])).toBe(0);
  });

  it("pai e filhos com pisos diferentes: vale o maior, que nenhum filho recusa", () => {
    expect(pisoDoEspelho(["8.00", "10.00", null])).toBe(10);
  });

  it("lixo não vira piso", () => {
    expect(pisoDoEspelho(["abc", -5 as unknown as string])).toBeNull();
  });
});

function plano(parcial: Partial<PlanoPublico>): PlanoPublico {
  return {
    anuaisQuantidade: 0,
    anuaisValor: 0,
    descontoPercentual: 0,
    entradaPercentual: 20,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "efetiva",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "CURTO",
    parcelas: 36,
    ressalva: null,
    sistemaAmortizacao: "PRICE",
    ...parcial,
  } as PlanoPublico;
}

// Os tres planos do Vale do Ouro, como estavam cadastrados no VLO e no VOC (15/09/2026).
const DO_VALE = [
  plano({ entradaPercentual: 20, indiceCorrecao: "SEM_CORRECAO", nome: "INVESTIDOR", parcelas: 24 }),
  plano({ entradaPercentual: 20, indiceCorrecao: "IPCA_ANUAL", nome: "CURTO", parcelas: 36 }),
  plano({ entradaPercentual: 10, indiceCorrecao: "IPCA_ANUAL", nome: "NORMAL", parcelas: 156 }),
];

describe("semPlanosRepetidos", () => {
  // ⚠️ O PRINT DO LUCAS: pai e filho com os mesmos tres planos viravam seis cartoes.
  it("pai e filho com os mesmos planos mostram cada plano uma vez", () => {
    const somados = [...DO_VALE, ...DO_VALE];

    expect(semPlanosRepetidos(somados)).toHaveLength(3);
  });

  it("mantem a ordem da primeira ocorrencia", () => {
    expect(semPlanosRepetidos([...DO_VALE, ...DO_VALE]).map((p) => p.nome)).toEqual([
      "INVESTIDOR",
      "CURTO",
      "NORMAL",
    ]);
  });

  // Caixa e espaco nao fazem planos diferentes: "Curto" e "CURTO " e o mesmo plano.
  it("nome com caixa ou espaco diferente e o mesmo plano", () => {
    expect(
      semPlanosRepetidos([plano({ nome: "CURTO" }), plano({ nome: " curto " })]),
    ).toHaveLength(1);
  });

  // ⚠️ SO TIRA REPETICAO. Tudo que muda a conta faz um plano diferente — e plano diferente
  // continua aparecendo, porque esconder condicao comercial real e pior do que repetir.
  it("plano que muda a conta nao some", () => {
    const base = plano({});

    for (const variacao of [
      { parcelas: 48 },
      { entradaPercentual: 30 },
      { indiceCorrecao: "IPCA_MENSAL" },
      { jurosTaxa: 0.5 },
      { jurosPeriodicidade: "mensal" },
      { anuaisQuantidade: 2 },
      { anuaisValor: 15000 },
      { sistemaAmortizacao: "SAC" },
      // O desconto do plano (0178) é preço: dois planos iguais com descontos diferentes são dois.
      { descontoPercentual: 8 },
    ] as Array<Partial<PlanoPublico>>) {
      expect(semPlanosRepetidos([base, plano(variacao)]), JSON.stringify(variacao)).toHaveLength(2);
    }
  });

  // Juros nulo (sem juros) e juros zero sao decisoes diferentes: nulo e ausencia, zero e escolha.
  it("juros nulo e juros zero nao se fundem", () => {
    expect(
      semPlanosRepetidos([plano({ jurosTaxa: null }), plano({ jurosTaxa: 0 })]),
    ).toHaveLength(2);
  });

  it("lista vazia continua vazia", () => {
    expect(semPlanosRepetidos([])).toEqual([]);
  });
});

// A RESSALVA NO ESPELHO (revisão de 18/09/2026). O mapa público da MMendes escreve "válido para as
// próximas 16 unidades" ao lado do INVESTIDOR PARCELADO, e a Mesa já mostrava; o espelho não lia a
// coluna. A leitura tem a mesma tolerância da Mesa (`lerPlanosDoPanteon`): coluna nova que o banco
// ainda não tem (a ressalva da 0168, o desconto da 0178) sai da leitura, e o resto continua.
describe("planosPublicos: a ressalva e as colunas novas", () => {
  const RESSALVA = "válido para as próximas 16 unidades";
  const LINHA = {
    anuais_quantidade: 4,
    anuais_valor: "25000.00",
    desconto_percentual: "8",
    entrada_percentual: "8.000",
    indice_correcao: "IPCA_ANUAL",
    juros_convencao: "equivalente",
    juros_periodicidade: "anual",
    juros_taxa: "6.000000",
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
    ressalva: `  ${RESSALVA}  `,
    sistema_amortizacao: "sacoc",
  };

  /** Um banco de mentira: recusa as colunas de `faltam` como o PostgREST recusa, e guarda o `select`. */
  function banco(faltam: Array<{ codigo: string; coluna: string }>, outroErro?: { code: string; message: string }) {
    const pedidas: string[] = [];
    const consulta = (colunas: string) => {
      const cadeia = {
        eq: () => cadeia,
        in: () => cadeia,
        is: () => cadeia,
        order: async () => {
          if (outroErro) return { data: null, error: outroErro };
          const falta = faltam.find((f) => colunas.split(",").includes(f.coluna));
          if (falta)
            return {
              data: null,
              error: { code: falta.codigo, message: `column temis_planos.${falta.coluna} does not exist` },
            };
          const linha: Record<string, unknown> = { ...LINHA };
          for (const f of faltam) delete linha[f.coluna];
          return { data: [linha], error: null };
        },
      };
      return cadeia;
    };
    const client = {
      from: () => ({
        select: (c: string) => {
          pedidas.push(c);
          return consulta(c);
        },
      }),
    };
    return { client: client as never, pedidas };
  }

  it("lê a ressalva, limpa, junto com o desconto", async () => {
    const { client, pedidas } = banco([]);
    const [p] = await planosPublicos(client, ["39"]);
    expect(p).toMatchObject({ descontoPercentual: 8, nome: "INVESTIDOR PARCELADO", ressalva: RESSALVA });
    expect(pedidas).toHaveLength(1);
    expect(pedidas[0]!.split(",")).toEqual(expect.arrayContaining(["ressalva", "desconto_percentual"]));
  });

  it("produção hoje (0168 aplicada, 0178 não): repete sem o desconto e mantém a ressalva", async () => {
    const { client, pedidas } = banco([{ codigo: "PGRST204", coluna: "desconto_percentual" }]);
    const [p] = await planosPublicos(client, ["39"]);
    expect(p).toMatchObject({ descontoPercentual: 0, ressalva: RESSALVA });
    expect(pedidas).toHaveLength(2);
    expect(pedidas[1]).toContain("ressalva");
    expect(pedidas[1]).not.toContain("desconto_percentual");
  });

  it("sem as duas colunas: repete até a leitura de antes, plano sem etiqueta e sem desconto", async () => {
    const { client, pedidas } = banco([
      { codigo: "42703", coluna: "ressalva" },
      { codigo: "42703", coluna: "desconto_percentual" },
    ]);
    const [p] = await planosPublicos(client, ["39"]);
    expect(p).toMatchObject({ descontoPercentual: 0, parcelas: 84, ressalva: null });
    expect(pedidas).toHaveLength(3);
    expect(pedidas[2]).not.toMatch(/ressalva|desconto_percentual/);
  });

  it("ressalva vazia ou só com espaço é nula (sem chip vazio no cartão)", async () => {
    const { client } = banco([]);
    LINHA.ressalva = "   ";
    try {
      const [p] = await planosPublicos(client, ["39"]);
      expect(p?.ressalva).toBeNull();
    } finally {
      LINHA.ressalva = `  ${RESSALVA}  `;
    }
  });

  it("outro erro do banco sobe, como sempre subiu", async () => {
    const { client } = banco([], { code: "57014", message: "canceling statement due to statement timeout" });
    await expect(planosPublicos(client, ["39"])).rejects.toThrow("statement timeout");
  });
});
