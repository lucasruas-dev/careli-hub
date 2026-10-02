import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQL_ABRE_LEITURA, SQL_FECHA_LEITURA } from "@/lib/assinatura/espelho-d4sign/c2x";

import {
  SQL_PARCELAS_DA_ENTRADA,
  SQL_PEDIDO_DO_ENVIO,
  SQL_PEDIDOS_DAS_UNIDADES,
  SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES,
  TIMEOUT_DA_CONSULTA_NA_TELA_MS,
} from "./c2x";
import { lerEntradaDaVenda, TETO_DA_LEITURA_MS } from "./ler-entrada";

// A LEITURA DA ENTRADA COM O CARD ABRINDO: Panteon falso e C2X falso, nenhum dos dois é o de verdade.
//
// O que fica travado:
//   • o casamento na ordem da F8 (carga pelo `origem_c2x_id`, D4Sign pelo envio, Clicksign pelo
//     terreno e pelo comprador), com "ambíguo" para dois candidatos e "sem pedido" para nenhum;
//   • (revisão de 02/10/2026) o pedido do terreno nascido antes da venda não casa sozinho (VOR Q14
//     L01); sem candidato vivo, o desfeito do comprador nascido depois da venda aparece; a venda do
//     Garden nem abre o C2X; o pedido sem parcela nenhuma sai "sem financeiro";
//   • no C2X só SELECT, dentro de `START TRANSACTION READ ONLY`, e a conexão volta (COMMIT + release);
//   • falha e teto viram `falhou`, a conexão que falhou é DESTRUÍDA (também quando é o próprio
//     START TRANSACTION que falha), e nada lança;
//   • o documento do comprador não sai na resposta.

const DOC = "11122233344";
const HOJE = () => new Date("2026-10-02T15:00:00Z");

type Linha = Record<string, unknown>;

// ── O PANTEON FALSO ─────────────────────────────────────────────────────────

type Chamada = { filtros: unknown[][]; tabela: string };

function panteon(dados: {
  envelopes?: Linha[];
  erroEm?: string;
  outrasVendas?: Linha[];
  unidades?: Linha[];
  venda: Linha | null;
}) {
  const chamadas: Chamada[] = [];
  const responder = (c: Chamada) => {
    if (dados.erroEm === c.tabela) return { count: null, data: null, error: { message: "fora do ar" } };
    if (c.tabela === "hercules_propostas") {
      return c.filtros.some((f) => f[0] === "in")
        ? { count: null, data: dados.outrasVendas ?? [], error: null }
        : { count: null, data: dados.venda, error: null };
    }
    if (c.tabela === "temis_envelopes") return { count: null, data: dados.envelopes ?? [], error: null };
    if (c.tabela === "hercules_unidades") {
      const todas = dados.unidades ?? [];
      const faixa = c.filtros.find((f) => f[0] === "range") as [string, number, number];
      return { count: todas.length, data: todas.slice(faixa[1], faixa[2] + 1), error: null };
    }
    return { count: null, data: [], error: null };
  };
  const sb = {
    from: (tabela: string) => {
      const chamada: Chamada = { filtros: [], tabela };
      chamadas.push(chamada);
      const q: Record<string, unknown> = {};
      for (const metodo of ["eq", "in", "is", "limit", "maybeSingle", "not", "order", "range", "select"]) {
        q[metodo] = (...args: unknown[]) => {
          chamada.filtros.push([metodo, ...args]);
          return q;
        };
      }
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => responder(chamada))
          .then(ok, falha);
      return q;
    },
  };
  return { chamadas, sb: sb as unknown as SupabaseClient };
}

// ── O C2X FALSO ─────────────────────────────────────────────────────────────

