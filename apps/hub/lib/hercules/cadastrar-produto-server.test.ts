import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cadastrarProduto,
  CODIGOS_DO_LEGADO_FORA_DO_CADASTRO,
  entradaDoCorpo,
  falhaDoInsertDoProduto,
  paisPossiveisDoOperador,
  type PedidoDeCadastroDeProduto,
  resolverIncorporadorPorSlug,
} from "./cadastrar-produto-server";

// O CADASTRO DE PRODUTO CONTRA UM BANCO DE MENTIRA. O que se trava aqui:
//   1. a régua roda contra os códigos do C2X E do Panteon, e nada é gravado quando ela recusa;
//   2. o insert OMITE `c2x_enterprise_id` (o DEFAULT da sequence só vale assim) e grava quem opera;
//   3. as configurações nascem com portões e pré-venda DESLIGADOS, explícitos;
//   4. falha no meio DESFAZ o que já foi gravado, na ordem inversa;
//   5. 23505 de código em corrida vira erro de campo;
//   6. o pai nunca é uma raiz com estoque próprio (ela perderia unidades e vendas nas telas);
//   7. C2X fora do ar não para o cadastro: a conferência cai no cadastro + os códigos congelados.
//
// ⚠️ O catálogo do C2X é mockado: o de verdade é um select no MySQL do legado.
const catalogo = vi.hoisted(() => ({
  itens: [] as { codes: string[]; id: string; name: string; stageIds: string[] }[],
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => catalogo.itens,
}));

type Erro = { code?: string; details?: string; message?: string };

type Chamada = {
  colunas?: string;
  filtros: [string, string, unknown][];
  op: "delete" | "insert" | "select";
  range?: [number, number];
  tabela: string;
  valores?: Record<string, unknown>;
};

type LinhaDoCadastro = {
  c2x_enterprise_id: null | string;
  codigo: string;
  id: string;
  operado_por: null | string;
  pai_id: null | string;
};

type OpcoesDoBanco = {
  cadastro?: LinhaDoCadastro[];
  /** `enterprise_id` que têm unidade em `hercules_unidades`. */
  comEstoque?: string[];
  contaComVinculo?: boolean;
  falhar?: (c: Chamada) => Erro | null;
  idGerado?: null | string;
  incorporador?: null | Record<string, unknown>;
};

