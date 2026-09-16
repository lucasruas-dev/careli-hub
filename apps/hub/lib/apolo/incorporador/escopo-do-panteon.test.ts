import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

// O PRODUTO NASCIDO NO PANTEON DENTRO DO ESCOPO DO PORTAL.
//
// ⚠️ O DEFEITO QUE ISTO TRAVA: `codigosDaSessao` traduzia os ids da sessão em códigos SÓ pelo
// catálogo do C2X, e o produto cadastrado no Panteon (id a partir de 100000; o ZZ TESTE 9001) não
// virava código — sumia de vendas, contratos, espelho, CRM, carteira e masterplan. E a checagem de
// unidade só conhecia o MySQL, então a unidade de `hercules_unidades` nunca era "da sessão".
//
// Os três lados da regra, em todos os blocos:
//   • o produto do Panteon que a sessão traz ENTRA (sozinho ou misturado com o C2X);
//   • o que a sessão não traz NÃO entra (é tradução, não permissão);
//   • uma fonte fora do ar não derruba a outra.

const estado = vi.hoisted(() => ({
  cadastro: [] as unknown[],
  cadastroFora: false,
  catalogo: [] as unknown[],
  donoNoMysql: null as null | number,
  mysqlFora: false,
  consultasMysql: 0,
  consultasSupabase: 0,
  unidades: new Map<string, string>(),
  supabaseErro: false,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/catalogo-empreendimentos")>()),
  catalogoDeEmpreendimentos: async () => estado.catalogo,
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => {
    if (estado.cadastroFora) throw new Error("supabase fora");
    return estado.cadastro;
  },
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () =>
    estado.mysqlFora
      ? { missing: ["C2X_DB"], ok: false }
      : {
          ok: true,
          pool: {
            query: async () => {
              estado.consultasMysql += 1;
              return [estado.donoNoMysql === null ? [] : [{ enterprise_id: estado.donoNoMysql }]];
            },
          },
        },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => {
      let id = "";
      const builder = {
        eq: (coluna: string, valor: string) => {
          if (coluna === "id") id = valor;
          return builder;
        },
        maybeSingle: async () => {
          estado.consultasSupabase += 1;
          if (estado.supabaseErro) return { data: null, error: { message: "timeout" } };
          const dono = estado.unidades.get(id);
          return { data: dono ? { enterprise_id: dono } : null, error: null };
        },
        select: () => builder,
      };
      return builder;
    },
  }),
}));

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";

import {
  alcanceDaSessao,
  codigosDaSessao,
  codigosDoEscopo,
  linhasSoDoPanteon,
  tipoDoIdDeUnidade,
  unidadeNoEscopo,
} from "./escopo";
import { montarPropriosDoPortal } from "./proprios-do-portal";
import type { SessaoIncorporador } from "./sessao";

// O catálogo REAL do C2X (a Lagoa Bonita e o Vale do Ouro agrupados; o LAB, espelho da Lagoa,
// fica FORA porque está em EXCLUDED_ENTERPRISE_CODES — é isso que o `agrupar` recebe depois do
// `where code not in (...)`).
const CATALOGO = agrupar([
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "VLO", id: 35, name: "VALE DO OURO" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "GDN", id: 39, name: "GARDEN" },
]);

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  operadoPor: null,
  ordem: 0,
  paiId: null,
  tipoProduto: "loteamento",
  uf: null,
  vendendo: true,
  ...p,
});

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", paiId: "vlo" }),
  linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", paiId: "vlo" }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab" }),
  linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", paiId: "lab" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn" }),
  linha({ c2xEnterpriseId: "9001", codigo: "TST", id: "tst" }),
  // Os prédios da Cecílio, nascidos no Panteon (sequence da 0170).
  linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", nome: "Ed. Jade", tipoProduto: "vertical" }),
  linha({ c2xEnterpriseId: "100001", codigo: "RUB", id: "rub", nome: "Ed. Rubi", tipoProduto: "vertical" }),
  // Pai de grupo sem id (como o LOX): não tem o que traduzir.
  linha({ codigo: "LOX", id: "lox" }),
];

function sessao(ids: string[]): SessaoIncorporador {
  return {
    enterpriseIds: ids,
    enterpriseIdsComCarteira: [],
    exp: Date.now() + 60_000,
    incorporadorId: "inc-cecilio",
    incorporadorNome: "Cecílio Rocha",
    slug: "cecilio-rocha",
    tipo: "incorporador",
    usuarioId: "user-1",
    usuarioNome: "Time Cecílio",
  };
}

