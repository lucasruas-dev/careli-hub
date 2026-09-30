import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getHadesDbPool } from "@/lib/guardian/db";
import { publishHubNotification } from "@/lib/notifications/publish";
import {
  loadOpenAlertProtocolsByFingerprintPrefix,
  syncOperationAlertProtocols,
  updateOperationAlertFeedback,
} from "@/lib/operations/alert-protocols";

import {
  conferidoHoje,
  ehJanelaDiaria,
  vigiarCadastroContraOC2x,
} from "./vigia-do-cadastro-servidor";

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: vi.fn() }));
vi.mock("@/lib/notifications/publish", () => ({ publishHubNotification: vi.fn() }));
vi.mock("@/lib/operations/alert-protocols", () => ({
  loadOpenAlertProtocolsByFingerprintPrefix: vi.fn(),
  syncOperationAlertProtocols: vi.fn(),
  updateOperationAlertFeedback: vi.fn(),
}));

// O VIGIA DO CADASTRO, LADO SERVIDOR (PAN-124, F3). O que estes testes cobram é a ORQUESTRAÇÃO:
//   1. sem a tabela do retrato (0201 não aplicada), sem C2X ou sem cadastro, não faz nada;
//   2. o bootstrap grava o retrato, abre os protocolos e notifica os que nasceram;
//   3. rodada sem auditoria nova e fora da janela custa uma consulta ao C2X e para;
//   4. protocolo que já existia não notifica de novo; banco de protocolos fora não notifica nunca;
//   5. o que voltou a bater é fechado com a devolutiva do vigia.

const AGORA_FORA_DA_JANELA = new Date("2026-09-30T16:00:00Z"); // 13:00 em Brasília
const AGORA_NA_JANELA = new Date("2026-10-01T10:05:00Z"); // 07:05 em Brasília

type Tabela = { data?: unknown[] | null; error?: unknown; upsertError?: unknown };

function clienteFalso(tabelas: Record<string, Tabela>) {
  const gravados: Array<Record<string, unknown>> = [];
  const consultadas: string[] = [];

  const client = {
    from(tabela: string) {
      consultadas.push(tabela);
      let faixa: [number, number] | null = null;
      const consulta = {
        eq: () => consulta,
        in: () => consulta,
        limit: () => consulta,
        order: () => consulta,
        range: (de: number, ate: number) => {
          faixa = [de, ate];
          return consulta;
        },
        select: () => consulta,
        then(resolve: (valor: unknown) => unknown, rejeitar?: (erro: unknown) => unknown) {
          const t = tabelas[tabela] ?? { data: [] };
          const data = t.data && faixa ? t.data.slice(faixa[0], faixa[1] + 1) : t.data;
          return Promise.resolve({ data: t.error ? null : data, error: t.error ?? null }).then(
            resolve,
            rejeitar,
          );
        },
        upsert: (linhas: Array<Record<string, unknown>>) => {
          gravados.push(...linhas);
          return Promise.resolve({ error: tabelas[tabela]?.upsertError ?? null });
        },
      };
      return consulta;
    },
  };

  return { client: client as unknown as SupabaseClient, consultadas, gravados };
}

type Linha = Record<string, unknown>;

function poolFalso(respostas: {
  empreendimentos: Linha[];
  novas?: Linha[];
  trocas?: Linha[];
  ultimas?: Linha[];
}) {
  const sqls: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("from enterprises")) return [respostas.empreendimentos];
      if (sql.includes("group by auditable_id")) return [respostas.ultimas ?? []];
      if (sql.includes("action = 'update'")) return [respostas.trocas ?? []];
      if (sql.includes("id > ?")) return [respostas.novas ?? []];
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  vi.mocked(getHadesDbPool).mockReturnValue({ ok: true, pool } as never);
  return { pool, sqls };
}

const C2X = [
  { cidade: "Governador Valadares", code: "ACT", id: 30, name: "ALDEIA - TERMO", uf: "MG" },
  { cidade: "Brumadinho", code: "ACP", id: 42, name: "ALDEIA DA CACHOEIRA DAS PEDRAS", uf: "MG" },
  { cidade: "Governador Valadares", code: "PTI", id: 43, name: "PORTAL IBITURUNA", uf: "MG" },
];

