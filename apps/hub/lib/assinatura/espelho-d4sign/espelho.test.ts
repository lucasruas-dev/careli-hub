import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConsultaD4Sign, DocumentoD4Sign, SignatarioD4Sign, SituacaoD4Sign } from "@/lib/guardian/d4sign-consulta";
import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import type { ChamadaDoRegistro, EntradaDoRegistro } from "../registro-db";
import { lerQuadro } from "../registro-db";
import type { EstadoDaAssinatura } from "../tipos";
import { SQL_DAS_PESSOAS, SQL_DOS_COMPRADORES, SQL_DOS_ENVIOS } from "./c2x";
import { espelharD4Sign, type OpcoesDoEspelho, type PortaDaD4Sign } from "./espelho";

// O ESPELHO DA D4SIGN, COM PORTAS FALSAS (F3 da fonte única, seção 6): o banco em memória do Panteon
// (confere nome de coluna), um C2X falso que responde as três consultas, uma D4Sign falsa e a função
// da 0195 imitada no essencial (só anda para a frente, marca pela chave). Pessoas e documentos fictícios.

const AGORA = Date.parse("2026-09-28T12:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const ORDEM: Record<string, number> = { aguardando: 2, assinado: 4, cancelado: 4, desconhecido: 1, expirado: 4, parcial: 3, rascunho: 0, recusado: 4 };
const TERMINAL = new Set(["assinado", "recusado", "cancelado", "expirado"]);

type EnvioFalso = {
  ar_id: number;
  criado_em_brasilia: string;
  cs_id: number;
  status_c2x?: number;
  tipo_c2x?: string;
  unidade_c2x_id: number;
  uuid_doc: null | string;
};

type PessoaFalsa = { cs_id: number; email: string; linha_id: number; nome: string };

/** O timeout de consulta do mysql2 (é o que ele devolve a quem chamou; a conexão não morre sozinha). */
const TIMEOUT_DO_MYSQL = () => Object.assign(new Error("Query inactivity timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });

function poolFalso(
  envios: EnvioFalso[],
  pessoas: PessoaFalsa[] = [],
  compradores: Record<number, string> = {},
  opcoesDoPool: { falhar?: "compradores" | "envios" | "rol" } = {},
) {
  const consultas: string[] = [];
  let destruidas = 0;
  let liberadas = 0;
  const conexao = {
    destroy: () => {
      destruidas += 1;
    },
    query: async (opcoes: { sql: string }, params?: unknown[]) => {
      consultas.push(opcoes.sql);
      if (opcoes.sql.startsWith(SQL_DOS_ENVIOS.slice(0, 12))) {
        if (opcoesDoPool.falhar === "envios") throw TIMEOUT_DO_MYSQL();
        return [
          envios.map((e) => ({
            enterprise_c2x_id: 36,
            enterprise_code: "VOC",
            ordenada: 1,
            status_c2x: 3,
            tipo_c2x: "default",
            ...e,
          })),
          [],
        ];
      }
      if (opcoes.sql === SQL_DAS_PESSOAS) {
        if (opcoesDoPool.falhar === "rol") throw TIMEOUT_DO_MYSQL();
        const ids = new Set((params?.[0] as number[]) ?? []);
        return [
          pessoas
            .filter((p) => ids.has(p.cs_id))
            .map((p) => ({ ...p, papel_no_empreendimento: null, perfil_c2x: "Cliente", posicao: 1, usuario_c2x_id: null })),
          [],
        ];
      }
      if (opcoes.sql === SQL_DOS_COMPRADORES) {
        if (opcoesDoPool.falhar === "compradores") throw TIMEOUT_DO_MYSQL();
        const ids = (params?.[0] as number[]) ?? [];
        return [ids.filter((id) => compradores[id]).map((id) => ({ ar_id: id, documento: compradores[id] })), []];
      }
      return [[], []];
    },
    release: () => {
      liberadas += 1;
    },
  };
  return {
    consultas,
    destruidas: () => destruidas,
    liberadas: () => liberadas,
    pool: { getConnection: async () => conexao } as never,
  };
}

function documento(uuid: string, situacao: SituacaoD4Sign): DocumentoD4Sign {
  const statusId = { "aguardando-assinaturas": 3, "aguardando-signatarios": 2, cancelado: 6, desconhecida: null, finalizado: 4 }[situacao];
  return { canceladoPor: null, cofre: null, nome: "", paginas: null, situacao, statusId, statusName: "", uuidDoc: uuid };
}

function d4signFalsa(opcoes: {
  catalogo?: null | Record<string, SituacaoD4Sign>;
  cota?: boolean;
  /** O disjuntor, pelo número de catálogos já pedidos (abre no meio da rodada). */
  disjuntor?: (catalogosPedidos: number) => boolean;
  lista?: (uuid: string) => ConsultaD4Sign;
}) {
  const listados: string[] = [];
  let catalogos = 0;
  const porta: PortaDaD4Sign = {
    catalogo: async () => {
      catalogos += 1;
      if (!opcoes.catalogo) return null;
      return new Map(Object.entries(opcoes.catalogo).map(([uuid, s]) => [uuid, documento(uuid, s)]));
    },
    cotaRecusadaDesde: () => Boolean(opcoes.cota),
    disjuntorAberto: () => opcoes.disjuntor?.(catalogos) ?? false,
    lista: async (uuid) => {
      listados.push(uuid);
      return opcoes.lista ? opcoes.lista(uuid) : { documento: documento(uuid, "aguardando-assinaturas"), ok: true, signatarios: [] };
    },
  };
  return { catalogos: () => catalogos, listados, porta };
}

function assinante(email: string, assinadoEm: null | string): SignatarioD4Sign {
  return {
    assinadoEm,
    assinou: Boolean(assinadoEm),
    chave: "k",
    convidadoEm: null,
    documento: "12345678901",
    email,
    entregaDoEmail: null,
    nome: email,
    papel: null,
  };
}

/** A função da 0195, imitada no essencial: só para a frente, marca pela chave, fechamento só com data. */
function registroFalso(banco: Banco) {
  const chamadas: Array<{ entrada: EntradaDoRegistro; id: string }> = [];
  const registrar = async (_sb: SupabaseClient, id: string, entrada: EntradaDoRegistro): Promise<ChamadaDoRegistro> => {
    chamadas.push({ entrada, id });
    const linha = banco.linha("temis_envelopes", id);
    if (!linha) return { tipo: "sem_linha" };
    const antes = String(linha.estado) as EstadoDaAssinatura;
    let depois = antes;
    const proposto = entrada.estado ?? null;
    if (proposto && proposto !== "desconhecido" && !TERMINAL.has(antes) && (ORDEM[proposto] ?? 0) > (ORDEM[antes] ?? 0)) depois = proposto;
    // ⚠️ O QUADRO GRAVADO VOLTA PELA LEITURA, E NÃO POR UM SPREAD. Quem grava pode mandar item SEM
    // `chave` (é a forma do banco: 104 das 159 linhas dos envelopes da Clicksign, medido em
    // 01/10/2026, só SELECT), e é `lerQuadro` que completa a posição faltante — exatamente como o
    // caminho real faz depois da função da 0195. Copiando o item cru, este duplo devolveria um quadro
    // que a leitura de verdade nunca devolve.
    const quadro = lerQuadro(entrada.quadro ?? linha.signatarios);
    for (const m of entrada.marcas ?? []) {
      const item = quadro.find((i) => i.chave === m.chave);
      if (item && m.assinadoEm && !item.assinado_em) item.assinado_em = m.assinadoEm;
    }
    const assinaram = quadro.filter((i) => i.assinado_em).length;
    if (assinaram > 0 && ["rascunho", "desconhecido", "aguardando"].includes(depois)) depois = "parcial";
    linha.estado = depois;
    linha.signatarios = quadro;
    if (entrada.conferidoEm) linha.conferido_em = entrada.conferidoEm;
    if (TERMINAL.has(depois) && !linha.fechado_em && entrada.fechadoEm) linha.fechado_em = entrada.fechadoEm;
    return {
      registro: {
        assinaram,
        estadoAntes: antes,
        estadoDepois: depois,
        fechadoEm: (linha.fechado_em as null | string) ?? null,
        mudouEstado: antes !== depois,
        recusa: null,
        signatarios: quadro,
        total: quadro.length,
      },
      tipo: "feito",
    };
  };
  return { chamadas, registrar };
}

/** Espiona o cliente: cada cadeia (from → ... → then) com os métodos e os argumentos do `.in()`. */
function espiao(cliente: SupabaseClient) {
  const cadeias: Array<{ ins: number[]; metodos: string[]; tabela: string }> = [];
  const from = (tabela: string) => {
    const cadeia = { ins: [] as number[], metodos: [] as string[], tabela };
    cadeias.push(cadeia);
    const alvo = (cliente as unknown as { from(t: string): object }).from(tabela);
    const proxy: object = new Proxy(alvo, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r);
        if (typeof v !== "function" || typeof p !== "string") return v;
        return (...args: unknown[]) => {
          cadeia.metodos.push(p);
          if (p === "in") cadeia.ins.push((args[1] as unknown[]).length);
          const res = (v as (...a: unknown[]) => unknown).apply(t, args);
          return res === t ? proxy : res;
        };
      },
    });
    return proxy;
  };
  return { cadeias, cliente: { from } as unknown as SupabaseClient };
}

