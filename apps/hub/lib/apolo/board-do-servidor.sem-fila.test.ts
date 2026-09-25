import { beforeEach, describe, expect, it, vi } from "vitest";

// A HABILITAÇÃO SEM FILA NO BOARD E O COORDENADOR PELO ID (Lucas, 24/09/2026).
//
// O caso real: a CONECTTA IMOVEIS, já credenciada, pediu o 43 pela página pública às 16:55 de 24/09 e
// foi aprovada sozinha (regra de 15/08). Não apareceu no Board: a ficha veio do C2X (entidade em
// `review`, sem `source`, sem esteira) e as três pernas da fila exigem `source='apolo'` ou esteira. O
// mesmo com as habilitadas pelo cadastro interno (VIDA IMOVEIS, SANTA FE, VINICIUS JOHNNY no 43). O que
// se trava aqui:
//   • a habilitação sem fila dos últimos 30 dias entra na fila, como IMOBILIÁRIA com papel ativo (a
//     coluna Habilitada), com o selo da porta: automática ou cadastro interno;
//   • a de mais de 30 dias não entra; papel em `review` não entra; CAD de cliente não entra;
//   • quem já está na tela por outra perna não duplica, e a decisão do Board não ganha selo;
//   • a habilitação pelo Board acha o coordenador PELO ID (o 43 renomeado RDV -> PDI achava ninguém).

const m = vi.hoisted(() => ({
  avisar: vi.fn(),
  catalogo: vi.fn(),
  coordenadoresPorId: vi.fn(),
  porSigla: vi.fn(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: m.catalogo }));
vi.mock("@/lib/apolo/credenciamento", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/credenciamento")>()),
  listEmpreendimentosAtivos: async () => [
    { code: "PDI", id: "43", name: "PORTAL DO IBITURUNA", stageIds: [] },
  ],
}));
vi.mock("@/lib/apolo/disparo-credenciamento", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/disparo-credenciamento")>()),
  avisarCredenciamentoAprovado: m.avisar,
  coordenadoresDosEmpreendimentosPorId: m.coordenadoresPorId,
  corretoresDaImobiliaria: async () => [],
  representanteDaImobiliaria: async () => ({ nome: "Representante", telefone: "33999990000" }),
}));
vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({
  contatoDaEntidadeImobiliaria: async () => ({ nome: "CONECTTA IMOVEIS", telefone: null }),
}));
// A busca antiga, pela sigla: o 43 virou PDI no C2X e o settings ainda diz RDV, então ela volta vazia.
vi.mock("@/lib/apolo/empreendimentos", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterpriseCadastro: m.porSigla,
}));

import { posicaoDaImobiliaria } from "@/lib/apolo/credenciamento-etapa";

import { decidirCredenciamento, montarFilaDoBoard } from "./board-do-servidor";

// ── Um banco de mentira que filtra de verdade (eq, in, gte, or) ─────────────────────────────────────

type Linha = Record<string, unknown>;

function valorDa(linha: Linha, coluna: string): unknown {
  if (coluna.startsWith("metadata->>")) {
    const metadata = (linha.metadata ?? null) as null | Record<string, unknown>;
    return metadata?.[coluna.slice("metadata->>".length)] ?? null;
  }
  return linha[coluna] ?? null;
}

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const escritas: Array<{ operacao: string; tabela: string; valores: unknown }> = [];
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
    // Só os formatos que a fila usa: "col.is.null,col.neq.valor" e, na perna (d),
    // "created_at.gte.<iso>,metadata->>habilitadoEm.gte.<iso>".
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
    for (const metodo of ["order", "limit", "range", "not"]) q[metodo] = () => q;
    const escrever = (operacao: string) => (valores: unknown) => {
      escritas.push({ operacao, tabela, valores });
      linhas = [];
      return q;
    };
    q.insert = escrever("insert");
    q.update = escrever("update");
    q.upsert = escrever("upsert");
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
  return { cliente: { from } as unknown as Parameters<typeof montarFilaDoBoard>[0], escritas };
}

// ── Os personagens (medidos em 24/09/2026) ──────────────────────────────────────────────────────────

const agora = Date.now();
const horasAtras = (h: number) => new Date(agora - h * 60 * 60 * 1000).toISOString();
const diasAtras = (d: number) => horasAtras(d * 24);

const CONECTTA = "6204a86b-26e4-5385-a888-2f4cfbf1bac2";
const VIDA = "11111111-1111-4111-8111-111111111111";
const ANTIGA = "22222222-2222-4222-8222-222222222222";
const EM_VALIDACAO = "33333333-3333-4333-8333-333333333333";
const MORVIAN = "44444444-4444-4444-8444-444444444444";
const CLIENTE = "55555555-5555-4555-8555-555555555555";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

