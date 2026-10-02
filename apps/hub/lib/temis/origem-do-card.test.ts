import { beforeEach, describe, expect, it, vi } from "vitest";

// DE ONDE É O CARD DA TÊMIS — o nome do empreendimento pelo cadastro (o pai na frente, o filho depois)
// e a categoria da unidade da proposta. Lucas (02/10/2026): *"quando tiver filho ou categoria, trazer
// aqui para gente saber de onde especificamente é"*.
//
// O que está travado aqui:
//   • com filho: "Pai · SIGLA", mesmo quando o card foi gravado só com o nome do pai (os 5 do Vale
//     do Ouro de 02/10/2026);
//   • sem filho: o nome do próprio cadastro;
//   • fora do cadastro: o nome gravado no card, como antes;
//   • a categoria sai de proposta → unidade → categoria; sem categoria, `null`;
//   • leitura que falha não lança: o card sai com o nome gravado e sem categoria, e fica o log.

const cadastro = vi.hoisted(() => ({
  falha: null as Error | null,
  linhas: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => {
    if (cadastro.falha) throw cadastro.falha;
    return cadastro.linhas;
  },
}));

import {
  type CardParaOrigem,
  type LinhaDoProdutoNoCard,
  nomeDoEmpreendimentoDoCard,
  origemDoCard,
  origemDosCards,
} from "./origem-do-card";

const VLO: LinhaDoProdutoNoCard = {
  c2xEnterpriseId: "35",
  codigo: "VLO",
  id: "pai-vlo",
  nome: "Vale do Ouro",
  paiId: null,
};
const VOL: LinhaDoProdutoNoCard = {
  c2xEnterpriseId: "36",
  codigo: "VOL",
  id: "filho-vol",
  nome: "Vale do Ouro · VOL",
  paiId: "pai-vlo",
};
const LAGOA: LinhaDoProdutoNoCard = {
  c2xEnterpriseId: "31",
  codigo: "LAB",
  id: "pai-lab",
  nome: "Lagoa Bonita",
  paiId: null,
};
const LBF: LinhaDoProdutoNoCard = {
  c2xEnterpriseId: "33",
  codigo: "LBF",
  id: "filho-lbf",
  nome: "Lagoa Bonita · LBF",
  paiId: "pai-lab",
};
const GARDEN: LinhaDoProdutoNoCard = {
  c2xEnterpriseId: "39",
  codigo: "GDN",
  id: "simples-gdn",
  nome: "Garden",
  paiId: null,
};

const CADASTRO = [VLO, VOL, LAGOA, LBF, GARDEN];

const card = (parcial: Partial<CardParaOrigem>): CardParaOrigem => ({
  codigo: "VOL",
  enterpriseId: "36",
  id: "t-1",
  nomeGravado: "Vale do Ouro · VOL",
  propostaId: null,
  ...parcial,
});

describe("nomeDoEmpreendimentoDoCard", () => {
  it("com filho: o nome do pai e a sigla do filho", () => {
    expect(nomeDoEmpreendimentoDoCard(card({}), CADASTRO)).toBe("Vale do Ouro · VOL");
  });

  it("⚠️ gravado só com o nome do pai: o filho volta pelo cadastro", () => {
    expect(nomeDoEmpreendimentoDoCard(card({ nomeGravado: "Vale do Ouro" }), CADASTRO)).toBe(
      "Vale do Ouro · VOL",
    );
  });

  it("o pai é a fonte: renomeado o pai, o filho acompanha", () => {
    const renomeado = [{ ...VLO, nome: "Vale do Ouro Residencial" }, VOL];
    expect(nomeDoEmpreendimentoDoCard(card({}), renomeado)).toBe("Vale do Ouro Residencial · VOL");
  });

  it("sem filho: o nome do próprio cadastro", () => {
    expect(
      nomeDoEmpreendimentoDoCard(card({ codigo: "GDN", enterpriseId: "39", nomeGravado: "GARDEN" }), CADASTRO),
    ).toBe("Garden");
  });

  it("sigla trocada no cadastro depois da abertura: acha pelo id do C2X", () => {
    expect(
      nomeDoEmpreendimentoDoCard(card({ codigo: "VOX", nomeGravado: "Vale do Ouro" }), CADASTRO),
    ).toBe("Vale do Ouro · VOL");
  });

  it("fora do cadastro (ou cadastro vazio): o nome gravado, como antes", () => {
    expect(
      nomeDoEmpreendimentoDoCard(card({ codigo: "XYZ", enterpriseId: "99", nomeGravado: "Produto Novo" }), CADASTRO),
    ).toBe("Produto Novo");
    expect(nomeDoEmpreendimentoDoCard(card({ nomeGravado: "Vale do Ouro" }), [])).toBe("Vale do Ouro");
  });

  it("filho cujo pai não veio na leitura: o nome da própria linha", () => {
    expect(nomeDoEmpreendimentoDoCard(card({ nomeGravado: "Vale do Ouro" }), [VOL])).toBe(
      "Vale do Ouro · VOL",
    );
  });
});

