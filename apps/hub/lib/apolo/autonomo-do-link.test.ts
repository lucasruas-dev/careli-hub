import { beforeEach, describe, expect, it, vi } from "vitest";

// O LINK PÚBLICO DO CORRETOR AUTÔNOMO (01/10/2026): o que este arquivo trava é a regra que não pode
// quebrar — o cadastro do link cai na MESMA entidade e na MESMA validação do time, e nada vira
// autônomo (código CA, papel ativo, habilitação) sem uma pessoa do time decidir.

const m = vi.hoisted(() => ({
  agrupar: vi.fn(),
  criar: vi.fn(),
  enviar: vi.fn(),
  fichas: vi.fn(),
  notificar: vi.fn(),
  sequencia: vi.fn(),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({
  createApoloEntity: m.criar,
  fichasDoDocumento: m.fichas,
}));
vi.mock("@/lib/apolo/cadastro-upload", () => ({ agruparEUploadDocumentos: m.agrupar }));
vi.mock("@/lib/apolo/codigo-do-corretor", () => ({ proximoCodigoDoCorretor: m.sequencia }));
vi.mock("@/lib/apolo/disparo-credenciamento", () => ({ enviarPeloRelacionamento: m.enviar }));
vi.mock("@/lib/notifications/publish", () => ({ publishHubNotification: m.notificar }));

import {
  ACOES_DO_PEDIDO,
  decidirPedidoDoAutonomo,
  entradaDaFichaDoLink,
  estadoDoPedido,
  MENSAGEM_DO_PORTAO,
  montarFila,
  recusaDaDecisao,
  registrarCadastroDoLink,
  situacaoDoCpf,
  situacaoNoPortao,
  statusDoPapelDepoisDoLink,
} from "./autonomo-do-link";

// ---------------------------------------------------------------------------
// Banco de mentira: cada operação é registrada e respondida por uma função do teste.
// ---------------------------------------------------------------------------
type Operacao = {
  acao: "delete" | "insert" | "select" | "update" | "upsert";
  filtros: Array<[string, string, unknown]>;
  tabela: string;
  valores?: unknown;
};

function banco(responder: (op: Operacao) => { data?: unknown; error?: unknown }) {
  const feitas: Operacao[] = [];
  const client = {
    from(tabela: string) {
      const op: Operacao = { acao: "select", filtros: [], tabela };
      const resolver = () => {
        feitas.push(op);
        const r = responder(op);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      };
      const cadeia: Record<string, unknown> = {};
      const filtro = (tipo: string) => (coluna: string, valor: unknown) => {
        op.filtros.push([tipo, coluna, valor]);
        return cadeia;
      };
      Object.assign(cadeia, {
        eq: filtro("eq"),
        in: filtro("in"),
        insert: (valores: unknown) => {
          op.acao = "insert";
          op.valores = valores;
          return cadeia;
        },
        is: filtro("is"),
        limit: () => cadeia,
        maybeSingle: resolver,
        order: () => cadeia,
        select: () => cadeia,
        then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
          resolver().then(ok, falha),
        update: (valores: unknown) => {
          op.acao = "update";
          op.valores = valores;
          return cadeia;
        },
        upsert: (valores: unknown) => {
          op.acao = "upsert";
          op.valores = valores;
          return cadeia;
        },
      });
      return cadeia;
    },
  };
  return { client: client as never, feitas };
}

const filtroDe = (op: Operacao, coluna: string) => op.filtros.find(([, c]) => c === coluna)?.[2];

const CORPO = {
  documentos: [],
  endereco: { cidade: "Belo Horizonte", uf: "MG" },
  identidade: { cpf: "529.982.247-25", nome: "JOANA DA SILVA" },
  perfil: { email: "joana@email.com", estadoCivilId: "2", telefone: "31999990000" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.agrupar.mockResolvedValue({ savedDocs: ["identificacao"], warnings: [] });
  m.enviar.mockResolvedValue({ ok: true });
  m.notificar.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
describe("o estado do pedido e o portão do CPF", () => {
  const ev = (action: string, created_at: string) => ({ action, created_at, entity_id: "e1" });

  it("o estado é a ÚLTIMA das quatro ações, e ação de fora não conta", () => {
    expect(estadoDoPedido([])).toBeNull();
    expect(
      estadoDoPedido([
        ev(ACOES_DO_PEDIDO.solicitado, "2026-10-01T10:00:00Z"),
        ev(ACOES_DO_PEDIDO.correcao, "2026-10-01T11:00:00Z"),
        ev("corretor_autonomo_habilitado", "2026-10-01T12:00:00Z"),
      ]),
    ).toBe("correcao");
    expect(
      estadoDoPedido([
        ev(ACOES_DO_PEDIDO.correcao, "2026-10-01T11:00:00Z"),
        ev(ACOES_DO_PEDIDO.solicitado, "2026-10-01T12:00:00Z"),
      ]),
    ).toBe("em-analise");
  });

  it("quem tem código já é autônomo; em análise espera; correção e indeferido podem reenviar", () => {
    expect(situacaoNoPortao({ estado: null, temCodigo: true })).toBe("ja-autonomo");
    expect(situacaoNoPortao({ estado: "em-analise", temCodigo: false })).toBe("em-analise");
    expect(situacaoNoPortao({ estado: "correcao", temCodigo: false })).toBe("liberado");
    expect(situacaoNoPortao({ estado: "indeferido", temCodigo: false })).toBe("liberado");
    expect(situacaoNoPortao({ estado: null, temCodigo: false })).toBe("liberado");
  });

  it("CPF JÁ CADASTRADO NÃO REVELA NADA DA FICHA: a resposta é uma frase fixa", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: ["e1"] });
    const { client } = banco((op) =>
      op.tabela === "apolo_entities"
        ? { data: [{ broker_code: "CA-0007", display_name: "JOANA DA SILVA", id: "e1" }] }
        : { data: [] },
    );
    const lido = await situacaoDoCpf(client, "52998224725");
    expect(lido).toEqual({ ok: true, situacao: "ja-autonomo" });
    // A frase pública não tem placeholder nem dado: é a mesma para todo CPF.
    for (const frase of Object.values(MENSAGEM_DO_PORTAO)) {
      expect(frase).not.toMatch(/JOANA|CA-\d|@|\d{3}/);
    }
  });

  it("leitura que falha NÃO libera o portão", async () => {
    m.fichas.mockResolvedValue({ falhou: true, ids: [] });
    const { client } = banco(() => ({}));
    expect(await situacaoDoCpf(client, "52998224725")).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
describe("o que o link grava", () => {
  it("a entrada da ficha é por lista de inclusão: papel, persona e origem do servidor, sem vínculo", () => {
    const entrada = entradaDaFichaDoLink({
      ...CORPO,
      // Tudo isto chega num corpo forjado e não pode passar.
      ...({
        corretores: [{ cpf: "1", nome: "X" }],
        empreendimentos: [{ id: "35", label: "Vale do Ouro" }],
        empresa: { cnpj: "12345678000195" },
        persona: "pj",
        role: "imobiliaria",
        vinculo: { enterpriseId: "35" },
      } as object),
      perfil: { ...CORPO.perfil, imobiliariaId: "imob-1", imobiliariaLabel: "Imob" },
    });
    expect(entrada.role).toBe("corretor");
    expect(entrada.persona).toBe("pf");
    expect(entrada.origem).toBe("publico-autonomo");
    expect(entrada.ownerUserId).toBeNull();
    // Uma ficha por pessoa: o mesmo CPF anexa na ficha que já existe.
    expect(entrada.dedupPorDocumento).toBe(true);
    expect(entrada.empreendimentos).toEqual([]);
    expect(entrada.corretores).toEqual([]);
    expect(entrada).not.toHaveProperty("empresa");
    expect(entrada).not.toHaveProperty("vinculo");
    expect(entrada.perfil?.imobiliariaId).toBe("");
    expect(entrada.perfil?.imobiliariaLabel).toBe("");
  });

  it("o papel fica em análise, a não ser que a pessoa já fosse corretor ativo", () => {
    expect(statusDoPapelDepoisDoLink(null)).toBe("review");
    expect(statusDoPapelDepoisDoLink("review")).toBe("review");
    expect(statusDoPapelDepoisDoLink("blocked")).toBe("review");
    expect(statusDoPapelDepoisDoLink("active")).toBe("active");
  });

  it("CAI NA MESMA ENTIDADE, SEM CÓDIGO, EM ANÁLISE E NA FILA DO TIME", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: [] });
    m.criar.mockResolvedValue({
      autenticacao: "CAD-2026-ABCDEF12",
      entityId: "nova",
      ok: true,
      warnings: [],
    });
    const { client, feitas } = banco((op) =>
      op.tabela === "hub_users" ? { data: [{ id: "u-admin" }] } : { data: [] },
    );

    const gravado = await registrarCadastroDoLink(client, {
      corpo: CORPO,
      empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }],
    });
    expect(gravado.ok).toBe(true);

    // A MESMA porta de gravação do cadastro interno, com papel de corretor e SEM gerador de código.
    expect(m.criar).toHaveBeenCalledTimes(1);
    const [, entrada, opcoes] = m.criar.mock.calls[0]!;
    expect(entrada).toMatchObject({
      dedupPorDocumento: true,
      empreendimentos: [],
      persona: "pf",
      role: "corretor",
    });
    expect(opcoes).toMatchObject({ cadastroDeCorretorAutonomo: true });
    expect(opcoes).not.toHaveProperty("codigoDoCorretor");
    expect(opcoes).not.toHaveProperty("habilitacaoInterna");

    // Papel em análise.
    const papel = feitas.find((op) => op.tabela === "apolo_entity_profiles" && op.acao === "update");
    expect(papel?.valores).toEqual({ status: "review" });
    expect(filtroDe(papel!, "profile")).toBe("corretor");

    // O pedido na trilha, com o interesse — e NENHUM vínculo de empreendimento, nenhum código.
    const pedido = feitas.find((op) => op.tabela === "apolo_audit_events" && op.acao === "insert");
    expect(pedido?.valores).toMatchObject({
      action: ACOES_DO_PEDIDO.solicitado,
      entity_id: "nova",
      metadata: { empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }] },
    });
    expect(feitas.some((op) => op.tabela === "apolo_relationships" && op.acao !== "select")).toBe(false);
    expect(
      feitas.some(
        (op) =>
          op.tabela === "apolo_entities" &&
          op.acao !== "select" &&
          JSON.stringify(op.valores ?? {}).includes("broker_code"),
      ),
    ).toBe(false);

    // O sino avisa a coordenação.
    expect(m.notificar).toHaveBeenCalledTimes(1);
    expect(m.notificar.mock.calls[0]![0]).toMatchObject({
      actionHref: "/apolo?tela=autonomos",
      recipientUserIds: ["u-admin"],
    });
  });

  it("quem já é corretor de imobiliária continua ativo: o pedido não tira ninguém do ar", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: ["existente"] });
    m.criar.mockResolvedValue({ autenticacao: "CAD-2026-X", entityId: "existente", ok: true, warnings: [] });
    const { client, feitas } = banco((op) =>
      op.tabela === "apolo_entity_profiles" && op.acao === "select"
        ? { data: [{ entity_id: "existente", status: "active" }] }
        : { data: [] },
    );

    await registrarCadastroDoLink(client, { corpo: CORPO, empreendimentosDeInteresse: [] });

    expect(
      feitas.some((op) => op.tabela === "apolo_entity_profiles" && op.acao === "update"),
    ).toBe(false);
    // A ficha é a mesma (o persist anexou nela) e o pedido entra nela.
    const pedido = feitas.find((op) => op.tabela === "apolo_audit_events" && op.acao === "insert");
    expect((pedido?.valores as { entity_id: string }).entity_id).toBe("existente");
  });

  it("sem o pedido na trilha a gravação FALHA: ficha que ninguém vê não é sucesso", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: [] });
    m.criar.mockResolvedValue({ autenticacao: "CAD-2026-X", entityId: "nova", ok: true, warnings: [] });
    const { client } = banco((op) =>
      op.tabela === "apolo_audit_events" && op.acao === "insert"
        ? { error: { message: "timeout" } }
        : { data: [] },
    );
    expect(await registrarCadastroDoLink(client, { corpo: CORPO, empreendimentosDeInteresse: [] })).toEqual({
      ok: false,
      recusa: null,
    });
  });

  it("a recusa do persist (e-mail de outra pessoa) volta inteira para a rota traduzir", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: [] });
    m.criar.mockResolvedValue({
      error: "Este e-mail já está no cadastro de MARIA",
      motivo: "email-repetido",
      ok: false,
    });
    const { client } = banco(() => ({ data: [] }));
    const gravado = await registrarCadastroDoLink(client, { corpo: CORPO, empreendimentosDeInteresse: [] });
    expect(gravado.ok).toBe(false);
    if (gravado.ok) return;
    expect(gravado.recusa?.motivo).toBe("email-repetido");
  });
});

