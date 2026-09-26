import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "./cadastro";
import {
  type CacheDoCadastro,
  type CarimboDoCadastro,
  comPrazo,
  criarCacheDoCadastro,
  INTERVALO_DO_CARIMBO_MS,
  lerCarimboDoCadastro,
  type OpcoesDoCache,
  PRAZO_DA_LEITURA_MS,
} from "./cadastro-em-cache";

// O CADASTRO EM CACHE, RENOVADO PELO CARIMBO (PAN-124, F1). O que estes testes cobram:
//   1. devolve o anterior quando a leitura falha (do carimbo ou do cadastro), inclusive por prazo;
//   2. não confere antes de 30 s;
//   3. relê quando o carimbo muda (count ou max(atualizado_em)), e só aí;
//   4. uma conferência por vez; partida a frio sem banco devolve null e não vira rajada;
//   5. com cadastro guardado, ninguém espera o banco: o guardado sai na hora e a conferência corre em
//      segundo plano (revisão de 26/09/2026: carimbo que não responde pendurava todos os leitores).

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
      abortSignal: (...args: unknown[]) => (banco.chamadas.push(["abortSignal", ...args]), builder),
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

function criar(f: Fontes, opcoes?: OpcoesDoCache) {
  return criarCacheDoCadastro(
    {
      lerCadastro: f.lerCadastro as (sinal: AbortSignal) => Promise<LinhaDoCadastro[]>,
      lerCarimbo: f.lerCarimbo as (sinal: AbortSignal) => Promise<CarimboDoCadastro>,
    },
    opcoes,
  );
}

// Lê passado o intervalo (a leitura devolve o guardado na hora) e espera a conferência em segundo plano.
async function lerEEsperar(cache: CacheDoCadastro, agoraMs: number) {
  const naHora = await cache.ler(agoraMs);
  await cache.emAndamento();
  return naHora;
}

// Uma promessa que nunca resolve: o Supabase pendurado.
const PENDURADO = () => new Promise<never>(() => undefined);

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

  it("carimbo igual depois de 30 s: confere em segundo plano e NÃO relê o cadastro", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    // A leitura que dispara a conferência devolve o guardado na hora.
    expect(await lerEEsperar(cache, T0 + INTERVALO_DO_CARIMBO_MS)).toBe(primeira);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
    expect(f.lerCadastro).toHaveBeenCalledTimes(1);

    const segunda = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(segunda?.regua).toBe(primeira?.regua);
    expect(segunda?.conferidoEmMs).toBe(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(segunda?.lidoEmMs).toBe(T0);

    // E o prazo recomeça da conferência, não da leitura.
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS - 1);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
  });

  it("relê quando o count muda (linha nova), e o novo vale a partir da leitura seguinte", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, linhas: 4 };
    f.cadastro = CADASTRO_2;
    expect(await lerEEsperar(cache, T0 + INTERVALO_DO_CARIMBO_MS)).toBe(primeira);
    const relido = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);

    expect(f.lerCadastro).toHaveBeenCalledTimes(2);
    expect(relido?.regua.grupos[0]?.siglas).toEqual(["VOC", "VOL", "VOR"]);
  });

  it("relê quando o max(atualizado_em) muda (edição), mesmo com o count igual", async () => {
    const f = fontes();
    const cache = criar(f);
    await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, ultimaEdicao: "2026-09-26T12:00:00+00:00" };
    f.cadastro = CADASTRO_1.map((l) => (l.codigo === "VLO" ? { ...l, nome: "Vale do Ouro Novo" } : l));
    await lerEEsperar(cache, T0 + INTERVALO_DO_CARIMBO_MS);
    const relido = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);

    expect(f.lerCadastro).toHaveBeenCalledTimes(2);
    expect(relido?.regua.porId.get("37")?.nomeDeMercado).toBe("Vale do Ouro Novo");
  });

  it("carimbo que falha: devolve o anterior e só tenta de novo depois de 30 s", async () => {
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.falharCarimbo = true;
    await lerEEsperar(cache, T0 + INTERVALO_DO_CARIMBO_MS);
    const naFalha = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(naFalha?.regua).toBe(primeira?.regua);
    expect(naFalha?.linhas).toEqual(primeira?.linhas);

    // Não vira rajada: dentro do prazo seguinte, nem tenta.
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS - 1);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);

    f.falharCarimbo = false;
    await lerEEsperar(cache, T0 + 2 * INTERVALO_DO_CARIMBO_MS);
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
    await lerEEsperar(cache, T0 + INTERVALO_DO_CARIMBO_MS);
    const naFalha = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(naFalha?.regua).toBe(primeira?.regua);
    // O carimbo novo não foi guardado: é ele que faz a próxima conferência reler.
    expect(naFalha?.carimbo).toEqual(CARIMBO_1);

    f.falharCadastro = false;
    await lerEEsperar(cache, T0 + 2 * INTERVALO_DO_CARIMBO_MS);
    const relido = await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS + 1);
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

  it("quem chega durante a partida a frio espera a MESMA", async () => {
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

  it("a conferência que começou antes do esquecer não grava por cima", async () => {
    const f = fontes();
    const cache = criar(f);
    await cache.ler(T0);

    let soltar: (carimbo: CarimboDoCadastro) => void = () => undefined;
    f.lerCarimbo.mockImplementationOnce(() => new Promise((resolver) => (soltar = resolver)));
    await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);
    const velha = cache.emAndamento();
    cache.esquecer();
    soltar({ ...CARIMBO_1 });
    await velha;

    // Nada guardado: a próxima leitura é partida a frio, e espera.
    expect(cache.emAndamento()).toBeNull();
    const nova = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(nova?.lidoEmMs).toBe(T0 + INTERVALO_DO_CARIMBO_MS + 1);
  });
});

