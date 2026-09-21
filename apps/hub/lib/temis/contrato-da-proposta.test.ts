import { beforeEach, describe, expect, it, vi } from "vitest";

// A CADEIA DO CONTRATO — a minuta que herda e os anexos que somam.
//
// ── O QUE JÁ ESTAVA TRAVADO AQUI (16/09/2026) ───────────────────────────────
// `minutaId` no corpo da prévia ou da geração aceitava QUALQUER minuta publicada: bastava trocar o
// id para imprimir o contrato de um loteamento com o modelo de outro. Nenhuma tela manda esse id; o
// único caminho era chamar a rota direto. Continua travado:
//   • a minuta do próprio empreendimento serve;
//   • a do PAI no cadastro do Panteon (VOC 37 → VLO 35) serve;
//   • a do CONSOLIDADO do catálogo (LBF 33 → `group:Lagoa Bonita`) serve;
//   • a de outro empreendimento NÃO serve, e o conteúdo dela nem chega a ser lido;
//   • proposta sem empreendimento não aceita minuta pedida;
//   • rascunho continua recusado.
//
// ── O QUE ENTROU EM 21/09/2026 ──────────────────────────────────────────────
// Pedido do Lucas: *"preciso garantir que consigamos vincular os anexos por filho, categoria.
// também as minutas."* A escolha deixou de ser igualdade exata com o empreendimento da PROPOSTA e
// passou a percorrer a cadeia: categoria da unidade → divisão da unidade → empreendimento da
// proposta → pai. A MINUTA para no primeiro degrau que responde; os ANEXOS somam todos.
//
// Os dados da proposta e o catálogo do C2X são mockados; o Supabase é um construtor falso que
// responde pela tabela e pelo que foi selecionado.

const estado = vi.hoisted(() => ({
  anexos: [] as Array<{
    categoria_id: null | string;
    enterprise_id: null | string;
    id: string;
    nome: string;
    posicao: number;
    storage_path: string;
    unidade_id: null | string;
  }>,
  catalogo: [] as Array<{ codes: string[]; id: string; name: string; stageIds: string[] }>,
  categorias: [] as Array<{
    categoria_pai_id: null | string;
    id: string;
    minuta_id: null | string;
    nome: string;
  }>,
  conteudo: [] as unknown[],
  consultas: [] as Array<{ filtros: unknown[][]; tabela: string }>,
  erroDe: "" as "" | "hercules_empreendimentos" | "temis_anexos" | "temis_categorias",
  gerais: {} as Record<string, string>,
  minutas: [] as Array<{
    enterprise_id: string;
    id: string;
    nome?: string;
    situacao: string;
    tipo?: string;
  }>,
  produtos: [] as Array<{
    c2x_enterprise_id: null | string;
    id: string;
    nome: string;
    pai_id: null | string;
  }>,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => estado.catalogo,
}));

vi.mock("./dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    avisos: [],
    dados: {
      compradores: [
        { ehPessoaFisica: true, temConjuge: false, valores: { nome_cliente: "Henrique" } },
      ],
      gerais: estado.gerais,
    },
  }),
}));

const SO_O_NOME = [
  {
    children: [
      { text: "Comprador: " },
      { children: [{ text: "" }], nome: "nome_cliente", type: "variavel" },
    ],
    type: "p",
  },
];

