import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

// As leituras de fora (C2X e cadastro do Panteon) são trocadas por dublês: o que se testa aqui é o
// recorte e as conferências, não o banco.
const leituras = vi.hoisted(() => ({
  cadastro: vi.fn<() => Promise<LinhaDoCadastro[]>>(),
  catalogo: vi.fn<() => Promise<Array<{ codes: string[]; id: string; name: string; stageIds: string[] }>>>(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: leituras.catalogo,
}));

vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  // A leitura que diz também se a 0170 veio (`com0170`), para a régua de quem opera o produto.
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: await leituras.cadastro() }),
}));

import {
  idsDoProdutoNoEscopo,
  registrarArquivoDoProduto,
  removerArquivoDoProduto,
  resolverProdutoDoPedido,
  todosOsIdsConhecidos,
} from "./arquivos-do-produto-servidor";

const MIB = 1024 * 1024;
const UUID = "0b9f3c1e-7d2a-4c55-9a61-3f0e8b7c2d14";

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
  ...p,
});

// O recorte real que importa: o Cecílio tem VOC (37) e Garden (39).
const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro" }),
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", ordem: 1, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", ordem: 2, paiId: "vlo" }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Lagoa Bonita" }),
  linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", ordem: 1, paiId: "lab" }),
  linha({ c2xEnterpriseId: "27", codigo: "LBR", id: "lbr", ordem: 2, paiId: "lab" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  // Só existe no Panteon: o id não está no catálogo do C2X.
  linha({ c2xEnterpriseId: "900", codigo: "TST", id: "tst", nome: "Teste" }),
];

const CATALOGO = [
  { codes: ["LBF", "LBR"], id: "group:Lagoa Bonita", name: "LAGOA BONITA", stageIds: ["33", "27"] },
  { codes: ["VOC"], id: "37", name: "VALE DO OURO CECILIO", stageIds: ["37"] },
  { codes: ["VOL"], id: "36", name: "VALE DO OURO LINO", stageIds: ["36"] },
  { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
];

describe("idsDoProdutoNoEscopo", () => {
  const cecilio = new Set(["37", "39"]);

  it("o pai do Vale do Ouro, para o Cecílio, é só o VOC", () => {
    expect(
      idsDoProdutoNoEscopo({ cadastro: CADASTRO, catalogo: CATALOGO, pedido: "pai:vlo", permitidos: cecilio }),
    ).toEqual(["37"]);
  });

  it("o Garden (pai sem filho) é o próprio id", () => {
    expect(
      idsDoProdutoNoEscopo({ cadastro: CADASTRO, catalogo: CATALOGO, pedido: "pai:gdn", permitidos: cecilio }),
    ).toEqual(["39"]);
  });

  it("id numérico: ele mesmo se for da sessão, nada se não for", () => {
    const base = { cadastro: CADASTRO, catalogo: CATALOGO, permitidos: cecilio };
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "37" })).toEqual(["37"]);
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "36" })).toEqual([]);
  });

  it("fail-closed: vazio, pai inventado e pai de outro dono não alcançam nada", () => {
    const base = { cadastro: CADASTRO, catalogo: CATALOGO, permitidos: cecilio };
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "" })).toEqual([]);
    expect(idsDoProdutoNoEscopo({ ...base, pedido: null })).toEqual([]);
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "pai:nao-existe" })).toEqual([]);
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "pai:lab" })).toEqual([]);
    // Filho não é produto: o uuid do VOC não abre nada.
    expect(idsDoProdutoNoEscopo({ ...base, pedido: "pai:voc" })).toEqual([]);
  });

  it("grupo: só quem tem o GRUPO abre o grupo (e leva as divisões)", () => {
    const dono = new Set(["group:Lagoa Bonita", "33", "27"]);
    expect(
      idsDoProdutoNoEscopo({
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        pedido: "group:Lagoa Bonita",
        permitidos: dono,
      }),
    ).toEqual(["group:Lagoa Bonita", "33", "27"]);

    // Quem tem só a gleba do Fernando não ganha o grupo pedindo por ele.
    expect(
      idsDoProdutoNoEscopo({
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        pedido: "group:Lagoa Bonita",
        permitidos: new Set(["33"]),
      }),
    ).toEqual([]);
  });

  it("pai com todas as divisões ganha o grupo; com uma só, só ela", () => {
    const dono = new Set(["group:Lagoa Bonita", "33", "27"]);
    expect(
      idsDoProdutoNoEscopo({ cadastro: CADASTRO, catalogo: CATALOGO, pedido: "pai:lab", permitidos: dono }),
    ).toEqual(["33", "27", "group:Lagoa Bonita"]);
    expect(
      idsDoProdutoNoEscopo({
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        pedido: "pai:lab",
        permitidos: new Set(["33"]),
      }),
    ).toEqual(["33"]);
  });

  it("empreendimento só do Panteon funciona sem catálogo (o recorte é por id)", () => {
    expect(
      idsDoProdutoNoEscopo({
        cadastro: CADASTRO,
        catalogo: [],
        pedido: "pai:tst",
        permitidos: new Set(["900"]),
      }),
    ).toEqual(["900"]);
  });
});

