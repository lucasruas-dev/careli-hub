import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades, SituacaoDaUnidade, UnidadeComSituacao } from "./situacao-da-unidade";

// O ESTOQUE CONTADO PELA SITUAÇÃO (18/09/2026). Lucas: *"esses status tem que morar em um so lugar"*.
// Este arquivo é a conta que o painel de Produtos, a lista de produtos, o funil do Resumo e a
// TelaVendas passaram a dividir. O que se trava aqui:
//   1. a unidade que a régua não conhece é OCUPADA, nunca livre;
//   2. o estágio do funil nunca discorda do balde (as nove situações, uma a uma);
//   3. a contagem: quantidade e preço da linha, balde da régua, cinco baldes mais o total;
//   4. a leitura: UMA chamada à régua, paginação das linhas, falha que lança (nunca mapa vazio).

const estado = vi.hoisted(() => ({
  chamadasDaRegua: [] as string[][],
  reguaFalha: false,
  situacoes: new Map<string, string>(),
}));

// A régua é mockada só na LEITURA: `situacaoDoTerreno`, `baldeDaSituacao` e `acharUnidade` são os de
// verdade, e é sobre eles que este arquivo precisa provar que conta certo.
vi.mock("./situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(async (_client: unknown, ids: readonly string[]) => {
    estado.chamadasDaRegua.push([...ids]);
    if (estado.reguaFalha) throw new Error("supabase fora");
    return mapaDaRegua([...estado.situacoes].map(([id, situacao]) => unidade(id, situacao as SituacaoDaUnidade)));
  }),
}));

import {
  contarEstoque,
  estagioDaSituacao,
  idsDosCodigos,
  lerEstoquePelaRegua,
  SITUACAO_FORA_DO_MAPA,
  situacaoPelaRegua,
} from "./estoque-da-situacao";
import { baldeDaSituacao, estaLivre } from "./situacao-da-unidade";

function unidade(id: string, situacao: SituacaoDaUnidade, extra: Partial<UnidadeComSituacao> = {}): UnidadeComSituacao {
  return {
    codigo: id.toUpperCase(),
    enterpriseId: "37",
    id,
    lote: null,
    origemC2xId: null,
    quadra: null,
    situacao,
    ...extra,
  };
}

function mapaDaRegua(unidades: UnidadeComSituacao[]): SituacaoDasUnidades {
  return {
    porCodigo: new Map(unidades.map((u) => [u.codigo.toUpperCase(), u])),
    porLinha: new Map(unidades.map((u) => [u.id, u])),
    porOrigemC2x: new Map(
      unidades.filter((u) => u.origemC2xId !== null).map((u) => [String(u.origemC2xId), u]),
    ),
    terreno: () => undefined,
    unidades,
  };
}

const TODAS: SituacaoDaUnidade[] = [
  "disponivel",
  "reservado",
  "reservada",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
  "vendida",
  "bloqueada",
];

beforeEach(() => {
  estado.chamadasDaRegua = [];
  estado.reguaFalha = false;
  estado.situacoes = new Map();
});

describe("a unidade que a régua não conhece", () => {
  it("⚠️ é ocupada (bloqueada), nunca livre", () => {
    expect(estaLivre(SITUACAO_FORA_DO_MAPA)).toBe(false);
    expect(baldeDaSituacao(SITUACAO_FORA_DO_MAPA)).toBe("bloqueado");
  });

  it("chave que não casa sai fora do mapa; a que casa sai com a situação da régua", () => {
    const situacoes = mapaDaRegua([unidade("u1", "reservado", { origemC2xId: "900" })]);

    expect(situacaoPelaRegua(situacoes, { linhaId: "u1" })).toBe("reservado");
    expect(situacaoPelaRegua(situacoes, { origemC2x: 900 })).toBe("reservado");
    expect(situacaoPelaRegua(situacoes, { codigo: " u1 " })).toBe("reservado");
    expect(situacaoPelaRegua(situacoes, { linhaId: "outra" })).toBe(SITUACAO_FORA_DO_MAPA);
    expect(situacaoPelaRegua(situacoes, {})).toBe(SITUACAO_FORA_DO_MAPA);
  });

  it("a ordem das chaves é a de `acharUnidade`: a linha do Panteon manda sobre o código", () => {
    const situacoes = mapaDaRegua([unidade("u1", "contrato"), unidade("u2", "disponivel")]);

    // O código aponta para uma unidade livre, a linha para uma em contrato: vale a linha.
    expect(situacaoPelaRegua(situacoes, { codigo: "U2", linhaId: "u1" })).toBe("contrato");
  });
});

