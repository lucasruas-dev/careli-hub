import { beforeEach, describe, expect, it, vi } from "vitest";

// A LEITURA DA FICHA CONTINUA DE PÉ SEM A COLUNA `broker_code` (migration 0193 NÃO APLICADA).
//
// ⚠️ O ESTADO MEDIDO HOJE. Em 27/09/2026, em produção (bxgukywoxgivlrhjkwjx):
// `select broker_code from public.apolo_entities limit 1` devolve
// `ERROR: 42703: column "broker_code" does not exist`. A 0193 está escrita e PARADA de propósito
// (aplicar migration exige OK explícito do Lucas, a cada vez).
//
// ⚠️ E O POSTGREST NÃO IGNORA COLUNA DESCONHECIDA: ele recusa a consulta INTEIRA com 400. Pedir a
// coluna nova sem rede de proteção derrubava o CRM do Apolo para TODO MUNDO, inclusive para quem
// nunca vai cadastrar corretor: `loadApoloTablesDashboard` devolvia `reason: "unavailable"` com a
// mensagem crua do Postgres na cara do operador, e `loadApoloImobiliarias` ENGOLE qualquer erro e
// devolve `[]` — o seletor "Imobiliária / corretor" do wizard ficava vazio e a etapa 1 do cadastro de
// CLIENTE travava em "falta imobiliária". É a armadilha "camada nova exige varrer os leitores" na
// versão pior: os leitores foram varridos, mas não protegidos contra o estado de HOJE.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. Nenhum outro teste alcança isto: os clientes falsos da casa aceitam
// qualquer string de `select` e respondem `broker_code` independentemente do schema. O cliente falso
// daqui faz o que o PostgREST faz — RECUSA a consulta que pede coluna que não existe.

const guardian = vi.hoisted(() => ({ query: vi.fn(async () => [[]]) }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ missing: ["C2X_DB_HOST"], ok: false }),
  sanitizeHadesDbError: (erro: unknown) => erro,
  __query: guardian.query,
}));

const IMOB_A = "11111111-2222-4333-8444-555555555555";
const IMOB_B = "66666666-7777-4888-8999-000000000000";

type Consulta = { colunas: string; tabela: string };

/**
 * PostgREST de mentira com o schema de HOJE: a coluna `broker_code` não existe.
 *
 * `temColuna` liga/desliga a coluna para provar os dois estados com o MESMO cliente.
 */
function supabaseFalso(temColuna: boolean) {
  const consultas: Consulta[] = [];

  const fichas = [
    { display_name: "RR Soluções", id: IMOB_A, entity_kind: "pj" },
    { display_name: "Alfa Imóveis", id: IMOB_B, entity_kind: "pj" },
  ];

  const client = {
    from(tabela: string) {
      let colunas = "";
      const cadeia: Record<string, unknown> = {};
      for (const metodo of [
        "eq",
        "gte",
        "ilike",
        "in",
        "is",
        "limit",
        "lte",
        "neq",
        "not",
        "or",
        "order",
        "range",
        "returns",
      ]) {
        cadeia[metodo] = () => cadeia;
      }
      cadeia.select = (selecao?: string) => {
        colunas = String(selecao ?? "");
        consultas.push({ colunas, tabela });
        return cadeia;
      };
      function resposta(): { data: unknown; error: unknown } {
        // ⚠️ O QUE O POSTGREST FAZ DE VERDADE: a consulta inteira é recusada, não a coluna ignorada.
        if (!temColuna && colunas.includes("broker_code")) {
          return {
            data: null,
            error: {
              code: "42703",
              message: 'column apolo_entities.broker_code does not exist',
            },
          };
        }
        if (tabela === "apolo_entity_profiles") {
          return { data: [{ entity_id: IMOB_A }, { entity_id: IMOB_B }], error: null };
        }
        if (tabela === "apolo_entities") {
          return {
            data: fichas.map((f) => (colunas.includes("broker_code") ? { ...f, broker_code: null } : f)),
            error: null,
          };
        }
        return { data: [], error: null };
      }
      cadeia.then = (ok: (valor: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      cadeia.maybeSingle = async () => {
        const r = resposta();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      return cadeia;
    },
  };

  return { client: client as never, consultas };
}

/**
 * Módulo NOVO a cada teste.
 *
 * O leitor guarda em memória de processo que a coluna não existe (senão TODA leitura pagaria duas
 * consultas). Sem recarregar o módulo, o primeiro teste apagaria o estado inicial do segundo.
 */
async function servidorNovo() {
  vi.resetModules();
  return import("./server");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "test");
});

describe("a coluna broker_code ainda não existe no banco", () => {
  it("a leitura tenta COM a coluna e, no 42703, repete SEM ela", async () => {
    const { loadApoloImobiliarias } = await servidorNovo();
    const { client, consultas } = supabaseFalso(false);

    await loadApoloImobiliarias(client);

    const daFicha = consultas.filter((c) => c.tabela === "apolo_entities");
    expect(daFicha[0]?.colunas).toContain("broker_code");
    expect(daFicha[1]).toBeDefined();
    expect(daFicha[1]?.colunas).not.toContain("broker_code");
  });

  it("o seletor de imobiliária do wizard continua cheio (a etapa 1 do CLIENTE não trava)", async () => {
    const { loadApoloImobiliarias } = await servidorNovo();
    const { client } = supabaseFalso(false);

    const lista = await loadApoloImobiliarias(client);

    // Sem a tolerância, `fetchEntityRowsByIds` devolvia `ok: false`, o `loadApoloImobiliarias`
    // engolia o erro e esta lista vinha VAZIA, sem mensagem nenhuma na tela.
    expect(lista.map((i) => i.label).sort()).toEqual(["Alfa Imóveis", "RR Soluções"]);
  });

  it("o CRM do Apolo carrega, e nenhum jargão de banco chega à tela", async () => {
    const { loadApoloDashboard } = await servidorNovo();
    const { client } = supabaseFalso(false);

    const dashboard = await loadApoloDashboard({}, client);

    expect(dashboard.entities.length).toBe(2);
    expect(JSON.stringify(dashboard)).not.toContain("42703");
    expect(JSON.stringify(dashboard)).not.toContain("does not exist");
  });

  it("uma vez sentida a ausência, a coluna não é pedida de novo (não paga duas consultas sempre)", async () => {
    const { loadApoloImobiliarias } = await servidorNovo();
    const { client, consultas } = supabaseFalso(false);

    await loadApoloImobiliarias(client);
    const aposAPrimeira = consultas.filter((c) => c.tabela === "apolo_entities").length;
    await loadApoloImobiliarias(client);

    const total = consultas.filter((c) => c.tabela === "apolo_entities");
    expect(aposAPrimeira).toBe(2);
    expect(total).toHaveLength(3);
    expect(total[2]?.colunas).not.toContain("broker_code");
  });
});

describe("no dia em que a 0193 for aplicada", () => {
  it("o código é lido na PRIMEIRA consulta, sem repetição e sem depender de ordem de deploy", async () => {
    const { loadApoloImobiliarias } = await servidorNovo();
    const { client, consultas } = supabaseFalso(true);

    const lista = await loadApoloImobiliarias(client);

    expect(lista).toHaveLength(2);
    const daFicha = consultas.filter((c) => c.tabela === "apolo_entities");
    expect(daFicha).toHaveLength(1);
    expect(daFicha[0]?.colunas).toContain("broker_code");
  });
});
