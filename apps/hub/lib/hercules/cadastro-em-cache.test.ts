import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "./cadastro";
import {
  type CarimboDoCadastro,
  criarCacheDoCadastro,
  INTERVALO_DO_CARIMBO_MS,
  lerCarimboDoCadastro,
} from "./cadastro-em-cache";

// O CADASTRO EM CACHE, RENOVADO PELO CARIMBO (PAN-124, F1). O que estes testes cobram:
//   1. devolve o anterior quando a leitura falha (do carimbo ou do cadastro);
//   2. não confere antes de 30 s;
//   3. relê quando o carimbo muda (count ou max(atualizado_em)), e só aí;
//   4. uma conferência por vez; partida a frio sem banco devolve null e não vira rajada.

// O client fake do Supabase para `lerCarimboDoCadastro`: grava o que foi pedido e devolve `resposta`.
const banco = vi.hoisted(() => ({
  chamadas: [] as Array<[string, ...unknown[]]>,
  resposta: { count: 38 as null | number, data: [{ atualizado_em: "2026-09-24T21:05:50.081521+00:00" }] as unknown, error: null as unknown },
  semCliente: false,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => {
    if (banco.semCliente) return null;
    const builder = {
      eq: (...args: unknown[]) => (banco.chamadas.push(["eq", ...args]), builder),
      limit: (...args: unknown[]) => (banco.chamadas.push(["limit", ...args]), builder),
      order: (...args: unknown[]) => (banco.chamadas.push(["order", ...args]), builder),
      returns: () => builder,
      select: (...args: unknown[]) => (banco.chamadas.push(["select", ...args]), builder),
      then: (resolver: (valor: unknown) => unknown) => Promise.resolve(resolver(banco.resposta)),
    };
    return {
      from: (tabela: string) => (banco.chamadas.push(["from", tabela]), builder),
    };
  },
}));

function linha(codigo: string, c2x: null | string, pai: null | string = null, ordem = 0): LinhaDoCadastro {
  return {
    c2xEnterpriseId: c2x,
    cidade: null,
    codigo,
    id: `u-${codigo.toLowerCase()}`,
    nome: pai ? `Vale do Ouro · ${codigo}` : codigo === "VLO" ? "Vale do Ouro" : codigo,
    ordem,
    paiId: pai ? `u-${pai.toLowerCase()}` : null,
    uf: null,
    vendendo: true,
  };
}

const CADASTRO_1 = [linha("VLO", "35"), linha("VOC", "37", "VLO", 0), linha("VOL", "36", "VLO", 1)];
const CADASTRO_2 = [...CADASTRO_1, linha("VOR", "41", "VLO", 2)];

const CARIMBO_1: CarimboDoCadastro = { linhas: 3, ultimaEdicao: "2026-09-02T21:55:35.387+00:00" };

type Fontes = {
  cadastro: LinhaDoCadastro[];
  carimbo: CarimboDoCadastro;
  falharCadastro: boolean;
  falharCarimbo: boolean;
  lerCadastro: ReturnType<typeof vi.fn>;
  lerCarimbo: ReturnType<typeof vi.fn>;
};

function fontes(): Fontes {
  const f = {
    cadastro: CADASTRO_1,
    carimbo: CARIMBO_1,
    falharCadastro: false,
    falharCarimbo: false,
  } as Fontes;
  f.lerCarimbo = vi.fn(async () => {
    if (f.falharCarimbo) throw new Error("carimbo fora do ar");
    return { ...f.carimbo };
  });
  f.lerCadastro = vi.fn(async () => {
    if (f.falharCadastro) throw new Error("cadastro fora do ar");
    return [...f.cadastro];
  });
  return f;
}

function criar(f: Fontes) {
  return criarCacheDoCadastro({
    lerCadastro: f.lerCadastro as () => Promise<LinhaDoCadastro[]>,
    lerCarimbo: f.lerCarimbo as () => Promise<CarimboDoCadastro>,
  });
}

const T0 = 1_000_000;

let espiao: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  espiao = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  espiao.mockRestore();
});

