import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { devolverVendaNoIndeferimento } from "./indeferimento-na-venda-server";

// O INDEFERIMENTO DE UM CARD DA TÊMIS CHEGANDO NA VENDA DO HÉRCULES.
//
// Medido em produção (18/09/2026): a Nívea indeferiu os pedidos de cancelamento do VOL1106 e do
// VOC0306 e os cards de contrato das mesmas vendas, e as duas vendas ficaram em `contrato` com a
// marca do pedido de pé: a tela Venda mostrava "Cancelamento pedido" e não oferecia mais nada.
//
//   • B: pedido de cancelamento/distrato indeferido = pedido RECUSADO. A marca sai (só se existir,
//     só na venda viva, só se não sobrou outro pedido aberto), e a venda fica onde estava;
//   • C: contrato indeferido = devolve a quem vendeu. A venda volta de `contrato` para `proposta`
//     (só de `contrato`, e nunca com envelope vivo), com o movimento no histórico.
//
// O banco é um dublê em memória, pequeno, que filtra de verdade e confere as colunas.

type Linha = Record<string, unknown>;
type Consulta = { filtros: string[]; operacao: "insert" | "select" | "update"; tabela: string };

const COLUNAS: Record<string, readonly string[]> = {
  hercules_proposta_etapas: [
    "autor_nome", "de", "motivo", "observacao", "para", "proposta_id", "quando", "workspace_id",
  ],
  hercules_propostas: [
    "atualizado_em", "cancelamento_pedido_em", "cancelamento_pedido_motivo", "cancelamento_pedido_por",
    "cancelamento_pedido_tipo", "codigo", "etapa", "etapa_desde", "etapa_por", "id", "protocolo_numero",
    "workspace_id",
  ],
  temis_envelopes: ["criado_em", "envelope_id", "estado", "falha", "id", "proposta_id", "provedor"],
  // As três do indeferimento conferidas no schema de produção em 18/09/2026 (information_schema).
  temis_trabalhos: [
    "criado_em",
    "estagio",
    "id",
    "indeferido_em",
    "indeferido_motivo",
    "indeferido_observacao",
    "indeferido_por_nome",
    "proposta_id",
    "tipo",
    "workspace_id",
  ],
};