/** O bloco do anexo, como a v6 publicada do VOL o escreve. */
const COM_BLOCO_DE_ANEXO = [
  ...SO_O_NOME,
  {
    children: [
      { children: [{ text: "" }], nome: "inicio_tem_anexo_1", type: "variavel" },
      { text: "ANEXO I — " },
      { children: [{ text: "" }], nome: "anexo_1_nome", type: "variavel" },
      { children: [{ text: "" }], nome: "fim_tem_anexo_1", type: "variavel" },
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
      for (const metodo of ["select", "eq", "in", "is", "limit", "or", "order"]) {
        q[metodo] = (...args: unknown[]) => {
          registro.filtros.push([metodo, ...args]);
          return q;
        };
      }

      const responder = (): { data: unknown; error: unknown } => {
        if (estado.erroDe === tabela) {
          return { data: null, error: { code: "57014", message: "caiu" } };
        }
        const selecao = String(registro.filtros.find((f) => f[0] === "select")?.[1] ?? "");

        if (tabela === "temis_minutas") {
          const id = filtro(registro.filtros, "eq", "id");
          if (id) {
            const m = estado.minutas.find((x) => x.id === id) ?? null;
            if (!m) return { data: null, error: null };
            const cabecalho = { ...m, tipo: m.tipo ?? "contrato" };
            return selecao.includes("conteudo")
              ? {
                  data: {
                    ...cabecalho,
                    capa_nome: null,
                    capa_path: null,
                    conteudo: estado.conteudo,
                    nome: m.nome ?? `Minuta ${m.id}`,
                    versao: 1,
                  },
                  error: null,
                }
              : { data: cabecalho, error: null };
          }
          // A cadeia pede os degraus de uma vez: `.in("enterprise_id", [...])`.
          const daCadeia = (filtro(registro.filtros, "in", "enterprise_id") ?? []) as string[];
          const lista = estado.minutas
            .filter(
              (m) =>
                daCadeia.includes(m.enterprise_id) &&
                m.situacao === "publicada" &&
                (m.tipo ?? "contrato") === "contrato",
            )
            .map((m) => ({
              ...m,
              capa_nome: null,
              capa_path: null,
              conteudo: estado.conteudo,
              nome: m.nome ?? `Minuta ${m.id}`,
              tipo: m.tipo ?? "contrato",
              versao: 1,
            }));
          return { data: lista, error: null };
        }

        if (tabela === "temis_categorias") {
          const id = String(filtro(registro.filtros, "eq", "id") ?? "");
          return { data: estado.categorias.find((c) => c.id === id) ?? null, error: null };
        }

        if (tabela === "hercules_empreendimentos") {
          // `empreendimentosQueServem` (o caminho da minuta PEDIDA) pergunta por um id só, com
          // `eq`; a cadeia pergunta por vários, com `in`. As duas leem a mesma tabela.
          const umSo = filtro(registro.filtros, "eq", "c2x_enterprise_id");
          const porC2x = (
            umSo === undefined
              ? (filtro(registro.filtros, "in", "c2x_enterprise_id") ?? [])
              : [String(umSo)]
          ) as string[];
          if (porC2x.length > 0) {
            return {
              data: estado.produtos.filter((p) => porC2x.includes(String(p.c2x_enterprise_id))),
              error: null,
            };
          }
          const porId = (filtro(registro.filtros, "in", "id") ?? []) as string[];
          return { data: estado.produtos.filter((p) => porId.includes(p.id)), error: null };
        }

        if (tabela === "temis_anexos") {
          // O `.or()` chega como "unidade_id.eq.uni-1,categoria_id.eq.cat-1,...": basta ficar com
          // o valor de cada termo para saber quais alcances a cadeia pediu.
          const alvos = new Set(
            (registro.filtros.find((f) => f[0] === "or")?.[1] as string | undefined)
              ?.split(",")
              .map((p) => p.split(".eq.")[1] ?? "") ?? [],
          );
          return {
            data: estado.anexos.filter((a) =>
              alvos.has(String(a.unidade_id ?? a.categoria_id ?? a.enterprise_id ?? "")),
            ),
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

/** O Vale do Ouro como ele é em produção: o pai 35 e os filhos 36 (VOL), 37 (VOC), 41 (VOR). */
function valeDoOuro() {
  estado.produtos = [
    { c2x_enterprise_id: "35", id: "uuid-vlo", nome: "VALE DO OURO", pai_id: null },
    { c2x_enterprise_id: "36", id: "uuid-vol", nome: "VALE DO OURO VOL", pai_id: "uuid-vlo" },
    { c2x_enterprise_id: "37", id: "uuid-voc", nome: "VALE DO OURO VOC", pai_id: "uuid-vlo" },
    { c2x_enterprise_id: "33", id: "uuid-lbf", nome: "LAGOA BONITA FASE", pai_id: null },
  ];
}

beforeEach(() => {
  estado.anexos = [];
  estado.catalogo = [
    {
      codes: ["LBF", "LBR", "LBP"],
      id: "group:Lagoa Bonita",
      name: "LAGOA BONITA",
      stageIds: ["33", "27", "32"],
    },
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
  ];
  estado.categorias = [];
  estado.consultas = [];
  estado.conteudo = SO_O_NOME;
  estado.erroDe = "";
  estado.gerais = { __empreendimento_id: "37", empreendimento_codigo: "VOC" };
  estado.minutas = [
    { enterprise_id: "37", id: "da-voc", situacao: "publicada" },
    { enterprise_id: "35", id: "do-pai-vlo", situacao: "publicada" },
    { enterprise_id: "group:Lagoa Bonita", id: "do-consolidado-lb", situacao: "publicada" },
    { enterprise_id: "36", id: "da-vol", situacao: "publicada" },
    { enterprise_id: "37", id: "rascunho-voc", situacao: "rascunho" },
  ];
  valeDoOuro();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("acharMinuta com minuta pedida", () => {
  it("a minuta do próprio empreendimento serve", async () => {
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "da-voc",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-voc");
      expect(r.minuta.origem).toBe("pedida");
    }
  });

  it("a minuta do pai no cadastro do Panteon serve (VOC 37 → VLO 35)", async () => {
    estado.produtos = [
      { c2x_enterprise_id: "37", id: "uuid-voc", nome: "VALE DO OURO VOC", pai_id: "uuid-vlo" },
      { c2x_enterprise_id: "35", id: "uuid-vlo", nome: "VALE DO OURO", pai_id: null },
    ];
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "do-pai-vlo",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(true);
  });

  it("a minuta do consolidado do catálogo serve (LBF 33 → group:Lagoa Bonita)", async () => {
    estado.gerais = { __empreendimento_id: "33" };
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "do-consolidado-lb",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(true);
  });

  it("a minuta de OUTRO empreendimento não serve, e o conteúdo dela nem é lido", async () => {
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "da-vol",
      propostaId: PROPOSTA,
    });
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
    estado.gerais = { __empreendimento_id: "35" };
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "da-voc",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(false);
  });

  it("proposta sem empreendimento não aceita minuta pedida", async () => {
    estado.gerais = {};
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "da-voc",
      propostaId: PROPOSTA,
    });
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
    estado.gerais = { __empreendimento_id: "33" };
    const r = await montarContratoDaProposta(sbFalso(), {
      minutaId: "do-consolidado-lb",
      propostaId: PROPOSTA,
    });
    expect(r.ok).toBe(false);
  });
});

// ── A CADEIA (o caminho de TODAS as telas: ninguém manda `minutaId`) ─────────

describe("a minuta que herda", () => {
  it("segue achando a publicada do empreendimento da proposta, numa consulta só", async () => {
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-voc");
      expect(r.minuta.origem).toBe("empreendimento");
      expect(r.minuta.herdada).toBe(false);
    }

    // ⚠️ ESTA ASSERÇÃO SUBSTITUIU "sem ler pai nem catálogo". Ela existia para garantir que o
    // caminho comum fosse barato (uma consulta), e a cadeia PRECISA ler `hercules_empreendimentos`
    // — é de lá que saem o nome da divisão e o pai, sem os quais os anexos do pai nunca entrariam
    // no contrato. O que continua valendo é que as MINUTAS são lidas de uma vez: a busca não vai
    // degrau a degrau ao banco.
    const buscasDeMinuta = estado.consultas.filter(
      (c) =>
        c.tabela === "temis_minutas" &&
        c.filtros.some((f) => f[0] === "in" && f[1] === "enterprise_id"),
    );
    expect(buscasDeMinuta).toHaveLength(1);
  });

  it("a DIVISÃO da unidade ganha do empreendimento da proposta (o caso das 189 do VOL)", async () => {
    // A proposta pendura no PAI 35 e a unidade mora no filho 36, que é onde a v6 está publicada.
    estado.gerais = { __empreendimento_id: "35", __unidade_enterprise_id: "36" };
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-vol");
      expect(r.minuta.origem).toBe("divisao");
      expect(r.minuta.rotulo).toBe("VALE DO OURO VOL");
      expect(r.minuta.herdada).toBe(false);
      expect(r.minuta.origemFrase).toBe("modelo da divisão VALE DO OURO VOL");
    }
  });

  it("sem minuta na divisão nem no empreendimento, HERDA do pai e diz de onde veio", async () => {
    estado.gerais = { __empreendimento_id: "37", __unidade_enterprise_id: "37" };
    estado.minutas = [{ enterprise_id: "35", id: "do-pai-vlo", situacao: "publicada" }];
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("do-pai-vlo");
      expect(r.minuta.origem).toBe("pai");
      expect(r.minuta.herdada).toBe(true);
      expect(r.minuta.origemFrase).toBe("modelo herdado do VALE DO OURO");
    }
  });

  it("o pai continua não enxergando a minuta do filho (só sobe, nunca desce)", async () => {
    estado.gerais = { __empreendimento_id: "35", __unidade_enterprise_id: "35" };
    estado.minutas = [{ enterprise_id: "36", id: "da-vol", situacao: "publicada" }];
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("a categoria da unidade vence a divisão, e a origem é ela", async () => {
    estado.gerais = {
      __empreendimento_id: "35",
      __unidade_categoria_id: "cat-caucao",
      __unidade_enterprise_id: "36",
    };
    estado.categorias = [
      { categoria_pai_id: null, id: "cat-caucao", minuta_id: "da-caucao", nome: "Caução" },
    ];
    estado.minutas.push({ enterprise_id: "35", id: "da-caucao", situacao: "publicada" });

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-caucao");
      expect(r.minuta.origem).toBe("categoria");
      expect(r.minuta.origemFrase).toBe("modelo da categoria Caução");
    }
  });

  it("categoria SEM minuta própria herda calada, e a tela diz que herdou", async () => {
    estado.gerais = {
      __empreendimento_id: "35",
      __unidade_categoria_id: "cat-condominio",
      __unidade_enterprise_id: "36",
    };
    estado.categorias = [
      { categoria_pai_id: null, id: "cat-condominio", minuta_id: null, nome: "Condomínio" },
    ];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-vol");
      expect(r.minuta.origem).toBe("divisao");
      expect(r.minuta.herdada).toBe(true);
    }
  });

  it("subcategoria herda a minuta da MÃE antes de descer para a divisão", async () => {
    estado.gerais = {
      __empreendimento_id: "35",
      __unidade_categoria_id: "cat-fase-2",
      __unidade_enterprise_id: "36",
    };
    estado.categorias = [
      { categoria_pai_id: "cat-condominio", id: "cat-fase-2", minuta_id: null, nome: "Fase 2" },
      {
        categoria_pai_id: null,
        id: "cat-condominio",
        minuta_id: "da-caucao",
        nome: "Condomínio",
      },
    ];
    estado.minutas.push({ enterprise_id: "35", id: "da-caucao", situacao: "publicada" });

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minuta.id).toBe("da-caucao");
      expect(r.minuta.rotulo).toBe("Condomínio");
    }
  });

  it("categoria que aponta para minuta ARQUIVADA recusa, e não cai para o degrau de cima", async () => {
    estado.gerais = {
      __empreendimento_id: "35",
      __unidade_categoria_id: "cat-caucao",
      __unidade_enterprise_id: "36",
    };
    estado.categorias = [
      { categoria_pai_id: null, id: "cat-caucao", minuta_id: "velha", nome: "Caução" },
    ];
    estado.minutas.push({
      enterprise_id: "35",
      id: "velha",
      nome: "VLO-CAUCAO v1",
      situacao: "arquivada",
    });

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Caução");
      expect(r.erro).toContain("VLO-CAUCAO v1");
      expect(r.erro).toContain("arquivada");
    }
  });

  it("duas minutas publicadas no mesmo degrau recusam nomeando as duas, em vez de sortear", async () => {
    estado.gerais = { __empreendimento_id: "36", __unidade_enterprise_id: "36" };
    estado.minutas = [
      { enterprise_id: "36", id: "a", nome: "VOL-NORMAL", situacao: "publicada" },
      { enterprise_id: "36", id: "b", nome: "VOL-CAUCAO", situacao: "publicada" },
    ];
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("VOL-NORMAL");
      expect(r.erro).toContain("VOL-CAUCAO");
      expect(r.erro).toContain("sorteio");
    }
  });

  it("quando nada responde, a frase diz TODOS os degraus em que procurou", async () => {
    estado.gerais = { __empreendimento_id: "35", __unidade_enterprise_id: "36" };
    estado.minutas = [];
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("VALE DO OURO VOL");
      expect(r.erro).toContain("VALE DO OURO");
    }
  });

  it("falha ao ler a hierarquia RECUSA a montagem, em vez de pular o degrau", async () => {
    estado.gerais = { __empreendimento_id: "35", __unidade_enterprise_id: "36" };
    estado.erroDe = "hercules_empreendimentos";
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("hierarquia");
  });
});