describe("criarCacheDoCadastro", () => {
  it("o intervalo é de 30 s", () => {
    expect(INTERVALO_DO_CARIMBO_MS).toBe(30_000);
  });

  it("a primeira leitura confere o carimbo, lê o cadastro e monta a régua", async () => {
    const f = fontes();
    const cache = criar(f);

    const lido = await cache.ler(T0);

    expect(f.lerCarimbo).toHaveBeenCalledTimes(1);
    expect(f.lerCadastro).toHaveBeenCalledTimes(1);
    expect(lido?.linhas).toHaveLength(3);
    expect(lido?.regua.porId.get("37")?.nomeDeMercado).toBe("Vale do Ouro");
    expect(lido?.carimbo).toEqual(CARIMBO_1);
  });

  it("não confere antes de 30 s: nenhuma ida ao banco", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.carimbo = { linhas: 4, ultimaEdicao: "2026-09-26T12:00:00+00:00" };
    f.cadastro = CADASTRO_2;
    const dentroDoPrazo = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS - 1);

    expect(dentroDoPrazo).toBe(primeira);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(1);
    expect(f.lerCadastro).toHaveBeenCalledTimes(1);
  });

  it("carimbo igual depois de 30 s: confere e NÃO relê o cadastro", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    const segunda = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);

    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
    expect(f.lerCadastro).toHaveBeenCalledTimes(1);
    expect(segunda?.regua).toBe(primeira?.regua);
    expect(segunda?.conferidoEmMs).toBe(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(segunda?.lidoEmMs).toBe(T0);

    // E o prazo recomeça da conferência, não da leitura.
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS - 1);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
  });

  it("relê quando o count muda (linha nova)", async () => {
    const f = fontes();
    const cache = criar(f);
    await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, linhas: 4 };
    f.cadastro = CADASTRO_2;
    const relido = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);

    expect(f.lerCadastro).toHaveBeenCalledTimes(2);
    expect(relido?.regua.grupos[0]?.siglas).toEqual(["VOC", "VOL", "VOR"]);
  });

  it("relê quando o max(atualizado_em) muda (edição), mesmo com o count igual", async () => {
    const f = fontes();
    const cache = criar(f);
    await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, ultimaEdicao: "2026-09-26T12:00:00+00:00" };
    f.cadastro = CADASTRO_1.map((l) => (l.codigo === "VLO" ? { ...l, nome: "Vale do Ouro Novo" } : l));
    const relido = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);

    expect(f.lerCadastro).toHaveBeenCalledTimes(2);
    expect(relido?.regua.porId.get("37")?.nomeDeMercado).toBe("Vale do Ouro Novo");
  });

  it("carimbo que falha: devolve o anterior e só tenta de novo depois de 30 s", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.falharCarimbo = true;
    const naFalha = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(naFalha?.regua).toBe(primeira?.regua);
    expect(naFalha?.linhas).toEqual(primeira?.linhas);

    // Não vira rajada: dentro do prazo seguinte, nem tenta.
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS - 1);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);

    f.falharCarimbo = false;
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(3);
    expect(espiao).toHaveBeenCalled();
  });

  it("cadastro que falha depois de o carimbo mudar: devolve o anterior e relê na conferência seguinte", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, linhas: 4 };
    f.cadastro = CADASTRO_2;
    f.falharCadastro = true;
    const naFalha = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(naFalha?.regua).toBe(primeira?.regua);
    // O carimbo novo não foi guardado: é ele que faz a próxima conferência reler.
    expect(naFalha?.carimbo).toEqual(CARIMBO_1);

    f.falharCadastro = false;
    const relido = await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS);
    expect(f.lerCadastro).toHaveBeenCalledTimes(3);
    expect(relido?.carimbo.linhas).toBe(4);
    expect(relido?.regua.porId.has("41")).toBe(true);
  });

  it("partida a frio sem banco: null, sem nova tentativa antes de 30 s, e depois carrega", async () => {
    const f = fontes();
    f.falharCarimbo = true;
    const cache = criar(f);

    expect(await cache.ler(T0)).toBeNull();
    expect(await cache.ler(T0 + 1_000)).toBeNull();
    expect(f.lerCarimbo).toHaveBeenCalledTimes(1);

    f.falharCarimbo = false;
    const carregado = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(carregado?.linhas).toHaveLength(3);
  });

  it("partida a frio com o cadastro falhando também devolve null", async () => {
    const f = fontes();
    f.falharCadastro = true;
    const cache = criar(f);
    expect(await cache.ler(T0)).toBeNull();
  });

  it("quem chega durante uma conferência espera a MESMA", async () => {
    const f = fontes();
    const cache = criar(f);

    const [a, b, c] = await Promise.all([cache.ler(T0), cache.ler(T0), cache.ler(T0)]);

    expect(f.lerCarimbo).toHaveBeenCalledTimes(1);
    expect(f.lerCadastro).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("esquecer força a próxima leitura inteira", async () => {
    const f = fontes();
    const cache = criar(f);
    await cache.ler(T0);
    cache.esquecer();
    await cache.ler(T0 + 1);
    expect(f.lerCadastro).toHaveBeenCalledTimes(2);
  });
});

describe("lerCarimboDoCadastro", () => {
  beforeEach(() => {
    banco.chamadas = [];
    banco.semCliente = false;
    banco.resposta = { count: 38, data: [{ atualizado_em: "2026-09-24T21:05:50.081521+00:00" }], error: null };
  });

  it("uma requisição: count exato e a linha de atualizado_em mais recente, do workspace", async () => {
    const carimbo = await lerCarimboDoCadastro();

    expect(carimbo).toEqual({ linhas: 38, ultimaEdicao: "2026-09-24T21:05:50.081521+00:00" });
    expect(banco.chamadas).toEqual([
      ["from", "hercules_empreendimentos"],
      ["select", "atualizado_em", { count: "exact" }],
      ["eq", "workspace_id", "careli"],
      ["order", "atualizado_em", { ascending: false }],
      ["limit", 1],
    ]);
  });

  it("cadastro vazio: count 0 e sem última edição", async () => {
    banco.resposta = { count: 0, data: [], error: null };
    expect(await lerCarimboDoCadastro()).toEqual({ linhas: 0, ultimaEdicao: null });
  });

  it("lança no erro, sem contagem e sem cliente (o cache mantém o anterior)", async () => {
    banco.resposta = { count: null, data: null, error: { message: "fora do ar" } };
    await expect(lerCarimboDoCadastro()).rejects.toThrow(/fora do ar/);

    banco.resposta = { count: null, data: [], error: null };
    await expect(lerCarimboDoCadastro()).rejects.toThrow(/contagem/);

    banco.semCliente = true;
    await expect(lerCarimboDoCadastro()).rejects.toThrow(/sem configuração/);
  });
});