describe("origemDoCard", () => {
  it("com categoria: o nome e a categoria da proposta", () => {
    const origem = origemDoCard(
      card({ codigo: "LBF", enterpriseId: "33", nomeGravado: "Lagoa Bonita · LBF", propostaId: "p-1" }),
      { cadastro: CADASTRO, categoriaPorProposta: new Map([["p-1", "Condomínio"]]) },
    );
    expect(origem).toEqual({ categoria: "Condomínio", nome: "Lagoa Bonita · LBF" });
  });

  it("sem categoria, ou sem proposta: categoria nula", () => {
    const fontes = { cadastro: CADASTRO, categoriaPorProposta: new Map([["p-1", "Condomínio"]]) };
    expect(origemDoCard(card({ propostaId: "p-2" }), fontes).categoria).toBeNull();
    expect(origemDoCard(card({ propostaId: null }), fontes).categoria).toBeNull();
  });
});

// ── A leitura em lote ────────────────────────────────────────────────────────

type Resposta = { data: unknown; error: unknown };
type Chamada = { filtros: unknown[][]; tabela: string };

/** `"lança"` faz a consulta daquela tabela rejeitar (a rede que cai), em vez de devolver `{ error }`. */
function bancoFalso(respostas: Record<string, "lança" | Resposta>) {
  const chamadas: Chamada[] = [];
  const sb = {
    from: (tabela: string) => {
      const chamada: Chamada = { filtros: [], tabela };
      chamadas.push(chamada);
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "order", "limit"]) {
        q[metodo] = (...args: unknown[]) => {
          chamada.filtros.push([metodo, ...args]);
          return q;
        };
      }
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => {
        const resposta = respostas[tabela];
        if (resposta === "lança") return Promise.reject(new Error("rede caiu")).then(ok, falha);
        return Promise.resolve(resposta ?? { data: [], error: null }).then(ok, falha);
      };
      return q;
    },
  };
  // O construtor falso só imita o que a leitura usa (`select`, `in` e o `await`).
  return { chamadas, sb: sb as unknown as Parameters<typeof origemDosCards>[0] };
}

const CARD_LBF = card({
  codigo: "LBF",
  enterpriseId: "33",
  id: "t-lbf",
  nomeGravado: "Lagoa Bonita · LBF",
  propostaId: "p-lbf",
});
const CARD_VOL_SEM_FILHO = card({ id: "t-vol", nomeGravado: "Vale do Ouro", propostaId: "p-vol" });