// A ficha que veio da carga do C2X: `review`, sem `source` e sem `bornRole`, criada em maio.
const fichaDoC2x = (id: string, nome: string): Linha => ({
  created_at: "2026-05-21T12:00:00+00:00",
  display_name: nome,
  document_masked: "37.716.144/0001-59",
  entity_kind: "pj",
  id,
  legal_name: nome,
  metadata: { cadastro: {}, responsibleName: "X" },
  primary_city: null,
  primary_state: null,
  status: "review",
  updated_at: "2026-08-04T15:38:29+00:00",
});

const vinculo = (entityId: string, criadoEm: string, metadata: Linha, status = "verified"): Linha => ({
  created_at: criadoEm,
  entity_id: entityId,
  id: `rel-${entityId}-${criadoEm}`,
  label: "PORTAL DO IBITURUNA",
  metadata: { enterpriseId: "43", kind: "trabalho", role: "empreendimento", ...metadata },
  relationship_type: "empreendimento",
  status,
});

const papel = (entityId: string, status: string): Linha => ({ entity_id: entityId, profile: "imobiliaria", status });

function tabelas(): Record<string, Linha[]> {
  return {
    apolo_entities: [
      fichaDoC2x(CONECTTA, "CONECTTA IMOVEIS"),
      fichaDoC2x(VIDA, "VIDA IMOVEIS LTDA"),
      fichaDoC2x(ANTIGA, "HABILITADA HA DOIS MESES"),
      fichaDoC2x(EM_VALIDACAO, "PAPEL AINDA EM REVIEW"),
      // Nasceu na página pública e foi habilitada no Board há 2 dias: já é da perna (b).
      {
        ...fichaDoC2x(MORVIAN, "MORVIAN TRANSACOES IMOBILIARIAS LTDA"),
        metadata: { bornRole: "imobiliaria", source: "apolo" },
        status: "active",
        updated_at: diasAtras(2),
      },
      { ...fichaDoC2x(CLIENTE, "CLIENTE DO FORMULARIO"), entity_kind: "pf", status: "active" },
    ],
    apolo_entity_profiles: [
      papel(CONECTTA, "active"),
      papel(VIDA, "active"),
      papel(ANTIGA, "active"),
      papel(EM_VALIDACAO, "review"),
      papel(MORVIAN, "active"),
    ],
    apolo_relationships: [
      vinculo(CONECTTA, horasAtras(1), { source: "publico-imobiliaria" }),
      vinculo(VIDA, horasAtras(3), { createdBy: OPERADOR, source: "apolo" }),
      vinculo(ANTIGA, diasAtras(40), { source: "publico-imobiliaria" }),
      vinculo(EM_VALIDACAO, horasAtras(2), { source: "publico-imobiliaria" }),
      vinculo(MORVIAN, diasAtras(3), { source: "apolo" }),
      vinculo(CLIENTE, horasAtras(5), { source: "publico-cad" }),
    ],
    apolo_enterprise_settings: [
      { code: "RDV", credenciamento_ativo: true, enterprise_id: "43", prevenda_habilitada: false, valor_pix: null },
    ],
    hub_users: [],
  };
}

beforeEach(() => {
  m.catalogo.mockReset();
  m.catalogo.mockResolvedValue([{ codes: ["PDI"], id: "43", name: "PORTAL DO IBITURUNA", stageIds: ["43"] }]);
  m.avisar.mockReset();
  m.avisar.mockResolvedValue({
    coordenador: { ok: true },
    corretores: { avisados: 0, falharam: 0 },
    imobiliaria: { ok: true },
  });
  m.coordenadoresPorId.mockReset();
  m.coordenadoresPorId.mockResolvedValue([
    { empreendimentos: [{ label: "RECANTO DO VALE" }], nome: "LUNA NEGOCIOS IMOBILIARIOS", telefone: "33988887777" },
  ]);
  m.porSigla.mockReset();
  m.porSigla.mockResolvedValue({ cadastros: [], ok: true });
});