function criarBanco(opcoes: OpcoesDoBanco = {}) {
  const chamadas: Chamada[] = [];

  const responder = (c: Chamada): { data: unknown; error: Erro | null } => {
    const erro = opcoes.falhar?.(c) ?? null;
    if (erro) return { data: null, error: erro };

    if (c.tabela === "hercules_empreendimentos" && c.op === "select") {
      const [de, ate] = c.range ?? [0, 999];
      return { data: (opcoes.cadastro ?? []).slice(de, ate + 1), error: null };
    }
    if (c.tabela === "hercules_empreendimentos" && c.op === "insert") {
      const id = opcoes.idGerado === undefined ? "100000" : opcoes.idGerado;
      return { data: { c2x_enterprise_id: id, id: "0b8f9f5e-0000-4000-8000-000000000001" }, error: null };
    }
    if (c.tabela === "hercules_unidades" && c.op === "select") {
      const alvo = c.filtros.find(([, coluna]) => coluna === "enterprise_id")?.[2];
      return { data: (opcoes.comEstoque ?? []).includes(String(alvo)) ? [{ id: "unidade-1" }] : [], error: null };
    }
    if (c.tabela === "apolo_incorporador_usuario_empreendimentos" && c.op === "select") {
      return { data: opcoes.contaComVinculo ? [{ enterprise_id: "37" }] : [], error: null };
    }
    if (c.tabela === "apolo_incorporadores" && c.op === "select") {
      return { data: opcoes.incorporador ?? null, error: null };
    }
    return { data: null, error: null };
  };

  const cliente = {
    from(tabela: string) {
      const c: Chamada = { filtros: [], op: "select", tabela };
      const resolver = () => {
        chamadas.push(c);
        return Promise.resolve(responder(c));
      };
      const builder = {
        delete() {
          c.op = "delete";
          return builder;
        },
        eq(coluna: string, valor: unknown) {
          c.filtros.push(["eq", coluna, valor]);
          return builder;
        },
        ilike(coluna: string, valor: unknown) {
          c.filtros.push(["ilike", coluna, valor]);
          return builder;
        },
        insert(valores: Record<string, unknown>) {
          c.op = "insert";
          c.valores = valores;
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => resolver(),
        order: () => builder,
        range(de: number, ate: number) {
          c.range = [de, ate];
          return builder;
        },
        select(colunas: string) {
          if (c.op === "select") c.colunas = colunas;
          return builder;
        },
        single: () => resolver(),
        then(ok: (valor: unknown) => unknown, falhou?: (motivo: unknown) => unknown) {
          return resolver().then(ok, falhou);
        },
      };
      return builder;
    },
  };

  return { chamadas, cliente: cliente as unknown as Parameters<typeof cadastrarProduto>[0] };
}

const CECILIO = "5d1c7a8e-1111-4222-8333-444455556666";
const GURGEL = "9a9a9a9a-1111-4222-8333-444455556666";
const CONTA = "c0c0c0c0-1111-4222-8333-444455556666";
const USUARIO_DO_HUB = "a1a1a1a1-1111-4222-8333-444455556666";

const CADASTRO: LinhaDoCadastro[] = [
  { c2x_enterprise_id: "39", codigo: "GDN", id: "u-gdn", operado_por: null, pai_id: null },
  { c2x_enterprise_id: "35", codigo: "VLO", id: "u-vlo", operado_por: null, pai_id: null },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "u-voc", operado_por: null, pai_id: "u-vlo" },
  { c2x_enterprise_id: null, codigo: "LOX", id: "u-lox", operado_por: null, pai_id: null },
  { c2x_enterprise_id: "100005", codigo: "GTW", id: "u-gtw", operado_por: CECILIO, pai_id: null },
  { c2x_enterprise_id: "100006", codigo: "GT1", id: "u-gt1", operado_por: CECILIO, pai_id: "u-gtw" },
  { c2x_enterprise_id: "100007", codigo: "OUT", id: "u-out", operado_por: GURGEL, pai_id: null },
  // Um prédio da Cecílio sem etapa: pode virar pai só enquanto não tiver unidade.
  { c2x_enterprise_id: "100008", codigo: "RUB", id: "u-rub", operado_por: CECILIO, pai_id: null },
];

const C2X = async () => ["VOC", "VOL", "LBF", "GDN"];

function pedidoDoPortal(entrada: Partial<PedidoDeCadastroDeProduto["entrada"]> = {}): PedidoDeCadastroDeProduto {
  return {
    autor: { id: CONTA, nome: "Ana da Cecílio" },
    entrada: { cidade: "Ipatinga", codigo: "jad", nome: "Ed. Jade", tipoProduto: "vertical", uf: "mg", ...entrada },
    incorporadorId: CECILIO,
    origem: "portal",
    portal: { slug: "cecilio-rocha", tipo: "incorporador" },
  };
}

const escritas = (chamadas: Chamada[]) => chamadas.filter((c) => c.op !== "select");

