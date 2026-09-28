import { beforeEach, describe, expect, it, vi } from "vitest";

// A CAD DO CLIENTE DO CORRETOR AUTÔNOMO APARECE NO BOARD — e é isto que fecha a fatia 2.
//
// ⚠️ UMA CAD QUE NASCE E FICA INVISÍVEL É PIOR QUE UMA CAD QUE NÃO NASCE. A fatia 2 passa a gravar
// `apolo_esteira` com `imobiliaria` e `imobiliaria_entity_id` NULOS (o autônomo mora em
// `corretor_entity_id`), então provar que ela grava não basta: tem de ser VISTA.
//
// ⚠️ MEDIDO EM PRODUÇÃO (bxgukywoxgivlrhjkwjx, 28/09/2026), e é o que autoriza o desenho:
//   • das 843 linhas de `apolo_esteira`, 486 (57,6%) estão sem `imobiliaria_entity_id` e 41 (4,9%)
//     estão sem ele E sem o texto, inclusive em etapa `credenciado` e `revisao`, sem nada quebrado;
//   • `imobiliaria` e `imobiliaria_entity_id` são as duas NULLABLE, e o único CHECK que as exige é
//     escopado em `origem = 'publico-cad'` (migration 0061), então esta fatia não pede migration;
//   • `imobiliaria_entity_id` aponta para PJ em 100% dos casos e `corretor_entity_id` para PF em
//     186 de 186: o slot do autônomo é o do corretor, e escrevê-lo no da imobiliária seria o
//     primeiro PF ali, exatamente o que o Lucas proibiu em 27/09/2026 (*"NAO QUERO TER A
//     INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA"*).
//
// O que está travado aqui:
//   • a CAD sem imobiliária tem card, com a coluna de imobiliária VAZIA e o corretor preenchido;
//   • o autônomo NÃO ganha card de imobiliária habilitada sem fila pela habilitação dele;
//   • a CAD de cliente de imobiliária continua exatamente como era.

const m = vi.hoisted(() => ({
  catalogo: vi.fn(),
  coordenadoresPorId: vi.fn(),
  porSigla: vi.fn(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: m.catalogo }));
vi.mock("@/lib/apolo/credenciamento", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/credenciamento")>()),
  listEmpreendimentosAtivos: async () => [
    { code: "VOC", id: "37", name: "VALE DO OURO", stageIds: [] },
  ],
}));
vi.mock("@/lib/apolo/disparo-credenciamento", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/disparo-credenciamento")>()),
  coordenadoresDosEmpreendimentosPorId: m.coordenadoresPorId,
  corretoresDaImobiliaria: async () => [],
  representanteDaImobiliaria: async () => ({ nome: "Representante", telefone: null }),
}));
vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({
  contatoDaEntidadeImobiliaria: async () => ({ nome: "RR SOLUCOES", telefone: null }),
}));
vi.mock("@/lib/apolo/empreendimentos", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterpriseCadastro: m.porSigla,
}));

import { FONTE_DA_HABILITACAO_DO_AUTONOMO } from "./habilitacao-do-autonomo";

import { montarFilaDoBoard } from "./board-do-servidor";

// ── Um banco de mentira que filtra de verdade (eq, in, neq, gte, or) ────────────────────────────

type Linha = Record<string, unknown>;

