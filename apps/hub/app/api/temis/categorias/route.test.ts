import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/temis/categorias — a ORDEM DE ASSINATURA do recorte, e a herança que ela sobrepõe.
//
// O que está travado aqui:
//   · categoria sem ordem HERDA o empreendimento (e diz de onde veio);
//   · categoria com ordem SOBREPÕE, sem apagar a herdada da tela;
//   · limpar (nulo) volta a herdar, zerando o booleano junto;
//   · lista inválida (papel inexistente, repetido, vazia, liga/desliga sozinho) é RECUSADA aqui;
//   · falha ao ler o empreendimento não vira "segue o padrão da casa";
//   · PATCH/DELETE filtram pelo empreendimento DONO — a ficha manda `group:` ou a etapa, e as
//     categorias moram no pai.
//
// Supabase mockado: o teste é da REGRA da rota.

const estado = vi.hoisted(() => ({
  atualizacoes: [] as Array<{ filtros: Record<string, unknown>; valores: Record<string, unknown> }>,
  categorias: [] as Array<Record<string, unknown>>,
  erroSettings: false,
  exclusoes: [] as Array<Record<string, unknown>>,
  settings: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/apolo/auth", () => {
  const autorizar = async () => ({ ok: true, userId: "user-1" });
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

// As três divisões do Lagoa Bonita e o pai, como estão no banco hoje (medido em 08/09/2026).
const EMPREENDIMENTOS = [
  { c2x_enterprise_id: "31", codigo: "LAB", id: "lab", nome: "Lagoa Bonita", pai_id: null },
  { c2x_enterprise_id: "33", codigo: "LBF", id: "lbf", nome: "Lagoa Bonita · LBF", pai_id: "lab" },
  { c2x_enterprise_id: "32", codigo: "LBP", id: "lbp", nome: "Lagoa Bonita · LBP", pai_id: "lab" },
  { c2x_enterprise_id: "27", codigo: "LBR", id: "lbr", nome: "Lagoa Bonita · LBR", pai_id: "lab" },
];

vi.mock("@/lib/apolo/server", () => {
  type Ctx = {
    filtros: Record<string, unknown>;
    tabela: string;
    tipo: "delete" | "insert" | "select" | "update";
    valores: Record<string, unknown>;
  };

  const casa = (linha: Record<string, unknown>, filtros: Record<string, unknown>) =>
    Object.entries(filtros).every(([coluna, valor]) => {
      if (coluna === "workspace_id") return true;
      const atual = linha[coluna] ?? null;
      return Array.isArray(valor) ? valor.includes(atual) : atual === valor;
    });

  const resolver = (ctx: Ctx): { data: unknown; error: null | { code?: string } } => {
    if (ctx.tabela === "hercules_empreendimentos") {
      return { data: EMPREENDIMENTOS.filter((e) => casa(e, ctx.filtros)), error: null };
    }
    if (ctx.tabela === "hercules_unidades") return { data: [], error: null };
    if (ctx.tabela === "apolo_enterprise_settings") {
      if (estado.erroSettings) return { data: null, error: { code: "57014" } };
      return { data: estado.settings.filter((s) => casa(s, ctx.filtros)), error: null };
    }
    if (ctx.tabela === "temis_categorias") {
      const alvo = estado.categorias.filter((c) => casa(c, ctx.filtros));
      if (ctx.tipo === "update") {
        estado.atualizacoes.push({ filtros: ctx.filtros, valores: ctx.valores });
        return { data: alvo.map((c) => ({ id: c.id })), error: null };
      }
      if (ctx.tipo === "delete") {
        estado.exclusoes.push(ctx.filtros);
        return { data: alvo.map((c) => ({ id: c.id })), error: null };
      }
      if (ctx.tipo === "insert") return { data: { id: "nova" }, error: null };
      return { data: alvo, error: null };
    }
    if (ctx.tabela === "temis_planos") return { data: [], error: null };
    return { data: [], error: null };
  };

  const construir = (tabela: string) => {
    const ctx: Ctx = { filtros: {}, tabela, tipo: "select", valores: {} };
    const api = {
      delete: () => {
        ctx.tipo = "delete";
        return api;
      },
      eq: (coluna: string, valor: unknown) => {
        ctx.filtros[coluna] = valor;
        return api;
      },
      in: (coluna: string, valor: unknown) => {
        ctx.filtros[coluna] = valor;
        return api;
      },
      insert: (valores: Record<string, unknown>) => {
        ctx.tipo = "insert";
        ctx.valores = valores;
        return api;
      },
      limit: () => api,
      maybeSingle: async () => {
        const { data, error } = resolver(ctx);
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      order: () => api,
      select: () => api,
      single: async () => {
        const { data, error } = resolver(ctx);
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) => {
        const bruto = resolver(ctx);
        const conta = { count: Array.isArray(bruto.data) ? bruto.data.length : 0 };
        return Promise.resolve({ ...bruto, ...conta }).then(aceitar, recusar);
      },
      update: (valores: Record<string, unknown>) => {
        ctx.tipo = "update";
        ctx.valores = valores;
        return api;
      },
    };
    return api;
  };

  return { createApoloAdminClient: () => ({ from: (tabela: string) => construir(tabela) }) };
});

import { DELETE, GET, PATCH } from "@/app/api/temis/categorias/route";

const CONDOMINIO = "cat-condominio";
const LOTEAMENTO = "cat-loteamento";

const categoria = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  assinatura_ordem: null,
  assinatura_ordenada: false,
  ativa: true,
  categoria_pai_id: null,
  enterprise_id: "31",
  id,
  nome,
  ordem: 0,
  ...extra,
});

const settings = (enterpriseId: string, ordem: unknown, ordenada = false) => ({
  assinatura_ordem: ordem,
  assinatura_ordenada: ordenada,
  enterprise_id: enterpriseId,
});

/** A ficha consolidada do Lagoa Bonita: manda `group:` + o código de uma etapa. */
const urlDaFicha = (extra = "") =>
  `https://x/api/temis/categorias?enterpriseId=${encodeURIComponent("group:Lagoa Bonita")}&codigo=LBF${extra}`;

const pedirGet = () => GET(new Request(urlDaFicha()));

type Corpo = {
  data?: {
    categorias: Array<{
      id: string;
      nome: string;
      ordemHerdada: null | { ordenada: boolean; origem: string; papeis: string[]; rotulo: string };
      ordemPropria: null | { ordenada: boolean; papeis: string[] };
    }>;
    divergenciaDoEmpreendimento: null | string[];
  };
  error?: string;
};

beforeEach(() => {
  estado.atualizacoes = [];
  estado.exclusoes = [];
  estado.erroSettings = false;
  estado.categorias = [categoria(CONDOMINIO, "Condomínio"), categoria(LOTEAMENTO, "Loteamento")];
  estado.settings = EMPREENDIMENTOS.map((e) => settings(e.c2x_enterprise_id, null));
});

describe("GET — a herança que a tela precisa mostrar", () => {
  it("categoria sem ordem HERDA o empreendimento, e diz de onde veio", async () => {
    // A aba de política grava nas DIVISÕES, nunca no pai — é por isso que a leitura desce até elas.
    estado.settings = [
      settings("31", null),
      settings("33", ["comprador", "vendedora"], true),
      settings("32", ["comprador", "vendedora"], true),
      settings("27", ["comprador", "vendedora"], true),
    ];

    const corpo = (await (await pedirGet()).json()) as Corpo;
    const condominio = corpo.data?.categorias.find((c) => c.id === CONDOMINIO);

    expect(condominio?.ordemPropria).toBe(null);
    expect(condominio?.ordemHerdada?.origem).toBe("empreendimento");
    expect(condominio?.ordemHerdada?.rotulo).toBe("Lagoa Bonita");
    expect(condominio?.ordemHerdada?.ordenada).toBe(true);
    expect(condominio?.ordemHerdada?.papeis.slice(0, 2)).toEqual(["comprador", "vendedora"]);
    expect(corpo.data?.divergenciaDoEmpreendimento).toBe(null);
  });

  it("categoria com ordem SOBREPÕE — e a herdada continua visível", async () => {
    estado.categorias = [
      categoria(CONDOMINIO, "Condomínio", {
        assinatura_ordem: ["testemunha", "comprador"],
        assinatura_ordenada: true,
      }),
    ];
    estado.settings = [settings("33", ["comprador", "vendedora"], true)];

    const corpo = (await (await pedirGet()).json()) as Corpo;
    const condominio = corpo.data?.categorias[0];

    expect(condominio?.ordemPropria?.papeis.slice(0, 2)).toEqual(["testemunha", "comprador"]);
    // ⚠️ A HERDADA VIAJA MESMO COM ORDEM PRÓPRIA: é o que a tela mostra como "isto sobrepõe X".
    // Escondê-la faria o operador perder a única pista de para onde volta quando ele limpar.
    expect(condominio?.ordemHerdada?.origem).toBe("empreendimento");
    expect(condominio?.ordemHerdada?.papeis.slice(0, 2)).toEqual(["comprador", "vendedora"]);
  });

  it("ninguém cadastrou nada: a tela diz PADRÃO DA CASA, não campo vazio", async () => {
    const corpo = (await (await pedirGet()).json()) as Corpo;
    const condominio = corpo.data?.categorias[0];

    expect(condominio?.ordemHerdada?.origem).toBe("padrao");
    expect(condominio?.ordemHerdada?.rotulo).toBe("Padrão da casa");
    expect(condominio?.ordemHerdada?.ordenada).toBe(false);
  });

  it("o par intacto do empreendimento NÃO cria regra", async () => {
    estado.settings = [settings("33", null, false)];
    const corpo = (await (await pedirGet()).json()) as Corpo;
    expect(corpo.data?.categorias[0]?.ordemHerdada?.origem).toBe("padrao");
  });

  it("falha ao ler o empreendimento NÃO vira 'segue o padrão da casa'", async () => {
    estado.erroSettings = true;

    const corpo = (await (await pedirGet()).json()) as Corpo;

    // Nulo = "não sei". A tela avisa; ela não afirma uma regra a partir de uma consulta que falhou.
    expect(corpo.data?.categorias[0]?.ordemHerdada).toBe(null);
    expect(corpo.data?.categorias.length).toBe(2);
  });

  it("divisões que discordam viram aviso, e não uma escolha inventada", async () => {
    estado.settings = [
      settings("33", ["comprador", "vendedora"], true),
      settings("32", ["vendedora", "comprador"], true),
    ];

    const corpo = (await (await pedirGet()).json()) as Corpo;

    expect(corpo.data?.divergenciaDoEmpreendimento?.length).toBe(2);
    expect(corpo.data?.divergenciaDoEmpreendimento?.[0]).toContain("LBF");
  });

  it("subcategoria herda do EMPREENDIMENTO, e não da mãe", async () => {
    // ⚠️ ISTO ESPELHA O MOTOR, e não é omissão. `regraDeOrdemDaVenda`
    // (`lib/assinatura/ordem-db.ts`) vai da categoria da unidade DIRETO ao empreendimento. Se a
    // tela dissesse "Fase 1 herda de Loteamento", o contrato sairia na ordem do empreendimento e a
    // tela teria mentido — sem erro nenhum para denunciar.
    estado.categorias = [
      categoria(LOTEAMENTO, "Loteamento", {
        assinatura_ordem: ["corretor"],
        assinatura_ordenada: true,
      }),
      categoria("cat-fase", "Fase 1", { categoria_pai_id: LOTEAMENTO }),
    ];
    estado.settings = [settings("33", ["comprador"], true)];

    const corpo = (await (await pedirGet()).json()) as Corpo;
    const fase = corpo.data?.categorias.find((c) => c.id === "cat-fase");

    expect(fase?.ordemHerdada?.origem).toBe("empreendimento");
    expect(fase?.ordemHerdada?.papeis[0]).toBe("comprador");
  });
});

const patch = (corpo: unknown, id = CONDOMINIO) =>
  PATCH(
    new Request(urlDaFicha(`&id=${id}`), {
      body: JSON.stringify(corpo),
      method: "PATCH",
    }),
  );

describe("PATCH — gravar, limpar e recusar", () => {
  it("grava o par da ordem própria", async () => {
    const r = await patch({
      assinaturaOrdem: ["comprador", "conjuge", "vendedora"],
      assinaturaOrdenada: true,
    });

    expect(r.status).toBe(200);
    expect(estado.atualizacoes[0]?.valores.assinatura_ordem).toEqual([
      "comprador",
      "conjuge",
      "vendedora",
    ]);
    expect(estado.atualizacoes[0]?.valores.assinatura_ordenada).toBe(true);
  });

  it("limpar volta a herdar: lista nula E booleano zerado", async () => {
    const r = await patch({ assinaturaOrdem: null, assinaturaOrdenada: false });

    expect(r.status).toBe(200);
    // ⚠️ OS DOIS JUNTOS. `assinatura_ordenada` é `not null`: deixá-lo `true` com a lista nula
    // produziria uma categoria que a tela mostra como ordenada e o envio resolve como herança.
    expect(estado.atualizacoes[0]?.valores.assinatura_ordem).toBe(null);
    expect(estado.atualizacoes[0]?.valores.assinatura_ordenada).toBe(false);
  });

  it("renomear não encosta na ordem", async () => {
    await patch({ nome: "Condomínio fechado" });
    expect("assinatura_ordem" in (estado.atualizacoes[0]?.valores ?? {})).toBe(false);
  });

  it("recusa papel que não existe, dizendo qual", async () => {
    const r = await patch({ assinaturaOrdem: ["comprador", "avalista"], assinaturaOrdenada: true });
    const corpo = (await r.json()) as Corpo;

    expect(r.status).toBe(400);
    expect(corpo.error).toContain("avalista");
    expect(estado.atualizacoes.length).toBe(0);
  });

  it("recusa papel repetido", async () => {
    const r = await patch({
      assinaturaOrdem: ["comprador", "comprador"],
      assinaturaOrdenada: true,
    });
    expect(r.status).toBe(400);
    expect(estado.atualizacoes.length).toBe(0);
  });

  it("recusa lista vazia com o liga ligado", async () => {
    const r = await patch({ assinaturaOrdem: [], assinaturaOrdenada: true });
    expect(r.status).toBe(400);
    expect(estado.atualizacoes.length).toBe(0);
  });

  it("recusa o liga/desliga sem a lista", async () => {
    const r = await patch({ assinaturaOrdenada: true });
    expect(r.status).toBe(400);
    expect(estado.atualizacoes.length).toBe(0);
  });

  it("filtra pelo empreendimento DONO, e não pelo `group:` da ficha", async () => {
    await patch({ assinaturaOrdem: ["comprador"], assinaturaOrdenada: true });
    // Com o id cru da URL o update casava zero linhas e voltava sem erro: "salvo" na tela, nada no
    // banco. As categorias vivem no pai (31), a ficha manda `group:Lagoa Bonita`.
    expect(estado.atualizacoes[0]?.filtros.enterprise_id).toBe("31");
  });

  it("categoria que não é deste empreendimento é 404, e não sucesso calado", async () => {
    const r = await patch({ nome: "Outro" }, "cat-de-outro-produto");
    expect(r.status).toBe(404);
  });
});

describe("DELETE — o mesmo dono", () => {
  it("apaga filtrando pelo pai", async () => {
    const r = await DELETE(new Request(urlDaFicha(`&id=${CONDOMINIO}`), { method: "DELETE" }));
    expect(r.status).toBe(200);
    expect(estado.exclusoes[0]?.enterprise_id).toBe("31");
  });

  it("categoria inexistente é 404", async () => {
    const r = await DELETE(new Request(urlDaFicha("&id=cat-fantasma"), { method: "DELETE" }));
    expect(r.status).toBe(404);
  });
});