function banco(inicial: Record<string, Linha[]>) {
  const tabelas = new Map(Object.entries(inicial).map(([t, ls]) => [t, ls.map((l) => ({ ...l }))]));
  const consultas: Consulta[] = [];
  const problemas: string[] = [];
  const falhas: Array<(c: Consulta) => boolean> = [];
  const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

  const from = (tabela: string) => {
    const consulta: Consulta = { filtros: [], operacao: "select", tabela };
    const filtros: Array<(l: Linha) => boolean> = [];
    let carga: Linha = {};
    let cargas: Linha[] = [];
    let unico = false;
    const conferir = (c: string) => {
      if (!(COLUNAS[tabela] ?? []).includes(c)) problemas.push(`${tabela}.${c}`);
    };
    const executar = () => {
      consultas.push(consulta);
      if (falhas.some((f) => f(consulta))) return { data: null, error: { code: "08006", message: "caiu" } };
      const todas = tabelas.get(tabela) ?? [];
      tabelas.set(tabela, todas);
      if (consulta.operacao === "insert") {
        for (const l of cargas) todas.push({ ...l });
        return { data: null, error: null };
      }
      const casadas = todas.filter((l) => filtros.every((f) => f(l)));
      if (consulta.operacao === "update") for (const l of casadas) Object.assign(l, carga);
      if (unico) return { data: casadas[0] ?? null, error: null };
      return { data: casadas.map((l) => ({ ...l })), error: null };
    };
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => {
        conferir(c);
        consulta.filtros.push(`eq:${c}=${String(v)}`);
        filtros.push((l) => txt(l[c]) === txt(v));
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        conferir(c);
        consulta.filtros.push(`in:${c}=${vs.join(",")}`);
        filtros.push((l) => vs.map(txt).includes(txt(l[c])));
        return q;
      },
      insert: (l: Linha | Linha[]) => {
        consulta.operacao = "insert";
        cargas = Array.isArray(l) ? l : [l];
        for (const linha of cargas) for (const c of Object.keys(linha)) conferir(c);
        return q;
      },
      is: (c: string, v: unknown) => {
        conferir(c);
        consulta.filtros.push(`is:${c}=${String(v)}`);
        if (v === null) filtros.push((l) => txt(l[c]) === null);
        else problemas.push(`is(${String(v)}) não imitado`);
        return q;
      },
      limit: () => q,
      maybeSingle: () => {
        unico = true;
        return q;
      },
      not: (c: string, op: string, v: unknown) => {
        conferir(c);
        consulta.filtros.push(`not:${c}.${op}.${String(v)}`);
        if (op === "is" && v === null) filtros.push((l) => txt(l[c]) !== null);
        else if (op === "in") {
          const lista = String(v).slice(1, -1).split(",");
          filtros.push((l) => !lista.includes(String(l[c])));
        } else problemas.push(`not(${op}) não imitado`);
        return q;
      },
      order: (c: string) => {
        conferir(c);
        return q;
      },
      select: (lista: string) => {
        for (const c of lista.split(",").map((s) => s.trim())) conferir(c);
        return q;
      },
      then: (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve().then(executar).then(ok, falha),
      update: (patch: Linha) => {
        consulta.operacao = "update";
        for (const c of Object.keys(patch)) conferir(c);
        carga = patch;
        return q;
      },
    };
    return q;
  };

  return {
    cliente: { from } as unknown as SupabaseClient,
    consultas,
    falhar: (f: (c: Consulta) => boolean) => falhas.push(f),
    linha: (tabela: string, id: string) => (tabelas.get(tabela) ?? []).find((l) => l.id === id),
    linhas: (tabela: string) => tabelas.get(tabela) ?? [],
    problemas,
  };
}

const bancos: Array<ReturnType<typeof banco>> = [];
afterEach(() => {
  for (const b of bancos.splice(0)) expect(b.problemas).toEqual([]);
  vi.restoreAllMocks();
});

/** A venda do VOC0306 (COD 000021) como estava presa: em contrato, com a marca do pedido. */
function vendaPresa(
  extra: { cards?: Linha[]; envelopes?: Linha[]; estagioDoContrato?: string; venda?: Linha } = {},
) {
  const b = banco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        cancelamento_pedido_em: "2026-09-17T12:00:00.000Z",
        cancelamento_pedido_motivo: "Cliente desistiu",
        cancelamento_pedido_por: "Nivea",
        cancelamento_pedido_tipo: "cancelamento",
        codigo: null,
        etapa: "contrato",
        etapa_desde: "2026-09-12T12:00:00.000Z",
        id: "venda-21",
        protocolo_numero: 21,
        workspace_id: "careli",
        ...extra.venda,
      },
    ],
    temis_envelopes: extra.envelopes ?? [],
    temis_trabalhos: [
      { estagio: "indeferido", id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento", workspace_id: "careli" },
      {
        criado_em: "2026-09-16T12:00:00.000Z",
        estagio: extra.estagioDoContrato ?? "indeferido",
        id: "card-contrato",
        indeferido_em: "2026-09-17T13:25:42.466Z",
        indeferido_motivo: "outro",
        indeferido_observacao: "Contrato não será gerado, pois foi solicitado o cancelamento",
        indeferido_por_nome: "Nivea",
        proposta_id: "venda-21",
        tipo: "contrato",
        workspace_id: "careli",
      },
      ...(extra.cards ?? []),
    ],
  });
  bancos.push(b);
  return b;
}