function valorDa(linha: Linha, coluna: string): unknown {
  if (coluna.startsWith("metadata->>")) {
    const metadata = (linha.metadata ?? null) as null | Record<string, unknown>;
    return metadata?.[coluna.slice("metadata->>".length)] ?? null;
  }
  return linha[coluna] ?? null;
}

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    let comContagem = false;
    const filtrar = (aceita: (linha: Linha) => boolean) => {
      linhas = linhas.filter(aceita);
    };
    const q: Record<string, unknown> = {};
    q.select = (_colunas?: string, opcoes?: { count?: string }) => {
      if (opcoes?.count) comContagem = true;
      return q;
    };
    q.eq = (coluna: string, valor: unknown) => {
      filtrar((linha) => String(valorDa(linha, coluna)) === String(valor));
      return q;
    };
    q.neq = (coluna: string, valor: unknown) => {
      filtrar((linha) => String(valorDa(linha, coluna)) !== String(valor));
      return q;
    };
    q.in = (coluna: string, valores: unknown[]) => {
      filtrar((linha) => valores.map(String).includes(String(valorDa(linha, coluna))));
      return q;
    };
    q.gte = (coluna: string, valor: string) => {
      filtrar((linha) => {
        const v = valorDa(linha, coluna);
        return v !== null && String(v) >= valor;
      });
      return q;
    };
    q.or = (expressao: string) => {
      const termos = expressao.split(",").map((termo) => {
        const [, coluna, op, valor] = /^(.+?)\.(is|neq|eq|gte)\.(.+)$/.exec(termo) ?? [];
        return { coluna: coluna ?? "", op, valor: valor ?? "" };
      });
      filtrar((linha) =>
        termos.some(({ coluna, op, valor }) => {
          const v = valorDa(linha, coluna);
          if (op === "is") return v === null;
          if (op === "neq") return v !== null && String(v) !== valor;
          if (op === "gte") return v !== null && String(v) >= valor;
          return String(v) === valor;
        }),
      );
      return q;
    };
    // `ilike` e `not` filtram de verdade: é `imobiliariaEntityIdEmLote` (lib/apolo/
    // imobiliaria-do-cliente.ts) que os usa, com `ilike("relationship_type", "imobili%")` e
    // `not("related_entity_id", "is", null)`. Ignorá-los faria o vínculo de HABILITAÇÃO do autônomo
    // (tipo `empreendimento`) passar por vínculo de imobiliária do cliente, que é exatamente o
    // engano que este arquivo existe para detectar.
    q.ilike = (coluna: string, padrao: string) => {
      const prefixo = padrao.replace(/%/g, "").toLowerCase();
      filtrar((linha) => String(valorDa(linha, coluna) ?? "").toLowerCase().startsWith(prefixo));
      return q;
    };
    q.not = (coluna: string, _op: string, _valor: unknown) => {
      filtrar((linha) => {
        const v = valorDa(linha, coluna);
        return v !== null && v !== undefined;
      });
      return q;
    };
    for (const metodo of ["order", "limit", "range"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.single = q.maybeSingle;
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({
        count: comContagem ? linhas.length : null,
        data: comContagem ? null : linhas,
        error: null,
      }).then(resolver);
    return q;
  };
  return { from } as unknown as Parameters<typeof montarFilaDoBoard>[0];
}

// ── Os personagens ──────────────────────────────────────────────────────────────────────────────

const agora = Date.now();
const horasAtras = (h: number) => new Date(agora - h * 60 * 60 * 1000).toISOString();

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const CLIENTE_DO_AUTONOMO = "11111111-1111-4111-8111-111111111111";
const IMOBILIARIA = "dddddddd-4444-4444-8444-444444444444";
const CLIENTE_DA_IMOBILIARIA = "22222222-2222-4222-8222-222222222222";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

const ficha = (id: string, nome: string, extra: Linha = {}): Linha => ({
  created_at: horasAtras(2),
  display_name: nome,
  document_masked: "529.982.247-25",
  entity_kind: "pf",
  id,
  legal_name: null,
  metadata: { bornRole: "prospect", source: "apolo" },
  primary_city: null,
  primary_state: null,
  status: "review",
  updated_at: horasAtras(2),
  ...extra,
});

// A linha da esteira como a fatia 2 a grava para o cliente do autônomo: SEM imobiliária, com o
// autônomo em `corretor_entity_id`.
const cadDoAutonomo: Linha = {
  analista_id: null,
  atualizado_em: horasAtras(1),
  chegou_em: horasAtras(1),
  corretor: "JOAO AUTONOMO",
  corretor_entity_id: AUTONOMO,
  created_at: horasAtras(1),
  empreendimento: "VALE DO OURO",
  enterprise_id: "37",
  entity_id: CLIENTE_DO_AUTONOMO,
  etapa: "validacao",
  imobiliaria: null,
  imobiliaria_entity_id: null,
  motivo: null,
  origem: "cadastro-manual",
  pago_em: null,
};

// A de sempre, com imobiliária: o controle que prova que nada afrouxou nem mudou para ela.
const cadDaImobiliaria: Linha = {
  ...cadDoAutonomo,
  corretor: "PEDRO DA RR",
  corretor_entity_id: null,
  empreendimento: "VALE DO OURO",
  entity_id: CLIENTE_DA_IMOBILIARIA,
  imobiliaria: "RR SOLUCOES",
  imobiliaria_entity_id: IMOBILIARIA,
};