describe("origemDosCards", () => {
  beforeEach(() => {
    cadastro.falha = null;
    cadastro.linhas = CADASTRO as unknown as Array<Record<string, unknown>>;
  });

  it("monta o nome pelo cadastro e a categoria pela cadeia proposta → unidade → categoria", async () => {
    const { chamadas, sb } = bancoFalso({
      hercules_propostas: {
        data: [
          { id: "p-lbf", unidade_id: "u-lbf" },
          { id: "p-vol", unidade_id: "u-vol" },
        ],
        error: null,
      },
      hercules_unidades: {
        data: [
          { categoria_id: "c-cond", id: "u-lbf" },
          { categoria_id: null, id: "u-vol" },
        ],
        error: null,
      },
      temis_categorias: { data: [{ id: "c-cond", nome: "Condomínio" }], error: null },
    });

    const origens = await origemDosCards(sb, [CARD_LBF, CARD_VOL_SEM_FILHO]);

    expect(origens.get("t-lbf")).toEqual({ categoria: "Condomínio", nome: "Lagoa Bonita · LBF" });
    expect(origens.get("t-vol")).toEqual({ categoria: null, nome: "Vale do Ouro · VOL" });
    // Em lote, pelas chaves primárias: uma consulta por tabela.
    expect(chamadas.map((c) => c.tabela)).toEqual([
      "hercules_propostas",
      "hercules_unidades",
      "temis_categorias",
    ]);
    expect(chamadas[0]?.filtros).toContainEqual(["in", "id", ["p-lbf", "p-vol"]]);
    expect(chamadas[1]?.filtros).toContainEqual(["in", "id", ["u-lbf", "u-vol"]]);
    expect(chamadas[2]?.filtros).toContainEqual(["in", "id", ["c-cond"]]);
  });

  it("nenhuma unidade com categoria: a consulta das categorias nem sai", async () => {
    const { chamadas, sb } = bancoFalso({
      hercules_propostas: { data: [{ id: "p-vol", unidade_id: "u-vol" }], error: null },
      hercules_unidades: { data: [{ categoria_id: null, id: "u-vol" }], error: null },
    });

    const origens = await origemDosCards(sb, [CARD_VOL_SEM_FILHO]);

    expect(origens.get("t-vol")?.categoria).toBeNull();
    expect(chamadas.map((c) => c.tabela)).toEqual(["hercules_propostas", "hercules_unidades"]);
  });

  it("lote de 100 no `.in()`: 150 propostas viram duas consultas", async () => {
    const { chamadas, sb } = bancoFalso({});
    const cards = Array.from({ length: 150 }, (_, i) => card({ id: `t-${i}`, propostaId: `p-${i}` }));

    await origemDosCards(sb, cards);

    const lotes = chamadas.filter((c) => c.tabela === "hercules_propostas");
    expect(lotes).toHaveLength(2);
    expect((lotes[0]?.filtros.find((f) => f[0] === "in")?.[2] as string[]).length).toBe(100);
    expect((lotes[1]?.filtros.find((f) => f[0] === "in")?.[2] as string[]).length).toBe(50);
  });

  it("⚠️ leitura da categoria que falha: o card sai sem categoria, com o nome, e fica o log", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sb } = bancoFalso({
      hercules_propostas: { data: null, error: { code: "57014", message: "statement timeout" } },
    });

    const origens = await origemDosCards(sb, [CARD_LBF]);

    expect(origens.get("t-lbf")).toEqual({ categoria: null, nome: "Lagoa Bonita · LBF" });
    expect(grito).toHaveBeenCalled();
    grito.mockRestore();
  });

  it("⚠️ leitura do cadastro que falha: o nome gravado, e a categoria continua vindo", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cadastro.falha = new Error("Não foi possível ler o cadastro de empreendimentos");
    const { sb } = bancoFalso({
      hercules_propostas: { data: [{ id: "p-vol", unidade_id: "u-vol" }], error: null },
      hercules_unidades: { data: [{ categoria_id: "c-x", id: "u-vol" }], error: null },
      temis_categorias: { data: [{ id: "c-x", nome: "Fase 2" }], error: null },
    });

    const origens = await origemDosCards(sb, [CARD_VOL_SEM_FILHO]);

    expect(origens.get("t-vol")).toEqual({ categoria: "Fase 2", nome: "Vale do Ouro" });
    expect(grito).toHaveBeenCalled();
    grito.mockRestore();
  });

  it("⚠️ banco que LANÇA (rede caiu): não derruba o quadro nem leva o nome junto, e loga", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sb } = bancoFalso({ hercules_propostas: "lança" });

    const origens = await origemDosCards(sb, [CARD_LBF]);

    expect(origens.get("t-lbf")).toEqual({ categoria: null, nome: "Lagoa Bonita · LBF" });
    expect(grito).toHaveBeenCalled();
    grito.mockRestore();
  });

  it("quadro vazio não consulta nada", async () => {
    const { chamadas, sb } = bancoFalso({});
    expect((await origemDosCards(sb, [])).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
});