const OPCOES: OpcoesDoEspelho = {
  concorrencia: 1,
  gravar: true,
  intervaloMs: 0,
  moverVendas: false,
  orcamentoMs: Number.POSITIVE_INFINITY,
  tetoDeListas: 20,
};

function linhaDoEspelho(patch: Linha & { id: string; provedor_documento_id: string }): Linha {
  return {
    atualizado_em: "2026-09-27T10:00:00Z",
    c2x_contract_signature_id: null,
    conferido_em: null,
    criado_em: "2026-09-20T10:00:00-03:00",
    estado: "aguardando",
    finalidade: "contrato",
    origem: "c2x",
    provedor: "d4sign",
    signatarios: [],
    tentado_em: null,
    workspace_id: "careli",
    ...patch,
    envelope_id: patch.provedor_documento_id,
  };
}

/** Todo banco criado no teste: no fim, nenhum pediu coluna que não existe (o 42703 do banco de verdade). */
const bancos: Banco[] = [];
function novoBanco(inicial: Record<string, Linha[]>): Banco {
  const banco = criarBanco(inicial);
  bancos.push(banco);
  return banco;
}

function bancoBase(extra: Record<string, Linha[]> = {}): Banco {
  return novoBanco({
    temis_espelho_d4sign: [{ d4sign_pausada_ate: null, em_curso_ate: null, id: 1, ultima_rodada_ok_em: null }],
    ...extra,
  });
}

const portasFalsas = (banco: Banco, extra: Record<string, unknown> = {}) => {
  const registro = registroFalso(banco);
  const aplicar = vi.fn(async () => ({ card: "andou" as const, dataDeAssinatura: "nao_se_aplica" as const, motivo: "teste" }));
  const reconciliar = vi.fn(async () => ({ planejadas: 0, puladas: {}, refeitas: 0 }));
  return {
    aplicar,
    portas: {
      agora: () => AGORA,
      aplicarNaVenda: aplicar,
      clicksign: async () => ({ envelopeId: "", erro: "x", ok: false as const, requestId: null }),
      dormir: async () => undefined,
      reconciliar,
      registrar: registro.registrar,
      ...extra,
    },
    reconciliar,
    registro,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  // ⚠️ COLUNA ERRADA NÃO PASSA VERDE: no ensaio um 42703 viraria `semA0195` em silêncio.
  const problemas = bancos.flatMap((b) => b.problemas);
  bancos.length = 0;
  expect(problemas).toEqual([]);
});

const vezDoBanco = (banco: Banco) => banco.linhas("temis_espelho_d4sign")[0];

