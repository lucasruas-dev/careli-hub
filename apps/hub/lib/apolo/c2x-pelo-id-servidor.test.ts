import { beforeEach, describe, expect, it, vi } from "vitest";

// As leituras de fora (o catálogo do C2X, o cadastro do Panteon e a conferência da sigla no C2X) são
// trocadas: aqui se testa só a casca (quando lê, quando relê, em quem confia, o que devolve quando
// falha). O catálogo DE VERDADE, com o cache dele, está em c2x-pelo-id-servidor.catalogo-real.test.ts.
const m = vi.hoisted(() => ({
  cadastro: vi.fn(),
  catalogo: vi.fn(),
  // O C2X "de agora": sigla -> ids. `null` = a consulta falha.
  noC2x: new Map<string, number[]>() as Map<string, number[]> | null,
  query: vi.fn(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: m.catalogo,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: m.cadastro,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
}));

import {
  ERRO_CATALOGO_INDISPONIVEL,
  esquecerReleituraDoCatalogo,
  idsDoC2xDasSiglasAoVivo,
  idsDoC2xDosPedidosAoVivo,
  RELEITURA_MINIMA_MS,
} from "./c2x-pelo-id-servidor";

const VALE_DO_OURO = {
  codes: ["VOC", "VOL", "VOR"],
  id: "group:Vale do Ouro",
  name: "VALE DO OURO",
  stageIds: ["37", "36", "41"],
};
const JDG = { codes: ["JDG"], id: "40", name: "JARDIM DAS GERAIS", stageIds: ["40"] };
const NOVO = { codes: ["NOV"], id: "44", name: "NOVO", stageIds: ["44"] };
const RDV_NO_CACHE = { codes: ["RDV"], id: "43", name: "RECANTO DO VALE", stageIds: ["43"] };
const PDI_NO_CACHE = { codes: ["PDI"], id: "43", name: "PORTAL DO IBITURUNA", stageIds: ["43"] };

beforeEach(() => {
  m.cadastro.mockReset();
  m.catalogo.mockReset();
  m.noC2x = new Map();
  m.query.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (!m.noC2x) throw new Error("C2X fora");
    expect(sql).toMatch(/where e\.code in \(/);
    const linhas = params.flatMap((p) =>
      (m.noC2x!.get(String(p).toUpperCase()) ?? []).map((id) => ({ code: String(p).toUpperCase(), id })),
    );
    return [linhas];
  });
  esquecerReleituraDoCatalogo();
});

const forcadas = () => m.catalogo.mock.calls.filter((c) => c[1]?.forcar === true).length;