function tabelas(): Record<string, Linha[]> {
  return {
    apolo_entities: [
      ficha(CLIENTE_DO_AUTONOMO, "MARIA CLIENTE DO AUTONOMO"),
      ficha(CLIENTE_DA_IMOBILIARIA, "JOSE CLIENTE DA IMOBILIARIA"),
      ficha(AUTONOMO, "JOAO AUTONOMO", {
        metadata: { bornRole: "corretor", source: "apolo" },
        status: "active",
        updated_at: horasAtras(1),
      }),
      ficha(IMOBILIARIA, "RR SOLUCOES LTDA", {
        entity_kind: "pj",
        legal_name: "RR SOLUCOES LTDA",
        metadata: { bornRole: "imobiliaria", source: "apolo" },
        status: "active",
        updated_at: horasAtras(1),
      }),
    ],
    apolo_entity_profiles: [
      { entity_id: AUTONOMO, profile: "corretor", status: "active" },
      { entity_id: IMOBILIARIA, profile: "imobiliaria", status: "active" },
      { entity_id: CLIENTE_DO_AUTONOMO, profile: "prospect", status: "review" },
      { entity_id: CLIENTE_DA_IMOBILIARIA, profile: "prospect", status: "review" },
    ],
    apolo_esteira: [cadDoAutonomo, cadDaImobiliaria],
    apolo_enterprise_settings: [
      {
        code: "VOC",
        credenciamento_ativo: true,
        enterprise_id: "37",
        prevenda_habilitada: false,
        valor_pix: null,
      },
    ],
    apolo_relationships: [
      // A habilitação do autônomo no 37, pela porta dele.
      {
        created_at: horasAtras(1),
        entity_id: AUTONOMO,
        id: "rel-autonomo-37",
        label: "VALE DO OURO",
        metadata: {
          createdBy: OPERADOR,
          enterpriseId: "37",
          kind: "trabalho",
          role: "empreendimento",
          source: FONTE_DA_HABILITACAO_DO_AUTONOMO,
        },
        relationship_type: "empreendimento",
        status: "verified",
      },
    ],
    hub_users: [],
  };
}

beforeEach(() => {
  m.catalogo.mockReset();
  m.catalogo.mockResolvedValue([{ codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] }]);
  m.coordenadoresPorId.mockReset();
  m.coordenadoresPorId.mockResolvedValue([]);
  m.porSigla.mockReset();
  m.porSigla.mockResolvedValue({ cadastros: [], ok: true });
});

describe("montarFilaDoBoard: a CAD sem imobiliária", () => {
  it("⚠️ a CAD do cliente do autônomo APARECE, com a imobiliária vazia e o corretor preenchido", async () => {
    const fila = await montarFilaDoBoard(bancoFalso(tabelas()), { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === CLIENTE_DO_AUTONOMO);
    expect(card).toBeDefined();
    expect(card?.etapa).toBe("validacao");
    expect(card?.enterpriseId).toBe("37");
    // A coluna de imobiliária fica VAZIA: não some e não quebra.
    expect(card?.imobiliaria).toBeNull();
    // E quem vendeu aparece onde deve: no corretor.
    expect(card?.corretor).toBe("JOAO AUTONOMO");
    expect(card?.empreendimentos).toEqual(["VALE DO OURO"]);
  });

  it("a CAD de cliente de imobiliária continua exatamente como era", async () => {
    const fila = await montarFilaDoBoard(bancoFalso(tabelas()), { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === CLIENTE_DA_IMOBILIARIA);
    expect(card?.imobiliaria).toBe("RR SOLUCOES");
    expect(card?.corretor).toBe("PEDRO DA RR");
    expect(card?.etapa).toBe("validacao");
  });

  it("⚠️ a habilitação do autônomo NÃO o põe no Board como imobiliária habilitada sem fila", async () => {
    const fila = await montarFilaDoBoard(bancoFalso(tabelas()), { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === AUTONOMO);
    // Ele pode não ter card nenhum (é o esperado: corretor não é CAD, regra do Lucas de 05/08).
    // O que NÃO pode, nunca, é aparecer com papel ou selo de imobiliária.
    expect(card?.papel ?? "sem-card").not.toBe("imobiliaria");
    expect(card?.habilitadaSemFila ?? null).toBeNull();
  });
});