describe("o rodízio do /list", () => {
  it("por tentado_em asc com nulos antes; a falha também grava tentado_em; o teto corta", async () => {
    const banco = bancoBase({
      temis_envelopes: [
        linhaDoEspelho({ id: "e-recente", provedor_documento_id: "d-recente", tentado_em: "2026-09-27T10:00:00Z" }),
        linhaDoEspelho({ id: "e-nunca", provedor_documento_id: "d-nunca", tentado_em: null }),
        linhaDoEspelho({ id: "e-velho", provedor_documento_id: "d-velho", tentado_em: "2026-09-26T10:00:00Z" }),
      ],
    });
    const d4 = d4signFalsa({
      catalogo: { "d-nunca": "aguardando-assinaturas", "d-recente": "aguardando-assinaturas", "d-velho": "aguardando-assinaturas" },
      lista: (uuid) => (uuid === "d-nunca" ? { motivo: "indisponivel", ok: false } : { documento: documento(uuid, "aguardando-assinaturas"), ok: true, signatarios: [] }),
    });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, tetoDeListas: 2 },
      pool: poolFalso([]).pool,
      portas,
    });
    expect(d4.listados).toEqual(["d-nunca", "d-velho"]);
    expect(banco.linha("temis_envelopes", "e-nunca")?.tentado_em).toBe(new Date(AGORA).toISOString());
    expect(banco.linha("temis_envelopes", "e-velho")?.tentado_em).toBe(new Date(AGORA).toISOString());
    expect(banco.linha("temis_envelopes", "e-recente")?.tentado_em).toBe("2026-09-27T10:00:00Z");
    expect(r.falhas).toContain("list:e-nunca:indisponivel");
    expect(r.restamEmMovimento).toBe(1);
  });

  it("recuo por idade: sem mudança há 30+ dias, 1 vez por dia; há 180+, 1 vez por semana", async () => {
    const banco = bancoBase({
      temis_envelopes: [
        linhaDoEspelho({ atualizado_em: new Date(AGORA - 40 * DIA).toISOString(), id: "e-40-hoje", provedor_documento_id: "d1", tentado_em: new Date(AGORA - 2 * 3600e3).toISOString() }),
        linhaDoEspelho({ atualizado_em: new Date(AGORA - 40 * DIA).toISOString(), id: "e-40-ontem", provedor_documento_id: "d2", tentado_em: new Date(AGORA - 2 * DIA).toISOString() }),
        linhaDoEspelho({ atualizado_em: new Date(AGORA - 200 * DIA).toISOString(), id: "e-200-3d", provedor_documento_id: "d3", tentado_em: new Date(AGORA - 3 * DIA).toISOString() }),
        linhaDoEspelho({ atualizado_em: new Date(AGORA - 200 * DIA).toISOString(), id: "e-200-8d", provedor_documento_id: "d4", tentado_em: new Date(AGORA - 8 * DIA).toISOString() }),
      ],
    });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.listados.sort()).toEqual(["d2", "d4"]);
  });
});

describe("o estado", () => {
  it("finalizado ligado a venda NATIVA só vira assinado junto com o /list (marcas e fechamento na mesma chamada)", async () => {
    const banco = bancoBase({
      hercules_propostas: [{ etapa: "assinatura", id: "p-nativa", origem: "panteon", workspace_id: "careli" }],
      temis_envelopes: [
        linhaDoEspelho({
          id: "e-1",
          proposta_id: "p-nativa",
          provedor_documento_id: "d-1",
          signatarios: [{ chave: "c2x:1", email: "a@exemplo.test", nome: "a@exemplo.test", ordem: 1, papel: null }],
        }),
      ],
    });
    const d4 = d4signFalsa({
      catalogo: { "d-1": "finalizado" },
      lista: (uuid) => ({ documento: documento(uuid, "finalizado"), ok: true, signatarios: [assinante("a@exemplo.test", "2026-09-27T15:00:00-03:00")] }),
    });
    const { portas, registro } = portasFalsas(banco);
    await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    const comAssinado = registro.chamadas.filter((c) => c.entrada.estado === "assinado");
    expect(comAssinado).toHaveLength(1);
    expect(comAssinado[0]?.entrada.fechadoEm).toBe("2026-09-27T15:00:00.000-03:00");
    expect(comAssinado[0]?.entrada.marcas?.[0]?.chave).toBe("c2x:1");
    expect(banco.linha("temis_envelopes", "e-1")?.estado).toBe("assinado");
  });

  it("se o /list do finalizado de nativa falhar, o estado não muda nesta rodada", async () => {
    const banco = bancoBase({
      hercules_propostas: [{ etapa: "assinatura", id: "p-nativa", origem: "panteon", workspace_id: "careli" }],
      temis_envelopes: [linhaDoEspelho({ id: "e-1", proposta_id: "p-nativa", provedor_documento_id: "d-1" })],
    });
    const d4 = d4signFalsa({ catalogo: { "d-1": "finalizado" }, lista: () => ({ motivo: "indisponivel", ok: false }) });
    const { portas, registro } = portasFalsas(banco);
    await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(registro.chamadas).toHaveLength(0);
    expect(banco.linha("temis_envelopes", "e-1")?.estado).toBe("aguardando");
  });

  it("status 6 do C2X vira cancelado (c2x:6), salvo finalizado na D4Sign", async () => {
    const banco = bancoBase({
      temis_envelopes: [
        linhaDoEspelho({ c2x_contract_signature_id: 10, id: "e-6", provedor_documento_id: "d-6" }),
        linhaDoEspelho({ c2x_contract_signature_id: 11, id: "e-6-fin", provedor_documento_id: "d-6-fin" }),
      ],
    });
    const envios: EnvioFalso[] = [
      { ar_id: 1, criado_em_brasilia: "2026-09-20 10:00:00", cs_id: 10, status_c2x: 6, unidade_c2x_id: 1, uuid_doc: "d-6" },
      { ar_id: 2, criado_em_brasilia: "2026-09-20 10:00:00", cs_id: 11, status_c2x: 6, unidade_c2x_id: 2, uuid_doc: "d-6-fin" },
    ];
    const d4 = d4signFalsa({ catalogo: { "d-6": "aguardando-assinaturas", "d-6-fin": "finalizado" } });
    const { portas, registro } = portasFalsas(banco);
    await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, tetoDeListas: 0 }, pool: poolFalso(envios).pool, portas });
    const porId = Object.fromEntries(registro.chamadas.map((c) => [c.id, c.entrada]));
    expect(porId["e-6"]).toMatchObject({ estado: "cancelado", estadoCru: "c2x:6" });
    expect(porId["e-6-fin"]).toMatchObject({ estado: "assinado" });
  });

  it("documento que sumiu do catálogo não vira cancelado", async () => {
    const banco = bancoBase({ temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-sumiu" })] });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas, registro } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, tetoDeListas: 0 }, pool: poolFalso([]).pool, portas });
    expect(registro.chamadas).toHaveLength(0);
    expect(r.estadosDoCatalogo).toEqual({ fora_do_catalogo: 1 });
  });
});

