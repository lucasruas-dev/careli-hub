import { beforeEach, describe, expect, it, vi } from "vitest";

// A MINUTA PEDIDA PRECISA SERVIR À PROPOSTA — o vazamento que `acharMinuta` fechou (16/09/2026).
//
// Até aqui, `minutaId` no corpo da prévia ou da geração aceitava QUALQUER minuta publicada: bastava
// trocar o id para imprimir o contrato de um loteamento com o modelo de outro. Nenhuma tela manda
// esse id; o único caminho era chamar a rota direto. O que está travado:
//   • a minuta do próprio empreendimento serve;
//   • a do PAI no cadastro do Panteon (VOC 37 → VLO 35) serve;
//   • a do CONSOLIDADO do catálogo (LBF 33 → `group:Lagoa Bonita`) serve;
//   • a de outro empreendimento NÃO serve, e o conteúdo dela nem chega a ser lido;
//   • proposta sem empreendimento não aceita minuta pedida;
//   • rascunho continua recusado;
//   • o caminho sem `minutaId` (o de todas as telas) segue igual.
//
// Os dados da proposta e o catálogo do C2X são mockados; o Supabase é um construtor falso que
// responde pela tabela e pelo que foi selecionado.

const estado = vi.hoisted(() => ({
  catalogo: [] as Array<{ codes: string[]; id: string; name: string; stageIds: string[] }>,
  consultas: [] as Array<{ filtros: unknown[][]; tabela: string }>,
  empreendimentoDaProposta: "37",
  minutas: [] as Array<{ enterprise_id: string; id: string; situacao: string }>,
  paiPorFilho: {} as Record<string, string>,
  paiUuid: {} as Record<string, string>,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => estado.catalogo,
}));

vi.mock("./dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    avisos: [],
    dados: {
      compradores: [{ ehPessoaFisica: true, temConjuge: false, valores: { nome_cliente: "Henrique" } }],
      gerais: {
        __empreendimento_id: estado.empreendimentoDaProposta,
        empreendimento_codigo: "VOC",
        numero_lote: "05",
        numero_quadra: "01",
      },
    },
  }),
}));

const CONTEUDO = [
  {
    children: [
      { text: "Comprador: " },
      { children: [{ text: "" }], nome: "nome_cliente", type: "variavel" },
    ],
    type: "p",
  },
];

function filtro(filtros: unknown[][], metodo: string, coluna: string): unknown {
  return filtros.find((f) => f[0] === metodo && f[1] === coluna)?.[2];
}

function sbFalso() {
  return {
    from(tabela: string) {
      const registro = { filtros: [] as unknown[][], tabela };
      estado.consultas.push(registro);
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "is", "limit", "order"]) {
        q[metodo] = (...args: unknown[]) => {
          registro.filtros.push([metodo, ...args]);
          return q;
        };
      }

      const responder = (): { data: unknown; error: null } => {
        const selecao = String(registro.filtros.find((f) => f[0] === "select")?.[1] ?? "");
        if (tabela === "temis_minutas") {
          const id = filtro(registro.filtros, "eq", "id");
          if (id) {
            const m = estado.minutas.find((x) => x.id === id) ?? null;
            if (!m) return { data: null, error: null };
            return selecao.includes("conteudo")
              ? { data: { ...m, conteudo: CONTEUDO, nome: `Minuta ${m.id}`, versao: 1 }, error: null }
              : { data: m, error: null };
          }
          const doEmpreendimento = filtro(registro.filtros, "eq", "enterprise_id");
          const lista = estado.minutas
            .filter((m) => m.enterprise_id === doEmpreendimento && m.situacao === "publicada")
            .map((m) => ({ ...m, conteudo: CONTEUDO, nome: `Minuta ${m.id}`, versao: 1 }));
          return { data: lista, error: null };
        }
        if (tabela === "hercules_empreendimentos") {
          const filho = filtro(registro.filtros, "eq", "c2x_enterprise_id");
          if (filho !== undefined) {
            const pai = estado.paiPorFilho[String(filho)];
            return { data: pai ? [{ pai_id: pai }] : [{ pai_id: null }], error: null };
          }
          const ids = (filtro(registro.filtros, "in", "id") ?? []) as string[];
          return {
            data: ids.map((id) => ({ c2x_enterprise_id: estado.paiUuid[id] ?? null })),
            error: null,
          };
        }
        return { data: null, error: null };
      };

      q.maybeSingle = async () => responder();
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(responder()).then(ok, falha);
      return q;
    },
  } as never;
}

