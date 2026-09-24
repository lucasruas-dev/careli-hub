import { beforeEach, describe, expect, it, vi } from "vitest";

// O CARD NÃO ANDA SOBRE VENDA MORTA — a trava na raiz do avanço da Têmis.
//
// ⚠️ O DEFEITO ERA PRÉ-EXISTENTE E O BOTÃO NOVO DE CANCELAR APENAS ALARGAVA. `marcarAtividade` nunca
// leu `hercules_propostas`: com a venda cancelada ou distratada, as atividades que restaram no card
// continuavam podendo ser marcadas e a última levava o card a "Faturado" — o quadro mostrando
// FATURADO sobre uma venda desfeita, e `arrependimento_inicio` contando prazo de um contrato morto.
//
// ⚠️ O ESTADO NASCE DO PEDIDO PELA TELA VENDA, e não só do botão novo: nas etapas em que o contrato
// está assinado por todos o motor RECUSA indeferir o card de contrato e só empilha aviso, então o card
// sobrevive à queda da venda. Consertar só a porta nova deixaria a porta antiga produzindo o mesmo
// card mentiroso.
//
// ⚠️ ALCANCE MEDIDO EM PRODUÇÃO (23/09/2026): 13 cards têm a venda morta, e os 13 estão em `faturado`
// (9) ou `indeferido` (4), de onde não há próximo estágio. NENHUM card mente na tela hoje, e a trava
// não muda uma linha do que está lá — ela fecha o caminho do próximo.
//
// O Supabase é um construtor falso que ANOTA as consultas e responde por tabela: o que se mede aqui é
// a consulta que sai daqui e a escrita que NÃO sai.

type Consulta = {
  filtros: unknown[][];
  tabela: string;
  tipo: string;
  valores?: unknown;
};

const estado = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  respostas: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: (tabela: string) => {
      const consulta: Consulta = { filtros: [], tabela, tipo: "select" };
      estado.consultas.push(consulta);
      const proxima = () => (estado.respostas[tabela] ?? []).shift() ?? { data: null, error: null };
      const q: Record<string, unknown> = {
        eq: (...args: unknown[]) => {
          consulta.filtros.push(["eq", ...args]);
          return q;
        },
        maybeSingle: async () => proxima(),
        select: () => q,
        single: async () => proxima(),
        then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
          Promise.resolve(proxima()).then(ok, falha),
        update: (valores: unknown) => {
          consulta.tipo = "update";
          consulta.valores = valores;
          return q;
        },
      };
      return q;
    },
  }),
}));

vi.mock("./contrato-guardado-db", () => ({
  contratosDasPropostas: async () => new Map(),
}));

const passagens = vi.hoisted(() => ({ registradas: [] as Array<Record<string, unknown>> }));

vi.mock("./passagem-de-etapa-db", () => ({
  registrarPassagemDeEtapa: async (_sb: unknown, passagem: Record<string, unknown>) => {
    passagens.registradas.push(passagem);
  },
}));

const { marcarAtividade } = await import("./trabalhos-db");
const { ATIVIDADES } = await import("./trabalhos");

const CARD = {
  atividades_feitas: [] as string[],
  canal: "hercules",
  cliente_cpf: null,
  cliente_nome: "MAURA MARIA PASSOS",
  criado_em: "2026-09-16T10:00:00Z",
  enterprise_codigo: "VOC",
  enterprise_id: "37",
  enterprise_nome: "Vale do Ouro Central",
  estagio: "analise",
  estagio_desde: "2026-09-16T10:00:00Z",
  evidencia_path: null,
  id: "card-contrato",
  iris_ticket_id: null,
  observacao: null,
  proposta_id: "venda-maura",
  tipo: "contrato",
  trabalho_origem_id: null,
  unidade: "Quadra 03 · Lote 06",
};

/** As atividades da Análise do contrato: todas menos a última, que é a que faz o card andar. */
function quaseTodasDaAnalise(): { antes: string[]; ultima: string } {
  const doEstagio = ATIVIDADES.contrato
    .filter((a) => a.estagio === "analise")
    .map((a) => a.texto);
  const [ultima, ...antes] = [...doEstagio].reverse();
  return { antes, ultima: ultima ?? "" };
}

function consultasDe(tabela: string): Consulta[] {
  return estado.consultas.filter((c) => c.tabela === tabela);
}

function escritas(): Consulta[] {
  return estado.consultas.filter((c) => c.tipo !== "select");
}