beforeEach(() => {
  catalogo.itens = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a régua, antes de qualquer gravação", () => {
  it("recusa código que já existe no C2X, sem gravar nada", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "lbf" }), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.erros.codigo).toMatch(/LBF já está em uso/);
    expect(escritas(banco.chamadas)).toHaveLength(0);
  });

  it("recusa código que já existe só no Panteon, sem diferença de maiúscula", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "gtw" }), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.codigo).toMatch(/GTW já está em uso/);
    expect(escritas(banco.chamadas)).toHaveLength(0);
  });

  it("devolve o erro de cada campo (UF e tipo) com 422", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ tipoProduto: "casa", uf: "XX" }), {
      codigosDoC2x: C2X,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(Object.keys(r.erros).sort()).toEqual(["tipoProduto", "uf"]);
  });

  it("⚠️ pagina o cadastro: código na linha 1.500 continua sendo repetido", async () => {
    const muitos = Array.from({ length: 1600 }, (_, i) => ({
      c2x_enterprise_id: null,
      codigo: i === 1500 ? "JAD" : `Z${String(i).padStart(4, "0")}`,
      id: `u-${i}`,
      operado_por: null,
      pai_id: null,
    }));
    const banco = criarBanco({ cadastro: muitos });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.codigo).toMatch(/JAD já está em uso/);
    const leituras = banco.chamadas.filter((c) => c.tabela === "hercules_empreendimentos" && c.op === "select");
    expect(leituras.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(leituras[0]?.filtros).toContainEqual(["eq", "workspace_id", "careli"]);
  });

  it("⚠️ C2X fora do ar NÃO para o cadastro: confere pelo cadastro do Panteon e pelos códigos congelados", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const semC2x = { codigosDoC2x: async () => null };

    // O que o semeador pulou (ADT) e o que o catálogo esconde (LAG) continuam recusados.
    for (const codigo of ["adt", "lag", "sdt"]) {
      const banco = criarBanco({ cadastro: CADASTRO });
      const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo }), semC2x);
      expect(!r.ok && r.erros.codigo).toMatch(/já está em uso/);
      expect(escritas(banco.chamadas)).toHaveLength(0);
    }
    // O que está no cadastro (copiado do legado pelo semeador) também.
    const doCadastro = await cadastrarProduto(criarBanco({ cadastro: CADASTRO }).cliente, pedidoDoPortal({ codigo: "gdn" }), semC2x);
    expect(!doCadastro.ok && doCadastro.erros.codigo).toMatch(/GDN já está em uso/);

    // Código livre grava. E o caminho padrão (catálogo de verdade vazio) faz o mesmo.
    expect((await cadastrarProduto(criarBanco({ cadastro: CADASTRO }).cliente, pedidoDoPortal(), semC2x)).ok).toBe(true);
    expect((await cadastrarProduto(criarBanco({ cadastro: CADASTRO }).cliente, pedidoDoPortal())).ok).toBe(true);
    expect(CODIGOS_DO_LEGADO_FORA_DO_CADASTRO).toEqual(expect.arrayContaining(["ADT", "LAB", "LAG", "SDT", "TSC"]));
  });

  it("⚠️ os códigos que o catálogo esconde (TSC, SDT, LAB, LAG) também contam", async () => {
    catalogo.itens = [{ codes: ["VOC"], id: "37", name: "VALE DO OURO CECILIO", stageIds: ["37"] }];
    const banco = criarBanco({ cadastro: [] });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "lag" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.codigo).toMatch(/LAG já está em uso/);
  });

  it("⚠️ migration 0170 pendente na leitura: 503 e nada gravado", async () => {
    const banco = criarBanco({
      cadastro: CADASTRO,
      falhar: (c) =>
        c.tabela === "hercules_empreendimentos" && c.op === "select"
          ? { code: "42703", message: "column hercules_empreendimentos.operado_por does not exist" }
          : null,
    });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(r.erro).toMatch(/0170/);
    expect(escritas(banco.chamadas)).toHaveLength(0);
  });

  it("portal sem incorporador ou sem conta não chega nem a ler o banco", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const semIncorporador = await cadastrarProduto(banco.cliente, { ...pedidoDoPortal(), incorporadorId: null }, {
      codigosDoC2x: C2X,
    });
    const semConta = await cadastrarProduto(banco.cliente, { ...pedidoDoPortal(), autor: { id: null, nome: null } }, {
      codigosDoC2x: C2X,
    });
    // Sem o portal não há como passar o pai pela régua do portal: recusa antes de ler.
    const semPortal = await cadastrarProduto(banco.cliente, { ...pedidoDoPortal(), portal: null }, {
      codigosDoC2x: C2X,
    });
    expect(semIncorporador.ok || semConta.ok || semPortal.ok).toBe(false);
    expect(banco.chamadas).toHaveLength(0);
  });
});