// ── OS ANEXOS QUE SOMAM ─────────────────────────────────────────────────────

function anexo(campos: {
  categoria?: string;
  id: string;
  nome: string;
  posicao: number;
  produto?: string;
  storage?: string;
  unidade?: string;
}) {
  return {
    categoria_id: campos.categoria ?? null,
    enterprise_id: campos.produto ?? null,
    id: campos.id,
    nome: campos.nome,
    posicao: campos.posicao,
    storage_path: campos.storage ?? `temis-anexos/${campos.id}.pdf`,
    unidade_id: campos.unidade ?? null,
  };
}

describe("os anexos somam os níveis", () => {
  beforeEach(() => {
    estado.gerais = {
      __empreendimento_id: "35",
      __unidade_categoria_id: "cat-condominio",
      __unidade_enterprise_id: "36",
      __unidade_id: "uni-1",
    };
    estado.categorias = [
      { categoria_pai_id: null, id: "cat-condominio", minuta_id: null, nome: "Condomínio" },
    ];
  });

  it("pai + divisão + categoria + unidade entram juntos, na ordem da posição", async () => {
    estado.anexos = [
      anexo({ id: "a3", nome: "Planta do lote", posicao: 3, unidade: "uni-1" }),
      anexo({ id: "a1", nome: "Convenção", posicao: 1, produto: "35" }),
      anexo({ id: "a2", nome: "Memorial do VOL", posicao: 2, produto: "36" }),
      anexo({ categoria: "cat-condominio", id: "a4", nome: "Regimento", posicao: 4 }),
    ];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.anexos.map((a) => a.nome)).toEqual([
      "Convenção",
      "Memorial do VOL",
      "Planta do lote",
      "Regimento",
    ]);
    expect(r.anexos.map((a) => a.degrau)).toEqual([
      "empreendimento",
      "divisao",
      "unidade",
      "categoria",
    ]);
    // A tela precisa do NOME do nível, nunca do id.
    expect(r.anexos[0]?.rotuloDoNivel).toBe("VALE DO OURO");
    expect(r.anexos[3]?.rotuloDoNivel).toBe("Condomínio");
  });

  it("o MESMO arquivo alcançado por dois degraus sai uma vez só", async () => {
    // Divisão e empreendimento da proposta iguais: o mesmo id responde pelos dois degraus.
    estado.gerais = { __empreendimento_id: "36", __unidade_enterprise_id: "36" };
    estado.categorias = [];
    estado.anexos = [anexo({ id: "a1", nome: "Convenção", posicao: 1, produto: "36" })];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.anexos).toHaveLength(1);
  });

  it("dois arquivos na MESMA posição recusam, nomeando as duas peças e os dois níveis", async () => {
    estado.anexos = [
      anexo({ id: "a1", nome: "Convenção do pai", posicao: 1, produto: "35" }),
      anexo({ categoria: "cat-condominio", id: "a2", nome: "Convenção da categoria", posicao: 1 }),
    ];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Convenção do pai");
      expect(r.erro).toContain("Convenção da categoria");
      expect(r.erro).toContain("Condomínio");
    }
  });

  it("falha ao ler os anexos RECUSA, em vez de emitir o contrato sem a peça", async () => {
    estado.erroDe = "temis_anexos";
    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("anexos");
  });

  it("o bloco [inicio_tem_anexo_1] volta a imprimir, com o NOME do arquivo", async () => {
    // ⚠️ É O DEFEITO QUE O LUCAS RELATOU: a v6 publicada do VOL tem esse bloco escrito e ele sumia
    // do papel em silêncio, porque `dados.anexos` nunca era preenchido.
    estado.conteudo = COM_BLOCO_DE_ANEXO;
    estado.anexos = [anexo({ id: "a1", nome: "Convenção de condomínio", posicao: 1, produto: "35" })];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain("ANEXO I");
      expect(r.html).toContain("Convenção de condomínio");
      expect(r.semValor).not.toContain("anexo_1_nome");
    }
  });

  it("sem anexo cadastrado, o bloco continua sumindo — e sem derrubar a geração", async () => {
    estado.conteudo = COM_BLOCO_DE_ANEXO;
    estado.anexos = [];

    const r = await montarContratoDaProposta(sbFalso(), { propostaId: PROPOSTA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).not.toContain("ANEXO I");
      expect(r.semValor).toHaveLength(0);
    }
  });
});