const quem = { motivo: "outro", observacao: "Cancelamento não será realizado", usuarioNome: "Nivea" };
const escritas = (b: ReturnType<typeof banco>) => b.consultas.filter((c) => c.operacao !== "select");

describe("B: o pedido de cancelamento indeferido é o pedido RECUSADO", () => {
  it("a marca do pedido sai da venda, e a venda continua em contrato (o contrato ainda anda)", async () => {
    const b = vendaPresa({ estagioDoContrato: "contrato" });

    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);

    expect(r.feito).toBe("carimbo_limpo");
    // ⚠️ A HISTÓRIA ANTES DA LIMPEZA (rodada 2, 18/09/2026): quem pediu, quando e por quê, e a recusa,
    // viram movimento da venda. Sem isto a ficha do lote perdia "Cancelamento solicitado".
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({
        autor_nome: "Nivea",
        de: null,
        motivo: "Cliente desistiu",
        para: "pedido_de_cancelamento",
        quando: "2026-09-17T12:00:00.000Z",
      }),
      expect.objectContaining({
        autor_nome: "Nivea",
        de: null,
        motivo: "Outro motivo",
        observacao: "Cancelamento não será realizado",
        para: "pedido_de_cancelamento_indeferido",
      }),
    ]);
    expect(r.recado).toContain("o Hércules volta a oferecer o pedido de cancelamento");
    expect(b.linha("hercules_propostas", "venda-21")).toMatchObject({
      cancelamento_pedido_em: null,
      cancelamento_pedido_motivo: null,
      cancelamento_pedido_por: null,
      cancelamento_pedido_tipo: null,
      etapa: "contrato",
    });
  });

  it("⚠️ VOL1106: o contrato já foi indeferido, e com o pedido recusado a venda volta para Proposta", async () => {
    // A Nívea indeferiu o contrato ("Contrato não será gerado, pois foi solicitado o cancelamento") e
    // depois o pedido ("Cancelamento não será realizado, pois não foi gerado contrato nem boletos").
    // Sem contrato, a saída é a proposta: quem vendeu a cancela no Hércules e o lote volta.
    const b = vendaPresa();

    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);

    expect(r.feito).toBe("voltou_para_proposta");
    expect(r.aviso).toBeNull();
    expect(r.recado).toContain("voltou para Proposta");
    expect(b.linha("hercules_propostas", "venda-21")).toMatchObject({
      cancelamento_pedido_em: null,
      etapa: "proposta",
      etapa_por: "Nivea",
    });
    // A história fica inteira: o pedido, a recusa e a volta, com o motivo do contrato indeferido.
    expect(b.linhas("hercules_proposta_etapas").map((m) => m.para)).toEqual([
      "pedido_de_cancelamento",
      "pedido_de_cancelamento_indeferido",
      "proposta",
    ]);
    expect(b.linhas("hercules_proposta_etapas")[2]).toMatchObject({
      de: "contrato",
      observacao: "Contrato não será gerado, pois foi solicitado o cancelamento",
    });
  });

  it("⚠️ pedido de DISTRATO recusado não devolve a venda para Proposta: o lote não pode sair sem devolução", async () => {
    const b = vendaPresa({ venda: { cancelamento_pedido_tipo: "distrato" } });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "distrato" }, quem);
    expect(r.feito).toBe("carimbo_limpo");
    expect(b.linha("hercules_propostas", "venda-21")).toMatchObject({ cancelamento_pedido_em: null, etapa: "contrato" });
    expect(b.linhas("hercules_proposta_etapas").map((m) => m.para)).toEqual([
      "pedido_de_distrato",
      "pedido_de_distrato_indeferido",
    ]);
  });

  it("⚠️ o contrato indeferido numa passagem ANTERIOR por contrato não devolve a venda", async () => {
    // A venda voltou a contrato em 18/09, depois do indeferimento de 17/09: aquele indeferimento é de
    // outro contrato.
    const b = vendaPresa({ venda: { etapa_desde: "2026-09-18T10:00:00.000Z" } });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("carimbo_limpo");
    expect(b.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
  });

  it("contrato indeferido, mas com envelope vivo: a marca sai e a venda fica em contrato, com o aviso", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = vendaPresa({
      envelopes: [{ criado_em: "2026-09-16T13:00:00.000Z", envelope_id: "env-1", estado: "enviado", falha: null, id: "reg-1", proposta_id: "venda-21", provedor: "clicksign" }],
    });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("carimbo_limpo");
    expect(r.aviso).toContain("envelope vivo");
    // A notícia do pedido vem primeiro: quem indeferiu sabe que a marca saiu.
    expect(r.aviso).toMatch(/^Pedido de cancelamento indeferido, e a marca do pedido saiu da venda\./);
    expect(b.linha("hercules_propostas", "venda-21")).toMatchObject({ cancelamento_pedido_em: null, etapa: "contrato" });
  });

  it("a escrita é condicional: só com a marca lida e só na venda viva", async () => {
    const b = vendaPresa();
    await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "distrato" }, quem);
    const limpeza = escritas(b).find((c) => c.tabela === "hercules_propostas");
    // A marca QUE FOI LIDA: um pedido novo que entrou no meio tem marca própria, e fica.
    expect(limpeza?.filtros).toContain("eq:cancelamento_pedido_em=2026-09-17T12:00:00.000Z");
    expect(limpeza?.filtros).toContain("in:etapa=reservado,proposta,contrato,assinatura,faturado");
  });

  it("venda que já caiu guarda a marca (é história da ficha do lote)", async () => {
    const b = vendaPresa({ venda: { etapa: "cancelado" } });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("nada");
    expect(b.linha("hercules_propostas", "venda-21")?.cancelamento_pedido_em).not.toBeNull();
  });

  it("outro pedido ainda aberto para a mesma venda: a marca fica", async () => {
    const b = vendaPresa({
      cards: [{ estagio: "analise", id: "card-outro", proposta_id: "venda-21", tipo: "distrato", workspace_id: "careli" }],
    });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("nada");
    expect(r.recado).toContain("outro pedido aberto");
    expect(escritas(b)).toEqual([]);
  });

  it("a história que não grava segura a marca: a ficha do lote não perde o pedido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = vendaPresa();
    b.falhar((c) => c.tabela === "hercules_proposta_etapas");
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("nada");
    expect(r.aviso).toContain("a marca do pedido ficou nela");
    expect(b.linha("hercules_propostas", "venda-21")?.cancelamento_pedido_em).not.toBeNull();
  });

  it("não conseguir conferir os outros pedidos não limpa a marca", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = vendaPresa();
    b.falhar((c) => c.tabela === "temis_trabalhos");
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-pedido", proposta_id: "venda-21", tipo: "cancelamento" }, quem);
    expect(r.feito).toBe("nada");
    expect(r.aviso).toContain("a marca do pedido ficou na venda");
    expect(escritas(b)).toEqual([]);
  });
});