const CADASTRO = [
  { c2x_enterprise_id: "42", cidade: "Brumadinho", codigo: "ACP", id: "u42", nome: "Aldeia das Cachoeiras das Pedras", uf: "MG" },
  { c2x_enterprise_id: "43", cidade: "Governador Valadares", codigo: "PDI", id: "u43", nome: "Portal do Ibituruna", uf: "MG" },
  { c2x_enterprise_id: null, cidade: "Itabirito", codigo: "RDX", id: "urdx", nome: "Rio de Pedras", uf: "MG" },
];

const UNIDADES = [
  ...Array.from({ length: 31 }, (_, i) => ({ codigo: `ADT${i}`, enterprise_id: "30", id: `a${i}` })),
  { codigo: "ACP0101", enterprise_id: "42", id: "b1" },
];

function retratoGravado(id: string, codigo: string, nome: string, visto: string, auditoria = 34722) {
  return {
    cidade: "Governador Valadares",
    codigo,
    enterprise_id: id,
    nome,
    nome_aceito: nome,
    nomes_anteriores: [],
    prefixos_divergentes: 0,
    sigla_divergente_aceita: false,
    siglas_anteriores: [],
    uf: "MG",
    ultima_auditoria_id: auditoria,
    visto_em: visto,
  };
}

const listarAdmins = vi.fn(async () => ["admin-1", "admin-2"]);

beforeEach(() => {
  vi.mocked(getHadesDbPool).mockReset();
  vi.mocked(publishHubNotification).mockReset();
  vi.mocked(syncOperationAlertProtocols).mockReset();
  vi.mocked(loadOpenAlertProtocolsByFingerprintPrefix).mockReset().mockResolvedValue([]);
  vi.mocked(updateOperationAlertFeedback).mockReset().mockResolvedValue({} as never);
  listarAdmins.mockClear();
});

function sincroniaQueNasce() {
  vi.mocked(syncOperationAlertProtocols).mockImplementation(async (alerts) => ({
    alerts,
    protocols: alerts.map((alert, i) => ({
      fingerprint: alert.fingerprint,
      occurrenceCount: 1,
      protocol: `AL-90${i}`,
    })) as never,
    status: "sincronizado",
  }));
}

