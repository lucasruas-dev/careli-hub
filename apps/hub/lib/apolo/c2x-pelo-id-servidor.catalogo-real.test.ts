import { beforeEach, describe, expect, it, vi } from "vitest";

// A TRADUÇÃO COM O CATÁLOGO DE VERDADE (e o cache dele), e só o MySQL falso (revisão do PAN-124,
// 25/09/2026). A primeira versão da releitura APAGAVA o cache antes de reler: se o C2X oscilasse
// naquele instante, a releitura falhava e toda leitura da instância (nomes do Board, escopo do portal,
// tradução sigla → id) passava a receber `[]` até o C2X voltar. O teste com o catálogo trocado não via
// isso, porque trocava também o `limparCacheDoCatalogo`.

const c2x = vi.hoisted(() => ({
  catalogo: [] as Array<{ code: string; id: number; name: string }>,
  // Quantas consultas ao catálogo o C2X recebeu, e se ele está respondendo.
  consultasDoCatalogo: 0,
  fora: false,
  // Segura a resposta do catálogo até o teste soltar (para medir leituras simultâneas).
  segurar: null as null | Promise<void>,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        if (c2x.fora) throw new Error("C2X fora");
        if (/select e\.id, e\.code, e\.name/.test(sql)) {
          c2x.consultasDoCatalogo += 1;
          if (c2x.segurar) await c2x.segurar;
          return [c2x.catalogo.filter((e) => !params.includes(e.id))];
        }
        // A conferência da sigla (`e.code in`).
        return [c2x.catalogo.filter((e) => params.includes(e.code))];
      },
    },
  }),
}));

vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: vi.fn() }));

import { catalogoDeEmpreendimentos, limparCacheDoCatalogo } from "./catalogo-empreendimentos";
import { esquecerReleituraDoCatalogo, idsDoC2xDasSiglasAoVivo } from "./c2x-pelo-id-servidor";

const JDG = { code: "JDG", id: 40, name: "JARDIM DAS GERAIS" };
const ACT = { code: "ACT", id: 30, name: "ALDEIA" };

beforeEach(() => {
  limparCacheDoCatalogo();
  esquecerReleituraDoCatalogo();
  c2x.catalogo = [JDG, ACT];
  c2x.consultasDoCatalogo = 0;
  c2x.fora = false;
  c2x.segurar = null;
});

describe("a releitura forçada não apaga o catálogo", () => {
  it("🔴 C2X oscilando + sigla desconhecida: a releitura falha e o catálogo anterior CONTINUA servindo a instância", async () => {
    expect((await catalogoDeEmpreendimentos(1_000)).map((e) => e.id)).toEqual(["30", "40"]);

    c2x.fora = true;
    // A TST (produto só do Panteon) força a releitura, que falha.
    const tst = await idsDoC2xDasSiglasAoVivo(["TST"], { agoraMs: 2_000 });
    expect(tst).toEqual({ ids: [], ok: true, semId: ["TST"] });
    expect(c2x.consultasDoCatalogo).toBe(1);

    // O Board, o escopo do portal e a próxima tradução continuam com o catálogo de antes.
    expect((await catalogoDeEmpreendimentos(3_000)).map((e) => e.id)).toEqual(["30", "40"]);
    expect(await idsDoC2xDasSiglasAoVivo(["JDG"], { agoraMs: 3_000 })).toEqual({
      ids: [40],
      ok: true,
      semId: [],
    });
  });

  it("forçar ignora o prazo e troca o catálogo quando a leitura volta", async () => {
    await catalogoDeEmpreendimentos(1_000);
    c2x.catalogo = [JDG, ACT, { code: "NOV", id: 44, name: "NOVO" }];
    expect(await catalogoDeEmpreendimentos(2_000)).toHaveLength(2);
    expect(await catalogoDeEmpreendimentos(2_000, { forcar: true })).toHaveLength(3);
    // E o novo passa a ser o do cache.
    expect(await catalogoDeEmpreendimentos(3_000)).toHaveLength(3);
    expect(c2x.consultasDoCatalogo).toBe(2);
  });

  it("forçar com o C2X fora e sem catálogo anterior devolve vazio (e a tradução responde a falha)", async () => {
    c2x.fora = true;
    expect(await catalogoDeEmpreendimentos(1_000, { forcar: true })).toEqual([]);
    expect(await idsDoC2xDasSiglasAoVivo(["JDG"], { agoraMs: 1_000 })).toMatchObject({ ok: false });
  });

  it("🔴 leituras simultâneas esperam a MESMA consulta (as abas do Apolo abrem juntas)", async () => {
    let soltar = () => undefined as void;
    c2x.segurar = new Promise<void>((r) => {
      soltar = r;
    });
    const leituras = [
      catalogoDeEmpreendimentos(1_000),
      catalogoDeEmpreendimentos(1_000),
      catalogoDeEmpreendimentos(1_000, { forcar: true }),
    ];
    soltar();
    const [a, b, c] = await Promise.all(leituras);
    expect(c2x.consultasDoCatalogo).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a sigla da tela conferida no C2X não depende do catálogo", async () => {
    c2x.catalogo = [JDG];
    const r = await idsDoC2xDasSiglasAoVivo(["JDG"], { agoraMs: 1_000, conferirNoC2x: true });
    expect(r).toEqual({ ids: [40], ok: true, semId: [] });
    expect(c2x.consultasDoCatalogo).toBe(0);
  });
});