function c2x(respostas: {
  desfeitos?: Linha[];
  envio?: Linha[];
  falharEm?: string;
  parcelas?: Linha[];
  pedidosDasUnidades?: Linha[];
  semFim?: string;
}) {
  const sqls: string[] = [];
  const parametros: unknown[] = [];
  const tetos: unknown[] = [];
  const conexao = {
    destroy: vi.fn(),
    query: vi.fn(async (opcoes: { sql: string; timeout?: number }, params?: unknown[]) => {
      sqls.push(opcoes.sql);
      parametros.push(params);
      tetos.push(opcoes.timeout);
      if (respostas.semFim && opcoes.sql === respostas.semFim) return new Promise(() => undefined);
      if (respostas.falharEm && opcoes.sql === respostas.falharEm) {
        throw Object.assign(new Error("Query inactivity timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });
      }
      if (opcoes.sql === SQL_PEDIDO_DO_ENVIO) return [respostas.envio ?? []];
      if (opcoes.sql === SQL_PEDIDOS_DAS_UNIDADES) return [respostas.pedidosDasUnidades ?? []];
      if (opcoes.sql === SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES) return [respostas.desfeitos ?? []];
      if (opcoes.sql === SQL_PARCELAS_DA_ENTRADA) return [respostas.parcelas ?? []];
      return [[]];
    }),
    release: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conexao) };
  return { conexao, parametros, pool: pool as unknown as Pick<Pool, "getConnection">, sqls, tetos };
}

const parcela = (campos: Linha): Linha => ({
  apagada: 0,
  ar_id: 5020,
  estagio: 5,
  marcado_em_brasilia: "2026-09-28 08:16:00",
  pago_em: null,
  parcela_do_sinal: 0,
  status: 6,
  total_de_parcelas: 40,
  total_do_sinal: 1,
  valor: "1000.00",
  vencimento: "2026-09-28",
  ...campos,
});

/** As parcelas do REP D L163 (pedido 5020), como o C2X as tinha em 02/10/2026. */
const PARCELAS_DO_5020 = [
  parcela({ parcela_id: 383381, status: 7, tipo: 1, valor: "1000.00", vencimento: "2026-09-28" }),
  parcela({ parcela_do_sinal: 1, parcela_id: 383382, status: 7, tipo: 2, valor: "8390.00", vencimento: "2026-09-29" }),
  parcela({ pago_em: "2026-09-28", parcela_id: 390001, status: 5, tipo: 4, valor: "1000.00" }),
  parcela({ pago_em: "2026-09-28", parcela_id: 390002, status: 5, tipo: 4, valor: "8390.00" }),
];

const ENVELOPE_D4SIGN = {
  c2x_contract_signature_id: 3803,
  criado_em: "2026-09-23T13:54:00-03:00",
  envelope_id: "uuid-do-c2x",
  enviado_em: "2026-09-23T13:54:00-03:00",
  estado: "parcial",
  falha: null,
  finalidade: "contrato",
  id: "env-1",
  provedor: "d4sign",
};

const ENVELOPE_CLICKSIGN = { ...ENVELOPE_D4SIGN, c2x_contract_signature_id: null, envelope_id: "env-clicksign", provedor: "clicksign" };

const VENDA_NATIVA = {
  cliente_documento: "111.222.333-44",
  criado_em: "2026-09-16T15:25:33.913804-03:00",
  id: "venda-1",
  origem: "panteon",
  origem_c2x_id: null,
  unidade: { enterprise_id: "36" },
  unidade_id: "u-vol",
};

/** Um pedido redigitado no C2X DEPOIS da venda nativa (o caso de sempre). */
const DEPOIS_DA_VENDA = "2026-09-22 10:00:00";

/** O terreno do VOL Q03 L11: a linha viva da VOL e a do pai VLO apontando para ela, entre 1.500 outras. */
const UNIDADES = [
  { enterprise_id: "36", espelho_de: null, id: "u-vol", lote: "11", origem_c2x_id: 5576, quadra: "03" },
  { enterprise_id: "35", espelho_de: "u-vol", id: "u-vlo", lote: "11", origem_c2x_id: 5277, quadra: "03" },
  ...Array.from({ length: 1500 }, (_, i) => ({
    enterprise_id: "99",
    espelho_de: null,
    id: `x-${String(i).padStart(4, "0")}`,
    lote: String(i),
    origem_c2x_id: 90000 + i,
    quadra: "Z",
  })),
];

afterEach(() => {
  vi.restoreAllMocks();
});

function soLeitura(sqls: string[]) {
  for (const sql of sqls) {
    const ok = sql === SQL_ABRE_LEITURA || sql === SQL_FECHA_LEITURA || /^\s*select\b/i.test(sql);
    expect(ok, sql).toBe(true);
  }
  expect(sqls[0]).toBe(SQL_ABRE_LEITURA);
}

describe("lerEntradaDaVenda: o casamento", () => {
  it("D4Sign: o pedido do envio, as parcelas e os Avulso pagos à parte (REP D L163)", async () => {
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], unidades: UNIDADES, venda: VENDA_NATIVA });
    const m = c2x({ envio: [{ ar_id: 5020 }], parcelas: PARCELAS_DO_5020 });

    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });

    expect(r).toMatchObject({ paga: false, pedido: 5020, regra: "envio_d4sign", situacao: "lida" });
    if (r.situacao !== "lida") throw new Error("esperava lida");
    expect(r.entrada).toMatchObject({ rotulo: "Ato", situacao: "vencida", valor: 1000 });
    expect(r.avulsosPagos.map((a) => a.valor)).toEqual([1000, 8390]);
    // O envio da D4Sign dispensa o terreno: nem a tabela de unidades nem os pedidos do lote são lidos.
    expect(p.chamadas.some((c) => c.tabela === "hercules_unidades")).toBe(false);
    expect(m.sqls).not.toContain(SQL_PEDIDOS_DAS_UNIDADES);
    expect(m.parametros[m.sqls.indexOf(SQL_PEDIDO_DO_ENVIO)]).toEqual([3803]);
    soLeitura(m.sqls);
    expect(m.sqls.at(-1)).toBe(SQL_FECHA_LEITURA);
    expect(m.conexao.release).toHaveBeenCalledTimes(1);
    expect(m.conexao.destroy).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(DOC);
  });

  it("D4Sign sem o envio no C2X: sem pedido, sem cair no terreno", async () => {
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], unidades: UNIDADES, venda: VENDA_NATIVA });
    const m = c2x({ envio: [] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" });
    expect(m.sqls).not.toContain(SQL_PEDIDOS_DAS_UNIDADES);
    expect(m.sqls).not.toContain(SQL_PARCELAS_DA_ENTRADA);
  });

  it("carga: pelo origem_c2x_id, sem envio e sem terreno", async () => {
    const p = panteon({ venda: { ...VENDA_NATIVA, origem: "c2x", origem_c2x_id: 4400 } });
    const m = c2x({ parcelas: [parcela({ ar_id: 4400, pago_em: "2026-08-01", parcela_id: 1, status: 5, tipo: 1 })] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toMatchObject({ paga: true, pedido: 4400, regra: "origem_c2x_id", situacao: "lida" });
    expect(m.sqls).toEqual([SQL_ABRE_LEITURA, SQL_PARCELAS_DA_ENTRADA, SQL_FECHA_LEITURA]);
    expect(m.parametros[1]).toEqual([4400]);
  });

  it("Clicksign: o pedido do mesmo comprador no terreno (a união pega a linha do pai)", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NATIVA });
    const m = c2x({
      parcelas: [parcela({ ar_id: 5012, pago_em: "2026-09-23", parcela_do_sinal: 1, parcela_id: 2, status: 5, tipo: 2, total_do_sinal: 3, valor: "4345.10" })],
      pedidosDasUnidades: [{ ar_id: 5012, criado_em_brasilia: DEPOIS_DA_VENDA, documento: "111.222.333-44", estagio: 4 }],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toMatchObject({ paga: true, pedido: 5012, regra: "terreno_mesmo_comprador", situacao: "lida" });
    if (r.situacao !== "lida") throw new Error("esperava lida");
    expect(r.entrada).toMatchObject({ pagoEm: "2026-09-23", rotulo: "Sinal 1/3", valor: 4345.1 });
    // A tabela inteira em duas páginas (1.502 linhas), e as unidades do C2X do terreno: VOL e VLO.
    expect(p.chamadas.filter((c) => c.tabela === "hercules_unidades")).toHaveLength(2);
    const unidadesPedidas = m.parametros[m.sqls.indexOf(SQL_PEDIDOS_DAS_UNIDADES)] as number[][];
    expect([...(unidadesPedidas[0] ?? [])].sort()).toEqual([5277, 5576]);
    soLeitura(m.sqls);
    expect(JSON.stringify(r)).not.toContain(DOC);
  });

  it("Clicksign: dois pedidos vivos do mesmo comprador é AMBÍGUO, e as parcelas nem são lidas", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NATIVA });
    const m = c2x({
      pedidosDasUnidades: [
        { ar_id: 5011, criado_em_brasilia: DEPOIS_DA_VENDA, documento: DOC, estagio: 3 },
        { ar_id: 5012, criado_em_brasilia: DEPOIS_DA_VENDA, documento: DOC, estagio: 4 },
      ],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "dois_pedidos", situacao: "ambiguo" });
    expect(m.sqls).not.toContain(SQL_PARCELAS_DA_ENTRADA);
    expect(m.conexao.release).toHaveBeenCalledTimes(1);
  });

  it("Clicksign: nenhum pedido vivo no lote = a venda não foi digitada (VOL Q07 L10)", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NATIVA });
    const m = c2x({ pedidosDasUnidades: [] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" });
    // Sem candidato vivo, os desfeitos do terreno são lidos, a partir da hora de parede da venda.
    const i = m.sqls.indexOf(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES);
    expect(i).toBeGreaterThan(m.sqls.indexOf(SQL_PEDIDOS_DAS_UNIDADES));
    const [unidades, desde] = m.parametros[i] as [number[], string];
    expect([...unidades].sort()).toEqual([5277, 5576]);
    expect(desde).toBe("2026-09-16 15:25:33");
    soLeitura(m.sqls);
  });

  it("o pedido que já é de outra venda do Panteon no lote não conta", async () => {
    const p = panteon({
      envelopes: [ENVELOPE_CLICKSIGN],
      outrasVendas: [{ id: "venda-antiga", origem_c2x_id: 5012 }],
      unidades: UNIDADES,
      venda: VENDA_NATIVA,
    });
    const m = c2x({ pedidosDasUnidades: [{ ar_id: 5012, criado_em_brasilia: DEPOIS_DA_VENDA, documento: DOC, estagio: 4 }] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "pedido_de_venda_desfeita", situacao: "sem_pedido_no_c2x" });
  });

  it("unidade sem id no C2X: sem pedido, e o C2X nem é aberto", async () => {
    const p = panteon({
      envelopes: [ENVELOPE_CLICKSIGN],
      unidades: [{ enterprise_id: "36", espelho_de: null, id: "u-vol", lote: "11", origem_c2x_id: null, quadra: "03" }],
      venda: VENDA_NATIVA,
    });
    const m = c2x({});
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" });
    expect(m.pool.getConnection).not.toHaveBeenCalled();
  });

  it("o pedido ligado não existe no C2X: sem pedido", async () => {
    const p = panteon({ venda: { ...VENDA_NATIVA, origem: "c2x", origem_c2x_id: 4400 } });
    const m = c2x({ parcelas: [] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "pedido_nao_achado_no_c2x", situacao: "sem_pedido_no_c2x" });
  });
});