describe("a cota", () => {
  it("429 no /list: para a rodada, grava d4sign_pausada_ate e relata", async () => {
    const banco = bancoBase({
      temis_envelopes: [
        linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" }),
        linhaDoEspelho({ id: "e-2", provedor_documento_id: "d-2" }),
      ],
    });
    const d4 = d4signFalsa({ catalogo: {}, lista: () => ({ motivo: "cota", ok: false }) });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.listados).toHaveLength(1);
    expect(r.pausadoPorCota).toBe(true);
    expect(banco.linhas("temis_espelho_d4sign")[0]).toMatchObject({
      d4sign_pausada_ate: new Date(AGORA + 60 * 60 * 1000).toISOString(),
    });
    // ⚠️ O 429 NO PASSO 4 NÃO DESFAZ A CONFERÊNCIA DOS PASSOS 1 A 3 (seção 6, passo 8): a campainha toca.
    // As rodadas seguintes, pausadas, não leem o catálogo e não tocam.
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBe(new Date(AGORA).toISOString());
  });

  it("pausa em vigor: ninguém chama a D4Sign", async () => {
    const banco = novoBanco({
      temis_espelho_d4sign: [{ d4sign_pausada_ate: new Date(AGORA + 10 * 60 * 1000).toISOString(), em_curso_ate: null, id: 1 }],
      temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" })],
    });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.catalogos()).toBe(0);
    expect(d4.listados).toHaveLength(0);
    expect(r.pausadoPorCota).toBe(true);
  });
});