import { montarContratoDaProposta } from "./contrato-da-proposta";

const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

beforeEach(() => {
  estado.catalogo = [
    { codes: ["LBF", "LBR", "LBP"], id: "group:Lagoa Bonita", name: "LAGOA BONITA", stageIds: ["33", "27", "32"] },
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
  ];
  estado.consultas = [];
  estado.empreendimentoDaProposta = "37";
  estado.minutas = [
    { enterprise_id: "37", id: "da-voc", situacao: "publicada" },
    { enterprise_id: "35", id: "do-pai-vlo", situacao: "publicada" },
    { enterprise_id: "group:Lagoa Bonita", id: "do-consolidado-lb", situacao: "publicada" },
    { enterprise_id: "36", id: "da-vol", situacao: "publicada" },
    { enterprise_id: "37", id: "rascunho-voc", situacao: "rascunho" },
  ];
  estado.paiPorFilho = { "37": "uuid-vlo" };
  estado.paiUuid = { "uuid-vlo": "35" };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("acharMinuta com minuta pedida", () => {
  it("a minuta do próprio empreendimento serve", async () => {
    const r = await montarContratoDaProposta(sbFalso(), { minutaId: "da-voc", propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minuta.id).toBe("da-voc");
  });

  it("a minuta do pai no cadastro do Panteon serve (VOC 37 → VLO 35)", async () => {
    const r = await montarContratoDaProposta(sbFalso(), { minutaId: "do-pai-vlo", propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
  });

  it("a minuta do consolidado do catálogo serve (LBF 33 → group:Lagoa Bonita)", async () => {
    estado.empreendimentoDaProposta = "33";
    estado.paiPorFilho = {};
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "do-consolidado-lb",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(true);
  });

  it("a minuta de OUTRO empreendimento não serve, e o conteúdo dela nem é lido", async () => {
    const r = await montarContratoDaProposta(sbFalso(), { minutaId: "da-vol", propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);

    const leuConteudo = estado.consultas.some(
      (c) =>
        c.tabela === "temis_minutas" &&
        c.filtros.some((f) => f[0] === "select" && String(f[1]).includes("conteudo")),
    );
    expect(leuConteudo).toBe(false);
  });

  it("o pai NÃO enxerga a minuta da divisão (só sobe, nunca desce)", async () => {
    estado.empreendimentoDaProposta = "35";
    estado.paiPorFilho = {};
    const r = await montarContratoDaProposta(sbFalso(), { minutaId: "da-voc", propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
  });

  it("proposta sem empreendimento não aceita minuta pedida", async () => {
    estado.empreendimentoDaProposta = "";
    const r = await montarContratoDaProposta(sbFalso(), { minutaId: "da-voc", propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
  });

  it("rascunho continua recusado, mesmo do próprio empreendimento", async () => {
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "rascunho-voc",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(false);
  });

  it("sem o catálogo do C2X, o consolidado fica recusado (a lista encolhe, nunca alarga)", async () => {
    estado.catalogo = [];
    estado.empreendimentoDaProposta = "33";
    estado.paiPorFilho = {};
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "do-consolidado-lb",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(false);
  });
});

describe("acharMinuta sem minuta pedida (o caminho das telas)", () => {
  it("segue achando a publicada do empreendimento, sem ler pai nem catálogo", async () => {
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minuta.id).toBe("da-voc");
    expect(estado.consultas.some((c) => c.tabela === "hercules_empreendimentos")).toBe(false);
  });
});
