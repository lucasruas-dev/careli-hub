import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "./cadastro";

// O CADASTRO DE UNIDADES NO PANTEON, com o banco simulado em memória.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • o tipo do produto vem do cadastro (loteamento grava quadra/lote, prédio grava torre/apartamento
//     e nunca quadra/lote), mesmo que o corpo diga outra coisa;
//   • duplicado é pego nas três direções: repetido na planilha, já no produto (pelo código e pelas
//     partes) e na gleba irmã do mesmo loteamento;
//   • importar é tudo ou nada: com uma linha ruim, zero insert; com todas boas, UM insert, relido;
//   • atualizar nunca manda `situacao` para o banco, e recusa o corpo que tenta;
//   • a guarda da porta vem antes de qualquer resposta que revele o produto;
//   • só produto nascido no Panteon recebe unidade, e o portal só opera produto MARCADO com o
//     incorporador da sessão (sem marca = a Careli opera = recusa).

const UUID_AUTOR = "11111111-1111-4111-8111-111111111111";
const U_APTO = "aaaaaaaa-0000-4000-8000-000000000001";
const U_LOTE_LIVRE = "aaaaaaaa-0000-4000-8000-000000000002";
const U_LOTE_RESERVADO = "aaaaaaaa-0000-4000-8000-000000000003";
const U_LOTE_COM_PROPOSTA = "aaaaaaaa-0000-4000-8000-000000000004";
const U_DO_C2X = "aaaaaaaa-0000-4000-8000-000000000005";
const U_ESPELHO = "aaaaaaaa-0000-4000-8000-000000000006";
const U_GARDEN_DA_CARGA = "aaaaaaaa-0000-4000-8000-000000000007";
const U_VOC_DA_CARGA = "aaaaaaaa-0000-4000-8000-000000000008";

type Linha = Record<string, unknown>;
type Chamada = {
  colunas: string;
  faixa: [number, number] | null;
  filtros: Array<[string, string, unknown]>;
  limite: null | number;
  operacao: "insert" | "select" | "update";
  payload: unknown;
  tabela: string;
};

const estado = vi.hoisted(() => ({
  cadastro: [] as unknown[],
  cadastroFora: false,
  chamadas: [] as unknown[],
  com0170: true,
  comSupabase: true,
  erroNaLeituraDe: null as null | string,
  categorias: [] as Record<string, unknown>[],
  erroNoInsert: null as null | { code: string; message: string },
  propostas: [] as Record<string, unknown>[],
  reservas: [] as Record<string, unknown>[],
  semColunasVerticais: false,
  unidades: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/apolo/server", () => {
  const VERTICAIS = ["torre", "andar", "apartamento", "tipologia", "vagas"];

  function consulta(tabela: string) {
    const reg: Chamada = {
      colunas: "",
      faixa: null,
      filtros: [],
      limite: null,
      operacao: "select",
      payload: undefined,
      tabela,
    };
    estado.chamadas.push(reg);

    const tabelaViva = () =>
      tabela === "hercules_unidades"
        ? estado.unidades
        : tabela === "hercules_propostas"
          ? estado.propostas
          : tabela === "hercules_reservas"
            ? estado.reservas
            : tabela === "temis_categorias"
              ? estado.categorias
              : [];

    const casa = (linha: Linha) =>
      reg.filtros.every(([tipo, coluna, valor]) => {
        if (tipo === "eq") return String(linha[coluna]) === String(valor);
        if (tipo === "in") return (valor as unknown[]).map(String).includes(String(linha[coluna]));
        if (tipo === "not-in") return !(valor as string[]).includes(String(linha[coluna]));
        return true;
      });

    const ausenteEm = (chaves: string[]) =>
      estado.semColunasVerticais ? VERTICAIS.find((c) => chaves.includes(c)) : undefined;

    const executar = (): { data: unknown; error: null | { code: string; message: string } } => {
      if (reg.operacao === "insert") {
        const linhas = reg.payload as Linha[];
        if (estado.erroNoInsert) return { data: null, error: estado.erroNoInsert };
        const ausente = ausenteEm(linhas.flatMap((l) => Object.keys(l)));
        if (ausente) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              message: `Could not find the '${ausente}' column of 'hercules_unidades' in the schema cache`,
            },
          };
        }
        const chaves = new Set(estado.unidades.map((u) => `${u.workspace_id}|${u.enterprise_id}|${u.codigo}`));
        for (const l of linhas) {
          const chave = `${l.workspace_id}|${l.enterprise_id}|${l.codigo}`;
          if (chaves.has(chave)) {
            return { data: null, error: { code: "23505", message: "duplicate key hercules_unidades_codigo_unico" } };
          }
          chaves.add(chave);
        }
        linhas.forEach((l, i) =>
          estado.unidades.push({ ...l, id: `bbbbbbbb-0000-4000-8000-${String(estado.unidades.length + i).padStart(12, "0")}` }),
        );
        return { data: null, error: null };
      }

      if (reg.operacao === "update") {
        const ausente = ausenteEm(Object.keys(reg.payload as Linha));
        if (ausente) {
          return { data: null, error: { code: "PGRST204", message: `Could not find the '${ausente}' column` } };
        }
        const alvo = tabelaViva().filter(casa);
        for (const l of alvo) Object.assign(l, reg.payload);
        return { data: alvo.map((l) => ({ id: l.id })), error: null };
      }

      if (estado.erroNaLeituraDe === tabela) {
        return { data: null, error: { code: "57014", message: `timeout lendo ${tabela}` } };
      }
      const ausente = ausenteEm(reg.colunas.split(","));
      if (ausente) {
        return { data: null, error: { code: "42703", message: `column hercules_unidades.${ausente} does not exist` } };
      }
      let linhas = tabelaViva().filter(casa);
      if (reg.faixa) linhas = linhas.slice(reg.faixa[0], reg.faixa[1] + 1);
      if (reg.limite !== null) linhas = linhas.slice(0, reg.limite);
      return { data: linhas.map((l) => ({ ...l })), error: null };
    };

    const construtor = {
      eq: (coluna: string, valor: unknown) => {
        reg.filtros.push(["eq", coluna, valor]);
        return construtor;
      },
      in: (coluna: string, valor: unknown[]) => {
        reg.filtros.push(["in", coluna, valor]);
        return construtor;
      },
      insert: (linhas: unknown) => {
        reg.operacao = "insert";
        reg.payload = linhas;
        return construtor;
      },
      limit: (n: number) => {
        reg.limite = n;
        return construtor;
      },
      maybeSingle: async () => {
        const r = executar();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      not: (coluna: string, _operador: string, lista: string) => {
        reg.filtros.push(["not-in", coluna, lista.replace(/[()"]/g, "").split(",")]);
        return construtor;
      },
      order: () => construtor,
      range: (de: number, ate: number) => {
        reg.faixa = [de, ate];
        return construtor;
      },
      select: (colunas = "*") => {
        if (reg.operacao === "select") reg.colunas = colunas;
        return construtor;
      },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, falhou),
      update: (patch: unknown) => {
        reg.operacao = "update";
        reg.payload = patch;
        return construtor;
      },
    };
    return construtor;
  }

  return { createApoloAdminClient: () => (estado.comSupabase ? { from: consulta } : null) };
});

vi.mock("./cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => {
    if (estado.cadastroFora) throw new Error("supabase fora");
    return estado.cadastro;
  },
  lerCadastroDeEmpreendimentos: async () => {
    if (estado.cadastroFora) throw new Error("supabase fora");
    return { com0170: estado.com0170, linhas: estado.cadastro };
  },
}));

import {
  autorGravavel,
  conferirContraOBanco,
  emLotes,
  executarCadastroDeUnidades,
  linhaNaChaveDoTipo,
  linhaParaGravar,
  linhasDoPedido,
  MAXIMO_DE_UNIDADES_POR_ENVIO,
  montarAtualizacao,
  PRODUTO_NAO_ENCONTRADO,
  type ProdutoDoCadastro,
  produtoNoRecorteDoPortal,
  produtoRecebeUnidade,
  resolverProduto,
  SITUACAO_E_IDENTIDADE_NAO_MUDAM,
  type UnidadeDoBanco,
} from "./cadastrar-unidades-panteon-server";