beforeEach(() => {
  estado.cadastro = CADASTRO;
  estado.cadastroFora = false;
  estado.catalogo = CATALOGO;
  estado.donoNoMysql = null;
  estado.mysqlFora = false;
  estado.consultasMysql = 0;
  estado.consultasSupabase = 0;
  estado.unidades = new Map();
  estado.supabaseErro = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("codigosDoEscopo (o núcleo puro)", () => {
  const codigos = (
    permitidos: string[],
    fontes: { cadastro?: LinhaDoCadastro[] | null; catalogo?: typeof CATALOGO } = {},
  ) =>
    codigosDoEscopo({
      cadastro: fontes.cadastro === undefined ? CADASTRO : fontes.cadastro,
      catalogo: fontes.catalogo ?? CATALOGO,
      permitidos,
    });

  it("⚠️ sessão SÓ com produto do Panteon: o código sai (antes vinha vazio)", () => {
    expect(codigos(["100000"])).toEqual(["JAD"]);
  });

  it("sessão mista: o C2X traduz o dele, o cadastro traduz o do Panteon", () => {
    expect(codigos(["37", "100000", "9001"]).sort()).toEqual(["JAD", "TST", "VOC"]);
  });

  it("⚠️ não amplia: o prédio que a sessão não traz não entra", () => {
    const saida = codigos(["37", "100000"]);
    expect(saida).not.toContain("RUB");
    expect(saida).not.toContain("VOL");
  });

  it("o que o C2X conhece não sai duas vezes (o cadastro também tem o VOC)", () => {
    expect(codigos(["37", "39"]).sort()).toEqual(["GDN", "VOC"]);
  });

  it("⚠️ o LAB (31), que o catálogo exclui de propósito, não volta pelo cadastro", () => {
    // A sessão do /gurgel carrega o 31. Sem a trava, o espelho da Lagoa Bonita viraria código e o
    // consolidado contaria a Lagoa duas vezes.
    expect(codigos(["31", "33"])).toEqual(["LBF"]);
    // Com o C2X fora, a sessão do legado sai vazia (e a rota responde 503), sem LAB nenhum.
    expect(codigos(["31", "33"], { catalogo: [] })).toEqual([]);
  });

  it("produto nascido no Panteon com sigla da lista de exclusão continua saindo", () => {
    const cadastro = [linha({ c2xEnterpriseId: "100007", codigo: "LAG", id: "lag-novo" })];
    expect(codigos(["100007"], { cadastro })).toEqual(["LAG"]);
  });

  it("⚠️ C2X fora do ar (catálogo vazio): sessão só do Panteon segue com os códigos dela", () => {
    expect(codigos(["100000"], { catalogo: [] })).toEqual(["JAD"]);
  });

  it("⚠️ C2X fora do ar com id do legado na sessão: vazio, para a rota responder 503 em vez de 500", () => {
    // Antes o cadastro respondia pelo VOC, e vendas/CRM/carteira seguiam para o loader do MySQL, que
    // lança sem try/catch.
    expect(codigos(["37", "100000"], { catalogo: [] })).toEqual([]);
    expect(codigos(["37"], { catalogo: [] })).toEqual([]);
    // O 9001 (ZZ TESTE) não é id do Panteon: conta como legado.
    expect(codigos(["9001"], { catalogo: [] })).toEqual([]);
  });

  it("C2X fora do ar: id de GRUPO não tem linha no cadastro e fica de fora (menos, nunca mais)", () => {
    expect(codigos(["group:Lagoa Bonita"], { catalogo: [] })).toEqual([]);
    expect(codigos(["group:Lagoa Bonita"])).toEqual(["LBF", "LBR", "LBP"]);
  });

  it("cadastro fora do ar: sai só o que o C2X traduz, como era antes", () => {
    expect(codigos(["37", "100000"], { cadastro: null })).toEqual(["VOC"]);
  });

  it("as duas fontes fora: vazio (a rota decide o 503)", () => {
    expect(codigos(["37", "100000"], { cadastro: null, catalogo: [] })).toEqual([]);
  });

  it("sessão sem id: vazio, sem olhar fonte nenhuma", () => {
    expect(codigos([])).toEqual([]);
  });
});

describe("linhasSoDoPanteon", () => {
  it("devolve a LINHA (nome e tipo), não só o código, e ignora o pai sem id", () => {
    const linhas = linhasSoDoPanteon({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      permitidos: ["100000", "37", "lox"],
    });
    expect(linhas.map((l) => [l.codigo, l.nome, l.tipoProduto])).toEqual([
      ["JAD", "Ed. Jade", "vertical"],
    ]);
  });

  it("cadastro nulo ou vazio: nenhuma linha", () => {
    expect(linhasSoDoPanteon({ cadastro: null, catalogo: [], permitidos: ["100000"] })).toEqual([]);
    expect(linhasSoDoPanteon({ cadastro: [], catalogo: [], permitidos: ["100000"] })).toEqual([]);
  });
});

describe("alcanceDaSessao", () => {
  it("o GRUPO abre as divisões; a divisão vale só por ela; o produto do Panteon vale por ele", () => {
    expect([...alcanceDaSessao(CATALOGO, ["group:Lagoa Bonita"])].sort()).toEqual(
      ["27", "32", "33", "group:Lagoa Bonita"].sort(),
    );
    expect([...alcanceDaSessao(CATALOGO, ["33"])]).toEqual(["33"]);
    expect([...alcanceDaSessao(CATALOGO, ["100000"])]).toEqual(["100000"]);
  });
});

describe("tipoDoIdDeUnidade", () => {
  it("número inteiro positivo é do C2X; uuid é do Panteon; o resto não é id", () => {
    expect(tipoDoIdDeUnidade(123)).toBe("c2x");
    expect(tipoDoIdDeUnidade(" 123 ")).toBe("c2x");
    expect(tipoDoIdDeUnidade("0b6c9d9e-5b1a-4a39-9c1e-2d3f4a5b6c7d")).toBe("panteon");
    expect(tipoDoIdDeUnidade("0B6C9D9E-5B1A-4A39-9C1E-2D3F4A5B6C7D")).toBe("panteon");
    for (const lixo of [0, -4, 1.5, "0", "12.5", "", "abc", "JAD-A-304", null, undefined, {}]) {
      expect(tipoDoIdDeUnidade(lixo)).toBeNull();
    }
  });
});

describe("codigosDaSessao (com as fontes mockadas)", () => {
  it("sessão só com produto do Panteon", async () => {
    expect(await codigosDaSessao(sessao(["100000"]))).toEqual(["JAD"]);
  });

  it("sessão mista, com e sem pedido", async () => {
    const s = sessao(["37", "100000"]);
    expect(await codigosDaSessao(s)).toEqual(["VOC", "JAD"]);
    expect(await codigosDaSessao(s, "100000")).toEqual(["JAD"]);
    // Pedido de fora da sessão some, não vaza.
    expect(await codigosDaSessao(s, "100001")).toEqual([]);
  });

  it("⚠️ C2X fora do ar: a sessão só do Panteon continua saindo; a mista sai vazia (503 na rota)", async () => {
    estado.catalogo = [];
    expect(await codigosDaSessao(sessao(["100000"]))).toEqual(["JAD"]);
    expect(await codigosDaSessao(sessao(["37", "100000"]))).toEqual([]);
  });

  it("⚠️ cadastro fora do ar: o C2X continua respondendo, e a queda vai para o log", async () => {
    estado.cadastroFora = true;
    expect(await codigosDaSessao(sessao(["37", "100000"]))).toEqual(["VOC"]);
    expect(console.error).toHaveBeenCalled();
  });

  it("idempotente com a soma que as rotas da ficha ainda fazem (`propriosDoPortal`)", async () => {
    const s = sessao(["37", "9001", "100000"]);
    const codesAutorizados = await codigosDaSessao(s);
    const r = montarPropriosDoPortal({
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codesAutorizados,
      idsDaSessao: s.enterpriseIds,
    });
    expect([...r.codesComProprios].sort()).toEqual(["JAD", "TST", "VOC"]);
    expect(new Set(r.codesComProprios).size).toBe(r.codesComProprios.length);
  });
});

describe("unidadeNoEscopo", () => {
  const UUID_JADE = "0b6c9d9e-5b1a-4a39-9c1e-2d3f4a5b6c7d";
  const UUID_RUBI = "7f1e2d3c-4b5a-4968-8776-655443322110";

  it("⚠️ unidade de `hercules_unidades` do produto do Panteon da sessão passa", async () => {
    estado.unidades.set(UUID_JADE, "100000");
    expect(await unidadeNoEscopo(UUID_JADE, sessao(["100000"]))).toBe(true);
    // E não foi ao MySQL: a unidade do Panteon não existe lá.
    expect(estado.consultasMysql).toBe(0);
  });

  it("⚠️ unidade de outro produto do Panteon NÃO passa", async () => {
    estado.unidades.set(UUID_RUBI, "100001");
    expect(await unidadeNoEscopo(UUID_RUBI, sessao(["100000"]))).toBe(false);
  });

  it("uuid que não existe, ou leitura com erro: fail-closed", async () => {
    expect(await unidadeNoEscopo(UUID_JADE, sessao(["100000"]))).toBe(false);
    estado.unidades.set(UUID_JADE, "100000");
    estado.supabaseErro = true;
    expect(await unidadeNoEscopo(UUID_JADE, sessao(["100000"]))).toBe(false);
  });

  it("C2X fora do ar não derruba a unidade do Panteon", async () => {
    estado.catalogo = [];
    estado.mysqlFora = true;
    estado.unidades.set(UUID_JADE, "100000");
    expect(await unidadeNoEscopo(UUID_JADE, sessao(["100000"]))).toBe(true);
  });

  it("id numérico continua no MySQL, com a assimetria do grupo", async () => {
    estado.donoNoMysql = 27;
    expect(await unidadeNoEscopo(123, sessao(["group:Lagoa Bonita"]))).toBe(true);
    expect(await unidadeNoEscopo(123, sessao(["33"]))).toBe(false);
    expect(estado.consultasSupabase).toBe(0);
  });

  it("MySQL fora do ar: unidade do C2X não passa (como sempre)", async () => {
    estado.mysqlFora = true;
    estado.donoNoMysql = 37;
    expect(await unidadeNoEscopo(123, sessao(["37"]))).toBe(false);
  });

  it("id que não é id não consulta nada", async () => {
    expect(await unidadeNoEscopo("JAD-A-304", sessao(["100000"]))).toBe(false);
    expect(estado.consultasMysql + estado.consultasSupabase).toBe(0);
  });
});