describe("idsDoC2xDasSiglasAoVivo: pelo catálogo (o portal e quem manda a sigla do catálogo)", () => {
  it("traduz pelo catálogo, sem ir ao C2X", async () => {
    m.catalogo.mockResolvedValue([VALE_DO_OURO, JDG]);
    const r = await idsDoC2xDasSiglasAoVivo(["VOC", "JDG"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [37, 40], ok: true, semId: [] });
    expect(m.query).not.toHaveBeenCalled();
    expect(forcadas()).toBe(0);
  });

  it("🔴 catálogo vazio (C2X fora) é FALHA, não carteira zerada", async () => {
    m.catalogo.mockResolvedValue([]);
    const r = await idsDoC2xDasSiglasAoVivo(["VOC"], { agoraMs: 1_000 });
    expect(r).toEqual({ erro: ERRO_CATALOGO_INDISPONIVEL, ok: false });
  });

  it("sem sigla nenhuma não lê nada", async () => {
    expect(await idsDoC2xDasSiglasAoVivo([" ", ""])).toEqual({ ids: [], ok: true, semId: [] });
    expect(m.catalogo).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
  });

  it("🔴 sigla nova força UMA releitura, que ignora o prazo SEM apagar o catálogo (`forcar`)", async () => {
    m.catalogo.mockResolvedValueOnce([JDG]).mockResolvedValueOnce([JDG, NOVO]);
    const r = await idsDoC2xDasSiglasAoVivo(["NOV"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [44], ok: true, semId: [] });
    expect(m.catalogo).toHaveBeenNthCalledWith(2, 1_000, { forcar: true });
  });

  it("🔴 o teto é POR SIGLA: a TST (que nunca estará no C2X) relê uma vez por minuto e não gasta o minuto da sigla nova", async () => {
    m.catalogo.mockResolvedValue([JDG]);
    await idsDoC2xDasSiglasAoVivo(["TST"], { agoraMs: 1_000 });
    await idsDoC2xDasSiglasAoVivo(["TST"], { agoraMs: 1_000 + RELEITURA_MINIMA_MS - 1 });
    expect(forcadas()).toBe(1);

    // Dez segundos depois da TST, nasce a NOV no C2X: ela relê por conta própria, e acha.
    m.catalogo.mockResolvedValueOnce([JDG]).mockResolvedValueOnce([JDG, NOVO]);
    const nova = await idsDoC2xDasSiglasAoVivo(["NOV"], { agoraMs: 11_000 });
    expect(forcadas()).toBe(2);
    expect(nova).toEqual({ ids: [44], ok: true, semId: [] });

    m.catalogo.mockResolvedValue([JDG]);
    const depois = await idsDoC2xDasSiglasAoVivo(["TST"], { agoraMs: 1_000 + RELEITURA_MINIMA_MS });
    expect(forcadas()).toBe(3);
    expect(depois).toEqual({ ids: [], ok: true, semId: ["TST"] });
  });

  it("releitura que falha fica com a tradução do catálogo que já estava na mão", async () => {
    m.catalogo.mockResolvedValueOnce([JDG]).mockResolvedValueOnce([]);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG", "NOV"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [40], ok: true, semId: ["NOV"] });
  });

  it("usa o catálogo e o cadastro que quem chama já tem", async () => {
    const r = await idsDoC2xDasSiglasAoVivo(["RDV"], {
      agoraMs: 1_000,
      cadastro: [{ c2xEnterpriseId: "43", codigo: "RDV", id: "x", nome: "Recanto", paiId: null }],
      catalogo: [JDG],
    });
    expect(r).toEqual({ ids: [43], ok: true, semId: [] });
    expect(m.catalogo).not.toHaveBeenCalled();
    expect(m.cadastro).not.toHaveBeenCalled();
  });

  it("🔴 O LIMITE: a sigla de antes do renome, com o catálogo JÁ relido, não acha nada (como `e.code in` não achava)", async () => {
    // A tela guardou RDV; o C2X e o catálogo já dizem PDI. Sem o cadastro, não há quem saiba que RDV
    // era o 43. Só a leitura pelo id atravessa esse caso.
    m.catalogo.mockResolvedValue([PDI_NO_CACHE]);
    const r = await idsDoC2xDasSiglasAoVivo(["RDV"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [], ok: true, semId: ["RDV"] });
  });

  it("a exclusão vale no fim, sobre todas as fontes, e `excluir: []` a desliga", async () => {
    m.catalogo.mockResolvedValue([JDG]);
    const cadastro = [{ c2xEnterpriseId: "31", codigo: "LAB", id: "l", nome: "Lagoa", paiId: null }];
    expect(await idsDoC2xDasSiglasAoVivo(["LAB"], { agoraMs: 1_000, cadastro })).toEqual({
      ids: [],
      ok: true,
      semId: [],
    });
    expect(
      await idsDoC2xDasSiglasAoVivo(["LAB"], { agoraMs: 1_000, cadastro, excluir: [] }),
    ).toEqual({ ids: [31], ok: true, semId: [] });
  });
});