describe("o pai: raiz e do mesmo operador", () => {
  it("paisPossiveisDoOperador: raízes do mesmo operador que não perdem estoque (nulo = Careli)", () => {
    expect([...paisPossiveisDoOperador(CADASTRO, CECILIO)].sort()).toEqual(["GTW", "RUB"]);
    // Com unidade, o prédio sem etapa deixa de poder ser pai.
    expect([...paisPossiveisDoOperador(CADASTRO, CECILIO, new Set(["100008"]))]).toEqual(["GTW"]);
    // ⚠️ O Garden (raiz do C2X sem filho) nunca: o estoque dele mora no legado. O VLO já é pai, o LOX
    // é pai de grupo sem id.
    expect([...paisPossiveisDoOperador(CADASTRO, null)].sort()).toEqual(["LOX", "VLO"]);
  });

  it("⚠️ no portal, o pai passa pela régua única (podeCadastrarNoProduto)", () => {
    const daCecilio = { slug: "cecilio-rocha", tipo: "incorporador" };
    // O mesmo resultado da comparação por operador, e sem distinguir caixa no uuid gravado.
    expect([...paisPossiveisDoOperador(CADASTRO, { incorporadorId: CECILIO, portal: daCecilio })].sort()).toEqual(["GTW", "RUB"]);
    expect(
      [...paisPossiveisDoOperador(CADASTRO, { incorporadorId: CECILIO.toUpperCase(), portal: daCecilio })].sort(),
    ).toEqual(["GTW", "RUB"]);
    // Portal que não confecciona e o comercial nunca penduram etapa, nem no que "operam".
    expect([...paisPossiveisDoOperador(CADASTRO, { incorporadorId: GURGEL, portal: { slug: "gurgel", tipo: "comercial" } })]).toEqual([]);
    expect([...paisPossiveisDoOperador(CADASTRO, { incorporadorId: CECILIO, portal: { slug: "cer", tipo: "incorporador" } })]).toEqual([]);
  });

  it("aceita o pai do mesmo operador e grava o uuid dele", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "GT2", paiCodigo: "gtw" }), {
      codigosDoC2x: C2X,
    });
    expect(r.ok).toBe(true);
    const insert = banco.chamadas.find((c) => c.tabela === "hercules_empreendimentos" && c.op === "insert");
    expect(insert?.valores?.pai_id).toBe("u-gtw");
  });

  it("⚠️ recusa pai com estoque próprio (o prédio perderia as unidades e as vendas das telas)", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, comEstoque: ["100008"] });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "RB2", paiCodigo: "rub" }), { codigosDoC2x: C2X });
    expect(!r.ok && r.erros.paiCodigo).toBe("O empreendimento RUB não pode ser pai: ele não existe ou já é filho de outro.");
    expect(escritas(banco.chamadas)).toHaveLength(0);
    const leitura = banco.chamadas.find((c) => c.tabela === "hercules_unidades");
    expect(leitura?.filtros).toEqual([
      ["eq", "workspace_id", "careli"],
      ["eq", "enterprise_id", "100008"],
    ]);

    // Sem unidade, o mesmo prédio aceita a etapa.
    const vazio = criarBanco({ cadastro: CADASTRO });
    const ok = await cadastrarProduto(vazio.cliente, pedidoDoPortal({ codigo: "RB2", paiCodigo: "rub" }), { codigosDoC2x: C2X });
    expect(ok.ok && ok.produto.paiId).toBe("u-rub");
  });

  it("pai que já tem etapa não precisa conferir estoque; não deu para ler o estoque é 503 sem gravar", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "GT2", paiCodigo: "gtw" }), { codigosDoC2x: C2X });
    expect(banco.chamadas.some((c) => c.tabela === "hercules_unidades")).toBe(false);

    const fora = criarBanco({
      cadastro: CADASTRO,
      falhar: (c) => (c.tabela === "hercules_unidades" ? { message: "timeout" } : null),
    });
    const r = await cadastrarProduto(fora.cliente, pedidoDoPortal({ codigo: "RB2", paiCodigo: "rub" }), { codigosDoC2x: C2X });
    expect(!r.ok && r.status).toBe(503);
    expect(escritas(fora.chamadas)).toHaveLength(0);
  });

  it("⚠️ pelo hub, o Garden (raiz do C2X, operada pela Careli) não vira pai", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(
      banco.cliente,
      {
        autor: { id: USUARIO_DO_HUB, nome: "Lucas" },
        entrada: { cidade: "Ipatinga", codigo: "GD2", nome: "Garden 2", paiCodigo: "GDN", tipoProduto: "loteamento", uf: "MG" },
        incorporadorId: null,
        origem: "hub",
      },
      { codigosDoC2x: C2X },
    );
    expect(!r.ok && r.erros.paiCodigo).toMatch(/GDN não pode ser pai/);
    expect(escritas(banco.chamadas)).toHaveLength(0);
  });

  it("⚠️ recusa pai de outro operador e pai que já é filho, com a mesma frase", async () => {
    for (const paiCodigo of ["VLO", "OUT", "GT1"]) {
      const banco = criarBanco({ cadastro: CADASTRO });
      const r = await cadastrarProduto(banco.cliente, pedidoDoPortal({ codigo: "GT2", paiCodigo }), {
        codigosDoC2x: C2X,
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.erros.paiCodigo).toBe(`O empreendimento ${paiCodigo} não pode ser pai: ele não existe ou já é filho de outro.`);
      expect(escritas(banco.chamadas)).toHaveLength(0);
    }
  });
});