// ───────────────────────────────────────────────────────────────────────────────────────────────

function produtoDoCadastro(sobre: Partial<LinhaDoCadastro> & { c2xEnterpriseId: null | string; codigo: string; id: string }): LinhaDoCadastro {
  return {
    cidade: null,
    nome: sobre.codigo,
    operadoPor: null,
    ordem: 0,
    paiId: null,
    tipoProduto: "loteamento",
    uf: null,
    vendendo: true,
    ...sobre,
  };
}

const CADASTRO: LinhaDoCadastro[] = [
  produtoDoCadastro({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo" }),
  produtoDoCadastro({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", paiId: "vlo" }),
  produtoDoCadastro({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", paiId: "vlo" }),
  // O Garden veio do C2X e é operado pela Cecílio (D1/D2, 16/09/2026); o VOC acima é da Careli.
  produtoDoCadastro({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", operadoPor: "inc-cecilio" }),
  produtoDoCadastro({ c2xEnterpriseId: "100002", codigo: "SOL", id: "sol", operadoPor: "inc-cecilio" }),
  // Um loteamento do Panteon dividido em glebas: o pai com id próprio e duas glebas.
  produtoDoCadastro({ c2xEnterpriseId: "100020", codigo: "VSP", id: "vsp", operadoPor: "inc-cecilio" }),
  produtoDoCadastro({ c2xEnterpriseId: "100021", codigo: "VSA", id: "vsa", operadoPor: "inc-cecilio", paiId: "vsp" }),
  produtoDoCadastro({ c2xEnterpriseId: "100022", codigo: "VSB", id: "vsb", operadoPor: "inc-lino", paiId: "vsp" }),
  produtoDoCadastro({ c2xEnterpriseId: "100001", codigo: "JAD", id: "jad", operadoPor: "inc-cecilio", tipoProduto: "vertical" }),
  produtoDoCadastro({ c2xEnterpriseId: "100003", codigo: "", id: "semcodigo" }),
  produtoDoCadastro({ c2xEnterpriseId: null, codigo: "LOX", id: "lox" }),
];

function unidade(sobre: Record<string, unknown>): Record<string, unknown> {
  return {
    area: 300,
    espelho_de: null,
    matricula: "1.234",
    origem_c2x_id: null,
    preco_tabela: 100000,
    situacao: "disponivel",
    workspace_id: "careli",
    ...sobre,
  };
}

function unidadesIniciais(): Record<string, unknown>[] {
  return [
    unidade({ codigo: "SOL0101", enterprise_id: "100002", id: U_DO_C2X, lote: "01", origem_c2x_id: 5001, quadra: "01" }),
    unidade({ codigo: "SOL0202", enterprise_id: "100002", id: U_LOTE_LIVRE, lote: "02", quadra: "02" }),
    unidade({ codigo: "SOL0203", enterprise_id: "100002", id: U_LOTE_RESERVADO, lote: "03", quadra: "02", situacao: "reservada" }),
    unidade({ codigo: "SOL0204", enterprise_id: "100002", id: U_LOTE_COM_PROPOSTA, lote: "04", quadra: "02" }),
    unidade({ codigo: "SOL0205", enterprise_id: "100002", espelho_de: U_LOTE_LIVRE, id: U_ESPELHO, lote: "05", quadra: "02" }),
    // A unidade do C2X com nome fora do padrão: o código não casa, as partes sim.
    unidade({ codigo: "SOLAR-Q9-L9", enterprise_id: "100002", id: "c2x-fora", lote: "09", origem_c2x_id: 5002, quadra: "09" }),
    unidade({ codigo: "VOL0305", enterprise_id: "36", id: "vol-0305", lote: "05", quadra: "03" }),
    // As unidades que vieram da carga do C2X: uma no Garden (com dono) e uma no VOC (sem dono).
    unidade({ codigo: "GDN0101", enterprise_id: "39", id: U_GARDEN_DA_CARGA, lote: "01", origem_c2x_id: 7001, quadra: "01" }),
    unidade({ codigo: "VOC0101", enterprise_id: "37", id: U_VOC_DA_CARGA, lote: "01", origem_c2x_id: 7002, quadra: "01" }),
    unidade({ codigo: "VLO0710", enterprise_id: "35", id: "vlo-0710", lote: "10", quadra: "07" }),
    unidade({ codigo: "VSB0305", enterprise_id: "100022", id: "vsb-0305", lote: "05", quadra: "03" }),
    unidade({ codigo: "VSP0710", enterprise_id: "100020", id: "vsp-0710", lote: "10", quadra: "07" }),
    unidade({
      andar: 3,
      apartamento: "304",
      area: 68.45,
      codigo: "JAD-A-304",
      enterprise_id: "100001",
      id: U_APTO,
      lote: null,
      preco_tabela: 450000,
      quadra: null,
      tipologia: "2 quartos",
      torre: "A",
      vagas: 1,
    }),
  ];
}

const chamadas = () => estado.chamadas as Chamada[];
const inserts = () => chamadas().filter((c) => c.operacao === "insert");
const updates = () => chamadas().filter((c) => c.operacao === "update");

beforeEach(() => {
  estado.cadastro = CADASTRO;
  estado.cadastroFora = false;
  estado.categorias = [];
  estado.chamadas = [];
  estado.com0170 = true;
  estado.comSupabase = true;
  estado.erroNaLeituraDe = null;
  estado.erroNoInsert = null;
  estado.propostas = [
    { etapa: "cancelado", id: "p-morta", unidade_id: U_LOTE_LIVRE, workspace_id: "careli" },
    { etapa: "proposta", id: "p-viva", unidade_id: U_LOTE_COM_PROPOSTA, workspace_id: "careli" },
  ];
  estado.reservas = [
    { id: "r-cancelada", situacao: "cancelada", unidade_id: U_LOTE_LIVRE, workspace_id: "careli" },
  ];
  estado.semColunasVerticais = false;
  estado.unidades = unidadesIniciais();
});

const AUTOR = { id: UUID_AUTOR, nome: "Time Cecílio" };
const AGORA = new Date("2026-09-16T12:00:00.000Z");

function executar(
  pedido: string,
  corpo: unknown,
  podeOperar?: (p: ProdutoDoCadastro, contexto: { com0170: boolean }) => boolean,
) {
  return executarCadastroDeUnidades({ agora: AGORA, autor: AUTOR, corpo, pedido, podeOperar });
}

// ─── REGRAS PURAS ──────────────────────────────────────────────────────────────────────────────

describe("resolverProduto", () => {
  it("acha o produto pelo id e pelo pai do cadastro, com o tipo do cadastro", () => {
    const porId = resolverProduto(CADASTRO, "100001");
    expect(porId.ok && porId.produto).toMatchObject({
      codigo: "JAD",
      enterpriseId: "100001",
      operadoPor: "inc-cecilio",
      tipoProduto: "vertical",
    });

    const porPai = resolverProduto(CADASTRO, "pai:sol");
    expect(porPai.ok && porPai.produto.enterpriseId).toBe("100002");
  });

  it("a família de uma gleba é o pai e as irmãs, sem ela mesma", () => {
    const voc = resolverProduto(CADASTRO, "37");
    expect(voc.ok && [...voc.familia].sort()).toEqual(["35", "36"]);

    const garden = resolverProduto(CADASTRO, "39");
    expect(garden.ok && garden.familia).toEqual([]);
  });

  it("404 para o que não aponta um produto com id: inexistente, pai sem id, grupo, vazio", () => {
    for (const pedido of ["99", "pai:lox", "pai:nao-existe", "group:Vale do Ouro", "", null]) {
      const r = resolverProduto(CADASTRO, pedido);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.status).toBe(404);
      expect(!r.ok && r.error).toBe(PRODUTO_NAO_ENCONTRADO);
    }
  });
});

describe("produtoRecebeUnidade", () => {
  const produto = (id: string) => {
    const r = resolverProduto(CADASTRO, id);
    if (!r.ok) throw new Error("fixture");
    return r.produto;
  };

  it("⚠️ produto dividido em glebas recusa (a unidade mora na gleba)", () => {
    expect(produtoRecebeUnidade(CADASTRO, produto("35"), "criar")?.status).toBe(409);
  });

  it("produto sem código recusa (o código da unidade nasce dele)", () => {
    expect(produtoRecebeUnidade(CADASTRO, produto("100003"), "importar")?.status).toBe(409);
  });

  it("a gleba e o produto único nascidos no Panteon aceitam", () => {
    for (const acao of ["atualizar", "conferir", "criar", "importar", "modelo"] as const) {
      expect(produtoRecebeUnidade(CADASTRO, produto("100021"), acao)).toBeNull();
      expect(produtoRecebeUnidade(CADASTRO, produto("100001"), acao)).toBeNull();
      expect(produtoRecebeUnidade(CADASTRO, produto("100002"), acao)).toBeNull();
    }
  });

  it("⚠️ produto do C2X (VOC 37, Garden 39) não recebe unidade: o estoque dele ainda tem outra fonte", () => {
    for (const [id, acao] of [["37", "criar"], ["39", "criar"], ["39", "importar"], ["39", "conferir"], ["37", "atualizar"], ["37", "modelo"]] as const) {
      const recusa = produtoRecebeUnidade(CADASTRO, produto(id), acao);
      expect(recusa?.status).toBe(409);
      expect(recusa?.error).toBe("O estoque deste empreendimento ainda é mantido pela Careli. Peça a inclusão da unidade a ela.");
      // O texto do portal não nomeia sistema; o detalhe técnico fica para o log e o hub.
      expect(recusa?.error).not.toMatch(/C2X/);
      expect(recusa?.detalhe).toMatch(/duas fontes/);
    }
  });

  it("⚠️ D2: no produto do C2X COM dono (o Garden da Cecílio), corrigir o que existe passa; criar não", () => {
    expect(produtoRecebeUnidade(CADASTRO, produto("39"), "atualizar")).toBeNull();
    expect(produtoRecebeUnidade(CADASTRO, produto("39"), "modelo")).toBeNull();
    expect(produtoRecebeUnidade(CADASTRO, produto("39"), "criar")?.status).toBe(409);
  });
});

describe("produtoNoRecorteDoPortal", () => {
  const recorte = {
    com0170: true,
    incorporadorId: "inc-cecilio",
    permitidos: new Set(["37", "39", "100001"]),
    slug: "cecilio-rocha",
    tipo: "incorporador",
  };

  it("⚠️ produto sem marca de operador é da Careli: o portal NÃO opera, nem com o id na sessão", () => {
    expect(produtoNoRecorteDoPortal({ enterpriseId: "37", operadoPor: null }, recorte)).toBe(false);
    expect(produtoNoRecorteDoPortal({ enterpriseId: "100001", operadoPor: "" }, recorte)).toBe(false);
    expect(produtoNoRecorteDoPortal({ enterpriseId: "100001", operadoPor: null }, { ...recorte, incorporadorId: "" })).toBe(false);
  });

  it("⚠️ é a régua única do portal: comercial nunca, portal padrão nunca, sem a 0170 ninguém", () => {
    const daCecilio = { enterpriseId: "39", operadoPor: "inc-cecilio" };
    expect(produtoNoRecorteDoPortal(daCecilio, recorte)).toBe(true);
    expect(produtoNoRecorteDoPortal(daCecilio, { ...recorte, slug: "gurgel", tipo: "comercial" })).toBe(false);
    expect(produtoNoRecorteDoPortal(daCecilio, { ...recorte, slug: "cer" })).toBe(false);
    expect(produtoNoRecorteDoPortal(daCecilio, { ...recorte, com0170: false })).toBe(false);
  });

  it("⚠️ fora da sessão é fora, com ou sem marca", () => {
    expect(produtoNoRecorteDoPortal({ enterpriseId: "36", operadoPor: null }, recorte)).toBe(false);
    expect(produtoNoRecorteDoPortal({ enterpriseId: "36", operadoPor: "inc-cecilio" }, recorte)).toBe(false);
  });

  it("⚠️ produto operado por OUTRO incorporador é fora, mesmo na sessão", () => {
    expect(produtoNoRecorteDoPortal({ enterpriseId: "100001", operadoPor: "inc-gurgel" }, recorte)).toBe(false);
    expect(produtoNoRecorteDoPortal({ enterpriseId: "100001", operadoPor: "inc-cecilio" }, recorte)).toBe(true);
  });
});

describe("linhaNaChaveDoTipo", () => {
  it("⚠️ 'area' é a área privativa no prédio, e o cabeçalho cru também vale", () => {
    expect(linhaNaChaveDoTipo("vertical", { Apto: "0304", area: "68,45", Torre: "a" })).toEqual({
      apartamento: "0304",
      areaPrivativa: "68,45",
      torre: "a",
    });
    expect(linhaNaChaveDoTipo("loteamento", { "Área (m²)": "300", Lote: "7", Quadra: "1" })).toEqual({
      area: "300",
      lote: "7",
      quadra: "1",
    });
  });

  it("a chave exata vence a traduzida, e o que não é do tipo sai", () => {
    expect(linhaNaChaveDoTipo("vertical", { "Área (m²)": "70", areaPrivativa: "68", quadra: "01" })).toEqual({
      areaPrivativa: "68",
    });
    expect(linhaNaChaveDoTipo("loteamento", { apartamento: "304", quadra: "01", tipoProduto: "vertical" })).toEqual({
      quadra: "01",
    });
  });

  it("o que não é objeto vira linha vazia", () => {
    expect(linhaNaChaveDoTipo("loteamento", null)).toEqual({});
    expect(linhaNaChaveDoTipo("loteamento", ["01", "07"])).toEqual({});
  });
});

describe("linhasDoPedido", () => {
  it("lê o CSV com o tipo do produto", () => {
    const r = linhasDoPedido("vertical", { csv: "Torre;Andar;Apto;Área privativa\nA;3;304;68,45\n" });
    expect(r.ok && r.linhas).toEqual([{ andar: "3", apartamento: "304", areaPrivativa: "68,45", torre: "A" }]);
  });

  it("aceita as linhas lidas pela tela e tira as em branco", () => {
    const r = linhasDoPedido("loteamento", { linhas: [{ lote: "1", quadra: "1" }, { lote: "", quadra: " " }, "lixo"] });
    expect(r.ok && r.linhas).toEqual([{ lote: "1", quadra: "1" }]);
  });

  it("vazio e acima do teto são 400", () => {
    expect(linhasDoPedido("loteamento", {}).ok).toBe(false);
    const muitas = Array.from({ length: MAXIMO_DE_UNIDADES_POR_ENVIO + 1 }, (_, i) => ({ lote: String(i), quadra: "1" }));
    const r = linhasDoPedido("loteamento", { linhas: muitas });
    expect(!r.ok && r.status).toBe(400);
  });
});

describe("conferirContraOBanco", () => {
  const existentes = unidadesIniciais().map((u) => ({
    apartamento: (u.apartamento as null | string) ?? null,
    codigo: String(u.codigo),
    enterpriseId: String(u.enterprise_id),
    lote: (u.lote as null | string) ?? null,
    quadra: (u.quadra as null | string) ?? null,
    torre: (u.torre as null | string) ?? null,
  }));
  const doGarden = existentes.filter((u) => u.enterpriseId === "100002");

  it("loteamento: ok, aviso, repetida na planilha, já no produto pelo código e pelas partes", () => {
    const c = conferirContraOBanco(
      "loteamento",
      [
        { area: "300", lote: "1", matricula: "10", preco: "100.000,00", quadra: "3" }, // 2: ok
        { area: "300", lote: "2", matricula: "11", quadra: "3" }, // 3: aviso (sem preço)
        { area: "300", lote: "01", matricula: "12", preco: "1", quadra: "03" }, // 4: repetida da 2
        { area: "300", lote: "02", matricula: "13", preco: "1", quadra: "02" }, // 5: SOL0202 existe
        { area: "300", lote: "9", matricula: "14", preco: "1", quadra: "9" }, // 6: partes do nome fora do padrão
        { area: "", lote: "3", quadra: "3" }, // 7: área inválida
      ],
      { prefixo: "SOL", proprias: doGarden },
    );

    expect(c.linhas.map((l) => l.resultado)).toEqual(["ok", "aviso", "erro", "erro", "erro", "erro"]);
    expect(c.linhas[0]).toMatchObject({ codigo: "SOL0301", rotulo: "Quadra 03 · Lote 01" });
    expect(c.linhas[2]?.problemas[0]?.motivo).toContain("Repetida");
    expect(c.linhas[3]?.problemas.map((p) => p.motivo)).toEqual([
      "Quadra 02 · Lote 02 já está cadastrada neste produto (SOL0202).",
    ]);
    expect(c.linhas[4]?.problemas[0]?.motivo).toContain("(SOLAR-Q9-L9)");
    expect(c.linhas[5]?.unidade).toBeNull();
    expect(c.prontas.map((u) => u.codigo)).toEqual(["SOL0301", "SOL0302"]);
    expect(c.resumo).toEqual({
      comAviso: 1,
      comCategoria: 0,
      comErro: 4,
      jaExistem: 2,
      prontas: 2,
      total: 6,
    });
  });

  it("⚠️ loteamento: o terreno que já existe na gleba irmã ou no pai não entra de novo", () => {
    const c = conferirContraOBanco(
      "loteamento",
      [
        { area: "300", lote: "5", matricula: "1", preco: "1", quadra: "3" },
        { area: "300", lote: "10", matricula: "1", preco: "1", quadra: "7" },
        { area: "300", lote: "11", matricula: "1", preco: "1", quadra: "7" },
      ],
      {
        familia: existentes.filter((u) => u.enterpriseId === "35" || u.enterpriseId === "36"),
        prefixo: "VOC",
        proprias: [],
      },
    );
    expect(c.linhas.map((l) => l.resultado)).toEqual(["erro", "erro", "ok"]);
    expect(c.linhas[0]?.problemas[0]?.motivo).toBe(
      "Quadra 03 · Lote 05 já existe neste loteamento. O mesmo terreno não pode ser cadastrado duas vezes.",
    );
    // ⚠️ Sem o código da gêmea: a gleba irmã pode ser de outro dono, e o código listaria o estoque dela.
    expect(JSON.stringify(c.linhas)).not.toMatch(/VOL0305|VLO0710/);
  });

  it("⚠️ loteamento: o mesmo código com outras partes não é 'já cadastrada', é código que colide", () => {
    const c = conferirContraOBanco(
      "loteamento",
      [{ area: "300", lote: "11", matricula: "1", preco: "1", quadra: "010" }],
      { prefixo: "SOL", proprias: [{ codigo: "SOL01011", enterpriseId: "100002", lote: "011", quadra: "01" }] },
    );
    expect(c.linhas[0]?.resultado).toBe("erro");
    expect(c.linhas[0]?.problemas[0]?.motivo).toBe(
      "Quadra 010 · Lote 11 gera o código SOL01011, que já é de outra unidade deste produto. Confira a quadra e o lote.",
    );
  });

  it("vertical: torre+apartamento já existente, 0304 = 304 repetido, torre diferente é outra unidade", () => {
    const c = conferirContraOBanco(
      "vertical",
      [
        { andar: "3", apartamento: "304", areaPrivativa: "68", matricula: "1", preco: "1", torre: "Torre A" },
        { andar: "3", apartamento: "304", areaPrivativa: "68", matricula: "1", preco: "1", torre: "B" },
        { andar: "3", apartamento: "0304", areaPrivativa: "68", matricula: "1", preco: "1", torre: "b" },
      ],
      { prefixo: "JAD", proprias: existentes.filter((u) => u.enterpriseId === "100001") },
    );
    expect(c.linhas.map((l) => l.resultado)).toEqual(["erro", "ok", "erro"]);
    expect(c.linhas[0]?.problemas[0]?.motivo).toBe("Torre A · Apto 304 já está cadastrada neste produto (JAD-A-304).");
    expect(c.linhas[1]).toMatchObject({ codigo: "JAD-B-304", rotulo: "Torre B · Apto 304" });
    expect(c.linhas[2]?.problemas[0]?.motivo).toContain("Repetida");
  });

  it("vertical não cruza com a família: o 101 de um prédio não é o 101 de outro", () => {
    const c = conferirContraOBanco(
      "vertical",
      [{ andar: "1", apartamento: "101", areaPrivativa: "50", matricula: "1", preco: "1" }],
      {
        familia: [{ apartamento: "101", codigo: "OUTRO-101", enterpriseId: "999", torre: null }],
        prefixo: "JAD",
      },
    );
    expect(c.linhas[0]?.resultado).toBe("ok");
  });
});

describe("autorGravavel e linhaParaGravar", () => {
  it("⚠️ id que não é uuid sai nulo (bloqueado_por é uuid), o nome fica", () => {
    expect(autorGravavel({ id: "local-hub-user", nome: " Lucas " })).toEqual({ id: null, nome: "Lucas" });
    expect(autorGravavel({ id: UUID_AUTOR, nome: null })).toEqual({ id: UUID_AUTOR, nome: null });
    expect(autorGravavel(null)).toEqual({ id: null, nome: null });
  });

  it("lote: tipo_unidade 'lote', origem nula, carimbo quando nasce bloqueada", () => {
    const c = conferirContraOBanco(
      "loteamento",
      [{ area: "300", lote: "1", matricula: "1", motivoDoBloqueio: "Permuta", preco: "1", quadra: "1", situacao: "Bloqueada" }],
      { prefixo: "SOL" },
    );
    const pronta = c.prontas[0];
    if (!pronta) throw new Error("fixture");
    expect(linhaParaGravar(pronta, { agora: AGORA, autor: { id: "x", nome: "Fulano" }, produto: { codigo: "SOL", enterpriseId: "100002" } })).toMatchObject({
      bloqueado_em: AGORA.toISOString(),
      bloqueado_por: null,
      bloqueado_por_nome: "Fulano",
      bloqueio_motivo: "Permuta",
      codigo: "SOL0101",
      enterprise_id: "100002",
      origem_c2x_id: null,
      situacao: "bloqueada",
      tipo_unidade: "lote",
    });
  });
});

describe("montarAtualizacao", () => {
  const lote: UnidadeDoBanco = {
    area: 300,
    codigo: "SOL0202",
    enterprise_id: "100002",
    espelho_de: null,
    id: U_LOTE_LIVRE,
    lote: "02",
    matricula: "1.234",
    origem_c2x_id: null,
    preco_tabela: 100000,
    quadra: "02",
    situacao: "reservada",
  };
  const apto: UnidadeDoBanco = {
    andar: 3,
    apartamento: "304",
    area: 68.45,
    codigo: "JAD-A-304",
    enterprise_id: "100001",
    espelho_de: null,
    id: U_APTO,
    lote: null,
    matricula: null,
    origem_c2x_id: null,
    preco_tabela: 450000,
    quadra: null,
    situacao: "disponivel",
    tipologia: "2 quartos",
    torre: "A",
    vagas: 1,
  };

  it("⚠️ situação no corpo é recusada, e nunca aparece no patch", () => {
    for (const campos of [{ situacao: "disponivel" }, { motivoDoBloqueio: "x" }, { preco: "1", situacao: "vendida" }]) {
      const r = montarAtualizacao("loteamento", lote, campos);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("situação");
    }
    const ok = montarAtualizacao("loteamento", lote, { matricula: "9.999", preco: "120.000,00" });
    expect(ok.ok && Object.keys(ok.patch)).not.toContain("situacao");
  });

  it("quadra, lote, torre e apartamento não mudam; campo de prédio não vale para lote; campo estranho é 400", () => {
    expect(montarAtualizacao("loteamento", lote, { quadra: "03" }).ok).toBe(false);
    expect(montarAtualizacao("vertical", apto, { apartamento: "305" }).ok).toBe(false);
    const vagas = montarAtualizacao("loteamento", lote, { vagas: 2 });
    expect(!vagas.ok && vagas.error).toBe("O campo vagas não se aplica a loteamento.");
    const estranho = montarAtualizacao("loteamento", lote, { cor: "azul" });
    expect(!estranho.ok && estranho.error).toBe("Campo desconhecido: cor.");
    expect(montarAtualizacao("loteamento", lote, {}).ok).toBe(false);
    expect(montarAtualizacao("loteamento", lote, null).ok).toBe(false);
  });

  it("preço muda com o extenso limpo e marca que mexe no valor; matrícula sozinha não mexe", () => {
    const preco = montarAtualizacao("loteamento", lote, { preco: "120.000,00" });
    expect(preco.ok && preco.patch).toEqual({ preco_extenso: null, preco_tabela: 120000 });
    expect(preco.ok && preco.mexeNoValor).toBe(true);

    const matricula = montarAtualizacao("loteamento", lote, { matricula: "25.862" });
    expect(matricula.ok && matricula.patch).toEqual({ matricula: "25.862" });
    expect(matricula.ok && matricula.mexeNoValor).toBe(false);
  });

  it("o mesmo valor não vira patch; preço em branco só na unidade bloqueada", () => {
    const igual = montarAtualizacao("loteamento", lote, { area: "300,00", preco: 100000 });
    expect(igual.ok && igual.patch).toEqual({});

    const semPreco = montarAtualizacao("loteamento", { ...lote, situacao: "bloqueada" }, { preco: "" });
    expect(semPreco.ok && semPreco.patch).toEqual({ preco_extenso: null, preco_tabela: null });
    expect(semPreco.ok && semPreco.avisos).toEqual({
      preco: "Sem valor de tabela: a unidade fica fora da venda e do VGV até alguém preencher o preço.",
    });

    // ⚠️ Disponível (ou reservada) sem preço entraria na Venda a R$ 0.
    for (const situacao of ["disponivel", "reservada"]) {
      const r = montarAtualizacao("loteamento", { ...lote, situacao }, { preco: "" });
      expect(!r.ok && r.status).toBe(422);
      expect(!r.ok && r.data).toEqual({ erros: { preco: expect.stringMatching(/bloqueie a unidade antes/) } });
    }
  });

  it("prédio: 'area' é a área privativa, e tipologia e vagas mudam", () => {
    const r = montarAtualizacao("vertical", apto, { area: "70,10", tipologia: "3 quartos", vagas: "2" });
    expect(r.ok && r.patch).toEqual({ area: 70.1, area_extenso: null, tipologia: "3 quartos", vagas: 2 });
  });

  it("valor inválido é 422 com o erro do campo", () => {
    const r = montarAtualizacao("vertical", apto, { vagas: "1,5" });
    expect(!r.ok && r.status).toBe(422);
    expect(!r.ok && r.data).toEqual({ erros: { vagas: "Vagas precisa ser um número inteiro, zero ou maior." } });
  });
});

describe("emLotes", () => {
  it("divide sem perder nada", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emLotes([], 100)).toEqual([]);
  });
});

// ─── AS AÇÕES, COM O BANCO SIMULADO ────────────────────────────────────────────────────────────

describe("executarCadastroDeUnidades: portas e guardas", () => {
  it("ação desconhecida é 400, sem ler nada", async () => {
    const r = await executar("100002", { acao: "apagar" });
    expect(!r.ok && r.status).toBe(400);
    expect(chamadas()).toHaveLength(0);
  });

  it("⚠️ cadastro lido sem as colunas da 0170 é 503, antes de olhar o produto", async () => {
    estado.com0170 = false;
    const r = await executar("100002", { acao: "importar", linhas: [{ area: "300", lote: "1", preco: "1", quadra: "1" }] });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(!r.ok && r.detalhe).toMatch(/0170/);
    expect(chamadas()).toHaveLength(0);
  });

  it("sem Supabase e com o cadastro fora do ar é 503", async () => {
    estado.cadastroFora = true;
    expect(await executar("100002", { acao: "modelo" })).toMatchObject({ ok: false, status: 503 });
    estado.cadastroFora = false;
    estado.comSupabase = false;
    expect(await executar("100002", { acao: "modelo" })).toMatchObject({ ok: false, status: 503 });
  });

  it("⚠️ a guarda da porta devolve o MESMO 404 do inexistente, antes do 409 das glebas", async () => {
    const naoPode = () => false;
    const foraDoRecorte = await executar("35", { acao: "conferir", linhas: [{ quadra: "1" }] }, naoPode);
    const inexistente = await executar("99", { acao: "conferir", linhas: [{ quadra: "1" }] });
    expect(foraDoRecorte).toEqual({ error: PRODUTO_NAO_ENCONTRADO, ok: false, status: 404 });
    expect(inexistente).toEqual(foraDoRecorte);
    expect(chamadas()).toHaveLength(0);

    const dentro = await executar("35", { acao: "conferir", linhas: [{ quadra: "1" }] }, () => true);
    expect(!dentro.ok && dentro.status).toBe(409);
  });

  it("modelo devolve as colunas do tipo DO CADASTRO", async () => {
    const r = await executar("pai:jad", { acao: "modelo", tipoProduto: "loteamento" });
    expect(r.ok).toBe(true);
    const data = (r as { data: { colunas: Array<{ chave: string }>; produto: unknown } }).data;
    expect(data.produto).toEqual({ codigo: "JAD", enterpriseId: "100001", nome: "JAD", tipoProduto: "vertical" });
    expect(data.colunas.map((c) => c.chave)).toContain("apartamento");
  });
});

describe("executarCadastroDeUnidades: conferir", () => {
  it("julga linha a linha e não escreve nada", async () => {
    const r = await executar("100021", {
      acao: "conferir",
      linhas: [
        { area: "300", lote: "5", matricula: "1", preco: "1", quadra: "3" }, // gêmea da VSB0305
        { area: "300", lote: "6", matricula: "1", preco: "1", quadra: "3" },
        { area: "300", lote: "06", matricula: "1", preco: "1", quadra: "03" },
      ],
    });
    expect(r.ok).toBe(true);
    const data = (r as { data: { bloqueioDaGravacao: unknown; linhas: Array<{ resultado: string }>; unidadesHoje: number } }).data;
    expect(data.linhas.map((l) => l.resultado)).toEqual(["erro", "ok", "erro"]);
    expect(data.bloqueioDaGravacao).toBeNull();
    expect(data.unidadesHoje).toBe(0);
    expect(inserts()).toHaveLength(0);
    expect(updates()).toHaveLength(0);

    // A leitura das existentes cobre o produto e a família, na página e no workspace certos.
    const leitura = chamadas().find((c) => c.tabela === "hercules_unidades");
    expect(leitura?.filtros).toContainEqual(["eq", "workspace_id", "careli"]);
    expect(leitura?.filtros).toContainEqual(["in", "enterprise_id", ["100021", "100020", "100022"]]);
    expect(leitura?.faixa).toEqual([0, 999]);
  });

  it("devolve quantas unidades o produto tem hoje", async () => {
    const r = await executar("100002", { acao: "conferir", linhas: [{ area: "300", lote: "1", preco: "1", quadra: "40" }] });
    expect((r as { data: { unidadesHoje: number } }).data.unidadesHoje).toBe(6);
  });

  it("prédio sem a 0171: a conferência segue pelo código e avisa que a gravação está bloqueada", async () => {
    estado.semColunasVerticais = true;
    const r = await executar("100001", {
      acao: "conferir",
      linhas: [{ andar: "1", apartamento: "101", areaPrivativa: "50", matricula: "1", preco: "1" }],
    });
    expect(r.ok).toBe(true);
    const data = (r as { data: { bloqueioDaGravacao: null | string } }).data;
    expect(data.bloqueioDaGravacao).toBe("O cadastro de apartamentos ainda não está liberado. Fale com a Careli.");
  });
});

describe("executarCadastroDeUnidades: importar", () => {
  it("loteamento: UM insert com a linha certa, relido do banco", async () => {
    const r = await executar("100002", {
      acao: "importar",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Matrícula;Situação;Motivo do bloqueio\n5;1;300,00;150.000,00;9.001;Disponível;\n5;2;310,50;;9.002;Bloqueada;Permuta\n",
      tipoProduto: "vertical", // ⚠️ ignorado: o tipo vem do cadastro
    });

    expect(r.ok).toBe(true);
    expect(inserts()).toHaveLength(1);
    const enviadas = inserts()[0]?.payload as Linha[];
    expect(enviadas).toHaveLength(2);
    expect(enviadas[0]).toEqual({
      area: 300,
      codigo: "SOL0501",
      enterprise_id: "100002",
      lote: "01",
      matricula: "9.001",
      origem_c2x_id: null,
      preco_tabela: 150000,
      quadra: "05",
      situacao: "disponivel",
      tipo_unidade: "lote",
      workspace_id: "careli",
    });
    expect(enviadas[1]).toMatchObject({
      bloqueado_em: AGORA.toISOString(),
      bloqueado_por: UUID_AUTOR,
      bloqueado_por_nome: "Time Cecílio",
      bloqueio_motivo: "Permuta",
      preco_tabela: null,
      situacao: "bloqueada",
    });
    for (const l of enviadas) {
      for (const coluna of ["torre", "andar", "apartamento", "tipologia", "vagas"]) expect(l).not.toHaveProperty(coluna);
    }

    const data = (r as { data: { avisos: unknown[]; criadas: number; unidades: Array<{ codigo: string; id: string; rotulo: string; situacao: string }> } }).data;
    expect(data.criadas).toBe(2);
    expect(data.unidades.map((u) => [u.codigo, u.rotulo, u.situacao])).toEqual([
      ["SOL0501", "Quadra 05 · Lote 01", "disponivel"],
      ["SOL0502", "Quadra 05 · Lote 02", "bloqueada"],
    ]);
    expect(data.unidades.every((u) => u.id.startsWith("bbbbbbbb"))).toBe(true);
    expect(data.avisos.length).toBeGreaterThan(0);

    // A releitura é pelo código, no produto certo.
    const releitura = chamadas().at(-1);
    expect(releitura?.filtros).toContainEqual(["eq", "enterprise_id", "100002"]);
    expect(releitura?.filtros).toContainEqual(["in", "codigo", ["SOL0501", "SOL0502"]]);
  });

  it("loteamento funciona sem a 0171 (lote não manda as colunas novas)", async () => {
    estado.semColunasVerticais = true;
    const r = await executar("100002", { acao: "importar", linhas: [{ area: "300", lote: "1", matricula: "1", preco: "1", quadra: "6" }] });
    expect(r.ok).toBe(true);
    expect(estado.unidades.some((u) => u.codigo === "SOL0601")).toBe(true);
  });

  it("⚠️ tudo ou nada: uma linha com erro e ZERO insert", async () => {
    const r = await executar("100002", {
      acao: "importar",
      linhas: [
        { area: "300", lote: "1", matricula: "1", preco: "1", quadra: "7" },
        { area: "300", lote: "2", matricula: "1", preco: "1", quadra: "2" }, // SOL0202 já existe
      ],
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(!r.ok && r.error).toBe("1 linha tem problema, e nada foi gravado. Corrija a planilha e envie de novo.");
    expect(inserts()).toHaveLength(0);
  });

  it("⚠️ duplicada DENTRO da planilha também trava a importação", async () => {
    const r = await executar("100002", {
      acao: "importar",
      linhas: [
        { area: "300", lote: "1", matricula: "1", preco: "1", quadra: "8" },
        { area: "300", lote: "01", matricula: "1", preco: "1", quadra: "08" },
      ],
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(inserts()).toHaveLength(0);
  });

  it("vertical: grava torre/andar/apartamento, quadra e lote nulos, código com hífen", async () => {
    const r = await executar("100001", {
      acao: "importar",
      linhas: [{ Andar: "12º andar", Apto: "1203", "Área privativa": "80,00", Matrícula: "77", Tipologia: "3 quartos", Torre: "Torre B", Vagas: "2", Valor: "600.000,00" }],
    });
    expect(r.ok).toBe(true);
    expect(inserts()[0]?.payload).toEqual([
      {
        andar: 12,
        apartamento: "1203",
        area: 80,
        codigo: "JAD-B-1203",
        enterprise_id: "100001",
        lote: null,
        matricula: "77",
        origem_c2x_id: null,
        preco_tabela: 600000,
        quadra: null,
        situacao: "disponivel",
        tipo_unidade: "apartamento",
        tipologia: "3 quartos",
        torre: "B",
        vagas: 2,
        workspace_id: "careli",
      },
    ]);
    const data = (r as { data: { unidades: Array<{ rotulo: string }> } }).data;
    expect(data.unidades[0]?.rotulo).toBe("Torre B · Apto 1203");
  });

  it("vertical sem a 0171: 503 e nenhum insert", async () => {
    estado.semColunasVerticais = true;
    const r = await executar("100001", {
      acao: "importar",
      linhas: [{ andar: "1", apartamento: "101", areaPrivativa: "50", matricula: "1", preco: "1" }],
    });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(!r.ok && r.detalhe).toContain("0171");
    expect(inserts()).toHaveLength(0);
  });

  it("corrida no índice único (23505) é 409, e nada entra", async () => {
    estado.erroNoInsert = { code: "23505", message: "duplicate key" };
    const antes = estado.unidades.length;
    const r = await executar("100002", { acao: "importar", linhas: [{ area: "300", lote: "1", matricula: "1", preco: "1", quadra: "9" }] });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(estado.unidades).toHaveLength(antes);
  });

  it("⚠️ produto do C2X (VOC 37) recusa unidade nova com 409, sem ler nem gravar unidade", async () => {
    for (const acao of ["conferir", "importar", "criar"]) {
      const r = await executar("37", {
        acao,
        linhas: [{ area: "300", lote: "1", matricula: "1", preco: "1", quadra: "20" }],
        unidade: { area: "300", lote: "1", matricula: "1", preco: "1", quadra: "20" },
      });
      expect(r).toMatchObject({ ok: false, status: 409 });
    }
    expect(chamadas()).toHaveLength(0);
  });

  it("sem preço: a unidade é gravada BLOQUEADA com o motivo, nunca disponível a R$ 0", async () => {
    const r = await executar("100002", { acao: "importar", linhas: [{ area: "300", lote: "1", matricula: "1", quadra: "41" }] });
    expect(r.ok).toBe(true);
    expect(inserts()[0]?.payload).toEqual([
      expect.objectContaining({
        bloqueado_por: UUID_AUTOR,
        bloqueio_motivo: "Sem preço de tabela",
        codigo: "SOL4101",
        preco_tabela: null,
        situacao: "bloqueada",
      }),
    ]);
  });
});

describe("executarCadastroDeUnidades: criar", () => {
  it("uma unidade, relida do banco", async () => {
    const r = await executar("100002", { acao: "criar", unidade: { area: "300", lote: "3", matricula: "1", preco: "1", quadra: "10" } });
    expect(r.ok).toBe(true);
    const data = (r as { data: { unidade: { codigo: string } } }).data;
    expect(data.unidade.codigo).toBe("SOL1003");
  });

  it("⚠️ já existente no banco é 409; dado inválido é 422; sem unidade é 400", async () => {
    const existe = await executar("100002", { acao: "criar", unidade: { area: "300", lote: "2", matricula: "1", preco: "1", quadra: "2" } });
    expect(existe).toMatchObject({ error: "Quadra 02 · Lote 02 já está cadastrada neste produto (SOL0202).", ok: false, status: 409 });

    const invalida = await executar("100002", { acao: "criar", unidade: { lote: "2", quadra: "30" } });
    expect(invalida).toMatchObject({ error: "A área precisa ser um número maior que zero.", ok: false, status: 422 });

    expect(await executar("100002", { acao: "criar" })).toMatchObject({ ok: false, status: 400 });
    expect(inserts()).toHaveLength(0);
  });

  it("⚠️ vendida não nasce: 422", async () => {
    const r = await executar("100002", {
      acao: "criar",
      unidade: { area: "300", lote: "1", matricula: "1", preco: "1", quadra: "11", situacao: "Vendida" },
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(inserts()).toHaveLength(0);
  });
});

describe("executarCadastroDeUnidades: atualizar", () => {
  it("⚠️ atualiza preço e matrícula e NÃO mexe em situação", async () => {
    const r = await executar("100002", {
      acao: "atualizar",
      campos: { matricula: "30.000", preco: "130.000,00" },
      unidadeId: U_LOTE_LIVRE,
    });
    expect(r.ok).toBe(true);
    expect(updates()).toHaveLength(1);
    const patch = updates()[0]?.payload as Linha;
    expect(patch).not.toHaveProperty("situacao");
    expect(patch).toMatchObject({ matricula: "30.000", preco_extenso: null, preco_tabela: 130000 });
    expect(updates()[0]?.filtros).toContainEqual(["in", "situacao", ["disponivel", "bloqueada"]]);

    const gravada = estado.unidades.find((u) => u.id === U_LOTE_LIVRE);
    expect(gravada).toMatchObject({ preco_tabela: 130000, situacao: "disponivel" });
    expect((r as { data: { alterados: string[] } }).data.alterados.sort()).toEqual(["matricula", "preco_tabela"]);
  });

  it("⚠️ corpo com situação é 400 e não chega ao banco", async () => {
    const r = await executar("100002", { acao: "atualizar", campos: { situacao: "disponivel" }, unidadeId: U_LOTE_RESERVADO });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(updates()).toHaveLength(0);
    expect(estado.unidades.find((u) => u.id === U_LOTE_RESERVADO)?.situacao).toBe("reservada");
  });

  it("preço e área travam com venda andando (situação ou proposta viva); matrícula não", async () => {
    const reservada = await executar("100002", { acao: "atualizar", campos: { preco: "1" }, unidadeId: U_LOTE_RESERVADO });
    expect(reservada).toMatchObject({ ok: false, status: 409 });

    const comProposta = await executar("100002", { acao: "atualizar", campos: { area: "301" }, unidadeId: U_LOTE_COM_PROPOSTA });
    expect(comProposta).toMatchObject({ ok: false, status: 409 });
    expect(updates()).toHaveLength(0);

    const matricula = await executar("100002", { acao: "atualizar", campos: { matricula: "1" }, unidadeId: U_LOTE_RESERVADO });
    expect(matricula.ok).toBe(true);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]?.filtros.some(([, coluna]) => coluna === "situacao")).toBe(false);
  });

  it("⚠️ reserva viva trava preço e área mesmo com a unidade ainda 'disponivel'", async () => {
    estado.reservas.push({ id: "r-viva", situacao: "ativa", unidade_id: U_LOTE_LIVRE, workspace_id: "careli" });
    const r = await executar("100002", { acao: "atualizar", campos: { preco: "99.000,00" }, unidadeId: U_LOTE_LIVRE });
    expect(r).toMatchObject({ error: "Esta unidade tem uma reserva em andamento: preço e área ficam travados.", ok: false, status: 409 });
    expect(updates()).toHaveLength(0);
    const leitura = chamadas().find((c) => c.tabela === "hercules_reservas");
    expect(leitura?.filtros).toContainEqual(["in", "situacao", ["ativa", "proposta"]]);
    expect(leitura?.filtros).toContainEqual(["eq", "workspace_id", "careli"]);

    // Matrícula não trava nem com reserva.
    const matricula = await executar("100002", { acao: "atualizar", campos: { matricula: "7" }, unidadeId: U_LOTE_LIVRE });
    expect(matricula.ok).toBe(true);
  });

  it("não deu para ler as reservas: 503 e nada muda (fail-closed)", async () => {
    estado.erroNaLeituraDe = "hercules_reservas";
    const r = await executar("100002", { acao: "atualizar", campos: { preco: "99.000,00" }, unidadeId: U_LOTE_LIVRE });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(updates()).toHaveLength(0);
  });

  it("a proposta cancelada não trava o preço", async () => {
    const r = await executar("100002", { acao: "atualizar", campos: { preco: "99.000,00" }, unidadeId: U_LOTE_LIVRE });
    expect(r.ok).toBe(true);
  });

  it("⚠️ unidade de outro produto, id que não é uuid e unidade inexistente são 404", async () => {
    for (const unidadeId of [U_APTO, "123", "aaaaaaaa-0000-4000-8000-00000000ffff"]) {
      const r = await executar("100002", { acao: "atualizar", campos: { matricula: "1" }, unidadeId });
      expect(r).toMatchObject({ error: "Unidade não encontrada.", ok: false, status: 404 });
    }
    expect(updates()).toHaveLength(0);
  });

  it("unidade da carga do C2X em produto SEM dono e linha espelho são 409", async () => {
    // O mesmo SOL, sem a marca de quem opera: a carga ainda seria dona da unidade.
    estado.cadastro = CADASTRO.map((l) => (l.id === "sol" ? { ...l, operadoPor: null } : l));
    const doC2x = await executar("100002", { acao: "atualizar", campos: { matricula: "1" }, unidadeId: U_DO_C2X });
    expect(doC2x).toMatchObject({ ok: false, status: 409 });
    const espelho = await executar("100002", { acao: "atualizar", campos: { matricula: "1" }, unidadeId: U_ESPELHO });
    expect(espelho).toMatchObject({ ok: false, status: 409 });
    expect(updates()).toHaveLength(0);
  });

  it("⚠️ D2: produto COM dono corrige a unidade que veio da carga (preço, área e matrícula)", async () => {
    const r = await executar("100002", { acao: "atualizar", campos: { matricula: "9.999" }, unidadeId: U_DO_C2X });
    expect(r.ok).toBe(true);
    expect(updates()[0]?.payload).toMatchObject({ matricula: "9.999" });
  });

  it("prédio: área privativa, tipologia e vagas", async () => {
    const r = await executar("100001", {
      acao: "atualizar",
      campos: { areaPrivativa: "70", tipologia: "Studio", vagas: 0 },
      unidadeId: U_APTO,
    });
    expect(r.ok).toBe(true);
    expect(updates()[0]?.payload).toMatchObject({ area: 70, area_extenso: null, tipologia: "Studio", vagas: 0 });
  });

  it("nada mudou: não escreve", async () => {
    const r = await executar("100002", { acao: "atualizar", campos: { matricula: "1.234" }, unidadeId: U_LOTE_LIVRE });
    expect(r.ok).toBe(true);
    expect(updates()).toHaveLength(0);
  });
});

describe("executarCadastroDeUnidades: D2, o Garden da Cecílio (produto do C2X com dono)", () => {
  const guardaDaCecilio = (p: ProdutoDoCadastro, contexto: { com0170: boolean }) =>
    produtoNoRecorteDoPortal(p, {
      com0170: contexto.com0170,
      incorporadorId: "inc-cecilio",
      permitidos: new Set(["37", "39", "100001"]),
      slug: "cecilio-rocha",
      tipo: "incorporador",
    });

  it("⚠️ pelo portal, a Cecílio muda o preço de uma unidade que veio da carga do C2X", async () => {
    const r = await executar(
      "39",
      { acao: "atualizar", campos: { area: "320", preco: "210.000,00" }, unidadeId: U_GARDEN_DA_CARGA },
      guardaDaCecilio,
    );
    expect(r.ok).toBe(true);
    expect(updates()).toHaveLength(1);
    const patch = updates()[0]?.payload as Linha;
    expect(patch).toMatchObject({ area: 320, area_extenso: null, preco_extenso: null, preco_tabela: 210000 });
    expect(patch).not.toHaveProperty("situacao");
    // A trava da venda viva continua valendo: o update é condicional à situação.
    expect(updates()[0]?.filtros).toContainEqual(["in", "situacao", ["disponivel", "bloqueada"]]);
    expect(estado.unidades.find((u) => u.id === U_GARDEN_DA_CARGA)).toMatchObject({ preco_tabela: 210000, situacao: "disponivel" });
  });

  it("⚠️ situação e identificação da unidade da carga são recusadas com 422, e nada chega ao banco", async () => {
    for (const campos of [{ situacao: "disponivel" }, { motivoDoBloqueio: "x" }, { quadra: "02" }, { lote: "09", preco: "1" }]) {
      const r = await executar("39", { acao: "atualizar", campos, unidadeId: U_GARDEN_DA_CARGA }, guardaDaCecilio);
      expect(r).toMatchObject({ error: SITUACAO_E_IDENTIDADE_NAO_MUDAM, ok: false, status: 422 });
    }
    const outro = await executar("39", { acao: "atualizar", campos: { tipologia: "Casa" }, unidadeId: U_GARDEN_DA_CARGA }, guardaDaCecilio);
    expect(outro).toMatchObject({ error: "Nesta unidade só o preço, a área e a matrícula podem ser corrigidos.", ok: false, status: 422 });
    expect(updates()).toHaveLength(0);
  });

  it("⚠️ a reserva viva continua travando o preço da unidade da carga", async () => {
    estado.reservas.push({ id: "r-garden", situacao: "ativa", unidade_id: U_GARDEN_DA_CARGA, workspace_id: "careli" });
    const r = await executar("39", { acao: "atualizar", campos: { preco: "1" }, unidadeId: U_GARDEN_DA_CARGA }, guardaDaCecilio);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(updates()).toHaveLength(0);
  });

  it("⚠️ o VOC (da Careli) é recusado: 404 pela porta do portal, 409 pelo hub, sem ler unidade", async () => {
    const peloPortal = await executar("37", { acao: "atualizar", campos: { preco: "1" }, unidadeId: U_VOC_DA_CARGA }, guardaDaCecilio);
    expect(peloPortal).toEqual({ error: PRODUTO_NAO_ENCONTRADO, ok: false, status: 404 });

    const peloHub = await executar("37", { acao: "atualizar", campos: { preco: "1" }, unidadeId: U_VOC_DA_CARGA });
    expect(peloHub).toMatchObject({ ok: false, status: 409 });

    expect(chamadas()).toHaveLength(0);
  });

  it("⚠️ criar, importar e conferir no Garden continuam 409 (unidade nova num id do C2X)", async () => {
    for (const acao of ["criar", "importar", "conferir"]) {
      const r = await executar(
        "39",
        {
          acao,
          linhas: [{ area: "300", lote: "40", matricula: "1", preco: "1", quadra: "40" }],
          unidade: { area: "300", lote: "40", matricula: "1", preco: "1", quadra: "40" },
        },
        guardaDaCecilio,
      );
      expect(r).toMatchObject({ ok: false, status: 409 });
    }
    expect(inserts()).toHaveLength(0);
  });

  it("modelo do Garden responde as colunas do loteamento", async () => {
    const r = await executar("39", { acao: "modelo" }, guardaDaCecilio);
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A COLUNA CATEGORIA NA PLANILHA — a unidade já nasce vinculada
// ════════════════════════════════════════════════════════════════════════════
//
// Lucas (15/09/2026): *"normalmente vamos subir em massa essa configuração na importação de
// unidades"*. O caso real é o VSA (100021), gleba do VSP (100020): a categoria mora no PAI e a
// planilha da gleba precisa achá-la.

const CONDOMINIO = "cccccccc-0000-4000-8000-000000000001";

function comCategoriasNoPai() {
  estado.categorias = [
    { ativa: true, enterprise_id: "100020", id: CONDOMINIO, nome: "Condomínio", workspace_id: "careli" },
  ];
}

describe("importar com a coluna Categoria", () => {
  // ⚠️ A CATEGORIA MORA NO PAI E VALE PARA A GLEBA (medido: 907 unidades do Lagoa Bonita apontam
  // para categoria cadastrada no pai 31). Ler só o `enterprise_id` do produto faria a planilha da
  // gleba dizer "não existe" para a categoria que carimba 750 lotes.
  it("a categoria cadastrada no PAI casa na planilha da gleba, e vai no insert", async () => {
    comCategoriasNoPai();
    const r = await executar("100021", {
      acao: "importar",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Categoria\n9;1;300,00;150.000,00;CONDOMINIO\n",
    });

    expect(r.ok).toBe(true);
    const enviadas = inserts()[0]?.payload as Linha[];
    expect(enviadas[0]).toMatchObject({ categoria_id: CONDOMINIO, codigo: "VSA0901" });
  });

  // ⚠️ NOME QUE NÃO EXISTE É ERRO DA LINHA, NUNCA "ENTRA SEM CATEGORIA": a unidade entraria calada
  // no lugar errado, e é a categoria que decide qual minuta o lote assina.
  it("categoria desconhecida recusa a planilha, diz o nome e não grava nada", async () => {
    comCategoriasNoPai();
    const r = await executar("100021", {
      acao: "importar",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Categoria\n9;2;300,00;150.000,00;Caução\n",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    const linhas = (r.data as { linhas: LinhaConferidaNoTeste[] }).linhas;
    expect(linhas[0]?.problemas.map((p) => p.motivo).join(" ")).toContain('"Caução" não existe');
    expect(inserts()).toHaveLength(0);
  });

  it("sem categoria cadastrada, a frase diz o que falta fazer", async () => {
    const r = await executar("100021", {
      acao: "importar",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Categoria\n9;3;300,00;150.000,00;Condomínio\n",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const linhas = (r.data as { linhas: LinhaConferidaNoTeste[] }).linhas;
    expect(linhas[0]?.problemas.map((p) => p.motivo).join(" ")).toContain(
      "não tem categorias cadastradas",
    );
  });

  // ⚠️ CHAVE AUSENTE NÃO É CITADA NO INSERT (a mesma disciplina das colunas da 0171).
  it("coluna em branco não manda categoria_id nenhum", async () => {
    comCategoriasNoPai();
    const r = await executar("100021", {
      acao: "importar",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Categoria\n9;4;300,00;150.000,00;\n",
    });
    expect(r.ok).toBe(true);
    expect(inserts()[0]?.payload).toEqual([expect.not.objectContaining({ categoria_id: expect.anything() })]);
  });

  it("a conferência devolve, por linha, com qual categoria a unidade casou", async () => {
    comCategoriasNoPai();
    const r = await executar("100021", {
      acao: "conferir",
      csv: "Quadra;Lote;Área (m²);Valor (R$);Categoria\n9;5;300,00;150.000,00;condominio\n",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      categorias: { nome: string }[];
      linhas: LinhaConferidaNoTeste[];
      resumo: { comCategoria: number };
    };
    expect(data.linhas[0]?.categoria).toBe("Condomínio");
    expect(data.resumo.comCategoria).toBe(1);
    // A lista de nomes aceitos sai junto: sem ela, "a categoria X não existe" manda o operador
    // adivinhar quais existem.
    expect(data.categorias.map((c) => c.nome)).toEqual(["Condomínio"]);
  });

  it("a régua pura resolve o nome sem caixa nem acento", () => {
    const c = conferirContraOBanco(
      "loteamento",
      [{ area: "300", categoria: "CONDOMINIO", lote: "1", preco: "1", quadra: "9" }],
      { categorias: [{ id: CONDOMINIO, nome: "Condomínio" }], prefixo: "VSA" },
    );
    expect(c.prontas[0]?.categoriaId).toBe(CONDOMINIO);
    expect(c.resumo.comCategoria).toBe(1);
  });
});

/** A linha da conferência, como o teste a lê da resposta. */
type LinhaConferidaNoTeste = {
  categoria: null | string;
  problemas: { motivo: string }[];
};