describe("criarCacheDoCadastro · banco lento ou pendurado", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o prazo é de 5 s", () => {
    expect(PRAZO_DA_LEITURA_MS).toBe(5_000);
  });

  it("com cadastro guardado, carimbo que NÃO RESPONDE não segura ninguém: uma conferência só, e o anterior", async () => {
    vi.useFakeTimers();
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    const sinais: AbortSignal[] = [];
    f.lerCarimbo.mockImplementation((sinal: AbortSignal) => (sinais.push(sinal), PENDURADO()));

    // O que a revisão mediu pendurado (T0 + 30 s, + 31 s, + 120 s): agora sai na hora, sem avançar o relógio.
    expect(await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS)).toBe(primeira);
    expect(await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1_000)).toBe(primeira);
    expect(await cache.ler(T0 + 4 * INTERVALO_DO_CARIMBO_MS)).toBe(primeira);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
    expect(cache.emAndamento()).not.toBeNull();

    // Passado o prazo, a conferência desiste: aborta a requisição e conta como falha.
    await vi.advanceTimersByTimeAsync(PRAZO_DA_LEITURA_MS);
    expect(cache.emAndamento()).toBeNull();
    expect(sinais[0]?.aborted).toBe(true);
    expect(String(espiao.mock.calls.at(-1)?.[1])).toMatch(/passou do prazo de 5000 ms/);

    // Fica o anterior, e a próxima tentativa é só depois do intervalo, contado do começo da conferência.
    const depois = await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS - 1);
    expect(depois?.regua).toBe(primeira?.regua);
    expect(depois?.conferidoEmMs).toBe(T0 + INTERVALO_DO_CARIMBO_MS);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(2);
    await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS);
    expect(f.lerCarimbo).toHaveBeenCalledTimes(3);
  });

  it("cadastro que não responde depois de o carimbo mudar: fica o anterior, e relê na seguinte", async () => {
    vi.useFakeTimers();
    const f = fontes();
    const cache = criar(f);
    const primeira = await cache.ler(T0);

    f.carimbo = { ...CARIMBO_1, linhas: 4 };
    f.cadastro = CADASTRO_2;
    f.lerCadastro.mockImplementationOnce(PENDURADO);
    expect(await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS)).toBe(primeira);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_LEITURA_MS);

    const naFalha = await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(naFalha?.regua).toBe(primeira?.regua);
    expect(naFalha?.carimbo).toEqual(CARIMBO_1);

    await lerEEsperar(cache, T0 + 2 * INTERVALO_DO_CARIMBO_MS);
    expect((await cache.ler(T0 + 2 * INTERVALO_DO_CARIMBO_MS + 1))?.carimbo.linhas).toBe(4);
  });

  it("partida a frio com o carimbo pendurado: null no prazo, e não tenta de novo antes de 30 s", async () => {
    vi.useFakeTimers();
    const f = fontes();
    f.lerCarimbo.mockImplementation(PENDURADO);
    const cache = criar(f);

    const aFrio = cache.ler(T0);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_LEITURA_MS);
    expect(await aFrio).toBeNull();

    expect(await cache.ler(T0 + 1_000)).toBeNull();
    expect(f.lerCarimbo).toHaveBeenCalledTimes(1);
  });

  it("a conferência em segundo plano vai para quem segura a função (after), uma vez por conferência", async () => {
    const segurar = vi.fn();
    const f = fontes();
    const cache = criar(f, { segurarAteTerminar: segurar });

    await cache.ler(T0);
    // A partida a frio é esperada por quem chamou: não precisa segurar.
    expect(segurar).not.toHaveBeenCalled();

    let soltar: (carimbo: CarimboDoCadastro) => void = () => undefined;
    f.lerCarimbo.mockImplementationOnce(() => new Promise((resolver) => (soltar = resolver)));
    await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS);
    await cache.ler(T0 + INTERVALO_DO_CARIMBO_MS + 1);
    expect(segurar).toHaveBeenCalledTimes(1);
    expect(segurar.mock.calls[0]?.[0]).toBe(cache.emAndamento());

    soltar({ ...CARIMBO_1 });
    await expect(segurar.mock.calls[0]?.[0]).resolves.toMatchObject({ conferidoEmMs: T0 + INTERVALO_DO_CARIMBO_MS });
  });
});

describe("comPrazo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devolve o que a leitura trouxe dentro do prazo, e não deixa relógio ligado", async () => {
    vi.useFakeTimers();
    expect(await comPrazo(async () => 42, 1_000, "x")).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repassa o erro da leitura", async () => {
    await expect(comPrazo(async () => Promise.reject(new Error("fora do ar")), 1_000, "x")).rejects.toThrow(
      /fora do ar/,
    );
  });

  it("estourado, lança e aborta o sinal, mesmo que a leitura o ignore", async () => {
    vi.useFakeTimers();
    let recebido: AbortSignal | undefined;
    const lendo = comPrazo(
      (sinal) => {
        recebido = sinal;
        return PENDURADO();
      },
      1_000,
      "A leitura",
    );
    const esperado = expect(lendo).rejects.toThrow("A leitura passou do prazo de 1000 ms.");
    await vi.advanceTimersByTimeAsync(1_000);
    await esperado;
    expect(recebido?.aborted).toBe(true);
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

  it("com sinal, a mesma requisição, abortável", async () => {
    const sinal = new AbortController().signal;
    await lerCarimboDoCadastro(sinal);
    expect(banco.chamadas.at(-1)).toEqual(["abortSignal", sinal]);
    expect(banco.chamadas.filter(([nome]) => nome === "from")).toHaveLength(1);
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