describe("o cadastro que dá certo", () => {
  it("⚠️ pelo portal: omite o id, grava quem opera, configurações desligadas e o vínculo do portal", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), {
      agora: () => new Date("2026-09-16T12:00:00.000Z"),
      codigosDoC2x: C2X,
    });

    expect(r).toEqual({
      ok: true,
      produto: {
        codigo: "JAD",
        enterpriseId: "100000",
        nome: "Ed. Jade",
        operadoPor: CECILIO,
        paiId: null,
        produtoId: "0b8f9f5e-0000-4000-8000-000000000001",
        tipoProduto: "vertical",
        vinculadoAConta: false,
        vinculadoAoPortal: true,
      },
    });

    const [produto, configuracoes, portal, ...resto] = escritas(banco.chamadas);
    expect(resto).toHaveLength(0);

    expect(produto?.tabela).toBe("hercules_empreendimentos");
    // ⚠️ O DEFAULT da sequence só vale com a coluna OMITIDA; `null` explícito gravaria nulo.
    expect(produto?.valores && "c2x_enterprise_id" in produto.valores).toBe(false);
    expect(produto?.valores).toEqual({
      cidade: "Ipatinga",
      codigo: "JAD",
      criado_origem: "portal",
      criado_por: CONTA,
      nome: "Ed. Jade",
      operado_por: CECILIO,
      pai_id: null,
      tipo_produto: "vertical",
      uf: "MG",
      vendendo: true,
      workspace_id: "careli",
    });

    expect(configuracoes?.tabela).toBe("apolo_enterprise_settings");
    expect(configuracoes?.valores).toEqual({
      code: "JAD",
      comprovante_renda_habilitado: false,
      credenciamento_ativo: false,
      enterprise_id: "100000",
      prevenda_habilitada: false,
      recepcao_cad: false,
      recepcao_imobiliaria: false,
      updated_at: "2026-09-16T12:00:00.000Z",
      // A conta do portal não é usuário do hub.
      updated_by: null,
      workspace_id: "careli",
    });

    expect(portal?.tabela).toBe("apolo_incorporador_empreendimentos");
    expect(portal?.valores).toEqual({ carteira_administrada: false, enterprise_id: "100000", incorporador_id: CECILIO });
  });

  it("⚠️ conta com recorte próprio: o produto entra nela também, senão quem cadastrou não o vê", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, contaComVinculo: true });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok && r.produto.vinculadoAConta).toBe(true);
    const conta = escritas(banco.chamadas).find((c) => c.tabela === "apolo_incorporador_usuario_empreendimentos");
    expect(conta?.valores).toEqual({ enterprise_id: "100000", usuario_id: CONTA });
  });

  it("pelo hub, sem operador: a Careli opera, sem vínculo de portal, e o autor do hub assina as configurações", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(
      banco.cliente,
      {
        autor: { id: USUARIO_DO_HUB, nome: "Lucas" },
        entrada: { cidade: "Ipatinga", codigo: "VDS", nome: "Vale do Sol", tipoProduto: "loteamento", uf: "MG" },
        incorporadorId: null,
        origem: "hub",
      },
      { codigosDoC2x: C2X },
    );
    expect(r.ok && r.produto.vinculadoAoPortal).toBe(false);
    const gravadas = escritas(banco.chamadas);
    expect(gravadas.map((c) => c.tabela)).toEqual(["hercules_empreendimentos", "apolo_enterprise_settings"]);
    expect(gravadas[0]?.valores).toMatchObject({ criado_origem: "hub", operado_por: null, tipo_produto: "loteamento" });
    expect(gravadas[1]?.valores?.updated_by).toBe(USUARIO_DO_HUB);
    // O hub não lê o recorte de conta de portal nenhuma.
    expect(banco.chamadas.some((c) => c.tabela === "apolo_incorporador_usuario_empreendimentos")).toBe(false);
  });

  it("pelo hub, com operador: entra no portal de quem opera", async () => {
    const banco = criarBanco({ cadastro: CADASTRO });
    const r = await cadastrarProduto(
      banco.cliente,
      {
        autor: { id: "local-hub-user", nome: null },
        entrada: { cidade: "Ipatinga", codigo: "ONSKY", nome: "On Sky", tipoProduto: "vertical", uf: "MG" },
        incorporadorId: CECILIO,
        origem: "hub",
      },
      { codigosDoC2x: C2X },
    );
    expect(r.ok && r.produto.vinculadoAoPortal).toBe(true);
    const configuracoes = escritas(banco.chamadas).find((c) => c.tabela === "apolo_enterprise_settings");
    // "local-hub-user" (ambiente sem Supabase) não é uuid: `updated_by` é coluna uuid.
    expect(configuracoes?.valores?.updated_by).toBeNull();
  });
});