/** A venda em contrato SEM pedido de cancelamento: é a que o contrato indeferido devolve. */
const semPedido = (extra: Parameters<typeof vendaPresa>[0] = {}) =>
  vendaPresa({ ...extra, venda: { cancelamento_pedido_em: null, ...extra.venda } });

describe("C: o contrato indeferido volta a quem vendeu", () => {
  it("com pedido de cancelamento aberto a venda NÃO volta (senão cairia pelo Cancelar proposta, sem distrato)", async () => {
    const b = vendaPresa();
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);
    expect(r.feito).toBe("nada");
    expect(r.recado).toContain("tem pedido de cancelamento aberto");
    expect(b.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
    expect(escritas(b)).toEqual([]);
  });

  it("com outro card de contrato aberto (o contrato novo já anda) a venda NÃO volta", async () => {
    const b = semPedido({
      cards: [{ estagio: "analise", id: "card-contrato-novo", proposta_id: "venda-21", tipo: "contrato", workspace_id: "careli" }],
    });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);
    expect(r.feito).toBe("nada");
    expect(r.recado).toContain("tem outro card aberto");
    expect(escritas(b)).toEqual([]);
  });

  it("a venda sai de contrato para proposta, e o passo entra no histórico", async () => {
    const b = semPedido();

    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);

    expect(r.feito).toBe("voltou_para_proposta");
    expect(r.recado).toBe(
      "Contrato indeferido. A venda COD 000021 voltou para Proposta no Hércules: quem vendeu corrige e envia de novo.",
    );
    const venda = b.linha("hercules_propostas", "venda-21");
    expect(venda).toMatchObject({ etapa: "proposta", etapa_por: "Nivea" });
    expect(venda?.etapa_desde).not.toBe("2026-09-12T12:00:00.000Z");
    // A condição vai na escrita: se a venda já andou, ou se um pedido chegou, nada se mexe.
    expect(escritas(b)[0]?.filtros).toContain("eq:etapa=contrato");
    expect(escritas(b)[0]?.filtros).toContain("is:cancelamento_pedido_em=null");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({
        autor_nome: "Nivea",
        de: "contrato",
        motivo: "Contrato indeferido na Têmis: Outro motivo",
        observacao: "Cancelamento não será realizado",
        para: "proposta",
        proposta_id: "venda-21",
      }),
    ]);
  });

  it.each(["assinatura", "faturado", "cancelado"])("venda em %s não se mexe", async (etapa) => {
    const b = semPedido({ venda: { etapa } });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);
    expect(r.feito).toBe("nada");
    expect(escritas(b)).toEqual([]);
  });

  it("envelope vivo segura a venda em contrato, com aviso e log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = semPedido({
      envelopes: [
        {
          criado_em: "2026-09-13T12:00:00.000Z",
          envelope_id: "env-vivo",
          estado: "aguardando",
          falha: null,
          id: "reg-1",
          proposta_id: "venda-21",
          provedor: "clicksign",
        },
      ],
    });

    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);

    expect(r.feito).toBe("nada");
    expect(r.aviso).toContain("existe envelope vivo deste contrato na Clicksign (env-vivo)");
    expect(b.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
    expect(aviso).toHaveBeenCalled();
  });

  it("envelope já morto (cancelado) não segura", async () => {
    const b = semPedido({
      envelopes: [
        {
          criado_em: "2026-09-13T12:00:00.000Z",
          envelope_id: "env-morto",
          estado: "cancelado",
          falha: null,
          id: "reg-1",
          proposta_id: "venda-21",
          provedor: "clicksign",
        },
      ],
    });
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);
    expect(r.feito).toBe("voltou_para_proposta");
  });

  it("leitura do envelope que falha também segura", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = semPedido();
    b.falhar((c) => c.tabela === "temis_envelopes");
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" }, quem);
    expect(r.feito).toBe("nada");
    expect(escritas(b)).toEqual([]);
  });
});

describe("o que não mexe na venda", () => {
  it("card sem venda ligada: nada, sem consultar", async () => {
    const b = vendaPresa();
    const r = await devolverVendaNoIndeferimento(b.cliente, { id: "x", proposta_id: null, tipo: "contrato" }, quem);
    expect(r).toEqual({ aviso: null, feito: "nada", recado: null });
    expect(b.consultas).toEqual([]);
  });

  it("cessão e cancelamento por correção não mexem na venda", async () => {
    const b = vendaPresa();
    for (const tipo of ["cessao", "cancelamento_correcao"]) {
      const r = await devolverVendaNoIndeferimento(b.cliente, { id: "x", proposta_id: "venda-21", tipo }, quem);
      expect(r.feito).toBe("nada");
    }
    expect(b.consultas).toEqual([]);
  });
});