describe("o envio novo", () => {
  const unidades: Linha[] = [
    { codigo: "VOC0101", enterprise_id: "36", espelho_de: null, id: "u-1", lote: "01", origem_c2x_id: 101, quadra: "01", workspace_id: "careli" },
    { codigo: "VOC0102", enterprise_id: "36", espelho_de: null, id: "u-2", lote: "02", origem_c2x_id: 102, quadra: "01", workspace_id: "careli" },
    { codigo: "VOC0103", enterprise_id: "36", espelho_de: null, id: "u-3", lote: "03", origem_c2x_id: 103, quadra: "01", workspace_id: "careli" },
  ];
  const propostas: Linha[] = [
    { cliente_documento: "111.222.333-44", criado_em: "2026-09-01T10:00:00Z", etapa: "contrato", id: "p-1", origem: "panteon", unidade_id: "u-1", workspace_id: "careli" },
    { cliente_documento: "555.666.777-88", criado_em: "2026-09-01T10:00:00Z", etapa: "contrato", id: "p-2", origem: "panteon", unidade_id: "u-2", workspace_id: "careli" },
  ];
  const envios: EnvioFalso[] = [
    { ar_id: 901, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: 1, unidade_c2x_id: 101, uuid_doc: "d-a" },
    { ar_id: 902, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: 2, unidade_c2x_id: 102, uuid_doc: "d-b" },
    { ar_id: 903, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: 3, unidade_c2x_id: 103, uuid_doc: "d-c" },
    { ar_id: 904, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: 4, unidade_c2x_id: 999, uuid_doc: "d-sem-unidade" },
  ];
  const pessoas: PessoaFalsa[] = envios.map((e) => ({ cs_id: e.cs_id, email: `p${e.cs_id}@exemplo.test`, linha_id: 100 + e.cs_id, nome: `P${e.cs_id}` }));
  const compradores = { 901: "11122233344", 902: "55566677788" };

  it("insere por linha: um 23505 não derruba as outras; sem_unidade não entra; o efeito vale só para o que o insert devolveu", async () => {
    const banco = bancoBase({ hercules_propostas: propostas, hercules_unidades: unidades });
    // Outra rodada insere o documento d-b no meio desta (o 23505 da unicidade da 0195).
    banco.depois(
      (c) => c.tabela === "temis_envelopes" && c.operacao === "insert",
      (b) => b.semear("temis_envelopes", linhaDoEspelho({ id: "e-outra-rodada", proposta_id: "p-2", provedor_documento_id: "d-b" })),
    );
    const d4 = d4signFalsa({ catalogo: { "d-a": "aguardando-assinaturas", "d-b": "aguardando-assinaturas", "d-c": "aguardando-assinaturas" } });
    const { aplicar, portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, moverVendas: true, tetoDeListas: 0 },
      pool: poolFalso(envios, pessoas, compradores).pool,
      portas,
    });
    expect(r.inseridos).toBe(2);
    expect(r.semUnidade).toBe(1);
    expect(r.falhas).toEqual([]);
    const docs = banco.linhas("temis_envelopes").map((l) => l.provedor_documento_id).sort();
    expect(docs).toEqual(["d-a", "d-b", "d-c"]);
    expect(docs).not.toContain("d-sem-unidade");
    const nova = banco.linhas("temis_envelopes").find((l) => l.provedor_documento_id === "d-a");
    expect(nova).toMatchObject({
      c2x_contract_signature_id: 1,
      enterprise_id: "36",
      finalidade: "contrato",
      nome: "Contrato VOC0101 (D4Sign, envio 1)",
      origem: "c2x",
      proposta_id: "p-1",
      provedor: "d4sign",
    });
    expect(lerQuadro(nova?.signatarios)[0]?.chave).toBe("c2x:101");
    // Só a linha inserida e ligada à nativa (d-a → p-1) chega à venda; d-b (23505) não.
    const envelopes = aplicar.mock.calls.map((c) => (c as unknown as [unknown, { envelope: { id: string } }])[1].envelope.id);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toBe(nova?.id);
    expect((aplicar.mock.calls[0] as unknown as [unknown, { estadoAntes: string }])[1].estadoAntes).toBe("novo");
  });

  it("moverVendas = false não chama aplicarEnvelopeNaVenda (conta o que faria)", async () => {
    const banco = bancoBase({ hercules_propostas: propostas, hercules_unidades: unidades });
    const d4 = d4signFalsa({ catalogo: { "d-a": "aguardando-assinaturas", "d-b": "aguardando-assinaturas", "d-c": "aguardando-assinaturas" } });
    const { aplicar, portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, moverVendas: false, tetoDeListas: 0 },
      pool: poolFalso(envios, pessoas, compradores).pool,
      portas,
    });
    expect(aplicar).not.toHaveBeenCalled();
    expect(r.efeitosPlanejados).toBe(2);
  });

  it("o ENSAIO não escreve nada no Panteon (nem a vez) e mesmo assim conta", async () => {
    const banco = bancoBase({ hercules_propostas: propostas, hercules_unidades: unidades });
    const espia = espiao(banco.cliente);
    const d4 = d4signFalsa({ catalogo: { "d-a": "aguardando-assinaturas" } });
    const { portas, registro } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: espia.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, gravar: false, tetoDeListas: 0 },
      pool: poolFalso(envios, pessoas, compradores).pool,
      portas,
    });
    expect(r.gravou).toBe(false);
    expect(r.semA0195).toBe(false);
    expect(r.casamentos).toMatchObject({ nativa_do_mesmo_comprador: 2, sem_unidade: 1 });
    expect(r.estadosMudaram).toBe(1);
    expect(registro.chamadas).toHaveLength(0);
    const escritas = espia.cadeias.filter((c) => c.metodos.some((m) => ["insert", "update", "upsert", "delete"].includes(m)));
    expect(escritas).toEqual([]);
  });

  it("consulta 3 que falha: quem precisava do comprador não nasce (nem ligado errado), os outros nascem, e a próxima rodada casa", async () => {
    const banco = bancoBase({ hercules_propostas: propostas, hercules_unidades: unidades });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const falho = poolFalso(envios, pessoas, compradores, { falhar: "compradores" });
    const r1 = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, tetoDeListas: 0 }, pool: falho.pool, portas });
    expect(r1.falhas).toContain("c2x:compradores:PROTOCOL_SEQUENCE_TIMEOUT");
    // d-a e d-b precisavam do comprador (regra 3); d-c não tem venda no terreno e nasce sem_venda.
    expect(banco.linhas("temis_envelopes").map((l) => l.provedor_documento_id)).toEqual(["d-c"]);
    expect(falho.destruidas()).toBe(1);
    expect(falho.liberadas()).toBe(0);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();

    const r2 = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, tetoDeListas: 0 },
      pool: poolFalso(envios, pessoas, compradores).pool,
      portas,
    });
    expect(r2.falhas).toEqual([]);
    expect(r2.inseridos).toBe(2);
    const porDoc = Object.fromEntries(banco.linhas("temis_envelopes").map((l) => [l.provedor_documento_id, l.proposta_id]));
    expect(porDoc).toEqual({ "d-a": "p-1", "d-b": "p-2", "d-c": null });
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBe(new Date(AGORA).toISOString());
  });

  it("o rol que falha: nada nasce, a conexão é destruída e a campainha não toca", async () => {
    const banco = bancoBase({ hercules_propostas: propostas, hercules_unidades: unidades });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const falho = poolFalso(envios, pessoas, compradores, { falhar: "rol" });
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, tetoDeListas: 0 }, pool: falho.pool, portas });
    expect(r.falhas).toContain("c2x:rol:PROTOCOL_SEQUENCE_TIMEOUT");
    expect(r.inseridos).toBe(0);
    expect(falho.destruidas()).toBe(1);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });

  it("a linha que nasceu sem venda é reavaliada: liga à nativa do mesmo comprador; a já ligada não é religada", async () => {
    const banco = bancoBase({
      hercules_propostas: propostas,
      hercules_unidades: unidades,
      temis_envelopes: [
        linhaDoEspelho({ c2x_contract_signature_id: 1, id: "e-sem", proposta_id: null, provedor_documento_id: "d-a", unidade_id: "u-1" }),
        linhaDoEspelho({ c2x_contract_signature_id: 2, id: "e-ligada", proposta_id: "p-outra", provedor_documento_id: "d-b", unidade_id: "u-2" }),
      ],
    });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, tetoDeListas: 0 },
      pool: poolFalso(envios.slice(0, 2), pessoas, compradores).pool,
      portas,
    });
    expect(r.religadas).toBe(1);
    expect(banco.linha("temis_envelopes", "e-sem")?.proposta_id).toBe("p-1");
    expect(banco.linha("temis_envelopes", "e-ligada")?.proposta_id).toBe("p-outra");
    expect(r.ligacoesComNativa).toEqual([{ csId: 1, propostaId: "p-1", regra: "nativa_do_mesmo_comprador" }]);
  });

  it("o ENSAIO conta os dois contratos vivos que a gravação vai criar (a Clicksign viva e a D4Sign que nasceria)", async () => {
    const banco = bancoBase({
      hercules_propostas: propostas,
      hercules_unidades: unidades,
      temis_envelopes: [
        {
          criado_em: "2026-09-21T10:00:00Z",
          envelope_id: "cs-env-1",
          estado: "aguardando",
          finalidade: "contrato",
          id: "e-clicksign",
          origem: "panteon",
          proposta_id: "p-1",
          provedor: "clicksign",
          provedor_documento_id: "cs-doc-1",
          signatarios: [],
          workspace_id: "careli",
        },
      ],
    });
    const d4 = d4signFalsa({ catalogo: { "d-a": "aguardando-assinaturas" } });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: banco.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, gravar: false, tetoDeListas: 0 },
      pool: poolFalso(envios.slice(0, 1), pessoas, compradores).pool,
      portas,
    });
    expect(r.semA0195).toBe(false);
    expect(r.casamentos).toMatchObject({ nativa_do_mesmo_comprador: 1 });
    expect(r.doisContratosVivos).toBe(1);
  });
});

