import { describe, expect, it } from "vitest";

import { type BancoDaCarga, executarCarga } from "./carga";

// O espelho de `lsoft_parcelas` em memória, com o mesmo comportamento dos filtros que o importador
// usa no Supabase. A pergunta de cada teste é a mesma: depois que a carga termina, bem ou mal,
// o que a tela da Cecílio veria?

type Parcela = Record<string, unknown> & { empreendimento: string; id: string; sincronizado_em: string };

function espelhoFalso(
  inicial: Parcela[],
  falhas: {
    apagarAntigas?: boolean;
    /** O DELETE efetiva no banco, mas a resposta se perde e volta como erro. */
    apagarEfetivaMasErra?: boolean;
    clientes?: boolean;
    contar?: boolean;
    desfazer?: boolean;
    loteDeParcelas?: number;
  } = {},
) {
  let parcelas = [...inicial];
  let lotesGravados = 0;
  let seq = 0;
  const antigas = (empreendimentos: string[], marca: string) =>
    parcelas.filter((p) => empreendimentos.includes(p.empreendimento) && p.sincronizado_em !== marca);
  const banco: BancoDaCarga = {
    async apagarAntigas(empreendimentos, marca) {
      if (falhas.apagarAntigas) return { erro: "timeout no delete" };
      parcelas = parcelas.filter((p) => !(empreendimentos.includes(p.empreendimento) && p.sincronizado_em !== marca));
      if (falhas.apagarEfetivaMasErra) return { erro: "fetch failed" };
      return {};
    },
    async contarAntigas(empreendimentos, marca) {
      if (falhas.contar) return { erro: "sem conexão" };
      return { total: antigas(empreendimentos, marca).length };
    },
    async apagarDaCarga(marca) {
      if (falhas.desfazer) return { erro: "sem conexão" };
      parcelas = parcelas.filter((p) => p.sincronizado_em !== marca);
      return {};
    },
    async gravarClientes() {
      return falhas.clientes ? { erro: "clientes recusados" } : {};
    },
    async gravarParcelas(lote) {
      lotesGravados += 1;
      if (falhas.loteDeParcelas === lotesGravados) {
        // Um lote que falha no meio grava PARTE: é o pior caso, e é o que o CHECK faz na prática.
        const metade = lote.slice(0, Math.floor(lote.length / 2));
        for (const l of metade) parcelas.push({ ...(l as Parcela), id: `nova-${seq++}` });
        return { erro: 'violates check constraint "lsoft_parcelas_empreendimento_check"' };
      }
      for (const l of lote) parcelas.push({ ...(l as Parcela), id: `nova-${seq++}` });
      return {};
    },
  };
  return { banco, ver: () => parcelas };
}

const antiga = (id: string, empreendimento: string): Parcela => ({
  empreendimento,
  id,
  sincronizado_em: "2026-09-16T21:09:52.664886+00:00",
});

const nova = (empreendimento: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ empreendimento, parcela: `${i + 1}/${n}` }));

const MARCA = "2026-09-24T20:00:00.000000+00:00";

/** O estado de antes, para comparar com o de depois. */
const retrato = (ps: Parcela[]) => ps.map((p) => p.id).sort();