describe("⚠️ compensação: falha no meio desfaz o que já foi gravado", () => {
  const falharEm = (tabela: string) => (c: Chamada) =>
    c.tabela === tabela && c.op === "insert" ? { code: "XX000", message: "falha simulada" } : null;

  const apagadas = (chamadas: Chamada[]) => chamadas.filter((c) => c.op === "delete").map((c) => c.tabela);

  it("configurações recusadas: apaga o produto e diz que nada ficou", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, falhar: falharEm("apolo_enterprise_settings") });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(r.erro).toMatch(/Nada ficou gravado/);
    expect(apagadas(banco.chamadas)).toEqual(["hercules_empreendimentos"]);
    const apagarProduto = banco.chamadas.find((c) => c.op === "delete");
    expect(apagarProduto?.filtros).toContainEqual(["eq", "id", "0b8f9f5e-0000-4000-8000-000000000001"]);
    expect(banco.chamadas.some((c) => c.tabela === "apolo_incorporador_empreendimentos")).toBe(false);
  });

  it("vínculo do portal recusado: apaga configurações e produto, nessa ordem", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, falhar: falharEm("apolo_incorporador_empreendimentos") });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    expect(apagadas(banco.chamadas)).toEqual(["apolo_enterprise_settings", "hercules_empreendimentos"]);
    const apagarConfiguracoes = banco.chamadas.find((c) => c.op === "delete");
    expect(apagarConfiguracoes?.filtros).toEqual([["eq", "enterprise_id", "100000"]]);
  });

  it("vínculo da conta recusado: apaga portal, configurações e produto, nessa ordem", async () => {
    const banco = criarBanco({
      cadastro: CADASTRO,
      contaComVinculo: true,
      falhar: falharEm("apolo_incorporador_usuario_empreendimentos"),
    });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    expect(apagadas(banco.chamadas)).toEqual([
      "apolo_incorporador_empreendimentos",
      "apolo_enterprise_settings",
      "hercules_empreendimentos",
    ]);
    const apagarPortal = banco.chamadas.find((c) => c.op === "delete");
    expect(apagarPortal?.filtros).toEqual([
      ["eq", "incorporador_id", CECILIO],
      ["eq", "enterprise_id", "100000"],
    ]);
  });

  it("desfazer que também falha: 500 dizendo o que ficou, e tenta apagar o resto mesmo assim", async () => {
    const banco = criarBanco({
      cadastro: CADASTRO,
      falhar: (c) => {
        if (c.tabela === "apolo_incorporador_empreendimentos" && c.op === "insert") return { message: "falha" };
        if (c.tabela === "apolo_enterprise_settings" && c.op === "delete") return { message: "sem rede" };
        return null;
      },
    });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(500);
    expect(r.erro).toMatch(/Sobrou no banco: as configurações do empreendimento\./);
    expect(r.erro).toMatch(/Avise a Careli/);
    expect(apagadas(banco.chamadas)).toEqual(["apolo_enterprise_settings", "hercules_empreendimentos"]);
  });

  it("⚠️ produto gravado sem id da sequence (0170 pela metade): apaga e responde 503", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, idGerado: null });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(r.erro).toMatch(/sequence/);
    expect(apagadas(banco.chamadas)).toEqual(["hercules_empreendimentos"]);
    expect(banco.chamadas.some((c) => c.tabela === "apolo_enterprise_settings")).toBe(false);
  });

  it("id numérico legado (< 100000) também não serve", async () => {
    const banco = criarBanco({ cadastro: CADASTRO, idGerado: "46" });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    expect(apagadas(banco.chamadas)).toEqual(["hercules_empreendimentos"]);
  });

  it("falha ao ler o recorte da conta: 503 ANTES de gravar qualquer coisa", async () => {
    const banco = criarBanco({
      cadastro: CADASTRO,
      falhar: (c) => (c.tabela === "apolo_incorporador_usuario_empreendimentos" ? { message: "timeout" } : null),
    });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
    expect(escritas(banco.chamadas)).toHaveLength(0);
  });
});