describe("todosOsIdsConhecidos", () => {
  it("junta catálogo (grupo e divisões) e cadastro, sem vazio", () => {
    const ids = todosOsIdsConhecidos(
      [...CADASTRO, linha({ codigo: "LOX", id: "lox" })],
      CATALOGO,
    );
    expect(ids.has("group:Lagoa Bonita")).toBe(true);
    expect(ids.has("33")).toBe(true);
    expect(ids.has("900")).toBe(true);
    expect(ids.has("")).toBe(false);
    expect(ids.has("41")).toBe(false);
  });
});

describe("resolverProdutoDoPedido", () => {
  beforeEach(() => {
    leituras.cadastro.mockReset();
    leituras.catalogo.mockReset();
    leituras.catalogo.mockResolvedValue(CATALOGO);
    leituras.cadastro.mockResolvedValue(CADASTRO);
  });

  it("sem emp: 400", async () => {
    expect(await resolverProdutoDoPedido("  ", () => new Set(["37"]))).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("fora do recorte: 404, igual a inexistente", async () => {
    expect(await resolverProdutoDoPedido("36", () => new Set(["37", "39"]))).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("dentro do recorte: ids e destinos com rótulo", async () => {
    expect(await resolverProdutoDoPedido("pai:vlo", async () => new Set(["37", "39"]))).toEqual({
      data: { destinos: [{ id: "37", rotulo: "VOC · VOC" }], ids: ["37"] },
      ok: true,
    });
  });

  it("entrega a quem decide o recorte o cadastro, o catálogo e se a 0170 veio", async () => {
    const bases: unknown[] = [];
    await resolverProdutoDoPedido("37", (b) => {
      bases.push(b);
      return new Set(["37"]);
    });
    expect(bases).toEqual([{ cadastro: CADASTRO, catalogo: CATALOGO, com0170: true }]);

    // Leitura que falhou não é "a 0170 veio": quem decide a escrita fecha.
    leituras.cadastro.mockRejectedValue(new Error("fora do ar"));
    await resolverProdutoDoPedido("37", (b) => {
      bases.push(b);
      return new Set(["37"]);
    });
    expect(bases[1]).toMatchObject({ cadastro: [], com0170: false });
  });

  it("cadastro fora do ar: pai responde 503; id numérico segue", async () => {
    leituras.cadastro.mockRejectedValue(new Error("fora do ar"));
    expect(await resolverProdutoDoPedido("pai:vlo", () => new Set(["37"]))).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(await resolverProdutoDoPedido("37", () => new Set(["37"]))).toMatchObject({
      data: { ids: ["37"] },
      ok: true,
    });
  });
});

// ── Um Supabase de mentira: só o que o registrar e o remover usam ──────────────

type Linha = Record<string, unknown>;

function falsoAdmin(opcoes: {
  erroNoInsert?: { code?: string; message: string };
  linhas?: Linha[];
  objetos?: Record<string, { contentType?: string; size: number }>;
}) {
  const inseridos: Linha[] = [];
  const removidos: string[] = [];
  const atualizados: Array<{ filtros: Array<[string, unknown]>; valores: Linha }> = [];

  const from = () => {
    const filtros: Array<[string, unknown]> = [];
    let valores: Linha | null = null;

    const filtrar = () =>
      (opcoes.linhas ?? []).filter((l) =>
        filtros.every(([coluna, valor]) => (valor === null ? l[coluna] == null : l[coluna] === valor)),
      );

    const consulta = {
      eq(coluna: string, valor: unknown) {
        filtros.push([coluna, valor]);
        return consulta;
      },
      insert(linhaNova: Linha) {
        inseridos.push(linhaNova);
        return Promise.resolve({ error: opcoes.erroNoInsert ?? null });
      },
      is(coluna: string, valor: unknown) {
        filtros.push([coluna, valor]);
        return consulta;
      },
      maybeSingle() {
        return Promise.resolve({ data: filtrar()[0] ?? null, error: null });
      },
      select() {
        return consulta;
      },
      then(resolver: (valor: { error: null }) => unknown) {
        if (valores) atualizados.push({ filtros: [...filtros], valores });
        return Promise.resolve({ error: null }).then(resolver);
      },
      update(novos: Linha) {
        valores = novos;
        return consulta;
      },
    };
    return consulta;
  };

  const storage = {
    from: () => ({
      info: (caminho: string) => {
        const objeto = opcoes.objetos?.[caminho];
        return Promise.resolve(
          objeto
            ? { data: { contentType: objeto.contentType, size: objeto.size }, error: null }
            : { data: null, error: { message: "Object not found" } },
        );
      },
      remove: (caminhos: string[]) => {
        removidos.push(...caminhos);
        return Promise.resolve({ data: [], error: null });
      },
    }),
  };

  return {
    admin: { from, storage } as unknown as Parameters<typeof registrarArquivoDoProduto>[0],
    atualizados,
    inseridos,
    removidos,
  };
}

const AUTOR = { id: "u-1", nome: "Corretora da Cecílio", origem: "portal" as const };
const FOTO = `37/${UUID}.jpg`;
const MINIATURA = `37/${UUID}.thumb.jpg`;

describe("registrarArquivoDoProduto", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("registra a foto com o tamanho MEDIDO, a miniatura conferida e o autor", async () => {
    const falso = falsoAdmin({
      objetos: {
        [FOTO]: { contentType: "image/jpeg", size: 3 * MIB },
        [MINIATURA]: { contentType: "image/jpeg", size: 40_000 },
      },
    });

    const resultado = await registrarArquivoDoProduto(falso.admin, {
      altura: 3024,
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      duracao: 99,
      largura: 4032,
      miniatura: MINIATURA,
      nome: "C:\\fotos\\Portaria.jpg",
    });

    expect(resultado).toEqual({ data: { id: UUID }, ok: true });
    expect(falso.removidos).toEqual([]);
    expect(falso.inseridos).toEqual([
      expect.objectContaining({
        altura: 3024,
        duracao_segundos: null,
        enterprise_id: "37",
        enviado_origem: "portal",
        enviado_por: "u-1",
        enviado_por_nome: "Corretora da Cecílio",
        id: UUID,
        largura: 4032,
        mime: "image/jpeg",
        miniatura_path: MINIATURA,
        nome: "Portaria.jpg",
        storage_path: FOTO,
        tamanho_bytes: 3 * MIB,
        tipo: "imagem",
        workspace_id: "careli",
      }),
    ]);
  });

  it("caminho de outro empreendimento: 422 e nada gravado", async () => {
    const falso = falsoAdmin({ objetos: { [`39/${UUID}.jpg`]: { size: 10 } } });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: `39/${UUID}.jpg`,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
    expect(falso.inseridos).toEqual([]);
  });

  it("objeto que não existe no bucket: 422 e nada gravado (registro sem upload)", async () => {
    const falso = falsoAdmin({});
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
    expect(falso.inseridos).toEqual([]);
  });

  it("foto acima de 25 MB: sai do bucket com a miniatura", async () => {
    const falso = falsoAdmin({
      objetos: { [FOTO]: { contentType: "image/jpeg", size: 30 * MIB }, [MINIATURA]: { size: 10 } },
    });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      miniatura: MINIATURA,
      nome: "x.jpg",
    });
    expect(resultado).toEqual({ error: "Cada foto pode ter até 25 MB.", ok: false, status: 422 });
    expect(falso.removidos).toEqual([FOTO, MINIATURA]);
    expect(falso.inseridos).toEqual([]);
  });

  it("vídeo gravado no caminho de uma foto não passa pelo teto do vídeo", async () => {
    const falso = falsoAdmin({ objetos: { [FOTO]: { contentType: "video/mp4", size: 20 * MIB } } });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
    expect(falso.removidos).toEqual([FOTO]);
    expect(falso.inseridos).toEqual([]);
  });

  it("miniatura grande demais sai do bucket, e a foto entra sem ela", async () => {
    const falso = falsoAdmin({
      objetos: {
        [FOTO]: { contentType: "image/jpeg", size: MIB },
        [MINIATURA]: { contentType: "image/jpeg", size: 5 * MIB },
      },
    });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      miniatura: MINIATURA,
      nome: "x.jpg",
    });
    expect(resultado.ok).toBe(true);
    expect(falso.removidos).toEqual([MINIATURA]);
    expect(falso.inseridos[0]).toMatchObject({ miniatura_path: null });
  });

  it("miniatura de outro arquivo é ignorada (não entra e não é apagada)", async () => {
    const outra = "37/11111111-2222-4333-8444-555555555555.thumb.jpg";
    const falso = falsoAdmin({
      objetos: { [FOTO]: { contentType: "image/jpeg", size: MIB }, [outra]: { size: 100 } },
    });
    await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      miniatura: outra,
      nome: "x.jpg",
    });
    expect(falso.removidos).toEqual([]);
    expect(falso.inseridos[0]).toMatchObject({ miniatura_path: null });
  });

  it("vídeo guarda a duração", async () => {
    const video = `37/${UUID}.mp4`;
    const falso = falsoAdmin({ objetos: { [video]: { contentType: "video/mp4", size: 200 * MIB } } });
    await registrarArquivoDoProduto(falso.admin, {
      autor: { id: "hub-1", nome: null, origem: "hub" },
      caminho: video,
      destino: "37",
      duracao: 95.456,
      nome: "tour.mp4",
    });
    expect(falso.inseridos[0]).toMatchObject({
      duracao_segundos: 95.46,
      enviado_origem: "hub",
      tipo: "video",
    });
  });

  it("idempotente: o caminho já registrado devolve a linha e NÃO apaga os bytes", async () => {
    const falso = falsoAdmin({
      linhas: [{ id: UUID, storage_path: FOTO }],
      objetos: { [FOTO]: { contentType: "image/jpeg", size: MIB } },
    });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toEqual({ data: { id: UUID }, ok: true });
    expect(falso.inseridos).toEqual([]);
    expect(falso.removidos).toEqual([]);
  });

  it("corrida no índice único (23505): ok, sem apagar", async () => {
    const falso = falsoAdmin({
      erroNoInsert: { code: "23505", message: "duplicate key" },
      objetos: { [FOTO]: { contentType: "image/jpeg", size: MIB } },
    });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toEqual({ data: { id: UUID }, ok: true });
    expect(falso.removidos).toEqual([]);
  });

  it("insert que falha de verdade: 503 e os bytes saem junto", async () => {
    const falso = falsoAdmin({
      erroNoInsert: { code: "42P01", message: "relation does not exist" },
      objetos: { [FOTO]: { contentType: "image/jpeg", size: MIB } },
    });
    const resultado = await registrarArquivoDoProduto(falso.admin, {
      autor: AUTOR,
      caminho: FOTO,
      destino: "37",
      nome: "x.jpg",
    });
    expect(resultado).toMatchObject({ ok: false, status: 503 });
    expect(falso.removidos).toEqual([FOTO]);
  });
});

