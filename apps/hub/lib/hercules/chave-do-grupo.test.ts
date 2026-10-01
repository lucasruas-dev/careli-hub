import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveCasa,
  chaveDoGrupoDe,
  chaveDoGrupoPendente,
  ehColunaDaChaveAusente,
  lerComChaveDoGrupo,
  limparMemoriaDaMigration0203,
  paiDaChave,
} from "./chave-do-grupo";

// A CHAVE DO GRUPO (PAN-124, F4). O que estes testes cobram:
//   1. a chave da coluna vence o nome; sem a coluna, vale o nome (como antes da F4);
//   2. o pai renomeado continua achado pela chave, e quem mostra usa o nome NOVO;
//   3. sem a migration 0203, a leitura repete sem a coluna, e lembra disso por 60 s;
//   4. só o erro DESTA coluna é engolido.

const LAB_RENOMEADO = { chaveDoGrupo: "Lagoa Bonita", nome: "Lagoa Bonita Residencial", paiId: null };

describe("chave do grupo", () => {
  it("a coluna vence o nome; sem ela, o nome", () => {
    expect(chaveDoGrupoDe(LAB_RENOMEADO)).toBe("Lagoa Bonita");
    expect(chaveDoGrupoDe({ chaveDoGrupo: null, nome: " Vale do Ouro " })).toBe("Vale do Ouro");
    expect(chaveDoGrupoDe({ chaveDoGrupo: "  ", nome: "Rio de Pedras" })).toBe("Rio de Pedras");
    expect(chaveDoGrupoDe({})).toBe("");
  });

  it("o pai renomeado casa pela chave, sem caixa e sem acento, e não pelo nome novo", () => {
    expect(chaveCasa(LAB_RENOMEADO, "lagoa bonita")).toBe(true);
    expect(chaveCasa(LAB_RENOMEADO, "Lagoa Bonita Residencial")).toBe(false);
    expect(chaveCasa({ nome: "Pará de Minas" }, "PARA DE MINAS")).toBe(true);
    expect(chaveCasa(LAB_RENOMEADO, "")).toBe(false);
  });

  it("acha o pai pela chave para mostrar o nome atual dele; filho não conta", () => {
    const cadastro = [
      { chaveDoGrupo: null, nome: "Lagoa Bonita · LBF", paiId: "lab" },
      LAB_RENOMEADO,
    ];

    expect(paiDaChave(cadastro, "Lagoa Bonita")?.nome).toBe("Lagoa Bonita Residencial");
    expect(paiDaChave(cadastro, "Lagoa Bonita · LBF")).toBeNull();
    expect(paiDaChave(cadastro, "Vale do Ouro")).toBeNull();
  });

  it("só o erro de coluna DESTA migration é engolido", () => {
    expect(ehColunaDaChaveAusente({ code: "42703", message: "column hercules_empreendimentos.chave_do_grupo does not exist" })).toBe(true);
    expect(ehColunaDaChaveAusente({ code: "PGRST204", message: "Could not find the 'chave_do_grupo' column" })).toBe(true);
    expect(ehColunaDaChaveAusente({ code: "42703", message: "column nomee does not exist" })).toBe(false);
    expect(ehColunaDaChaveAusente({ code: "57014", message: "chave_do_grupo timeout" })).toBe(false);
    expect(ehColunaDaChaveAusente(null)).toBe(false);
  });
});

describe("leitura com a chave do grupo", () => {
  beforeEach(() => limparMemoriaDaMigration0203());

  it("com a coluna, uma ida só, e o select leva a chave", async () => {
    const ler = vi.fn(async () => ({ data: [{ id: "1" }], error: null }));

    const r = await lerComChaveDoGrupo("id, nome", ler);

    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler).toHaveBeenCalledWith("id, nome, chave_do_grupo");
    expect(r.data).toEqual([{ id: "1" }]);
  });

  it("sem a 0203, repete sem a coluna e lembra: a próxima já vai sem", async () => {
    const ler = vi.fn(async (selecao: string) =>
      selecao.includes("chave_do_grupo")
        ? { data: null, error: { code: "42703", message: "column chave_do_grupo does not exist" } }
        : { data: [{ id: "1" }], error: null },
    );

    const r = await lerComChaveDoGrupo("id, nome", ler);
    expect(r).toEqual({ data: [{ id: "1" }], error: null });
    expect(ler.mock.calls.map((c) => c[0])).toEqual(["id, nome, chave_do_grupo", "id, nome"]);
    expect(chaveDoGrupoPendente()).toBe(true);

    await lerComChaveDoGrupo("id, nome", ler);
    expect(ler.mock.calls.map((c) => c[0])).toEqual(["id, nome, chave_do_grupo", "id, nome", "id, nome"]);
  });

  it("outro erro volta como veio, sem repetir e sem marcar a migration como pendente", async () => {
    const erro = { code: "57014", message: "canceling statement due to statement timeout" };
    const ler = vi.fn(async () => ({ data: null, error: erro }));

    const r = await lerComChaveDoGrupo("id", ler);

    expect(r.error).toBe(erro);
    expect(ler).toHaveBeenCalledTimes(1);
    expect(chaveDoGrupoPendente()).toBe(false);
  });
});
