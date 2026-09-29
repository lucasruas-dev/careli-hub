import { beforeEach, describe, expect, it, vi } from "vitest";

// A AUTO-APROVAÇÃO QUE PROMOVE UM PEDIDO PENDENTE (revisão de 24/09/2026).
//
// A imobiliária já credenciada que tinha um pedido antigo `pending` e volta a pedir o mesmo
// empreendimento pela página pública é aprovada sozinha: a rota PROMOVE a linha antiga para `verified`
// por UPDATE. Essa linha guarda o `created_at` do pedido original e o `source: "apolo"` sem autor do
// cadastro público, que o Board lê como "passou pela fila". Sem marca, a habilitação sumia da coluna
// Habilitada (pedido de mais de 30 dias) ou aparecia sem o selo "automática". O que se trava aqui:
//   • a promoção grava `habilitadoEm` (a hora da promoção) e `habilitadoPela`;
//   • o metadata antigo é MESCLADO, não trocado (o `enterpriseId` não pode sumir);
//   • e o Board lê essa linha como habilitação automática de agora.

const estado = vi.hoisted(() => ({
  updates: [] as Array<{ filtros: Record<string, unknown>; tabela: string; valores: Record<string, unknown> }>,
}));

vi.mock("@/lib/publico/cad/rotas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publico/cad/rotas")>()),
  prepararRota: vi.fn(async () => ({ adminClient: clienteFalso(), inicio: 0, ok: true })),
  responder: vi.fn(async (_request: Request, _inicio: number, resposta: Response) => resposta),
}));

vi.mock("@/lib/publico/cad/sessao", () => ({
  preSessaoImobDoRequest: () => ({ ok: true, pre: { cnpj: "11222333000181" } }),
}));

vi.mock("@/lib/publico/cad/log-erros", () => ({ anotarContexto: () => undefined }));

vi.mock("@/lib/publico/cad/dados", () => ({
  consultarImobiliariaCredenciada: vi.fn(async () => ({
    credenciada: true,
    entityId: "imob-x",
    nome: "IMOBILIARIA X",
  })),
}));

vi.mock("@/lib/apolo/credenciamento", () => ({
  listEmpreendimentosParaImobiliaria: vi.fn(async () => [
    { id: "43", name: "PORTAL DO IBITURUNA", stageIds: [] },
  ]),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: vi.fn() }));

vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({
  contatoDaEntidadeImobiliaria: vi.fn(async () => ({
    email: null,
    entityId: "imob-x",
    nome: "IMOBILIARIA X",
    telefone: "(33) 98303-3877",
  })),
}));

// O aviso não é o assunto aqui: espiões que não mandam nada.
vi.mock("@/lib/apolo/disparo-credenciamento", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/disparo-credenciamento")>()),
  avisarCredenciamentoAprovado: vi.fn(async () => ({
    coordenador: { ok: true },
    corretores: { avisados: 0, falharam: 0 },
    imobiliaria: { ok: true },
  })),
  coordenadoresDosEmpreendimentosPorId: vi.fn(async () => []),
  representanteDaImobiliaria: vi.fn(async () => ({ nome: null, telefone: null })),
}));

// O pedido antigo: cadastro público de julho, ainda `pending` no 43.
const PEDIDO_ANTIGO = {
  id: "rel-43-antigo",
  metadata: { enterpriseId: "43", kind: "trabalho", role: "empreendimento", source: "apolo" },
  status: "pending",
};

function clienteFalso() {
  return {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      const filtros: Record<string, unknown> = {};
      let valores: null | Record<string, unknown> = null;
      for (const metodo of ["select", "in", "limit", "order"]) q[metodo] = () => q;
      q.eq = (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return q;
      };
      q.insert = async () => ({ error: null });
      q.update = (v: Record<string, unknown>) => {
        valores = v;
        return q;
      };
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => {
        if (valores) {
          estado.updates.push({ filtros: { ...filtros }, tabela, valores });
          return Promise.resolve({ data: null, error: null }).then(ok, falha);
        }
        const dados =
          tabela === "apolo_relationships" && filtros.relationship_type === "empreendimento"
            ? [PEDIDO_ANTIGO]
            : [];
        return Promise.resolve({ data: dados, error: null }).then(ok, falha);
      };
      return q;
    },
  };
}

import { origemDoVinculo, ultimaHabilitacaoPorEntidade } from "@/lib/apolo/habilitada-sem-fila";

import { POST } from "./route";

beforeEach(() => {
  estado.updates = [];
});

describe("POST /api/publico/imobiliaria/credenciar: a promoção do pedido pendente", () => {
  it("⚠️ grava a hora e a porta da promoção, mesclando o metadata antigo", async () => {
    const antes = new Date().toISOString();
    const r = await POST(
      new Request("http://localhost/api/publico/imobiliaria/credenciar", {
        body: JSON.stringify({ corretores: [], empreendimentos: ["43"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(r.status).toBe(201);

    const promocao = estado.updates.find((u) => u.tabela === "apolo_relationships");
    expect(promocao?.filtros).toEqual({ id: "rel-43-antigo" });
    expect(promocao?.valores.status).toBe("verified");
    const metadata = promocao?.valores.metadata as Record<string, unknown>;
    // O que já estava continua (o enterpriseId é o que todo leitor usa).
    expect(metadata).toMatchObject({ enterpriseId: "43", source: "apolo" });
    expect(metadata.habilitadoPela).toBe("publico-imobiliaria");
    expect(String(metadata.habilitadoEm) >= antes).toBe(true);

    // E o Board lê a linha promovida como habilitação AUTOMÁTICA de agora, não como a fila de julho.
    expect(origemDoVinculo(metadata)).toBe("automatica");
    const ultima = ultimaHabilitacaoPorEntidade([
      { created_at: "2026-07-10T12:00:00+00:00", entity_id: "imob-x", metadata },
    ]).get("imob-x");
    expect(ultima).toEqual({ em: metadata.habilitadoEm, enterpriseIds: ["43"], origem: "automatica" });
  });
});