describe("a vez da rodada", () => {
  it("duas rodadas juntas: a segunda sai sem fazer nada; a primeira fecha a vez e toca a campainha", async () => {
    const banco = bancoBase({ temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" })] });
    const d4 = d4signFalsa({ catalogo: { "d-1": "aguardando-assinaturas" } });
    const { portas } = portasFalsas(banco);
    const [a, b] = await Promise.all([
      espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas }),
      espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas }),
    ]);
    expect(a.falhas).toEqual([]);
    expect(b.falhas).toEqual(["outra_rodada_em_curso"]);
    expect(d4.catalogos()).toBe(1);
    const estado = banco.linhas("temis_espelho_d4sign")[0];
    expect(estado?.em_curso_ate).toBeNull();
    expect(estado?.ultima_rodada_ok_em).toBe(new Date(AGORA).toISOString());
    expect(JSON.stringify(estado?.relatorio)).not.toMatch(/@/);
  });
});

describe("as guardas", () => {
  it("nenhum delete; relatório e console sem credencial, e-mail nem 11 dígitos", async () => {
    process.env.D4SIGN_TOKEN_API = "tokenAPI-do-teste";
    process.env.D4SIGN_CRYPT_KEY = "cryptKey-do-teste";
    const falas: string[] = [];
    for (const nivel of ["info", "log", "warn", "error"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
        falas.push(JSON.stringify(args));
      });
    }
    const banco = bancoBase({
      hercules_propostas: [
        { cliente_documento: "11122233344", criado_em: "2026-09-01T10:00:00Z", etapa: "contrato", id: "p-1", origem: "panteon", unidade_id: "u-1", workspace_id: "careli" },
      ],
      hercules_unidades: [{ codigo: "VOC0101", enterprise_id: "36", espelho_de: null, id: "u-1", lote: "01", origem_c2x_id: 101, quadra: "01", workspace_id: "careli" }],
    });
    const espia = espiao(banco.cliente);
    const d4 = d4signFalsa({
      catalogo: { "d-a": "aguardando-assinaturas" },
      lista: (uuid) => ({ documento: documento(uuid, "aguardando-assinaturas"), ok: true, signatarios: [assinante("p1@exemplo.test", "2026-09-27T10:00:00-03:00")] }),
    });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: espia.cliente,
      d4sign: d4.porta,
      opcoes: OPCOES,
      pool: poolFalso(
        [{ ar_id: 901, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: 1, unidade_c2x_id: 101, uuid_doc: "d-a" }],
        [{ cs_id: 1, email: "p1@exemplo.test", linha_id: 7, nome: "P1" }],
        { 901: "11122233344" },
      ).pool,
      portas,
    });
    expect(espia.cadeias.some((c) => c.metodos.includes("delete"))).toBe(false);
    for (const texto of [JSON.stringify(r), ...falas]) {
      expect(texto).not.toMatch(/tokenAPI|cryptKey|@|\d{11}/);
    }
  });

  it("leitura do Panteon paginada com ordem e .in() em lotes de 100 (2.500 envios novos)", async () => {
    const n = 2500;
    const unidades: Linha[] = [];
    const envios: EnvioFalso[] = [];
    for (let i = 1; i <= n; i += 1) {
      unidades.push({ codigo: `U${i}`, enterprise_id: "36", espelho_de: null, id: `u-${String(i).padStart(5, "0")}`, lote: String(i), origem_c2x_id: i, quadra: "1", workspace_id: "careli" });
      envios.push({ ar_id: 10_000 + i, criado_em_brasilia: "2026-09-22 10:00:00", cs_id: i, unidade_c2x_id: i, uuid_doc: `d-${i}` });
    }
    const banco = bancoBase({ hercules_unidades: unidades });
    const espia = espiao(banco.cliente);
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({
      admin: espia.cliente,
      d4sign: d4.porta,
      opcoes: { ...OPCOES, gravar: false, tetoDeListas: 0 },
      pool: poolFalso(envios).pool,
      portas,
    });
    expect(r.semA0195).toBe(false);
    expect(r.lidosPorTabela.hercules_unidades).toBe(n);
    expect(r.casamentos.sem_venda).toBe(n);
    for (const cadeia of espia.cadeias) {
      for (const tamanho of cadeia.ins) expect(tamanho).toBeLessThanOrEqual(100);
      if (cadeia.metodos.includes("range")) expect(cadeia.metodos).toContain("order");
    }
    expect(espia.cadeias.filter((c) => c.tabela === "hercules_propostas").length).toBeGreaterThanOrEqual(50);
  });
});

describe("a conexão do C2X", () => {
  it("consulta 1 que falha: a conexão é destruída (não fica fora do pool), nada chama a D4Sign e a campainha não toca", async () => {
    const banco = bancoBase({ temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" })] });
    const c2x = poolFalso([], [], {}, { falhar: "envios" });
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: c2x.pool, portas });
    expect(r.falhas).toContain("c2x:PROTOCOL_SEQUENCE_TIMEOUT");
    expect(c2x.destruidas()).toBe(1);
    expect(c2x.liberadas()).toBe(0);
    expect(d4.catalogos()).toBe(0);
    expect(d4.listados).toHaveLength(0);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
    expect(vezDoBanco(banco)?.em_curso_ate).toBeNull();
  });

  it("rodada boa: a leitura do C2X fecha (COMMIT e release, uma vez) ANTES do /list", async () => {
    const banco = bancoBase({ temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" })] });
    const c2x = poolFalso([{ ar_id: 1, criado_em_brasilia: "2026-09-20 10:00:00", cs_id: 10, unidade_c2x_id: 1, uuid_doc: "d-1" }]);
    const devolvidasNoList: number[] = [];
    const d4 = d4signFalsa({
      catalogo: { "d-1": "aguardando-assinaturas" },
      lista: (uuid) => {
        devolvidasNoList.push(c2x.liberadas());
        return { documento: documento(uuid, "aguardando-assinaturas"), ok: true, signatarios: [] };
      },
    });
    const { portas } = portasFalsas(banco);
    await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: c2x.pool, portas });
    expect(devolvidasNoList).toEqual([1]);
    expect(c2x.liberadas()).toBe(1);
    expect(c2x.destruidas()).toBe(0);
    expect(c2x.consultas.at(-1)).toBe("COMMIT");
  });
});