describe("montarFilaDoBoard: a habilitação sem fila", () => {
  it("⚠️ a CONECTTA (automática no 43, ficha do C2X em review, sem source) aparece em Habilitada", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === CONECTTA);
    expect(card).toBeDefined();
    // Imobiliária com papel ativo: é o que a tela lê como coluna Habilitada (colunaDoItem) e trilha
    // concluída (posicaoDaImobiliaria), mesmo com a entidade em `review`.
    expect(card?.papel).toBe("imobiliaria");
    expect(card?.papelStatus).toBe("active");
    expect(
      posicaoDaImobiliaria({ entidadeStatus: card?.entidadeStatus, papelStatus: card?.papelStatus, totalEtapas: 2 }),
    ).toBe(2);
    // Com o produto: o hover diz ONDE foi a habilitação (revisão de 24/09/2026).
    expect(card?.habilitadaSemFila).toEqual({
      em: horasAtras(1),
      empreendimentos: ["PORTAL DO IBITURUNA"],
      origem: "automatica",
    });
    // A chegada é a habilitação, não a ficha de maio.
    expect(card?.criadoEm).toBe(horasAtras(1));
    expect(card?.empreendimentos).toEqual(["PORTAL DO IBITURUNA"]);
  });

  it("a do cadastro interno (VIDA IMOVEIS pelo wizard) aparece com o selo interno", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === VIDA);
    expect(card?.papel).toBe("imobiliaria");
    expect(card?.habilitadaSemFila).toEqual({
      em: horasAtras(3),
      empreendimentos: ["PORTAL DO IBITURUNA"],
      origem: "interna",
    });
  });

  it("⚠️ habilitação de mais de 30 dias não entra (o Board não é arquivo histórico)", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.itens.map((item) => item.id)).not.toContain(ANTIGA);
  });

  it("papel ainda em review e CAD de cliente não entram por esta perna", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const ids = fila.data.itens.map((item) => item.id);
    expect(ids).not.toContain(EM_VALIDACAO);
    expect(ids).not.toContain(CLIENTE);
  });

  it("quem já está na tela por outra perna não duplica, e a decisão do Board não ganha selo", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const daMorvian = fila.data.itens.filter((item) => item.id === MORVIAN);
    expect(daMorvian).toHaveLength(1);
    expect(daMorvian[0]?.habilitadaSemFila).toBeNull();
    expect(fila.data.itens.filter((item) => item.id === CONECTTA)).toHaveLength(1);
  });

  it("o coordenador do 43 no portal (recorte) também vê a CONECTTA", async () => {
    const { cliente } = bancoFalso(tabelas());
    const fila = await montarFilaDoBoard(cliente, {
      recorte: { ids: new Set(["43"]), nomes: ["PORTAL DO IBITURUNA"], usuario: { id: "u", nome: "Luna" } },
      usuarioId: "u",
    });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.itens.map((item) => item.id)).toEqual(expect.arrayContaining([CONECTTA, VIDA]));
  });
});

// ── Revisão de 24/09/2026: a habilitação é de UM produto, e a ficha é de todos ──────────────────────
//
// Medido em produção: a CONECTTA IMOVEIS (automática no 43 em 24/09, Vale do Ouro desde 02/08) aparecia
// no portal do Vale do Ouro com o selo e a data do 43; a ZEN NEGOCIOS (JDG pela fila em 20/08, Aldeia
// automática em 01/09) aparecia no portal do JDG com "sem fila em 01/09". O portal só pode ler o que
// aconteceu dentro do produto dele; o hub vê tudo, mas o hover diz em qual produto foi.

const ZEN = "77777777-7777-4777-8777-777777777777";
const PROMOVIDA = "88888888-8888-4888-8888-888888888888";

const CATALOGO = [
  { codes: ["PDI"], id: "43", name: "PORTAL DO IBITURUNA", stageIds: ["43"] },
  { codes: ["VLO"], id: "35", name: "VALE DO OURO", stageIds: ["36", "37", "41"] },
  { codes: ["JDG"], id: "40", name: "JARDIM DAS GERAIS", stageIds: ["40"] },
  { codes: ["ACP"], id: "42", name: "ALDEIA DAS CACHOEIRAS DAS PEDRAS", stageIds: ["42"] },
];

function tabelasDeDoisProdutos(): Record<string, Linha[]> {
  const base = tabelas();
  base.apolo_entities?.push(fichaDoC2x(ZEN, "ZEN NEGOCIOS"), fichaDoC2x(PROMOVIDA, "PEDIU EM JULHO"));
  base.apolo_entity_profiles?.push(papel(ZEN, "active"), papel(PROMOVIDA, "active"));
  base.apolo_relationships?.push(
    // A CONECTTA no Vale do Ouro desde 02/08, pelo modal da ficha.
    vinculo(CONECTTA, diasAtras(53), { createdBy: OPERADOR, enterpriseId: "35", source: "apolo" }),
    // A ZEN: JDG decidido no Board há 10 dias, Aldeia automática há 3.
    vinculo(ZEN, diasAtras(10), { enterpriseId: "40", source: "apolo" }),
    vinculo(ZEN, diasAtras(3), { enterpriseId: "42", source: "publico-imobiliaria" }),
    // O pedido de julho, `pending` até a página pública o promover há 2 horas.
    vinculo(PROMOVIDA, diasAtras(60), {
      habilitadoEm: horasAtras(2),
      habilitadoPela: "publico-imobiliaria",
      source: "apolo",
    }),
  );
  return base;
}

