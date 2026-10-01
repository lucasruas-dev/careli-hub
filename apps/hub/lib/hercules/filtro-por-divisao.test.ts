import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aplicarFiltroDaDivisao,
  ehColunaDaDivisaoAusente,
  type FiltroDaDivisao,
  lerPelaDivisao,
  limparMemoriaDaMigration0205,
} from "./filtro-por-divisao";

// A LEITURA PELO ID DA DIVISÃO (PAN-124, F5). O que estes testes cobram:
//   1. as duas partes (id; sem id pela sigla) unidas pelo `id`, sem repetir linha;
//   2. sem a 0205, só a sigla, e a memória de 60 s evita tentar de novo;
//   3. lotes de 100 nos dois `in`;
//   4. erro que não é de coluna volta como veio, sem trocar de modo.

type Linha = { empreendimento_codigo: string; enterprise_id: null | string; id: string };

// As linhas do "banco": uma proposta já com id (37), uma ainda sem id (VOC) e uma de outro produto.
const BANCO: Linha[] = [
  { empreendimento_codigo: "VOC", enterprise_id: "37", id: "p1" },
  { empreendimento_codigo: "VOC", enterprise_id: null, id: "p2" },
  { empreendimento_codigo: "GDN", enterprise_id: "39", id: "p3" },
];

/** Um `ler` que filtra o BANCO como o PostgREST filtraria, e grava os filtros pedidos. */
function lerDoBanco(semColuna = false) {
  const pedidos: FiltroDaDivisao[] = [];
  const ler = vi.fn(async (filtro: FiltroDaDivisao) => {
    pedidos.push(filtro);
    if (semColuna && filtro.tipo !== "sigla") {
      return { data: null, error: { code: "42703", message: "column hercules_propostas.enterprise_id does not exist" } };
    }
    const data = BANCO.filter((l) => {
      if (filtro.tipo === "ids") return l.enterprise_id !== null && filtro.valores.includes(l.enterprise_id);
      if (filtro.tipo === "sigla-sem-id") return l.enterprise_id === null && filtro.valores.includes(l.empreendimento_codigo);
      return filtro.valores.includes(l.empreendimento_codigo);
    });
    return { data, error: null };
  });
  return { ler, pedidos };
}

describe("lerPelaDivisao", () => {
  beforeEach(() => limparMemoriaDaMigration0205());

  it("une a linha com id e a ainda sem id, e deixa o outro produto de fora", async () => {
    const { ler } = lerDoBanco();
    const r = await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: ["37"] }, ler);

    expect(r.error).toBeNull();
    expect(r.data?.map((l) => l.id).sort()).toEqual(["p1", "p2"]);
  });

  it("🔴 o renome no C2X não tira a proposta: a sigla nova não casa, o id casa", async () => {
    // O catálogo do C2X passa a chamar o 37 de "VCX"; a linha gravada continua "VOC" e com o id 37.
    const { ler } = lerDoBanco();
    const r = await lerPelaDivisao<Linha>({ codes: ["VCX"], ids: ["37"] }, ler);

    expect(r.data?.map((l) => l.id)).toEqual(["p1"]);
  });

  it("a mesma linha pelas duas partes não repete", async () => {
    const ler = async () => ({ data: [BANCO[0]!], error: null });
    const r = await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: ["37"] }, ler);

    expect(r.data).toHaveLength(1);
  });

  it("sem a 0205: só a sigla, como antes, e a próxima leitura nem tenta o id", async () => {
    const primeira = lerDoBanco(true);
    const r = await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: ["37"] }, primeira.ler);

    expect(r.data?.map((l) => l.id).sort()).toEqual(["p1", "p2"]);
    expect(primeira.pedidos.map((p) => p.tipo)).toEqual(["ids", "sigla"]);

    const segunda = lerDoBanco(true);
    await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: ["37"] }, segunda.ler);
    expect(segunda.pedidos.map((p) => p.tipo)).toEqual(["sigla"]);
  });

  it("em lotes de 100, nos ids e nas siglas, sem repetir valor", async () => {
    const { ler, pedidos } = lerDoBanco();
    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));
    const codes = Array.from({ length: 150 }, (_, i) => `C${i}`);
    await lerPelaDivisao<Linha>({ codes: [...codes, "C0"], ids: [...ids, " 1 "] }, ler);

    expect(pedidos.filter((p) => p.tipo === "ids").map((p) => p.valores.length)).toEqual([100, 100, 50]);
    expect(pedidos.filter((p) => p.tipo === "sigla-sem-id").map((p) => p.valores.length)).toEqual([100, 50]);
  });

  it("erro que não é de coluna volta como veio, sem cair para a sigla", async () => {
    const erro = { code: "57014", message: "canceling statement due to statement timeout" };
    const ler = vi.fn(async () => ({ data: null, error: erro }));
    const r = await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: ["37"] }, ler);

    expect(r).toEqual({ data: null, error: erro });
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("sem ids (código sem cadastro e sem catálogo), a parte da sigla ainda acha a linha sem id", async () => {
    const { ler } = lerDoBanco();
    const r = await lerPelaDivisao<Linha>({ codes: ["VOC"], ids: [] }, ler);

    expect(r.data?.map((l) => l.id)).toEqual(["p2"]);
  });
});

describe("aplicarFiltroDaDivisao", () => {
  function consultaQueGrava() {
    const chamadas: string[] = [];
    const consulta = {
      in(coluna: string, valores: readonly string[]) {
        chamadas.push(`in:${coluna}=${valores.join(",")}`);
        return consulta;
      },
      is(coluna: string, valor: null) {
        chamadas.push(`is:${coluna}=${String(valor)}`);
        return consulta;
      },
    };
    return { chamadas, consulta };
  }

  it("cada filtro vira o where certo", () => {
    const a = consultaQueGrava();
    aplicarFiltroDaDivisao(a.consulta, { tipo: "ids", valores: ["37", "36"] });
    expect(a.chamadas).toEqual(["in:enterprise_id=37,36"]);

    const b = consultaQueGrava();
    aplicarFiltroDaDivisao(b.consulta, { tipo: "sigla-sem-id", valores: ["VOC"] });
    expect(b.chamadas).toEqual(["is:enterprise_id=null", "in:empreendimento_codigo=VOC"]);

    const c = consultaQueGrava();
    aplicarFiltroDaDivisao(c.consulta, { tipo: "sigla", valores: ["VOC"] });
    expect(c.chamadas).toEqual(["in:empreendimento_codigo=VOC"]);
  });

  it("só o erro DESTA coluna é coluna ausente", () => {
    expect(ehColunaDaDivisaoAusente({ code: "42703", message: "column hercules_propostas.enterprise_id does not exist" })).toBe(true);
    expect(ehColunaDaDivisaoAusente({ code: "PGRST204", message: "Could not find the 'enterprise_id' column" })).toBe(true);
    expect(ehColunaDaDivisaoAusente({ code: "42703", message: "column etapa does not exist" })).toBe(false);
    expect(ehColunaDaDivisaoAusente(null)).toBe(false);
  });
});