describe("a carga do LSoft", () => {
  it("dá certo: troca as parcelas dos empreendimentos da carga e deixa os outros em paz", async () => {
    const { banco, ver } = espelhoFalso([antiga("g1", "Garden"), antiga("g2", "Garden"), antiga("s1", "Vale do Sol")]);

    const r = await executarCarga({ banco, clientes: [{ codigo: "1" }], marca: MARCA, parcelas: nova("Garden", 3) });

    expect(r).toEqual({ clientes: 1, empreendimentos: ["Garden"], ok: true, parcelas: 3 });
    const depois = ver();
    expect(depois.filter((p) => p.empreendimento === "Garden").every((p) => p.sincronizado_em === MARCA)).toBe(true);
    expect(depois.filter((p) => p.empreendimento === "Garden")).toHaveLength(3);
    // ⚠️ O Vale do Sol não veio na carga, então não sai. Antes, sairia.
    expect(depois.find((p) => p.id === "s1")).toBeDefined();
  });

  it("a carga do Giant Towers não apaga o Garden (o 08/09 ao contrário)", async () => {
    // Em 08/09 às 17:47 uma carga só do Vale do Ouro apagou o Garden e o Vale do Sol inteiros.
    const garden = Array.from({ length: 10 }, (_, i) => antiga(`g${i}`, "Garden"));
    const { banco, ver } = espelhoFalso(garden);

    await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Giant Towers", 5) });

    expect(ver().filter((p) => p.empreendimento === "Garden")).toHaveLength(10);
    expect(ver().filter((p) => p.empreendimento === "Giant Towers")).toHaveLength(5);
  });

  it("um lote de parcelas falha no meio: o espelho volta EXATAMENTE ao de antes", async () => {
    // ⚠️ É o 08/09 às 17:06. Antes o espelho ficava vazio; agora nada muda para quem olha.
    const inicial = Array.from({ length: 700 }, (_, i) => antiga(`g${i}`, "Garden"));
    const { banco, ver } = espelhoFalso(inicial, { loteDeParcelas: 2 });

    const r = await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 1200) });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.passo).toBe("parcelas");
      expect(r.espelhoIntacto).toBe(true);
      expect(r.erro).toContain("lsoft_parcelas_empreendimento_check");
    }
    expect(retrato(ver())).toEqual(retrato(inicial));
  });

  it("gravou tudo, mas o apagamento das antigas falha: volta ao de antes, sem duplicata", async () => {
    const inicial = [antiga("g1", "Garden"), antiga("g2", "Garden")];
    const { banco, ver } = espelhoFalso(inicial, { apagarAntigas: true });

    const r = await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 4) });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.passo).toBe("apagar_antigas");
    expect(retrato(ver())).toEqual(retrato(inicial));
  });

  it("o DELETE efetivou mas a resposta se perdeu: NÃO desfaz, a carga deu certo", async () => {
    // ⚠️ O defeito que a revisão adversarial achou no desenho de 24/09. Antes desta regra, o
    // desfazer apagava as NOVAS, que já eram a única cópia do Garden, e a tela ficava vazia.
    const inicial = [antiga("g1", "Garden"), antiga("g2", "Garden"), antiga("s1", "Vale do Sol")];
    const { banco, ver } = espelhoFalso(inicial, { apagarEfetivaMasErra: true });

    const r = await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 3) });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.aviso).toContain("efetivou");
    const garden = ver().filter((p) => p.empreendimento === "Garden");
    expect(garden).toHaveLength(3);
    expect(garden.every((p) => p.sincronizado_em === MARCA)).toBe(true);
    expect(ver().find((p) => p.id === "s1")).toBeDefined();
  });

  it("o DELETE deu erro e nem a contagem responde: não mexe em NADA, e diz como consertar", async () => {
    // Sem prova de que as antigas estão lá, apagar as novas pode esvaziar o empreendimento. Fica em
    // dobro, que é recuperável, em vez de vazio, que não é.
    const inicial = [antiga("g1", "Garden")];
    const { banco, ver } = espelhoFalso(inicial, { apagarEfetivaMasErra: true, contar: true });

    const r = await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 2) });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.passo).toBe("apagar_antigas");
      expect(r.espelhoIntacto).toBe(false);
      expect(r.erro).toContain("NADA foi desfeito");
    }
    // As novas continuam: o Garden não ficou vazio.
    expect(ver().filter((p) => p.sincronizado_em === MARCA)).toHaveLength(2);
  });

  it("o PIOR caso, o desfazer também falha: as antigas continuam, nada se perde, e o erro diz como limpar", async () => {
    const inicial = [antiga("g1", "Garden"), antiga("g2", "Garden")];
    const { banco, ver } = espelhoFalso(inicial, { desfazer: true, loteDeParcelas: 1 });

    const r = await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 10) });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.passo).toBe("desfazer");
      expect(r.espelhoIntacto).toBe(false);
      expect(r.erro).toContain(MARCA);
    }
    // As duas antigas seguem lá: sobra lixo novo, mas nenhuma parcela antiga foi perdida.
    expect(ver().filter((p) => p.id === "g1" || p.id === "g2")).toHaveLength(2);
  });

  it("a carga seguinte limpa os restos de uma carga anterior que falhou", async () => {
    // Restos com outra marca, do mesmo empreendimento: são "antigas" para a carga nova, e saem.
    const restos: Parcela[] = [
      antiga("g1", "Garden"),
      { empreendimento: "Garden", id: "resto-1", sincronizado_em: "2026-09-20T10:00:00+00:00" },
    ];
    const { banco, ver } = espelhoFalso(restos);

    await executarCarga({ banco, clientes: [], marca: MARCA, parcelas: nova("Garden", 2) });

    expect(ver().map((p) => p.sincronizado_em)).toEqual([MARCA, MARCA]);
  });

  it("carga sem nenhuma parcela é recusada e não toca em nada", async () => {
    // Com o comportamento antigo, isto apagaria o espelho inteiro e gravaria zero.
    const inicial = [antiga("g1", "Garden")];
    const { banco, ver } = espelhoFalso(inicial);

    const r = await executarCarga({ banco, clientes: [{ codigo: "1" }], marca: MARCA, parcelas: [] });

    expect(r).toMatchObject({ espelhoIntacto: true, ok: false, passo: "validacao" });
    expect(retrato(ver())).toEqual(["g1"]);
  });

  it("parcela sem empreendimento recusa a carga antes de gravar qualquer coisa", async () => {
    const { banco, ver } = espelhoFalso([antiga("g1", "Garden")]);
    const r = await executarCarga({
      banco,
      clientes: [],
      marca: MARCA,
      parcelas: [...nova("Garden", 2), { empreendimento: "", parcela: "1/1" }],
    });
    expect(r).toMatchObject({ ok: false, passo: "validacao" });
    expect(retrato(ver())).toEqual(["g1"]);
  });

  it("falha nos clientes não encosta nas parcelas", async () => {
    const { banco, ver } = espelhoFalso([antiga("g1", "Garden")], { clientes: true });
    const r = await executarCarga({ banco, clientes: [{ codigo: "1" }], marca: MARCA, parcelas: nova("Garden", 3) });
    expect(r).toMatchObject({ espelhoIntacto: true, ok: false, passo: "clientes" });
    expect(retrato(ver())).toEqual(["g1"]);
  });

  it("carga sem marca é recusada", async () => {
    const { banco } = espelhoFalso([]);
    const r = await executarCarga({ banco, clientes: [], marca: "", parcelas: nova("Garden", 1) });
    expect(r).toMatchObject({ ok: false, passo: "validacao" });
  });
});