describe("o erro do insert do produto", () => {
  const produto = {
    cidade: "Ipatinga",
    codigo: "JAD",
    nome: "Ed. Jade",
    paiCodigo: "GTW",
    tipoProduto: "vertical" as const,
    uf: "MG" as const,
  };

  it("⚠️ 23505 no código (corrida) vira erro de campo, sem compensação", async () => {
    const banco = criarBanco({
      cadastro: CADASTRO,
      falhar: (c) =>
        c.tabela === "hercules_empreendimentos" && c.op === "insert"
          ? {
              code: "23505",
              details: "Key (workspace_id, codigo)=(careli, JAD) already exists.",
              message: 'duplicate key value violates unique constraint "hercules_empreendimentos_codigo_uk"',
            }
          : null,
    });
    const r = await cadastrarProduto(banco.cliente, pedidoDoPortal(), { codigosDoC2x: C2X });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.erros.codigo).toBe("O código JAD acabou de ser usado por outro cadastro. Escolha outro.");
    expect(banco.chamadas.some((c) => c.op === "delete")).toBe(false);
    expect(banco.chamadas.some((c) => c.tabela === "apolo_enterprise_settings")).toBe(false);
  });

  it("23505 no id (alguém gravou à frente da sequence) é 503 de tentar de novo", () => {
    const r = falhaDoInsertDoProduto(
      { code: "23505", message: 'duplicate key value violates unique constraint "hercules_empreendimentos_c2x_uk"' },
      produto,
    );
    expect(r.status).toBe(503);
    expect(r.erros).toEqual({});
  });

  it("colunas da 0170 ausentes no insert: 503 da migration", () => {
    const r = falhaDoInsertDoProduto(
      { code: "PGRST204", message: "Could not find the 'tipo_produto' column of 'hercules_empreendimentos' in the schema cache" },
      produto,
    );
    expect(r.status).toBe(503);
    expect(r.erro).toMatch(/0170/);
  });

  it("gatilho de um nível e FK do pai viram erro no campo do pai", () => {
    const gatilho = falhaDoInsertDoProduto(
      { code: "P0001", message: "O pai de um empreendimento precisa ser raiz (um nível só)." },
      produto,
    );
    const fk = falhaDoInsertDoProduto(
      { code: "23503", message: 'violates foreign key constraint "hercules_empreendimentos_pai_id_fkey"' },
      produto,
    );
    expect(gatilho.erros.paiCodigo).toMatch(/GTW não pode ser pai/);
    expect(fk.erros.paiCodigo).toMatch(/GTW não pode ser pai/);
  });

  it("erro desconhecido: 500, e diz que nada foi gravado", () => {
    const r = falhaDoInsertDoProduto({ code: "42501", message: "permission denied" }, produto);
    expect(r.status).toBe(500);
    expect(r.erro).toMatch(/Nada foi gravado/);
  });
});

