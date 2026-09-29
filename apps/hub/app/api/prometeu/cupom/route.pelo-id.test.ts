import { beforeEach, describe, expect, it, vi } from "vitest";

// A PA DO PROMETEU LÊ OS PLANOS PELO ID DO EMPREENDIMENTO, E NÃO PELA SIGLA GUARDADA (PAN-124).
//
// `prometeu_eventos.enterprise_code` é uma CÓPIA da sigla, guardada no dia em que o lançamento foi
// configurado. Num renome no C2X (o 43 de RDV para PDI em 24/09/2026), a busca por ela volta vazia, e
// a PA sai com os planos padrão da casa sobre um empreendimento que tem plano. O `enterprise_id` do
// evento não muda (medido em 25/09/2026: os três eventos têm o id, 35, 38 e 40).

const m = vi.hoisted(() => ({
  evento: null as null | { enterpriseCode: null | string; enterpriseId: null | string },
  lerPlanosDoC2x: vi.fn(),
  lerPlanosDoC2xPorIds: vi.fn(),
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: m.lerPlanosDoC2x,
  lerPlanosDoC2xPorIds: m.lerPlanosDoC2xPorIds,
}));

vi.mock("@/lib/prometeu/operador-server", () => ({
  autorizarOperacao: vi.fn(async () => ({ ok: true })),
  autorizarOperacaoDeEscrita: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/prometeu/reservas-evento", () => ({
  ehIdDeCupom: () => true,
  reservasDoGrupo: vi.fn(async () => ({
    reservas: [{ codigo: "PDI0101", credenciadoId: "cred-1", situacao: "reservada" }],
  })),
}));

vi.mock("@/lib/prometeu/data", () => {
  const respostas: Record<string, unknown> = {
    prometeu_credenciados: {
      data: { corretor: null, documento: null, evento_id: "ev-1", id: "cred-1", imobiliaria: null, nome: "CLIENTE" },
    },
    prometeu_reservas: { data: { evento_id: "ev-1" } },
  };
  const cliente = {
    from(tabela: string) {
      const cadeia: Record<string, unknown> = {
        eq: () => cadeia,
        limit: () => cadeia,
        maybeSingle: async () => respostas[tabela] ?? { data: null },
        select: () => cadeia,
      };
      return cadeia;
    },
  };
  return {
    createPrometeuClient: () => cliente,
    getEvento: vi.fn(async () =>
      m.evento ? { config: {}, id: "ev-1", nome: "LANÇAMENTO", ...m.evento } : null,
    ),
  };
});

import { GET } from "./route";

const PLANO_DO_C2X = {
  entradaPercentual: 10,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 8,
  nome: "PLANO NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

async function bipar() {
  const resposta = await GET(new Request("http://hub.test/api/prometeu/cupom?grupoId=RSV-123456") as never);
  return (await resposta.json()) as {
    data: { planos: Array<{ nome: string }>; planosAviso: null | string; planosSaoPadrao: boolean };
  };
}

beforeEach(() => {
  m.evento = null;
  m.lerPlanosDoC2x.mockReset().mockResolvedValue({ empreendimentos: [], ok: true });
  m.lerPlanosDoC2xPorIds.mockReset().mockResolvedValue({
    empreendimentos: [{ code: "PDI", enterpriseId: "43", planos: [PLANO_DO_C2X], tabelaDoEmpreendimento: "SACOOC" }],
    ok: true,
  });
});

describe("GET /api/prometeu/cupom: os planos da PA pelo id do evento", () => {
  it("🔴 com o id no evento, lê pelo id, e a sigla guardada (velha) não vai ao C2X", async () => {
    m.evento = { enterpriseCode: "RDV", enterpriseId: "43" };
    const { data } = await bipar();
    expect(m.lerPlanosDoC2xPorIds).toHaveBeenCalledWith([43]);
    expect(m.lerPlanosDoC2x).not.toHaveBeenCalled();
    expect(data.planosSaoPadrao).toBe(false);
    expect(data.planosAviso).toBeNull();
    expect(data.planos.map((p) => p.nome)).toEqual(["PLANO NORMAL"]);
  });

  it("sem o id, cai na sigla (o único caminho que havia)", async () => {
    m.evento = { enterpriseCode: "JDG", enterpriseId: null };
    await bipar();
    expect(m.lerPlanosDoC2x).toHaveBeenCalledWith(["JDG"]);
    expect(m.lerPlanosDoC2xPorIds).not.toHaveBeenCalled();
  });

  it("id nascido no Panteon (>= 100000) não é id do C2X: cai na sigla", async () => {
    m.evento = { enterpriseCode: "CEC", enterpriseId: "100003" };
    await bipar();
    expect(m.lerPlanosDoC2x).toHaveBeenCalledWith(["CEC"]);
    expect(m.lerPlanosDoC2xPorIds).not.toHaveBeenCalled();
  });

  it("sem id nem sigla: planos padrão, com o aviso de sempre, e nada vai ao C2X", async () => {
    m.evento = { enterpriseCode: null, enterpriseId: null };
    const { data } = await bipar();
    expect(data.planosSaoPadrao).toBe(true);
    expect(data.planosAviso).toMatch(/não tem empreendimento no Setup/);
    expect(m.lerPlanosDoC2x).not.toHaveBeenCalled();
    expect(m.lerPlanosDoC2xPorIds).not.toHaveBeenCalled();
  });

  it("C2X fora pelo id: planos padrão com o pedido de conferência, rotulado pela sigla do evento", async () => {
    m.evento = { enterpriseCode: "RDV", enterpriseId: "43" };
    m.lerPlanosDoC2xPorIds.mockResolvedValue({ error: "fora", ok: false });
    const { data } = await bipar();
    expect(data.planosSaoPadrao).toBe(true);
    expect(data.planosAviso).toBe(
      "Não consegui ler os planos de RDV no C2X. A folha saiu com os planos padrão da casa — confira antes de entregar.",
    );
  });
});