describe("a campainha e a D4Sign fora", () => {
  const umaLinha = () => bancoBase({ temis_envelopes: [linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" })] });

  it("catálogo nulo por COTA: pausa 1 h, nenhum /list e a campainha não toca", async () => {
    const banco = umaLinha();
    const d4 = d4signFalsa({ catalogo: null, cota: true });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(r.pausadoPorCota).toBe(true);
    expect(r.falhas).toEqual([]);
    expect(d4.listados).toHaveLength(0);
    expect(vezDoBanco(banco)?.d4sign_pausada_ate).toBe(new Date(AGORA + 60 * 60 * 1000).toISOString());
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });

  it("catálogo nulo sem cota: d4signFora, falha d4sign:catalogo e a campainha não toca", async () => {
    const banco = umaLinha();
    const d4 = d4signFalsa({ catalogo: null });
    const { portas, registro } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(r.d4signFora).toBe(true);
    expect(r.pausadoPorCota).toBe(false);
    expect(r.falhas).toContain("d4sign:catalogo");
    // Catálogo nulo → nenhum estado da D4Sign pelo catálogo (só o que o /list conferiu).
    expect(registro.chamadas.filter((c) => !c.entrada.conferidoEm)).toHaveLength(0);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });

  it("disjuntor aberto desde o começo: nem catálogo nem /list, d4signFora, sem campainha", async () => {
    const banco = umaLinha();
    const d4 = d4signFalsa({ catalogo: {}, disjuntor: () => true });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.catalogos()).toBe(0);
    expect(d4.listados).toHaveLength(0);
    expect(r.d4signFora).toBe(true);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });

  it("disjuntor que abre no passo 4, com o catálogo bom: o /list para, d4signFora, e a campainha TOCA (passos 1 a 3 inteiros)", async () => {
    const banco = umaLinha();
    const d4 = d4signFalsa({ catalogo: { "d-1": "aguardando-assinaturas" }, disjuntor: (pedidos) => pedidos > 0 });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.catalogos()).toBe(1);
    expect(d4.listados).toHaveLength(0);
    expect(r.d4signFora).toBe(true);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBe(new Date(AGORA).toISOString());
  });

  it("o Panteon que não lê o espelho: a campainha não toca", async () => {
    const banco = umaLinha();
    banco.falhar((c) => c.tabela === "temis_envelopes" && c.operacao === "select");
    const d4 = d4signFalsa({ catalogo: {} });
    const { portas } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(r.falhas).toContain("panteon:temis_envelopes:08006");
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });
});

describe("o finalizado de nativa sem data real", () => {
  it("o /list sem a data de quem assinou: não vira assinado, vão as marcas e a conferência, e conta sem_data_real", async () => {
    const banco = bancoBase({
      hercules_propostas: [{ etapa: "assinatura", id: "p-nativa", origem: "panteon", workspace_id: "careli" }],
      temis_envelopes: [
        linhaDoEspelho({
          id: "e-1",
          proposta_id: "p-nativa",
          provedor_documento_id: "d-1",
          signatarios: [
            { chave: "c2x:1", email: "a@exemplo.test", nome: "a@exemplo.test", ordem: 1, papel: null },
            { chave: "c2x:2", email: "b@exemplo.test", nome: "b@exemplo.test", ordem: 2, papel: null },
          ],
        }),
      ],
    });
    const d4 = d4signFalsa({
      catalogo: { "d-1": "finalizado" },
      lista: (uuid) => ({
        documento: documento(uuid, "finalizado"),
        ok: true,
        // b assinou (a D4Sign diz), mas sem `sign_info`: sem a data dele o fechamento sairia cedo.
        signatarios: [assinante("a@exemplo.test", "2026-09-27T15:00:00-03:00"), { ...assinante("b@exemplo.test", null), assinou: true }],
      }),
    });
    const { portas, registro } = portasFalsas(banco);
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(r.semDataReal).toBe(1);
    expect(registro.chamadas.some((c) => c.entrada.estado === "assinado")).toBe(false);
    const linha = banco.linha("temis_envelopes", "e-1");
    expect(linha?.estado).toBe("parcial");
    expect(linha?.fechado_em).toBeNull();
    expect(linha?.conferido_em).toBe(new Date(AGORA).toISOString());
  });
});

describe("a vez tem dono", () => {
  const duasLinhas = () =>
    bancoBase({
      temis_envelopes: [
        linhaDoEspelho({ id: "e-1", provedor_documento_id: "d-1" }),
        linhaDoEspelho({ id: "e-2", provedor_documento_id: "d-2" }),
      ],
    });

  it("perdida no meio (a nossa venceu e outra rodada entrou): esta para e não solta a vez da outra", async () => {
    const banco = duasLinhas();
    const daOutra = "2026-09-28T14:00:00.000Z";
    // A outra rodada toma a vez logo depois do primeiro /list desta (o `tentado_em` é o 1º update).
    banco.depois(
      (c) => c.tabela === "temis_envelopes" && c.operacao === "update",
      (b) => {
        const vez = b.linhas("temis_espelho_d4sign")[0];
        if (vez) vez.em_curso_ate = daOutra;
      },
    );
    let t = AGORA;
    const d4 = d4signFalsa({ catalogo: { "d-1": "aguardando-assinaturas", "d-2": "aguardando-assinaturas" } });
    // O relógio anda 61 s por leitura: toda chance de renovar a vez é usada.
    const { portas } = portasFalsas(banco, { agora: () => (t += 61_000) });
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(d4.listados).toEqual(["d-1"]);
    expect(r.falhas).toContain("vez_perdida");
    expect(vezDoBanco(banco)?.em_curso_ate).toBe(daOutra);
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).toBeNull();
  });

  it("renovada nos laços longos: cada /list vê uma vez mais nova, e o fechamento (com o dono conferido) a solta", async () => {
    const banco = duasLinhas();
    let t = AGORA;
    const vistas: string[] = [];
    const d4 = d4signFalsa({
      catalogo: { "d-1": "aguardando-assinaturas", "d-2": "aguardando-assinaturas" },
      lista: (uuid) => {
        vistas.push(String(vezDoBanco(banco)?.em_curso_ate));
        return { documento: documento(uuid, "aguardando-assinaturas"), ok: true, signatarios: [] };
      },
    });
    const { portas } = portasFalsas(banco, { agora: () => (t += 61_000) });
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas });
    expect(r.falhas).toEqual([]);
    expect(d4.listados).toHaveLength(2);
    expect(new Set(vistas).size).toBe(2);
    expect(vezDoBanco(banco)?.em_curso_ate).toBeNull();
    expect(vezDoBanco(banco)?.ultima_rodada_ok_em).not.toBeNull();
  });
});