describe("o estágio do funil", () => {
  // O balde que cada estágio do funil representa, na régua das telas que contam por estágio
  // (TelaVendas: disponível + bloqueio à parte; faturado é vendido).
  const BALDE_DO_ESTAGIO = {
    assinatura: "negociacao",
    contrato: "negociacao",
    disponivel: "disponivel",
    em_cancelamento: "em_cancelamento",
    faturado: "vendido",
    proposta: "negociacao",
    reservado: "reservado",
  } as const;

  it.each(TODAS)("⚠️ %s: o estágio cai no mesmo balde que a régua dá", (situacao) => {
    const balde = baldeDaSituacao(situacao);
    const estagio = estagioDaSituacao(situacao);

    // Bloqueada não tem estágio próprio no funil: sai "disponivel", e quem separa é o balde.
    expect(balde === "bloqueado" ? "bloqueado" : BALDE_DO_ESTAGIO[estagio]).toBe(balde);
    if (balde === "bloqueado") expect(estagio).toBe("disponivel");
  });

  it("guarda o detalhe da negociação e junta as duas reservas e as duas vendas", () => {
    expect(estagioDaSituacao("proposta")).toBe("proposta");
    expect(estagioDaSituacao("contrato")).toBe("contrato");
    expect(estagioDaSituacao("assinatura")).toBe("assinatura");
    expect(estagioDaSituacao("reservada")).toBe("reservado");
    expect(estagioDaSituacao("reservado")).toBe("reservado");
    expect(estagioDaSituacao("vendida")).toBe("faturado");
    expect(estagioDaSituacao("faturado")).toBe("faturado");
  });

  it("só a disponível e a bloqueada saem com o estágio de estoque", () => {
    const deEstoque = TODAS.filter((s) => estagioDaSituacao(s) === "disponivel");
    expect(deEstoque.sort()).toEqual(["bloqueada", "disponivel"]);
  });
});

describe("contarEstoque", () => {
  it("⚠️ balde da régua, quantidade e preço da linha, cinco baldes mais o total", () => {
    const situacoes = mapaDaRegua([
      // Reserva do Hércules com o cadastro dizendo disponível: a régua diz reservado.
      unidade("u1", "reservado"),
      unidade("u2", "contrato"),
      unidade("u3", "disponivel"),
      unidade("u4", "vendida"),
      unidade("u6", "bloqueada"),
    ]);

    const estoque = contarEstoque(
      [
        { enterprise_id: 37, id: "u1", preco_tabela: 100 },
        { enterprise_id: "37", id: "u2", preco_tabela: "200" },
        { enterprise_id: " 37 ", id: "u3", preco_tabela: 300 },
        { enterprise_id: "37", id: "u4", preco_tabela: 400 },
        // Fora do mapa (nasceu entre as duas leituras): ocupada, e entra no total.
        { enterprise_id: "37", id: "u5", preco_tabela: 500 },
        { enterprise_id: "36", id: "u6", preco_tabela: null },
      ],
      situacoes,
    );

    expect(estoque.get("37")).toEqual({
      bloqueado: { units: 1, value: 500 },
      disponivel: { units: 1, value: 300 },
      em_cancelamento: { units: 0, value: 0 },
      negociacao: { units: 1, value: 200 },
      reservado: { units: 1, value: 100 },
      total: { units: 5, value: 1500 },
      vendido: { units: 1, value: 400 },
    });
    // Preço ausente vale zero, mas a unidade conta.
    expect(estoque.get("36")?.bloqueado).toEqual({ units: 1, value: 0 });
    expect(estoque.get("36")?.total).toEqual({ units: 1, value: 0 });
  });

  it("sem linha, sem empreendimento: o mapa não inventa zero para quem não tem unidade", () => {
    expect(contarEstoque([], mapaDaRegua([])).size).toBe(0);
  });
});