describe("lerEntradaDaVenda: a revisão de 02/10/2026", () => {
  /** A eec9f905 do VOR Q14 L01: nasceu no Panteon em 01/10 17:53, pela Clicksign. */
  const VENDA_NOVA_DO_VOR = { ...VENDA_NATIVA, criado_em: "2026-10-01T17:53:31.381775-03:00" };

  it("VOR Q14 L01: o pedido 5032, de 25/09 (da proposta cancelada), é ambíguo e as parcelas nem são lidas", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NOVA_DO_VOR });
    const m = c2x({
      parcelas: [parcela({ ar_id: 5032, parcela_id: 1, tipo: 2 })],
      pedidosDasUnidades: [{ ar_id: 5032, criado_em_brasilia: "2026-09-25 19:24:00", documento: DOC, estagio: 4 }],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "pedido_anterior_a_venda", pedido: 5032, situacao: "ambiguo" });
    expect(m.sqls).not.toContain(SQL_PARCELAS_DA_ENTRADA);
    // Ambíguo não é "sem candidato vivo": os desfeitos não são lidos.
    expect(m.sqls).not.toContain(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES);
    expect(m.conexao.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain(DOC);
  });

  it("VOR Q14 L01: o pedido redigitado depois da venda casa", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NOVA_DO_VOR });
    const m = c2x({
      parcelas: [parcela({ ar_id: 5040, parcela_id: 1, status: 6, tipo: 2, vencimento: "2026-10-05" })],
      pedidosDasUnidades: [{ ar_id: 5040, criado_em_brasilia: "2026-10-01 18:10:00", documento: DOC, estagio: 4 }],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toMatchObject({ pedido: 5040, regra: "terreno_mesmo_comprador", situacao: "lida" });
  });

  it("sem candidato vivo: o pedido do comprador desfeito DEPOIS da venda aparece com o número", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NOVA_DO_VOR });
    const m = c2x({
      desfeitos: [{ ar_id: 5041, criado_em_brasilia: "2026-10-01 18:30:00", documento: DOC, estagio: 7 }],
      pedidosDasUnidades: [],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "pedido_desfeito_no_c2x", pedido: 5041, situacao: "sem_pedido_no_c2x" });
    // O corte pela data vai no SQL, na hora de parede de Brasília da venda.
    const [, desde] = m.parametros[m.sqls.indexOf(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES)] as [number[], string];
    expect(desde).toBe("2026-10-01 17:53:31");
    expect(m.sqls).not.toContain(SQL_PARCELAS_DA_ENTRADA);
    soLeitura(m.sqls);
    expect(JSON.stringify(r)).not.toContain(DOC);
  });

  it("sem candidato vivo: o desfeito de ANTES da venda não conta, e segue 'ainda não foi digitada'", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: VENDA_NOVA_DO_VOR });
    // O C2X falso devolve a linha mesmo com o corte do SQL: a régua da memória também barra.
    const m = c2x({
      desfeitos: [{ ar_id: 4990, criado_em_brasilia: "2026-09-25 19:24:00", documento: DOC, estagio: 10 }],
      pedidosDasUnidades: [],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" });
  });

  it("a venda sem data de criação não lê os desfeitos (não há corte para o SQL)", async () => {
    const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], unidades: UNIDADES, venda: { ...VENDA_NATIVA, criado_em: null } });
    const m = c2x({ pedidosDasUnidades: [] });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" });
    expect(m.sqls).not.toContain(SQL_PEDIDOS_DESFEITOS_DAS_UNIDADES);
  });

  it("Garden (enterprise 39): o financeiro não é do C2X, e o C2X nem é aberto", async () => {
    const GARDEN = { ...VENDA_NATIVA, unidade: { enterprise_id: "39" } };
    for (const [envelopes, venda] of [
      [[ENVELOPE_CLICKSIGN], GARDEN],
      [[ENVELOPE_D4SIGN], GARDEN],
      [[], { ...GARDEN, origem: "c2x", origem_c2x_id: 4400 }],
    ] as const) {
      const p = panteon({ envelopes: [...envelopes], unidades: UNIDADES, venda });
      const m = c2x({ envio: [{ ar_id: 5020 }], parcelas: PARCELAS_DO_5020 });
      const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
      expect(r).toEqual({ motivo: "financeiro_no_lsoft", situacao: "fora_do_c2x" });
      expect(m.pool.getConnection).not.toHaveBeenCalled();
      // Nem o terreno é lido: a tabela de unidades inteira não serve a quem não vai ao C2X.
      expect(p.chamadas.some((c) => c.tabela === "hercules_unidades")).toBe(false);
    }
  });

  it("a unidade embutida pode vir em lista (PostgREST) e o empreendimento que não é do LSoft segue para o C2X", async () => {
    const lista = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: { ...VENDA_NATIVA, unidade: [{ enterprise_id: 39 }] } });
    const m1 = c2x({});
    expect(await lerEntradaDaVenda(lista.sb, "venda-1", { agora: HOJE, pool: m1.pool })).toEqual({
      motivo: "financeiro_no_lsoft",
      situacao: "fora_do_c2x",
    });
    const semUnidade = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: { ...VENDA_NATIVA, unidade: null } });
    const m2 = c2x({ envio: [] });
    await lerEntradaDaVenda(semUnidade.sb, "venda-1", { agora: HOJE, pool: m2.pool });
    expect(m2.pool.getConnection).toHaveBeenCalledTimes(1);
    // A venda é lida com a data de criação e o empreendimento da unidade, numa ida só.
    const select = lista.chamadas.find((c) => c.tabela === "hercules_propostas")?.filtros.find((f) => f[0] === "select");
    expect(String(select?.[1])).toContain("criado_em");
    expect(String(select?.[1])).toContain("unidade:hercules_unidades(enterprise_id)");
  });

  it("o pedido sem NENHUMA parcela no C2X: lido, sem parcelas e 'sem financeiro'", async () => {
    const p = panteon({ venda: { ...VENDA_NATIVA, origem: "c2x", origem_c2x_id: 4400 } });
    const m = c2x({
      parcelas: [
        {
          apagada: null,
          ar_id: 4400,
          estagio: 4,
          marcado_em_brasilia: null,
          pago_em: null,
          parcela_do_sinal: null,
          parcela_id: null,
          status: null,
          tipo: null,
          total_de_parcelas: 0,
          total_do_sinal: null,
          valor: null,
          vencimento: null,
        },
      ],
    });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toMatchObject({ entrada: null, parcelas: [], pedido: 4400, semFinanceiro: true, situacao: "lida" });
  });

  it("o pedido com parcela lançada não é 'sem financeiro'", async () => {
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const m = c2x({ envio: [{ ar_id: 5020 }], parcelas: PARCELAS_DO_5020 });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toMatchObject({ semFinanceiro: false, situacao: "lida" });
  });

  it("o teto da leitura inteira é 3 s, e o START TRANSACTION leva o teto do card (5 s), não os 20 s do espelho", async () => {
    expect(TETO_DA_LEITURA_MS).toBe(3_000);
    const p = panteon({ venda: { ...VENDA_NATIVA, origem: "c2x", origem_c2x_id: 4400 } });
    const m = c2x({ parcelas: [parcela({ ar_id: 4400, parcela_id: 1, tipo: 1 })] });
    await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(m.sqls[0]).toBe(SQL_ABRE_LEITURA);
    expect(m.tetos[0]).toBe(TIMEOUT_DA_CONSULTA_NA_TELA_MS);
  });
});

