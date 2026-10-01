import { beforeEach, describe, expect, it, vi } from "vitest";

// O LINK PÚBLICO DO CORRETOR AUTÔNOMO (01/10/2026). O que este arquivo trava é a regra que não pode
// quebrar, no desenho da segunda rodada de revisão: o envio pelo link NÃO ENCOSTA EM FICHA NENHUMA. Ele
// grava só o pedido; a ficha nasce, ou é acrescentada, na aprovação de uma pessoa da coordenação, pela
// mesma porta do cadastro interno.

const m = vi.hoisted(() => ({
  agrupar: vi.fn(),
  criar: vi.fn(),
  enviar: vi.fn(),
  evolution: vi.fn(),
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
vi.mock("@/lib/apolo/disparo-credenciamento", () => ({
  enviarPeloRelacionamento: m.enviar,
  telefoneParaEnvio: (bruto?: null | string) => {
    const d = String(bruto ?? "").replace(/\D/g, "");
    return d.length >= 10 ? `55${d}` : null;
  },
}));
vi.mock("@/lib/iris/evolution-api", () => ({ sendEvolutionDirectText: m.evolution }));
vi.mock("@/lib/notifications/publish", () => ({ publishHubNotification: m.notificar }));

import {
  ACOES_DO_PEDIDO,
  celularValido,
  decidirPedidoDoAutonomo,
  entradaDaAprovacao,
  estadoDoPedido,
  guardarDocumentosDoPedido,
  MENSAGEM_DO_PORTAO,
  montarFila,
  propostaDoLink,
  recusaDaDecisao,
  registrarPedidoDoLink,
  resumoDoCpf,
  situacaoDoCpf,
  situacaoNoPortao,
  TETO_DE_PEDIDOS_POR_HORA,
} from "./autonomo-do-link";

// ---------------------------------------------------------------------------
// Banco de mentira: cada operação é registrada e respondida por uma função do teste.
// ---------------------------------------------------------------------------
type Operacao = {
  acao: "insert" | "select" | "update" | "upsert";
  contagem: boolean;
  filtros: Array<[string, string, unknown]>;
  tabela: string;
  valores?: unknown;
};

function banco(responder: (op: Operacao) => { count?: number; data?: unknown; error?: unknown }) {
  const feitas: Operacao[] = [];
  const subidas: Array<{ caminho: string; opcoes: unknown }> = [];
  const client = {
    from(tabela: string) {
      const op: Operacao = { acao: "select", contagem: false, filtros: [], tabela };
      const resolver = () => {
        feitas.push(op);
        const r = responder(op);
        return Promise.resolve({ count: r.count ?? null, data: r.data ?? null, error: r.error ?? null });
      };
      const cadeia: Record<string, unknown> = {};
      const filtro = (tipo: string) => (coluna: string, valor: unknown) => {
        op.filtros.push([tipo, coluna, valor]);
        return cadeia;
      };
      Object.assign(cadeia, {
        eq: filtro("eq"),
        gte: filtro("gte"),
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
        select: (_colunas?: string, opcoes?: { count?: string; head?: boolean }) => {
          if (opcoes?.head) op.contagem = true;
          return cadeia;
        },
        single: resolver,
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
    storage: {
      from: () => ({
        createSignedUrl: async (caminho: string) => ({ data: { signedUrl: `https://x/${caminho}` }, error: null }),
        upload: async (caminho: string, _bytes: unknown, opcoes: unknown) => {
          subidas.push({ caminho, opcoes });
          return { data: { path: caminho }, error: null };
        },
      }),
    },
  };
  return { client: client as never, feitas, subidas };
}

const filtroDe = (op: Operacao, coluna: string) => op.filtros.find(([, c]) => c === coluna)?.[2];

/** As tabelas que guardam a FICHA. O envio pelo link não pode encostar em nenhuma. */
const TABELAS_DA_FICHA = [
  "apolo_addresses",
  "apolo_contacts",
  "apolo_documents",
  "apolo_entity_identifiers",
  "apolo_entity_profiles",
  "apolo_relationships",
  "apolo_search_entries",
];

const CPF = "52998224725";
const PROPOSTA = propostaDoLink({
  endereco: { cidade: "Belo Horizonte", logradouro: "Rua A", numero: "10", uf: "MG" },
  identidade: { cpf: CPF, naturalidade: "Belo Horizonte - MG", nome: "JOANA DA SILVA" },
  perfil: { email: "joana@email.com", estadoCivilId: "2", telefone: "31999990000" },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.agrupar.mockResolvedValue({ savedDocs: ["identificacao"], warnings: [] });
  m.enviar.mockResolvedValue({ ok: true });
  m.evolution.mockResolvedValue({ ok: true });
  m.notificar.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
describe("o portão do CPF", () => {
  it("o estado de um pedido é a última decisão que aponta para ELE", () => {
    const decisoes = [
      { action: ACOES_DO_PEDIDO.correcao, created_at: "2026-10-01T11:00:00Z", metadata: { pedidoId: "p1" } },
      { action: ACOES_DO_PEDIDO.indeferido, created_at: "2026-10-01T12:00:00Z", metadata: { pedidoId: "p2" } },
    ];
    expect(estadoDoPedido("p1", decisoes)).toBe("correcao");
    expect(estadoDoPedido("p2", decisoes)).toBe("indeferido");
    expect(estadoDoPedido("p3", decisoes)).toBe("em-analise");
  });

  it("quem tem código já é autônomo; em análise espera; correção e indeferido podem reenviar", () => {
    expect(situacaoNoPortao({ estado: null, temCodigo: true })).toBe("ja-autonomo");
    expect(situacaoNoPortao({ estado: "em-analise", temCodigo: false })).toBe("em-analise");
    expect(situacaoNoPortao({ estado: "correcao", temCodigo: false })).toBe("liberado");
    expect(situacaoNoPortao({ estado: "indeferido", temCodigo: false })).toBe("liberado");
    expect(situacaoNoPortao({ estado: null, temCodigo: false })).toBe("liberado");
  });

  it("CPF com código: frase fixa, sem nada da ficha", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: ["e1"] });
    const { client } = banco((op) =>
      op.tabela === "apolo_entities"
        ? { data: [{ broker_code: "CA-0007", display_name: "JOANA DA SILVA", id: "e1" }] }
        : { data: [] },
    );
    expect(await situacaoDoCpf(client, CPF)).toEqual({ ok: true, situacao: "ja-autonomo" });
    for (const frase of Object.values(MENSAGEM_DO_PORTAO)) {
      expect(frase).not.toMatch(/JOANA|CA-\d|@|\d{3}|WhatsApp/);
    }
  });

  it("CPF com pedido sem decisão está em análise, e o pedido é achado pelo RESUMO do CPF", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: [] });
    const { client, feitas } = banco((op) =>
      op.tabela === "apolo_audit_events" && filtroDe(op, "metadata->>cpfHash")
        ? { data: [{ action: ACOES_DO_PEDIDO.solicitado, created_at: "2026-10-01T10:00:00Z", id: "p1" }] }
        : { data: [] },
    );
    expect(await situacaoDoCpf(client, CPF)).toEqual({ ok: true, situacao: "em-analise" });
    const busca = feitas.find((op) => filtroDe(op, "metadata->>cpfHash"));
    expect(filtroDe(busca!, "metadata->>cpfHash")).toBe(resumoDoCpf(CPF));
    expect(JSON.stringify(busca)).not.toContain(CPF);
  });

  it("leitura que falha NÃO libera o portão", async () => {
    m.fichas.mockResolvedValue({ falhou: true, ids: [] });
    const { client } = banco(() => ({}));
    expect(await situacaoDoCpf(client, CPF)).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
describe("a proposta e o celular", () => {
  it("lista de inclusão: nada de cônjuge, empreendimento, empresa, vínculo nem imobiliária", () => {
    const proposta = propostaDoLink({
      conjuge: { cpf: "11144477735", nome: "MARIDO" },
      empreendimentos: [{ id: "35" }],
      empresa: { cnpj: "12345678000195" },
      endereco: { cidade: "BH", inventado: "x" },
      identidade: { cpf: CPF, nome: "  JOANA  ", outro: "y" },
      perfil: { imobiliariaId: "imob-1", imobiliariaLabel: "Imob", telefone: "31999990000" },
      vinculo: { enterpriseId: "35" },
    } as never);
    expect(Object.keys(proposta).sort()).toEqual(["endereco", "identidade", "perfil"]);
    expect(proposta.identidade).toEqual({ cpf: CPF, nome: "JOANA" });
    expect(proposta.perfil).toEqual({ telefone: "31999990000" });
    expect(proposta.endereco).toEqual({ cidade: "BH" });
  });

  it("cada campo tem teto de tamanho", () => {
    const proposta = propostaDoLink({ identidade: { nome: "A".repeat(5000) } });
    expect(proposta.identidade.nome?.length).toBe(200);
  });

  it("a entrada da APROVAÇÃO é o cadastro interno do autônomo: corretor, PF, um CPF uma ficha, sem vínculo", () => {
    const entrada = entradaDaAprovacao(PROPOSTA, "u-1");
    expect(entrada).toMatchObject({
      conjuge: null,
      dedupPorDocumento: true,
      empreendimentos: [],
      ownerUserId: "u-1",
      persona: "pf",
      role: "corretor",
    });
    expect(entrada.perfil).toMatchObject({ imobiliariaId: "", imobiliariaLabel: "" });
  });

  it("celular é DÍGITO com DDD (o `/D/g` da primeira versão aceitava qualquer texto de 10 letras)", () => {
    expect(celularValido("(31) 99999-0000")).toBe(true);
    expect(celularValido("+55 31 99999-0000")).toBe(true);
    expect(celularValido("31 9999-000")).toBe(false);
    expect(celularValido("abcdefghijkl")).toBe(false);
    expect(celularValido("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("o envio pelo link", () => {
  it("NÃO ENCOSTA EM FICHA: grava só o pedido, sem entity_id, e avisa no sino", async () => {
    const { client, feitas } = banco((op) => {
      if (op.contagem) return { count: 0 };
      if (op.tabela === "apolo_audit_events" && op.acao === "insert") return { data: { id: "p-novo" } };
      if (op.tabela === "hub_users") return { data: [{ id: "u-admin" }] };
      return { data: [] };
    });

    const resultado = await registrarPedidoDoLink(client, {
      documentos: [
        { categoria: "identificacao", fileName: "rg.jpg", mimeType: "image/jpeg", sizeBytes: 10, storagePath: "s/a" },
      ],
      empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }],
      proposta: PROPOSTA,
    });

    expect(resultado).toEqual({ ok: true, pedidoId: "p-novo" });
    expect(m.criar).not.toHaveBeenCalled();
    expect(feitas.some((op) => TABELAS_DA_FICHA.includes(op.tabela))).toBe(false);
    expect(feitas.some((op) => op.tabela === "apolo_entities")).toBe(false);

    const pedido = feitas.find((op) => op.tabela === "apolo_audit_events" && op.acao === "insert");
    expect(pedido?.valores).toMatchObject({
      action: ACOES_DO_PEDIDO.solicitado,
      entity_id: null,
      metadata: {
        cpfHash: resumoDoCpf(CPF),
        cpfMascarado: "***.982.247-**",
        empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }],
        proposta: PROPOSTA,
      },
    });
    expect(m.notificar).toHaveBeenCalledTimes(1);
    expect(m.notificar.mock.calls[0]![0]).toMatchObject({
      actionHref: "/apolo?tela=autonomos",
      recipientUserIds: ["u-admin"],
    });
  });

  it("TETO GERAL: com a hora cheia de pedidos, recusa sem gravar nada", async () => {
    const { client, feitas } = banco((op) => (op.contagem ? { count: TETO_DE_PEDIDOS_POR_HORA } : { data: [] }));
    const resultado = await registrarPedidoDoLink(client, {
      documentos: [],
      empreendimentosDeInteresse: [],
      proposta: PROPOSTA,
    });
    expect(resultado).toEqual({ motivo: "teto", ok: false });
    expect(feitas.some((op) => op.acao !== "select")).toBe(false);
  });

  it("o sino não inunda: com muitos pedidos em 15 minutos, ele para de tocar a cada um", async () => {
    let contagens = 0;
    const { client } = banco((op) => {
      if (op.contagem) {
        contagens += 1;
        return { count: contagens === 1 ? 10 : 6 };
      }
      if (op.acao === "insert") return { data: { id: "p" } };
      return { data: [{ id: "u" }] };
    });
    await registrarPedidoDoLink(client, { documentos: [], empreendimentosDeInteresse: [], proposta: PROPOSTA });
    expect(m.notificar).not.toHaveBeenCalled();
  });

  it("os documentos vão para o staging do dono, só identidade e comprovante, sem o texto livre lido", async () => {
    const { client, subidas } = banco(() => ({}));
    const guardados = await guardarDocumentosDoPedido(client, {
      documentos: [
        { categoria: "identificacao", extractedPayload: { nome: "FORJADO" }, fileBase64: "QUJD", fileName: "rg.jpg", mimeType: "image/jpeg" },
        { categoria: "comprovante_endereco", fileName: "luz.pdf", sizeBytes: 99, storagePath: "entidade/_pendente/a-dono/x-luz.pdf" },
        { categoria: "certidao", fileBase64: "QUJD", fileName: "c.jpg" },
      ] as never,
      dono: "a-dono",
    });
    expect(guardados.ok).toBe(true);
    if (!guardados.ok) return;
    expect(guardados.documentos.map((doc) => doc.categoria)).toEqual(["identificacao", "comprovante_endereco"]);
    expect(subidas).toHaveLength(1);
    expect(subidas[0]!.caminho.startsWith("entidade/_pendente/a-dono/")).toBe(true);
    expect(JSON.stringify(guardados)).not.toContain("FORJADO");
  });
});

// ---------------------------------------------------------------------------
describe("a fila do time", () => {
  const agora = new Date("2026-10-01T12:00:00Z");
  const pedido = (id: string, cpfHash: string, created_at: string, extra = {}) => ({
    action: ACOES_DO_PEDIDO.solicitado,
    created_at,
    id,
    metadata: { cpfHash, proposta: { identidade: { nome: id } }, ...extra },
  });
  const decisao = (action: string, pedidoId: string, created_at: string, extra = {}) => ({
    action,
    created_at,
    metadata: { pedidoId, ...extra },
  });

  it("um item por CPF, o pedido mais recente; decididos saem depois de 30 dias", () => {
    const fila = montarFila(
      [
        pedido("antigo", "cpf-a", "2026-09-29T10:00:00Z"),
        decisao(ACOES_DO_PEDIDO.correcao, "antigo", "2026-09-29T11:00:00Z", { motivos: ["RG ilegível"] }),
        pedido("reenvio", "cpf-a", "2026-09-30T10:00:00Z", {
          empreendimentosDeInteresse: [{ id: "35", label: "Vale do Ouro" }],
        }),
        pedido("velho", "cpf-b", "2026-07-01T10:00:00Z"),
        decisao(ACOES_DO_PEDIDO.aprovado, "velho", "2026-07-02T10:00:00Z", { codigo: "CA-0001" }),
        pedido("negado", "cpf-c", "2026-09-30T09:00:00Z"),
        decisao(ACOES_DO_PEDIDO.indeferido, "negado", "2026-09-30T09:30:00Z", { motivos: ["CRECI cancelado"] }),
      ],
      agora,
    );
    expect(fila.map((item) => [item.pedidoId, item.estado])).toEqual([
      ["reenvio", "em-analise"],
      ["negado", "indeferido"],
    ]);
    expect(fila[0]!.interesse).toEqual([{ id: "35", label: "Vale do Ouro" }]);
    expect(fila[1]!.motivos).toEqual(["CRECI cancelado"]);
  });
});

// ---------------------------------------------------------------------------
describe("as três decisões do time", () => {
  it("recusa decidido, pedido substituído, correção repetida e motivo vazio", () => {
    const base = { estado: "em-analise" as const, maisRecente: true, motivos: [] };
    expect(recusaDaDecisao({ ...base, acao: "aprovar", estado: "aprovado" })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "indeferir", estado: "indeferido", motivos: ["x"] })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "aprovar", maisRecente: false })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "correcao", estado: "correcao", motivos: ["x"] })?.status).toBe(409);
    expect(recusaDaDecisao({ ...base, acao: "correcao" })?.status).toBe(400);
    expect(recusaDaDecisao({ ...base, acao: "indeferir" })?.status).toBe(400);
    expect(recusaDaDecisao({ ...base, acao: "aprovar" })).toBeNull();
    expect(recusaDaDecisao({ ...base, acao: "aprovar", estado: "correcao" })).toBeNull();
  });

  const DOCUMENTOS = [
    { categoria: "identificacao", fileName: "rg.jpg", mimeType: "image/jpeg", sizeBytes: 10, storagePath: "entidade/_pendente/a-x/rg.jpg" },
  ];

  function bancoDaDecisao(extra: { fichaComCodigo?: boolean; fichaPj?: boolean; outroMaisRecente?: boolean } = {}) {
    return banco((op) => {
      if (op.tabela === "apolo_audit_events" && op.acao === "select" && filtroDe(op, "id") === "p1") {
        return {
          data: {
            action: ACOES_DO_PEDIDO.solicitado,
            created_at: "2026-10-01T10:00:00Z",
            id: "p1",
            metadata: { cpfHash: resumoDoCpf(CPF), documentos: DOCUMENTOS, proposta: PROPOSTA },
          },
        };
      }
      if (op.tabela === "apolo_audit_events" && op.acao === "select" && filtroDe(op, "metadata->>cpfHash")) {
        return { data: [{ action: ACOES_DO_PEDIDO.solicitado, created_at: "x", id: extra.outroMaisRecente ? "p2" : "p1" }] };
      }
      if (op.tabela === "apolo_entities" && op.acao === "select" && filtroDe(op, "id") === "ficha-nova") {
        return { data: { broker_code: "CA-0001" } };
      }
      if (op.tabela === "apolo_entities" && op.acao === "select") {
        return {
          data: [
            {
              broker_code: extra.fichaComCodigo ? "CA-0004" : null,
              entity_kind: extra.fichaPj ? "pj" : "pf",
              id: "existente",
            },
          ],
        };
      }
      return { data: [] };
    });
  }

  it("APROVAR grava pela porta do cadastro interno, acrescentando, com papel ativo, código e documentos", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: [] });
    m.criar.mockResolvedValue({ autenticacao: "CAD-2026-X", entityId: "ficha-nova", ok: true, warnings: [] });
    m.sequencia.mockResolvedValue({ codigo: "CA-0001", ok: true });
    const { client, feitas } = bancoDaDecisao();

    const feita = await decidirPedidoDoAutonomo(client, {
      acao: "aprovar",
      autorNome: "Cinthia",
      autorUserId: "u-1",
      pedidoId: "p1",
    });

    expect(feita).toMatchObject({ codigo: "CA-0001", estado: "aprovado", ok: true });
    const [, entrada, opcoes] = m.criar.mock.calls[0]!;
    expect(entrada).toEqual(entradaDaAprovacao(PROPOSTA, "u-1"));
    // Ficha que já existe só é ACRESCENTADA, e sem gerador: o código é gravado à parte.
    expect(opcoes).toEqual({ cadastroDeCorretorAutonomo: true, fichaExistente: "acrescentar" });

    const papel = feitas.find((op) => op.tabela === "apolo_entity_profiles" && op.acao === "upsert");
    expect(papel?.valores).toEqual({ entity_id: "ficha-nova", profile: "corretor", status: "active" });
    const codigo = feitas.find((op) => op.tabela === "apolo_entities" && op.acao === "update");
    expect(codigo?.valores).toMatchObject({ broker_code: "CA-0001" });
    expect(codigo?.filtros).toContainEqual(["is", "broker_code", null]);

    expect(m.agrupar.mock.calls[0]![1]).toMatchObject({
      documentos: [{ categoria: "identificacao", storagePath: "entidade/_pendente/a-x/rg.jpg" }],
      entityId: "ficha-nova",
    });
    const evento = feitas.find((op) => op.tabela === "apolo_audit_events" && op.acao === "insert");
    expect(evento?.valores).toMatchObject({
      action: ACOES_DO_PEDIDO.aprovado,
      actor_user_id: "u-1",
      entity_id: "ficha-nova",
      metadata: { codigo: "CA-0001", pedidoId: "p1" },
    });
    // Nenhuma habilitação nasce da aprovação.
    expect(feitas.some((op) => op.tabela === "apolo_relationships")).toBe(false);
    // O aviso vai para o celular DIGITADO, sem o código ("somente no CRM").
    expect(m.enviar.mock.calls[0]![1]).toMatchObject({ telefone: "31999990000" });
    expect(String(m.enviar.mock.calls[0]![1].texto)).not.toContain("CA-0001");
  });

  it("uma pessoa, um código: CPF que já é autônomo não é aprovado de novo", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: ["existente"] });
    const { client, feitas } = bancoDaDecisao({ fichaComCodigo: true });
    const feita = await decidirPedidoDoAutonomo(client, { acao: "aprovar", autorNome: null, autorUserId: "u", pedidoId: "p1" });
    expect(feita).toMatchObject({ ok: false, status: 409 });
    expect(m.criar).not.toHaveBeenCalled();
    expect(feitas.some((op) => op.acao !== "select")).toBe(false);
  });

  it("ficha de empresa nunca vira autônomo", async () => {
    m.fichas.mockResolvedValue({ falhou: false, ids: ["existente"] });
    const { client } = bancoDaDecisao({ fichaPj: true });
    const feita = await decidirPedidoDoAutonomo(client, { acao: "aprovar", autorNome: null, autorUserId: "u", pedidoId: "p1" });
    expect(feita).toMatchObject({ ok: false, status: 409 });
    expect(m.criar).not.toHaveBeenCalled();
  });

  it("pedido substituído por um reenvio mais novo não se decide", async () => {
    const { client } = bancoDaDecisao({ outroMaisRecente: true });
    const feita = await decidirPedidoDoAutonomo(client, { acao: "aprovar", autorNome: null, autorUserId: "u", pedidoId: "p1" });
    expect(feita).toMatchObject({ ok: false, status: 409 });
  });

  for (const acao of ["correcao", "indeferir"] as const) {
    it(`${acao.toUpperCase()} não encosta em ficha: só a trilha, e o aviso vai ao celular digitado`, async () => {
      const { client, feitas } = bancoDaDecisao();
      const feita = await decidirPedidoDoAutonomo(client, {
        acao,
        autorNome: null,
        autorUserId: "u-1",
        motivos: ["Comprovante vencido"],
        pedidoId: "p1",
      });
      expect(feita).toMatchObject({ estado: acao === "correcao" ? "correcao" : "indeferido", ok: true });
      expect(m.criar).not.toHaveBeenCalled();
      expect(feitas.filter((op) => op.acao !== "select").map((op) => op.tabela)).toEqual(["apolo_audit_events"]);
      const evento = feitas.find((op) => op.acao === "insert");
      expect(evento?.valores).toMatchObject({ entity_id: null, metadata: { pedidoId: "p1" } });
      expect(m.evolution).toHaveBeenCalledWith(
        expect.objectContaining({ telefone: "5531999990000", text: expect.stringContaining("Comprovante vencido") }),
      );
      if (acao === "correcao") {
        expect(m.evolution.mock.calls[0]![0].text).toContain("https://c2x.app.br/publico/autonomo");
      }
    });
  }
});