describe("lerEstoquePelaRegua", () => {
  type Linha = { enterprise_id: string; id: string; preco_tabela: number };

  function clienteFalso(linhas: Linha[], erro?: string) {
    const paginas: number[] = [];
    const client = {
      from: (tabela: string) => {
        let ids: string[] = [];
        const consulta = {
          eq: () => consulta,
          in: (_coluna: string, valores: string[]) => {
            ids = valores;
            return consulta;
          },
          order: () => consulta,
          range: async (de: number, ate: number) => {
            paginas.push(de);
            if (erro) return { data: null, error: { message: erro } };
            if (tabela !== "hercules_unidades") return { data: [], error: null };
            return { data: linhas.filter((l) => ids.includes(l.enterprise_id)).slice(de, ate + 1), error: null };
          },
          select: () => consulta,
        };
        return consulta;
      },
    };
    return { client: client as unknown as Parameters<typeof lerEstoquePelaRegua>[0], paginas };
  }

  it("⚠️ UMA chamada à régua com todos os empreendimentos; o id de grupo fica de fora", async () => {
    estado.situacoes = new Map([
      ["a", "proposta"],
      ["b", "disponivel"],
    ]);
    const { client } = clienteFalso([
      { enterprise_id: "37", id: "a", preco_tabela: 10 },
      { enterprise_id: "36", id: "b", preco_tabela: 20 },
    ]);

    const estoque = await lerEstoquePelaRegua(client, ["37", " 36 ", "group:Lagoa Bonita", "37", ""]);

    expect(estado.chamadasDaRegua).toEqual([["37", "36"]]);
    expect(estoque.get("37")?.negociacao).toEqual({ units: 1, value: 10 });
    expect(estoque.get("36")?.disponivel).toEqual({ units: 1, value: 20 });
  });

  it("⚠️ pagina as linhas: o PostgREST corta em 1.000 sem avisar", async () => {
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ enterprise_id: "37", id: `l${i}`, preco_tabela: 1 }));
    const { client, paginas } = clienteFalso(linhas);

    const estoque = await lerEstoquePelaRegua(client, ["37"]);

    expect(paginas).toEqual([0, 1000]);
    expect(estoque.get("37")?.total.units).toBe(1500);
    // Nenhuma veio da régua: todas fora do mapa, todas ocupadas.
    expect(estoque.get("37")?.bloqueado.units).toBe(1500);
    expect(estoque.get("37")?.disponivel.units).toBe(0);
  });

  it("sem id nenhum, não lê nada", async () => {
    const { client, paginas } = clienteFalso([]);

    expect((await lerEstoquePelaRegua(client, ["group:X", " "])).size).toBe(0);
    expect(paginas).toEqual([]);
    expect(estado.chamadasDaRegua).toEqual([]);
  });

  it("⚠️ falha da régua ou das linhas LANÇA, nunca devolve mapa vazio", async () => {
    estado.reguaFalha = true;
    await expect(lerEstoquePelaRegua(clienteFalso([]).client, ["37"])).rejects.toThrow("supabase fora");

    estado.reguaFalha = false;
    await expect(lerEstoquePelaRegua(clienteFalso([], "fora do ar").client, ["37"])).rejects.toThrow("fora do ar");
  });
});

describe("idsDosCodigos", () => {
  const CATALOGO = [
    { codes: ["VOC"], stageIds: ["37"] },
    { codes: ["LBF", "LBR", "LBP"], stageIds: ["33", "34", "38"] },
  ];

  it("traduz pelo catálogo, código a código, e diz o que não achou", () => {
    expect(idsDosCodigos(CATALOGO, [" lbr ", "VOC", "ZZZ"])).toEqual({ faltando: ["ZZZ"], ids: ["37", "34"] });
  });

  it("os códigos que o funil nunca contou continuam fora, e não contam como faltando", () => {
    expect(idsDosCodigos(CATALOGO, ["LAB", "TSC"])).toEqual({ faltando: [], ids: [] });
  });
});