describe("idsDoC2xDasSiglasAoVivo com `conferirNoC2x` (a sigla que a tela do Apolo leu ao vivo)", () => {
  it("a sigla que existe no C2X agora é traduzida por ele, sem ler o catálogo", async () => {
    m.noC2x = new Map([["JDG", [40]], ["VOC", [37]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG", "voc"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [37, 40], ok: true, semId: [] });
    expect(m.catalogo).not.toHaveBeenCalled();
    // As siglas vão como vieram: é o mesmo predicado de `e.code in (...)`.
    expect(m.query.mock.calls[0]?.[1]).toEqual(["JDG", "voc"]);
  });

  it("🔴 siglas TROCADAS no C2X dentro da janela do cache: vale o C2X de agora, e não o outro empreendimento", async () => {
    // O catálogo (de 5 minutos atrás) ainda diz JDG = 40; a Nívea deu a JDG ao 44.
    m.catalogo.mockResolvedValue([JDG]);
    m.noC2x = new Map([["JDG", [44]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [44], ok: true, semId: [] });
  });

  it("🔴 sigla recém-criada que o catálogo não conhece: responde na hora, sem esperar releitura", async () => {
    m.catalogo.mockResolvedValue([JDG]);
    m.noC2x = new Map([["NOV", [44]]]);
    // Outra sigla desconhecida acabou de gastar a releitura dela: não importa.
    await idsDoC2xDasSiglasAoVivo(["TST"], { agoraMs: 1_000 });
    const r = await idsDoC2xDasSiglasAoVivo(["NOV"], { agoraMs: 2_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [44], ok: true, semId: [] });
  });

  it("🔴 renome (a tela aberta antes dele manda RDV): o C2X não conhece mais, o catálogo em cache ainda salva", async () => {
    m.catalogo.mockResolvedValue([JDG, RDV_NO_CACHE]);
    m.noC2x = new Map([["PDI", [43]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["RDV"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [43], ok: true, semId: [] });
    // E não força releitura: o C2X acabou de dizer que RDV não existe, reler só perderia o 43.
    expect(forcadas()).toBe(0);
  });

  it("🔴 O LIMITE: renome com o catálogo já relido, a sigla de antes volta vazia", async () => {
    m.catalogo.mockResolvedValue([PDI_NO_CACHE]);
    m.noC2x = new Map([["PDI", [43]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["RDV"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [], ok: true, semId: ["RDV"] });
  });

  it("conferência que falha cai no caminho do catálogo, com a releitura dele", async () => {
    m.noC2x = null;
    m.catalogo.mockResolvedValueOnce([JDG]).mockResolvedValueOnce([JDG, NOVO]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG", "NOV"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [40, 44], ok: true, semId: [] });
    expect(forcadas()).toBe(1);
    erro.mockRestore();
  });

  it("C2X no ar e catálogo ilegível: fica o que o C2X respondeu, e o resto é sigla sem id (não é falha)", async () => {
    m.catalogo.mockResolvedValue([]);
    m.noC2x = new Map([["JDG", [40]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG", "XYZ"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [40], ok: true, semId: ["XYZ"] });
  });

  it("C2X fora na conferência E catálogo vazio: a mesma falha de sempre", async () => {
    m.noC2x = null;
    m.catalogo.mockResolvedValue([]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await idsDoC2xDasSiglasAoVivo(["JDG"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ erro: ERRO_CATALOGO_INDISPONIVEL, ok: false });
    erro.mockRestore();
  });

  it("a exclusão continua pelo id: o teste (34) achado no C2X agora não entra", async () => {
    m.noC2x = new Map([["TSC", [34]], ["JDG", [40]]]);
    const r = await idsDoC2xDasSiglasAoVivo(["TSC", "JDG"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [40], ok: true, semId: [] });
  });
});

describe("idsDoC2xDosPedidosAoVivo", () => {
  it("id numérico não lê catálogo nem cadastro", async () => {
    const r = await idsDoC2xDosPedidosAoVivo(["37", "100001", "31"]);
    expect(r).toEqual({ ids: [37], ok: true, semId: [] });
    expect(m.catalogo).not.toHaveBeenCalled();
    expect(m.cadastro).not.toHaveBeenCalled();
  });

  it("grupo lê os dois, juntos", async () => {
    m.catalogo.mockResolvedValue([VALE_DO_OURO]);
    m.cadastro.mockResolvedValue([]);
    const r = await idsDoC2xDosPedidosAoVivo(["group:Vale do Ouro"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [36, 37, 41], ok: true, semId: [] });
    expect(m.catalogo).toHaveBeenCalledTimes(1);
    expect(m.cadastro).toHaveBeenCalledTimes(1);
  });

  it("🔴 cadastro que lança e C2X fora não derrubam o grupo: os ids fixos respondem", async () => {
    m.catalogo.mockResolvedValue([]);
    m.cadastro.mockRejectedValue(new Error("supabase fora"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await idsDoC2xDosPedidosAoVivo(["group:Lagoa Bonita"], { agoraMs: 1_000 });
    expect(r).toEqual({ ids: [27, 32, 33], ok: true, semId: [] });
    erro.mockRestore();
  });
});