// ---------------------------------------------------------------------------
describe("a fila do time", () => {
  const agora = new Date("2026-10-01T12:00:00Z");
  const ev = (entity_id: string, action: string, created_at: string, metadata = {}) => ({
    action,
    created_at,
    entity_id,
    metadata,
  });

  it("em análise e em correção ficam; decididos saem depois de 30 dias; quem nunca pediu não entra", () => {
    const fila = montarFila(
      [
        ev("a", ACOES_DO_PEDIDO.solicitado, "2026-06-01T10:00:00Z", {
          empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }],
        }),
        ev("b", ACOES_DO_PEDIDO.solicitado, "2026-09-30T10:00:00Z"),
        ev("b", ACOES_DO_PEDIDO.correcao, "2026-09-30T11:00:00Z", { motivos: ["RG ilegível"] }),
        ev("c", ACOES_DO_PEDIDO.solicitado, "2026-07-01T10:00:00Z"),
        ev("c", ACOES_DO_PEDIDO.aprovado, "2026-07-02T10:00:00Z"),
        ev("d", ACOES_DO_PEDIDO.aprovado, "2026-09-30T10:00:00Z"),
      ],
      agora,
    );
    expect(fila.map((item) => [item.entityId, item.estado])).toEqual([
      ["b", "correcao"],
      ["a", "em-analise"],
    ]);
    expect(fila.find((item) => item.entityId === "a")?.interesse).toEqual([
      { id: "35", label: "Vale do Ouro" },
    ]);
    expect(fila.find((item) => item.entityId === "b")?.motivos).toEqual(["RG ilegível"]);
  });
});

