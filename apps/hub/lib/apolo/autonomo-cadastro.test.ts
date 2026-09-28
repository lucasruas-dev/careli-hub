import { describe, expect, it, vi } from "vitest";

// A PORTA DA HABILITAÇÃO DO CORRETOR AUTÔNOMO — e a garantia que o módulo se dá: habilitação repetida
// não grava linha nova nem avisa o coordenador de novo.
//
// ⚠️ A GARANTIA NÃO VALIA PARA O PAI NEM PARA O GRUPO (revisão de 28/09/2026). A conferência comparava o
// id CRU (`habilitados.ids.includes(enterpriseId)`) enquanto `conferirHabilitacaoDoAutonomo` expande pai
// e grupo: quem estivesse habilitado no PAI "35" (que é como o wizard grava o Vale do Ouro) e fosse
// habilitado de novo na divisão "37" ganhava um SEGUNDO vínculo `verified` e o coordenador recebia
// "Corretor autônomo habilitado no seu empreendimento" sobre quem já vendia o produto. É literalmente o
// caso SANTA FE e VINICIUS JOHNNY de 24/09/2026 que o cabeçalho do módulo cita como lição aprendida, e o
// caminho da imobiliária não tem o furo porque usa `separarVinculosNovos` COM o expansor. Se a função
// que confere e a que grava não usarem a mesma régua, uma sempre vai discordar da outra.

const m = vi.hoisted(() => ({
  ativos: vi.fn(async () => [] as unknown[]),
  cadastro: vi.fn(async () => [] as unknown[]),
  coordenadores: vi.fn(async () => [] as unknown[]),
  enviar: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/apolo/credenciamento", () => ({ listEmpreendimentosAtivos: m.ativos }));
vi.mock("@/lib/apolo/disparo-credenciamento", () => ({
  coordenadoresDosEmpreendimentosPorId: m.coordenadores,
  enviarPeloRelacionamento: m.enviar,
}));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: m.cadastro }));

import { habilitarAutonomoNoEmpreendimento } from "./autonomo-cadastro";
import { FONTE_DA_HABILITACAO_DO_AUTONOMO } from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

/** O cadastro do Panteon como medido em 24/09/2026: o 35 é o pai das divisões 36, 37 e 41. */
const PANTEON = [
  { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", paiId: "h-vlo" },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", paiId: "h-vlo" },
  { c2xEnterpriseId: "31", codigo: "LAB", id: "h-lab", nome: "Lagoa Bonita", paiId: null },
  { c2xEnterpriseId: "33", codigo: "LBF", id: "h-lbf", nome: "Lagoa Bonita · LBF", paiId: "h-lab" },
];

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const inseridos: Array<{ tabela: string; valores: Linha }> = [];
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) === String(valor));
      return q;
    };
    q.insert = async (valores: Linha) => {
      inseridos.push({ tabela, valores });
      return { data: null, error: null };
    };
    for (const metodo of ["in", "limit", "not", "order", "range"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(resolver);
    return q;
  };
  return { client: { from } as never, inseridos };
}

/** O autônomo da casa, habilitado nos ids passados (fonte própria, a única que autoriza). */
function banco(habilitadoEm: string[]) {
  return bancoFalso({
    apolo_entities: [
      {
        broker_code: "CA-0001",
        display_name: "JOAO AUTONOMO",
        entity_kind: "pf",
        id: AUTONOMO,
        legal_name: null,
      },
    ],
    apolo_entity_profiles: [{ entity_id: AUTONOMO, profile: "corretor", status: "active" }],
    apolo_relationships: habilitadoEm.map((enterpriseId) => ({
      created_at: "2026-09-28T12:00:00+00:00",
      entity_id: AUTONOMO,
      metadata: { createdBy: OPERADOR, enterpriseId, source: FONTE_DA_HABILITACAO_DO_AUTONOMO },
      relationship_type: "empreendimento",
      status: "verified",
    })),
  });
}

const habilitar = (b: ReturnType<typeof banco>, enterpriseId: string, label = "Vale do Ouro") =>
  habilitarAutonomoNoEmpreendimento(b.client, {
    autorNome: "ZEUS",
    autorUserId: OPERADOR,
    enterpriseId,
    entityId: AUTONOMO,
    label,
  });

describe("habilitarAutonomoNoEmpreendimento: a duplicidade usa a MESMA expansão da autorização", () => {
  it("⚠️ habilitado no PAI 35, habilitar na divisão 37 NÃO grava linha nova nem avisa de novo", async () => {
    m.cadastro.mockResolvedValue(PANTEON);
    const b = banco(["35"]);
    const r = await habilitar(b, "37", "Vale do Ouro · VOC");
    expect(r).toMatchObject({ jaHabilitado: true, ok: true });
    expect(b.inseridos).toEqual([]);
    expect(m.coordenadores).not.toHaveBeenCalled();
  });

  it("⚠️ habilitado na divisão 33, habilitar no group:Lagoa Bonita também não repete", async () => {
    m.cadastro.mockResolvedValue(PANTEON);
    const b = banco(["33"]);
    const r = await habilitar(b, "group:Lagoa Bonita", "Lagoa Bonita");
    expect(r).toMatchObject({ jaHabilitado: true, ok: true });
    expect(b.inseridos).toEqual([]);
  });

  it("o id igual continua sendo já habilitado (o caso que já funcionava)", async () => {
    m.cadastro.mockResolvedValue(PANTEON);
    const b = banco(["35"]);
    expect(await habilitar(b, "35")).toMatchObject({ jaHabilitado: true, ok: true });
    expect(b.inseridos).toEqual([]);
  });

  it("empreendimento de OUTRA família habilita de verdade: grava o vínculo com a fonte própria e audita", async () => {
    m.cadastro.mockResolvedValue(PANTEON);
    const b = banco(["35"]);
    const r = await habilitar(b, "33", "Lagoa Bonita · LBF");
    expect(r).toMatchObject({ auditou: true, jaHabilitado: false, ok: true });
    const vinculo = b.inseridos.find((i) => i.tabela === "apolo_relationships");
    expect((vinculo?.valores.metadata as Linha)?.source).toBe(FONTE_DA_HABILITACAO_DO_AUTONOMO);
    expect(vinculo?.valores.status).toBe("verified");
    expect(b.inseridos.some((i) => i.tabela === "apolo_audit_events")).toBe(true);
  });
});