describe("entradaDoCorpo", () => {
  it("⚠️ só os campos do produto, só texto: operador e id do corpo são ignorados", () => {
    const entrada = entradaDoCorpo({
      cidade: "Ipatinga",
      codigo: "JAD",
      enterpriseId: "37",
      incorporadorId: GURGEL,
      nome: 12,
      operadoPor: GURGEL,
      paiCodigo: "",
      tipoProduto: "vertical",
      uf: "MG",
    });
    expect(entrada).toEqual({ cidade: "Ipatinga", codigo: "JAD", nome: "", paiCodigo: null, tipoProduto: "vertical", uf: "MG" });
    expect(entradaDoCorpo(null)).toEqual({ cidade: "", codigo: "", nome: "", paiCodigo: null, tipoProduto: "", uf: "" });
  });
});

describe("resolverIncorporadorPorSlug", () => {
  it("⚠️ tira o curinga do ilike antes de consultar", async () => {
    const banco = criarBanco({ incorporador: null });
    const r = await resolverIncorporadorPorSlug(banco.cliente, "cec%");
    expect(r).toEqual({ incorporador: null, ok: true });
    expect(banco.chamadas[0]?.filtros).toContainEqual(["ilike", "slug", "cec"]);
    expect(banco.chamadas[0]?.filtros).toContainEqual(["eq", "workspace_id", "careli"]);
  });

  it("devolve ativo e tipo normalizados; erro de banco é ok: false", async () => {
    const achado = await resolverIncorporadorPorSlug(
      criarBanco({ incorporador: { ativo: false, id: CECILIO, slug: "cecilio-rocha", tipo: null } }).cliente,
      "cecilio-rocha",
    );
    expect(achado).toEqual({
      incorporador: { ativo: false, id: CECILIO, slug: "cecilio-rocha", tipo: "incorporador" },
      ok: true,
    });

    const fora = await resolverIncorporadorPorSlug(
      criarBanco({ falhar: () => ({ message: "timeout" }) }).cliente,
      "cecilio-rocha",
    );
    expect(fora).toEqual({ ok: false });
  });
});