describe("a rede da Clicksign", () => {
  const velho = new Date(AGORA - 31 * 60 * 1000).toISOString();
  const recente = new Date(AGORA - 5 * 60 * 1000).toISOString();
  const todosAssinados = [{ assinado_em: "2026-09-28T08:00:00-03:00", chave: "k1", email: "", nome: "X", ordem: 1, papel: "comprador" }];
  const envelope = (id: string, patch: Linha = {}): Linha => ({
    atualizado_em: velho,
    criado_em: "2026-09-20T10:00:00Z",
    envelope_id: `env-${id}`,
    estado: "parcial",
    finalidade: "contrato",
    id,
    origem: "panteon",
    proposta_id: `p-${id}`,
    provedor: "clicksign",
    signatarios: todosAssinados,
    workspace_id: "careli",
    ...patch,
  });

  it("só parcial, todos assinados e parado há 30+ min; até 5; só closed fecha; move a venda (decisão da F2) e conta", async () => {
    const banco = bancoBase({
      temis_envelopes: [
        envelope("c1"),
        envelope("c2"),
        envelope("c3"),
        envelope("c4"),
        envelope("c5"),
        envelope("c6"),
        envelope("c7-recente", { atualizado_em: recente }),
        envelope("c8-falta", { signatarios: [...todosAssinados, { chave: "k2", email: "", nome: "Y", ordem: 2, papel: "conjuge" }] }),
      ],
    });
    const consultados: string[] = [];
    const d4 = d4signFalsa({ catalogo: {} });
    const { aplicar, portas, registro } = portasFalsas(banco, {
      clicksign: async (id: string) => {
        consultados.push(id);
        const fechado = id !== "env-c2";
        return { envelopeId: id, estado: fechado ? "desconhecido" : "aguardando", ok: true as const, status: fechado ? "closed" : "running" };
      },
    });
    // ⚠️ `moverVendas: false` (o `--gravar` da carga): a Clicksign move mesmo assim, como o webhook dela.
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, moverVendas: false }, pool: poolFalso([]).pool, portas });
    expect(consultados).toEqual(["env-c1", "env-c2", "env-c3", "env-c4", "env-c5"]);
    expect(registro.chamadas.map((c) => c.id)).toEqual(["c1", "c3", "c4", "c5"]);
    for (const c of registro.chamadas) expect(c.entrada).toMatchObject({ estado: "assinado", estadoCru: "clicksign:closed" });
    expect(aplicar).toHaveBeenCalledTimes(4);
    for (const chamada of aplicar.mock.calls as unknown as Array<[unknown, { envelope: { provedor: string } }, { moverVendas: boolean }]>) {
      expect(chamada[1].envelope.provedor).toBe("clicksign");
      expect(chamada[2]).toEqual({ moverVendas: true });
    }
    expect(r.redeDaClicksign).toBe(4);
    expect(r.vendasMovidas).toBe(4);
    expect(r.falhas).toEqual([]);
    expect(banco.linha("temis_envelopes", "c2")?.estado).toBe("parcial");
  });

  it("no ENSAIO só conta (nem GET na Clicksign, nem função, nem venda); gravando, a venda recusada vira falha", async () => {
    const banco = bancoBase({ temis_envelopes: [envelope("c1")] });
    const consultados: string[] = [];
    const d4 = d4signFalsa({ catalogo: {} });
    const clicksign = async (id: string) => {
      consultados.push(id);
      return { envelopeId: id, estado: "desconhecido" as const, ok: true as const, status: "closed" };
    };
    const ensaio = portasFalsas(banco, { clicksign });
    const r = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: { ...OPCOES, gravar: false }, pool: poolFalso([]).pool, portas: ensaio.portas });
    expect(r.redeDaClicksign).toBe(1);
    expect(consultados).toEqual([]);
    expect(ensaio.aplicar).not.toHaveBeenCalled();

    const recusa = vi.fn(async () => ({ card: "recusado" as const, dataDeAssinatura: "nao_se_aplica" as const, motivo: "teste" }));
    const gravando = portasFalsas(banco, { aplicarNaVenda: recusa, clicksign });
    const r2 = await espelharD4Sign({ admin: banco.cliente, d4sign: d4.porta, opcoes: OPCOES, pool: poolFalso([]).pool, portas: gravando.portas });
    expect(recusa).toHaveBeenCalledTimes(1);
    expect(r2.vendasMovidas).toBe(0);
    expect(r2.falhas).toContain("venda:p-c1:recusado");
  });
});