describe("removerArquivoDoProduto", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  const LINHAS = [
    { enterprise_id: "37", id: UUID, removido_em: null, workspace_id: "careli" },
    {
      enterprise_id: "36",
      id: "11111111-2222-4333-8444-555555555555",
      removido_em: null,
      workspace_id: "careli",
    },
  ];

  it("remove (lógico) o arquivo do recorte, carimbando quem removeu", async () => {
    const falso = falsoAdmin({ linhas: LINHAS });
    const resultado = await removerArquivoDoProduto(falso.admin, {
      autorId: "u-1",
      id: UUID,
      ids: ["37"],
    });
    expect(resultado).toEqual({ data: { id: UUID }, ok: true });
    expect(falso.atualizados).toHaveLength(1);
    expect(falso.atualizados[0]?.valores).toMatchObject({ removido_por: "u-1" });
    expect(typeof falso.atualizados[0]?.valores.removido_em).toBe("string");
  });

  it("arquivo de outro empreendimento: 404 e nada muda (uuid adivinhado)", async () => {
    const falso = falsoAdmin({ linhas: LINHAS });
    const resultado = await removerArquivoDoProduto(falso.admin, {
      autorId: "u-1",
      id: "11111111-2222-4333-8444-555555555555",
      ids: ["37", "39"],
    });
    expect(resultado).toMatchObject({ ok: false, status: 404 });
    expect(falso.atualizados).toEqual([]);
  });

  it("id que não é uuid: 404 sem ir ao banco", async () => {
    const falso = falsoAdmin({ linhas: LINHAS });
    expect(
      await removerArquivoDoProduto(falso.admin, { autorId: null, id: "1 or 1=1", ids: ["37"] }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(falso.atualizados).toEqual([]);
  });
});