beforeEach(() => {
  estado.consultas.length = 0;
  estado.respostas = {};
  passagens.registradas.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("marcarAtividade não deixa o card andar sobre venda desfeita", () => {
  it.each([
    ["cancelado", "cancelada"],
    ["distrato", "distratada"],
  ])("venda em %s: recusa, não grava e não registra passagem", async (etapa, palavra) => {
    const { antes, ultima } = quaseTodasDaAnalise();
    estado.respostas.temis_trabalhos = [
      { data: { ...CARD, atividades_feitas: antes }, error: null },
    ];
    estado.respostas.hercules_propostas = [{ data: { etapa }, error: null }];

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-contrato" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain(`já foi ${palavra}`);
    expect(r.erro).toContain("Indefira o card");
    // NADA foi gravado: nem a atividade, nem o estágio novo, nem a passagem de etapa.
    expect(escritas()).toEqual([]);
    expect(passagens.registradas).toEqual([]);
  });

  it("a venda viva continua fazendo o card andar (a trava não fecha o caminho normal)", async () => {
    const { antes, ultima } = quaseTodasDaAnalise();
    estado.respostas.temis_trabalhos = [
      { data: { ...CARD, atividades_feitas: antes }, error: null },
      { data: null, error: null },
    ];
    estado.respostas.hercules_propostas = [{ data: { etapa: "contrato" }, error: null }];

    const r = await marcarAtividade({
      atividade: ultima,
      feita: true,
      id: "card-contrato",
      quem: "u-nivea",
      quemNome: "Nivea Careli",
    });

    expect(r).toMatchObject({ andou: true, estagio: "contrato", ok: true });
    expect(escritas()).toHaveLength(1);
    expect(passagens.registradas[0]).toMatchObject({ origem: "atividade", para: "contrato" });
  });

  it("a venda é conferida ANTES da escrita, pelo id da proposta do card", async () => {
    estado.respostas.temis_trabalhos = [{ data: { ...CARD }, error: null }, { data: null, error: null }];
    estado.respostas.hercules_propostas = [{ data: { etapa: "contrato" }, error: null }];

    await marcarAtividade({ atividade: "Conferir os dados da venda", feita: true, id: "card-contrato" });

    const ordem = estado.consultas.map((c) => `${c.tabela}:${c.tipo}`);
    expect(ordem).toEqual([
      "temis_trabalhos:select",
      "hercules_propostas:select",
      "temis_trabalhos:update",
    ]);
    expect(consultasDe("hercules_propostas")[0]?.filtros).toContainEqual(["eq", "id", "venda-maura"]);
  });

  it("card sem venda ligada: não consulta venda nenhuma e marca como sempre", async () => {
    estado.respostas.temis_trabalhos = [
      { data: { ...CARD, proposta_id: null }, error: null },
      { data: null, error: null },
    ];

    const r = await marcarAtividade({
      atividade: "Conferir os dados da venda",
      feita: true,
      id: "card-contrato",
    });

    expect(r.ok).toBe(true);
    expect(consultasDe("hercules_propostas")).toEqual([]);
    expect(escritas()).toHaveLength(1);
  });

  it.each(["faturado", "indeferido"])(
    "card já encerrado em %s: a venda não é consultada, e o registro antigo continua corrigível",
    async (estagio) => {
      estado.respostas.temis_trabalhos = [
        { data: { ...CARD, estagio }, error: null },
        { data: null, error: null },
      ];

      const r = await marcarAtividade({
        atividade: "Liberar a unidade para venda",
        feita: false,
        id: "card-contrato",
      });

      expect(r.ok).toBe(true);
      expect(consultasDe("hercules_propostas")).toEqual([]);
      expect(escritas()).toHaveLength(1);
    },
  );

  it("leitura da venda que falha recusa, e não grava nada", async () => {
    estado.respostas.temis_trabalhos = [{ data: { ...CARD }, error: null }];
    estado.respostas.hercules_propostas = [
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
    ];

    const r = await marcarAtividade({
      atividade: "Conferir os dados da venda",
      feita: true,
      id: "card-contrato",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("não foi possível conferir");
    expect(escritas()).toEqual([]);
  });

  it("venda não encontrada não é venda desfeita: o elo quebrado não congela o card", async () => {
    estado.respostas.temis_trabalhos = [{ data: { ...CARD }, error: null }, { data: null, error: null }];
    estado.respostas.hercules_propostas = [{ data: null, error: null }];

    const r = await marcarAtividade({
      atividade: "Conferir os dados da venda",
      feita: true,
      id: "card-contrato",
    });

    expect(r.ok).toBe(true);
    expect(escritas()).toHaveLength(1);
  });
});