describe("montarFilaDoBoard: a habilitação sem fila é de um produto só", () => {
  beforeEach(() => {
    m.catalogo.mockResolvedValue(CATALOGO);
  });

  it("⚠️ o portal do Vale do Ouro não vê a CONECTTA habilitada no 43 (ela tem vínculo antigo no 35)", async () => {
    const { cliente } = bancoFalso(tabelasDeDoisProdutos());
    const fila = await montarFilaDoBoard(cliente, {
      recorte: {
        ids: new Set(["35", "36", "37", "41"]),
        nomes: ["VALE DO OURO"],
        usuario: { id: "u", nome: "Huber" },
      },
      usuarioId: "u",
    });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.itens.map((item) => item.id)).not.toContain(CONECTTA);
  });

  it("⚠️ ficha de dois produtos (fila no 40, automática no 42) no portal do 40: sem selo e com a data do 40", async () => {
    const { cliente } = bancoFalso(tabelasDeDoisProdutos());
    const fila = await montarFilaDoBoard(cliente, {
      recorte: { ids: new Set(["40"]), nomes: ["JARDIM DAS GERAIS"], usuario: { id: "u", nome: "Coord" } },
      usuarioId: "u",
    });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === ZEN);
    expect(card).toBeDefined();
    expect(card?.habilitadaSemFila).toBeNull();
    expect(card?.criadoEm).toBe(diasAtras(10));
    expect(card?.empreendimentos).toEqual(["JARDIM DAS GERAIS"]);
  });

  it("no hub a mesma ficha tem o selo da Aldeia, e o hover diz o produto", async () => {
    const { cliente } = bancoFalso(tabelasDeDoisProdutos());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    expect(fila.data.itens.find((item) => item.id === ZEN)?.habilitadaSemFila).toEqual({
      em: diasAtras(3),
      empreendimentos: ["ALDEIA DAS CACHOEIRAS DAS PEDRAS"],
      origem: "automatica",
    });
    // A CONECTTA segue com o selo do 43, e não do Vale do Ouro onde ela também está.
    expect(fila.data.itens.find((item) => item.id === CONECTTA)?.habilitadaSemFila?.empreendimentos).toEqual([
      "PORTAL DO IBITURUNA",
    ]);
  });

  it("⚠️ o pedido de julho promovido hoje pela página pública entra como automática de hoje", async () => {
    const { cliente } = bancoFalso(tabelasDeDoisProdutos());
    const fila = await montarFilaDoBoard(cliente, { usuarioId: "local-hub-user" });
    if (!fila.ok) throw new Error(fila.error);

    const card = fila.data.itens.find((item) => item.id === PROMOVIDA);
    expect(card?.habilitadaSemFila).toEqual({
      em: horasAtras(2),
      empreendimentos: ["PORTAL DO IBITURUNA"],
      origem: "automatica",
    });
    expect(card?.criadoEm).toBe(horasAtras(2));
  });
});

describe("decidirCredenciamento: o coordenador pelo ID", () => {
  it("⚠️ habilitar no 43 renomeado (settings RDV, C2X PDI) avisa a LUNA, buscada pelo id", async () => {
    const IMOB = "66666666-6666-4666-8666-666666666666";
    const { cliente } = bancoFalso({
      apolo_enterprise_settings: [{ code: "RDV", enterprise_id: "43" }],
      apolo_entity_profiles: [papel(IMOB, "review")],
      apolo_relationships: [
        {
          entity_id: IMOB,
          id: "rel-43",
          label: "RECANTO DO VALE",
          metadata: { enterpriseId: "43" },
          relationship_type: "empreendimento",
          status: "pending",
        },
      ],
    });

    const resposta = await decidirCredenciamento(cliente, IMOB, { acao: "habilitar", empreendimentos: ["43"] }, OPERADOR);
    expect(resposta.status).toBe(200);

    expect(m.coordenadoresPorId).toHaveBeenCalledWith(cliente, [{ enterpriseId: "43", label: "RECANTO DO VALE" }]);
    expect(m.porSigla).not.toHaveBeenCalled();
    expect(m.avisar).toHaveBeenCalledTimes(1);
    expect(m.avisar.mock.calls[0]?.[1]).toMatchObject({
      coordenadores: [expect.objectContaining({ nome: "LUNA NEGOCIOS IMOBILIARIOS" })],
      primeiraVez: true,
    });
  });
});