describe("vigia do cadastro no sweep: quando não faz nada", () => {
  it("sem a tabela do retrato (0201 não aplicada) para antes de tocar no C2X", async () => {
    const { client, gravados } = clienteFalso({
      hercules_empreendimentos_c2x_retrato: { error: { code: "PGRST205", message: "not found" } },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.modo).toBe("parado");
    expect(getHadesDbPool).not.toHaveBeenCalled();
    expect(gravados).toEqual([]);
  });

  it("sem cadastro lido não confere: seria 'sem cadastro' para todo mundo", async () => {
    poolFalso({ empreendimentos: C2X });
    const { client, gravados } = clienteFalso({
      hercules_empreendimentos: { error: { message: "timeout" } },
      hercules_empreendimentos_c2x_retrato: { data: [] },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.modo).toBe("parado");
    expect(gravados).toEqual([]);
    expect(syncOperationAlertProtocols).not.toHaveBeenCalled();
  });

  it("sem unidades lidas não confere: fecharia o protocolo de prefixo como resolvido", async () => {
    poolFalso({ empreendimentos: C2X });
    const { client, gravados } = clienteFalso({
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: { data: [] },
      hercules_unidades: { error: { message: "timeout" } },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.modo).toBe("parado");
    expect(gravados).toEqual([]);
    expect(updateOperationAlertFeedback).not.toHaveBeenCalled();
  });

  it("fora da janela e sem auditoria nova, custa uma consulta ao C2X e para", async () => {
    const { sqls } = poolFalso({ empreendimentos: C2X, novas: [] });
    const { client, gravados } = clienteFalso({
      hercules_empreendimentos_c2x_retrato: {
        data: [retratoGravado("43", "PTI", "PORTAL IBITURUNA", "2026-09-30T10:00:00Z")],
      },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.modo).toBe("parado");
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("id > ?");
    expect(gravados).toEqual([]);
  });
});

describe("vigia do cadastro no sweep: o bootstrap", () => {
  it("grava o retrato, abre 2 protocolos (30 e 43) e avisa os admins de cada um", async () => {
    poolFalso({
      empreendimentos: C2X,
      trocas: [
        { auditable_id: 43, nome_antes: "RECANTO DO VALE", sigla_antes: "RDV" },
        { auditable_id: 43, nome_antes: null, sigla_antes: "PDI" },
        { auditable_id: 30, nome_antes: "null", sigla_antes: "ADT" },
      ],
      ultimas: [{ auditable_id: 43, ultima: 34722 }, { auditable_id: 30, ultima: 33689 }],
    });
    sincroniaQueNasce();
    const { client, gravados } = clienteFalso({
      hercules_empreendimento_valores_antigos: { data: [] },
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: { data: [] },
      hercules_unidades: { data: UNIDADES },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r).toEqual({ avisos: 2, fechados: 0, modo: "bootstrap", notificados: 2 });
    expect(gravados.map((g) => g.enterprise_id)).toEqual(["30", "42", "43"]);
    const g43 = gravados.find((g) => g.enterprise_id === "43")!;
    expect(g43.siglas_anteriores).toEqual(["RDV", "PDI"]);
    expect(g43.nomes_anteriores).toEqual(["RECANTO DO VALE"]);
    expect(g43.ultima_auditoria_id).toBe(34722);
    expect(gravados.find((g) => g.enterprise_id === "30")!.nomes_anteriores).toEqual([]);

    const alertas = vi.mocked(syncOperationAlertProtocols).mock.calls[0]![0];
    expect(alertas.map((a) => a.fingerprint)).toEqual([
      "cadastro-c2x:30:prefixo=ACT:ADT|sem_cadastro",
      "cadastro-c2x:43:sigla=PDI>PTI",
    ]);
    expect(publishHubNotification).toHaveBeenCalledTimes(2);
    const aviso = vi.mocked(publishHubNotification).mock.calls[1]![0];
    expect(aviso.recipientUserIds).toEqual(["admin-1", "admin-2"]);
    expect(aviso.title).toBe("Cadastro diferente do C2X: Portal do Ibituruna (PDI)");
    expect(aviso.body).toBe("Sigla: PDI no Panteon, PTI no C2X.");
    expect(aviso.context).toEqual({ enterpriseId: "43", entityType: "cadastro-c2x", protocol: "AL-901" });
  });

  it("protocolo que já existia não notifica de novo", async () => {
    poolFalso({ empreendimentos: C2X });
    vi.mocked(syncOperationAlertProtocols).mockImplementation(async (alerts) => ({
      alerts,
      protocols: alerts.map((alert) => ({ fingerprint: alert.fingerprint, occurrenceCount: 7, protocol: "AL-1" })) as never,
      status: "sincronizado",
    }));
    const { client } = clienteFalso({
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: { data: [] },
      hercules_unidades: { data: UNIDADES },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.notificados).toBe(0);
    expect(publishHubNotification).not.toHaveBeenCalled();
  });

  it("com o banco dos protocolos fora, não notifica: o reserva devolve tudo como nascido", async () => {
    poolFalso({ empreendimentos: C2X });
    vi.mocked(syncOperationAlertProtocols).mockImplementation(async (alerts) => ({
      alerts,
      protocols: alerts.map((alert) => ({ fingerprint: alert.fingerprint, occurrenceCount: 1, protocol: "AL-1" })) as never,
      status: "indisponivel",
    }));
    const { client } = clienteFalso({
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: { data: [] },
      hercules_unidades: { data: UNIDADES },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r.avisos).toBe(2);
    expect(r.notificados).toBe(0);
    expect(publishHubNotification).not.toHaveBeenCalled();
  });

  it("pagina as unidades pelo teto de 1.000 do PostgREST", async () => {
    poolFalso({ empreendimentos: C2X });
    sincroniaQueNasce();
    const muitas = Array.from({ length: 2500 }, (_, i) => ({ codigo: `ACP${i}`, enterprise_id: "42", id: `x${i}` }));
    const { client, consultadas } = clienteFalso({
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: { data: [] },
      hercules_unidades: { data: [...muitas, ...UNIDADES] },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(consultadas.filter((t) => t === "hercules_unidades")).toHaveLength(3);
    // As 31 ADT estão na terceira página: sem paginar, o 30 perderia o motivo de prefixo.
    expect(vi.mocked(syncOperationAlertProtocols).mock.calls[0]![0][0]!.fingerprint).toBe(
      "cadastro-c2x:30:prefixo=ACT:ADT|sem_cadastro",
    );
    expect(r.avisos).toBe(2);
  });
});

describe("vigia do cadastro no sweep: evento, janela diária e fechamento", () => {
  it("auditoria nova confere só o id auditado e fecha o protocolo dele se os lados bateram", async () => {
    // O C2X voltou o 43 para PDI: a sigla bate com o cadastro.
    poolFalso({
      empreendimentos: C2X.map((e) => (e.id === 43 ? { ...e, code: "PDI" } : e)),
      novas: [{ auditable_id: 43, id: 34800 }],
    });
    vi.mocked(loadOpenAlertProtocolsByFingerprintPrefix).mockResolvedValue([
      { fingerprint: "cadastro-c2x:43:sigla=PDI>PTI", protocol: "AL-901" },
      { fingerprint: "cadastro-c2x:30:prefixo=ACT:ADT|sem_cadastro", protocol: "AL-900" },
    ]);
    const { client, gravados } = clienteFalso({
      hercules_empreendimento_valores_antigos: { data: [] },
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: {
        data: [
          retratoGravado("30", "ACT", "ALDEIA - TERMO", "2026-09-30T10:00:00Z", 33689),
          retratoGravado("43", "PTI", "PORTAL IBITURUNA", "2026-09-30T10:00:00Z"),
        ],
      },
      hercules_unidades: { data: UNIDADES },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_FORA_DA_JANELA, listarAdmins });

    expect(r).toEqual({ avisos: 0, fechados: 1, modo: "evento", notificados: 0 });
    expect(gravados.map((g) => g.enterprise_id)).toEqual(["43"]);
    expect(gravados[0]!.siglas_anteriores).toEqual(["PTI"]);
    expect(gravados[0]!.ultima_auditoria_id).toBe(34800);
    expect(updateOperationAlertFeedback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateOperationAlertFeedback).mock.calls[0]![0]).toMatchObject({
      protocol: "AL-901",
      status: "corrigido",
      userId: null,
    });
  });

  it("na janela diária confere todos os ids, mesmo sem auditoria nova", async () => {
    poolFalso({ empreendimentos: C2X, novas: [] });
    sincroniaQueNasce();
    const { client, gravados } = clienteFalso({
      hercules_empreendimentos: { data: CADASTRO },
      hercules_empreendimentos_c2x_retrato: {
        data: [retratoGravado("43", "PTI", "PORTAL IBITURUNA", "2026-09-30T10:00:00Z")],
      },
      hercules_unidades: { data: UNIDADES },
    });

    const r = await vigiarCadastroContraOC2x(client, { agora: AGORA_NA_JANELA, listarAdmins });

    expect(r.modo).toBe("diario");
    expect(gravados.map((g) => g.enterprise_id)).toEqual(["30", "42", "43"]);
  });

  it("a janela é das 07:00 às 07:14 em Brasília, e 'conferido hoje' é pelo dia de Brasília", () => {
    expect(ehJanelaDiaria(new Date("2026-10-01T10:00:00Z"))).toBe(true);
    expect(ehJanelaDiaria(new Date("2026-10-01T10:14:59Z"))).toBe(true);
    expect(ehJanelaDiaria(new Date("2026-10-01T10:15:00Z"))).toBe(false);
    expect(ehJanelaDiaria(new Date("2026-10-01T07:05:00Z"))).toBe(false);

    // 01/10 às 00:30 em Brasília é 01/10 03:30 UTC: já é hoje.
    expect(conferidoHoje("2026-10-01T03:30:00Z", AGORA_NA_JANELA)).toBe(true);
    // 30/09 às 23:59 em Brasília é 01/10 02:59 UTC: dia anterior em Brasília.
    expect(conferidoHoje("2026-10-01T02:59:00Z", AGORA_NA_JANELA)).toBe(false);
    expect(conferidoHoje(null, AGORA_NA_JANELA)).toBe(false);
  });
});