describe("lerEntradaDaVenda: falha não derruba nada", () => {
  it("o START TRANSACTION falhou: a conexão é DESTRUÍDA e nunca devolvida ao pool", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const m = c2x({ envio: [{ ar_id: 5020 }], falharEm: SQL_ABRE_LEITURA });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "c2x", situacao: "falhou" });
    expect(m.conexao.destroy).toHaveBeenCalledTimes(1);
    expect(m.conexao.release).not.toHaveBeenCalled();
    expect(m.sqls).toEqual([SQL_ABRE_LEITURA]);
  });

  it("o C2X sem vaga ou fora do ar: falhou", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const pool = { getConnection: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { code: "ER_CON_COUNT_ERROR" }))) };
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: pool as unknown as Pick<Pool, "getConnection"> });
    expect(r).toEqual({ motivo: "c2x", situacao: "falhou" });
  });

  it("a consulta falhou: falhou, e a conexão é DESTRUÍDA (não volta ao pool)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const m = c2x({ envio: [{ ar_id: 5020 }], falharEm: SQL_PARCELAS_DA_ENTRADA });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
    expect(r).toEqual({ motivo: "c2x", situacao: "falhou" });
    expect(m.conexao.destroy).toHaveBeenCalledTimes(1);
    expect(m.conexao.release).not.toHaveBeenCalled();
    // O log leva só o código do erro.
    expect(JSON.stringify(erro.mock.calls)).toContain("PROTOCOL_SEQUENCE_TIMEOUT");
    expect(JSON.stringify(erro.mock.calls)).not.toContain(DOC);
  });

  it("passou do teto: falhou por tempo, e a conexão presa é destruída", async () => {
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const m = c2x({ envio: [{ ar_id: 5020 }], semFim: SQL_PARCELAS_DA_ENTRADA });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool, tetoMs: 30 });
    expect(r).toEqual({ motivo: "tempo", situacao: "falhou" });
    expect(m.conexao.destroy).toHaveBeenCalledTimes(1);
  });

  it("o Panteon falhou: falhou, e o C2X nem é aberto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = c2x({});
    for (const erroEm of ["hercules_propostas", "temis_envelopes", "hercules_unidades"]) {
      const p = panteon({ envelopes: [ENVELOPE_CLICKSIGN], erroEm, unidades: UNIDADES, venda: VENDA_NATIVA });
      const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: m.pool });
      expect(r, erroEm).toEqual({ motivo: "panteon", situacao: "falhou" });
    }
    expect(m.pool.getConnection).not.toHaveBeenCalled();
  });

  it("sem o C2X configurado: falhou", async () => {
    const p = panteon({ envelopes: [ENVELOPE_D4SIGN], venda: VENDA_NATIVA });
    const r = await lerEntradaDaVenda(p.sb, "venda-1", { agora: HOJE, pool: null });
    expect(r).toEqual({ motivo: "c2x_sem_configuracao", situacao: "falhou" });
  });
});