// ---------------------------------------------------------------------------
describe("as três decisões do time", () => {
  const base = {
    entityKind: "pf",
    estado: "em-analise" as const,
    motivos: [],
    temPapelDeImobiliaria: false,
  };

  it("recusa ficha sem pedido, pessoa jurídica, ficha de imobiliária e pedido já decidido", () => {
    expect(recusaDaDecisao({ ...base, acao: "aprovar", estado: null })?.status).toBe(404);
    expect(recusaDaDecisao({ ...base, acao: "aprovar", entityKind: "pj" })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "aprovar", temPapelDeImobiliaria: true })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "aprovar", estado: "aprovado" })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "indeferir", estado: "indeferido" })?.status).toBe(409);
  });

  it("correção e indeferimento exigem motivo; aprovar não", () => {
    expect(recusaDaDecisao({ ...base, acao: "correcao" })?.status).toBe(400);
    expect(recusaDaDecisao({ ...base, acao: "indeferir" })?.status).toBe(400);
    expect(recusaDaDecisao({ ...base, acao: "correcao", motivos: ["RG"] })).toBeNull();
    expect(recusaDaDecisao({ ...base, acao: "aprovar" })).toBeNull();
    // Em correção dá para aprovar ou indeferir, mas não pedir correção de novo.
    expect(recusaDaDecisao({ ...base, acao: "correcao", estado: "correcao", motivos: ["x"] })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "aprovar", estado: "correcao" })).toBeNull();
  });

  function bancoDaDecisao(extra: { brokerCode?: null | string; gravouCodigo?: boolean; papel?: string } = {}) {
    return banco((op) => {
      if (op.tabela === "apolo_entities" && op.acao === "select") {
        return {
          data: {
            broker_code: extra.brokerCode ?? null,
            display_name: "JOANA DA SILVA",
            entity_kind: "pf",
            id: "e1",
          },
        };
      }
      if (op.tabela === "apolo_entities" && op.acao === "update") {
        return { data: extra.gravouCodigo === false ? [] : [{ id: "e1" }] };
      }
      if (op.tabela === "apolo_entity_profiles" && op.acao === "select") {
        return { data: [{ profile: "corretor", status: extra.papel ?? "review" }] };
      }
      if (op.tabela === "apolo_audit_events" && op.acao === "select") {
        return {
          data: [{ action: ACOES_DO_PEDIDO.solicitado, created_at: "2026-10-01T10:00:00Z", entity_id: "e1" }],
        };
      }
      if (op.tabela === "apolo_contacts") {
        return { data: [{ is_primary: true, normalized_value: "31999990000" }] };
      }
      return { data: [] };
    });
  }

  it("APROVAR faz o que o cadastro interno faz: código da sequência, só em ficha sem código, e papel ativo", async () => {
    m.sequencia.mockResolvedValue({ codigo: "CA-0001", ok: true });
    const { client, feitas } = bancoDaDecisao();

    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "aprovar",
      autorNome: "Cinthia",
      autorUserId: "u-1",
      entityId: "e1",
    });

    expect(feita).toMatchObject({ codigo: "CA-0001", estado: "aprovado", ok: true });
    const codigo = feitas.find((op) => op.tabela === "apolo_entities" && op.acao === "update");
    expect(codigo?.valores).toMatchObject({ broker_code: "CA-0001" });
    expect(codigo?.filtros).toContainEqual(["is", "broker_code", null]);
    const papel = feitas.find((op) => op.tabela === "apolo_entity_profiles" && op.acao === "upsert");
    expect(papel?.valores).toEqual({ entity_id: "e1", profile: "corretor", status: "active" });
    const evento = feitas.find((op) => op.tabela === "apolo_audit_events" && op.acao === "insert");
    expect(evento?.valores).toMatchObject({
      action: ACOES_DO_PEDIDO.aprovado,
      actor_user_id: "u-1",
      metadata: { codigo: "CA-0001" },
    });
    // NENHUMA habilitação nasce da aprovação: ela é a outra porta, produto a produto.
    expect(feitas.some((op) => op.tabela === "apolo_relationships")).toBe(false);
    // O aviso ao corretor não leva o código (Lucas: o código é "somente no CRM").
    expect(String(m.enviar.mock.calls[0]![1].texto)).not.toContain("CA-0001");
  });

  it("dois cliques em Aprovar não dão dois códigos: o segundo não acha ficha sem código e recusa", async () => {
    m.sequencia.mockResolvedValue({ codigo: "CA-0002", ok: true });
    const { client, feitas } = bancoDaDecisao({ gravouCodigo: false });
    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "aprovar",
      autorNome: null,
      autorUserId: "u-1",
      entityId: "e1",
    });
    expect(feita).toMatchObject({ ok: false, status: 409 });
    expect(feitas.some((op) => op.tabela === "apolo_entity_profiles" && op.acao === "upsert")).toBe(false);
  });

  it("sem a sequência do código no banco, recusa e não inventa número", async () => {
    m.sequencia.mockResolvedValue({ mensagem: "sem sequência", ok: false });
    const { client, feitas } = bancoDaDecisao();
    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "aprovar",
      autorNome: null,
      autorUserId: "u-1",
      entityId: "e1",
    });
    expect(feita).toMatchObject({ ok: false, status: 503 });
    expect(feitas.some((op) => op.acao !== "select")).toBe(false);
  });

  it("INDEFERIR bloqueia só o papel que o link pôs em análise e avisa o corretor com o motivo", async () => {
    const { client, feitas } = bancoDaDecisao();
    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "indeferir",
      autorNome: null,
      autorUserId: "u-1",
      entityId: "e1",
      motivos: ["CRECI cancelado"],
    });
    expect(feita).toMatchObject({ estado: "indeferido", ok: true });
    const papel = feitas.find((op) => op.tabela === "apolo_entity_profiles" && op.acao === "update");
    expect(papel?.valores).toEqual({ status: "blocked" });
    expect(papel?.filtros).toContainEqual(["eq", "status", "review"]);
    expect(m.enviar.mock.calls[0]![1].texto).toContain("CRECI cancelado");
  });

  it("indeferir quem já era corretor ativo de imobiliária não mexe no papel dele", async () => {
    const { client, feitas } = bancoDaDecisao({ papel: "active" });
    await decidirPedidoDoAutonomo(client, {
      acao: "indeferir",
      autorNome: null,
      autorUserId: "u-1",
      entityId: "e1",
      motivos: ["x"],
    });
    expect(feitas.some((op) => op.tabela === "apolo_entity_profiles" && op.acao !== "select")).toBe(false);
  });

  it("PEDIR CORREÇÃO só registra e avisa, com o link para reenviar", async () => {
    const { client, feitas } = bancoDaDecisao();
    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "correcao",
      autorNome: null,
      autorUserId: "u-1",
      entityId: "e1",
      motivos: ["Comprovante de endereço vencido"],
    });
    expect(feita).toMatchObject({ estado: "correcao", ok: true });
    expect(feitas.filter((op) => op.acao !== "select").map((op) => op.tabela)).toEqual([
      "apolo_audit_events",
    ]);
    expect(m.enviar.mock.calls[0]![1].texto).toContain("https://c2x.app.br/publico/autonomo");
  });
});
