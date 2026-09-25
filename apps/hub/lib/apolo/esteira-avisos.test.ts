import { describe, expect, it, vi } from "vitest";

import { ETAPAS_ESTEIRA } from "./esteira";
import { etapaTemAviso } from "./esteira-avisos";

// ⚠️ PRAZO FOLGADO SÓ POR CAUSA DA SUÍTE CHEIA (16/09/2026). Sozinho este arquivo roda em menos de
// 2 s; com os 389 arquivos em paralelo no pre-push, o último teste (que só reusa o módulo já
// carregado) estourou os 5 s padrão e barrou um deploy. Não é lentidão da regra: é fila de CPU.
vi.setConfig({ testTimeout: 30_000 });

// Os avisos saem pelo gateway do Relacionamento. Aqui ele é falso: o que se mede é QUEM seria
// avisado e QUANTAS vezes, não o que a Evolution faz com o payload.
const enviados: { telefone: string; text: string }[] = [];
const anexos: { fileName: string; telefone: string }[] = [];

vi.mock("@/lib/iris/evolution-api", () => ({
  sendEvolutionDirectMedia: vi.fn(async (p: { fileName: string; telefone: string }) => {
    anexos.push({ fileName: p.fileName, telefone: p.telefone });
    return { ok: true, providerMessageId: "m2" };
  }),
  sendEvolutionDirectText: vi.fn(async (p: { telefone: string; text: string }) => {
    enviados.push(p);
    return { ok: true, providerMessageId: "m1" };
  }),
}));

// O coordenador sem cadastro no Panteon vem do C2X, PELO ID (Lucas, 24/09/2026). Aqui o legado é um
// fixo por id, para o teste falar de destinatários e não de integração. A busca por SIGLA devolve
// VAZIO de propósito: é o que o C2X respondeu com a sigla velha do 43 (RDV) depois do renome, e o
// aviso não pode depender dela.
vi.mock("@/lib/apolo/empreendimentos", () => ({
  loadApoloEnterpriseCadastro: vi.fn(async () => ({ cadastros: [], ok: true })),
  loadApoloEnterpriseCadastroPorId: vi.fn(async (ids: string[]) => ({
    cadastros: ids
      .filter((id) => id === "39" || id === "43")
      .map((id) => ({
        enterpriseId: id,
        players: [
          {
            entityId: "coord-c2x",
            name: "Coordenador Teste",
            phone: "31988887777",
            relation: "coordenador_vendas",
          },
        ],
      })),
    ok: true,
  })),
}));

import { loadApoloEnterpriseCadastro, loadApoloEnterpriseCadastroPorId } from "./empreendimentos";

const gravados: Record<string, unknown>[] = [];

type LinhaCad = {
  corretor: null | string;
  corretor_entity_id: null | string;
  empreendimento: null | string;
  enterprise_id: null | string;
  imobiliaria: null | string;
  imobiliaria_entity_id: null | string;
  motivo: null | string;
};

// Client de mentira: responde as tabelas que `avisarEtapa` toca, inclusive as da busca do
// coordenador (settings, a entidade do coordenador e o telefone dela).
function clienteFake(opts: {
  cad?: Partial<LinhaCad>;
  /** Entidades além do cliente, lidas por `.in("id", ...)` (o coordenador do Panteon). */
  entidades?: Array<{ display_name: string; id: string }>;
  /** O que `apolo_enterprise_settings` guarda. Padrão: a sigla, sem coordenador cadastrado. */
  settings?: Array<Record<string, unknown>>;
  telefonePorEntidade?: Record<string, string>;
}) {
  const cad: LinhaCad = {
    corretor: "Igor Fernando",
    corretor_entity_id: "corretor-1",
    empreendimento: "Vale do Ouro",
    enterprise_id: "39",
    imobiliaria: "Imobiliária Teste",
    imobiliaria_entity_id: "imob-1",
    motivo: "Documento ilegível; falta o verso da identidade",
    ...opts.cad,
  };
  const telefones = opts.telefonePorEntidade ?? { "corretor-1": "31997250000", "imob-1": "31996660000" };
  const settings = opts.settings ?? [{ code: "VOC", coordenador_entity_id: null, enterprise_id: "39" }];

  const encadeavel = (linhas: unknown[] | ((ids: string[]) => unknown[])) => {
    const ids: string[] = [];
    const dados = () => (typeof linhas === "function" ? linhas(ids) : linhas);
    const self: Record<string, unknown> = {};
    for (const metodo of ["eq", "order"]) {
      self[metodo] = (_coluna: string, valor: unknown) => {
        if (metodo === "eq" && typeof valor === "string") ids.push(valor);
        return self;
      };
    }
    self.in = (_coluna: string, valores: unknown) => {
      if (Array.isArray(valores)) ids.push(...valores.map(String));
      return self;
    };
    self.limit = () => Promise.resolve({ data: dados() });
    self.maybeSingle = () => Promise.resolve({ data: dados()[0] ?? null });
    self.then = (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: dados(), error: null });
    return self;
  };

  return {
    from(tabela: string) {
      if (tabela === "apolo_esteira") return { select: () => encadeavel([cad]) };
      if (tabela === "apolo_entities") {
        return {
          select: (colunas: string) =>
            // A leitura do cliente (`maybeSingle`) pede display_name/legal_name; a do coordenador
            // pede o `id` junto, por `.in`.
            colunas.includes("metadata")
              ? encadeavel((ids) => (opts.entidades ?? []).filter((e) => ids.includes(e.id)))
              : encadeavel([{ display_name: "JOAO BATISTA FRAGA", legal_name: null }]),
        };
      }
      if (tabela === "apolo_enterprise_settings") return { select: () => encadeavel(settings) };
      if (tabela === "apolo_contacts") {
        return {
          select: () =>
            encadeavel((ids) =>
              ids
                .filter((id) => telefones[id])
                .map((id) => ({ contact_type: "whatsapp", entity_id: id, is_primary: true, value: telefones[id] })),
            ),
        };
      }
      if (tabela === "apolo_disparos") {
        return {
          insert: (linha: Record<string, unknown>) => {
            gravados.push(linha);
            return Promise.resolve({ error: null });
          },
        };
      }
      return { select: () => encadeavel([]) };
    },
  };
}

function limpar() {
  enviados.length = 0;
  anexos.length = 0;
  gravados.length = 0;
}

describe("cobertura das etapas", () => {
  it("TODA etapa da esteira tem aviso — é a resposta a 'revisa se todas as etapas têm disparo'", () => {
    const semAviso = ETAPAS_ESTEIRA.filter((e) => !etapaTemAviso(e));
    expect(semAviso).toEqual([]);
  });
});

describe("quem é avisado", () => {
  it("avisa o corretor vinculado e o coordenador, e registra os dois", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(clienteFake({}) as never, {
      enterpriseId: "39",
      entityId: "cliente-1",
      etapa: "correcao",
      etapaAnterior: "validacao",
    });

    expect(r?.corretor.ok).toBe(true);
    expect(r?.corretor.papel).toBe("corretor");
    expect(r?.coordenador.ok).toBe(true);
    expect(enviados).toHaveLength(2);
    // DDI acrescentado: sem ele a Evolution entrega para o número errado em silêncio.
    expect(enviados[0]!.telefone).toBe("5531997250000");
    // O motivo é o conteúdo da mensagem do corretor, não um detalhe.
    expect(enviados[0]!.text).toContain("Documento ilegível");
    expect(gravados).toHaveLength(2);
    expect(gravados[0]!.origem).toBe("relacionamento:whatsapp:automatico");
    expect(gravados[0]!.status).toBe("enviado");
  });

  it("SEM corretor vinculado cai na imobiliária, em vez de não avisar ninguém", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(
      clienteFake({ cad: { corretor_entity_id: null } }) as never,
      { enterpriseId: "39", entityId: "cliente-1", etapa: "correcao", etapaAnterior: "validacao" },
    );

    expect(r?.corretor.ok).toBe(true);
    expect(r?.corretor.papel).toBe("imobiliaria");
    expect(enviados[0]!.telefone).toBe("5531996660000");
  });

  it("sem corretor E sem imobiliária, registra FALHA (não some em silêncio)", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(
      clienteFake({ cad: { corretor_entity_id: null, imobiliaria_entity_id: null } }) as never,
      { enterpriseId: "39", entityId: "cliente-1", etapa: "correcao", etapaAnterior: "validacao" },
    );

    expect(r?.corretor.ok).toBe(false);
    // O que mata a investigação é o "pulado" silencioso: 718 CADs sem corretor nunca apareceram
    // como problema em lugar nenhum. Falha registrada é falha que a tela mostra.
    const falha = gravados.find((g) => String(g.tipo).includes("corretor") || String(g.tipo).includes("imobiliaria"));
    expect(falha?.status).toBe("falhou");
    expect(String(falha?.erro)).toContain("sem corretor vinculado");
  });
});

describe("⚠️ o coordenador da CAD é achado pelo id (Lucas, 24/09/2026)", () => {
  it("renome de sigla no C2X (RDV -> PDI) não quebra o aviso: a busca vai pelo id 43", async () => {
    limpar();
    vi.mocked(loadApoloEnterpriseCadastro).mockClear();
    vi.mocked(loadApoloEnterpriseCadastroPorId).mockClear();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(
      clienteFake({
        cad: { enterprise_id: "43" },
        // A sigla velha, como o Panteon guardava às 16:55 de 24/09.
        settings: [{ code: "RDV", coordenador_entity_id: null, enterprise_id: "43" }],
      }) as never,
      { enterpriseId: "43", entityId: "cliente-1", etapa: "correcao", etapaAnterior: "validacao" },
    );

    expect(r?.coordenador.ok).toBe(true);
    expect(enviados.map((e) => e.telefone)).toContain("5531988887777");
    expect(loadApoloEnterpriseCadastroPorId).toHaveBeenCalledWith(["43"]);
    // A sigla não é mais perguntada ao legado.
    expect(loadApoloEnterpriseCadastro).not.toHaveBeenCalled();
  });

  it("coordenador_entity_id do Panteon prevalece sobre o do C2X", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(
      clienteFake({
        entidades: [{ display_name: "LUNA NEGOCIOS IMOBILIARIOS", id: "luna" }],
        settings: [{ code: "VOC", coordenador_entity_id: "luna", enterprise_id: "39" }],
        telefonePorEntidade: { "corretor-1": "31997250000", luna: "31995968349" },
      }) as never,
      { enterpriseId: "39", entityId: "cliente-1", etapa: "correcao", etapaAnterior: "validacao" },
    );

    expect(r?.coordenador).toMatchObject({ destinatario: "LUNA NEGOCIOS IMOBILIARIOS", ok: true });
    expect(enviados.map((e) => e.telefone)).toContain("5531995968349");
    // O coordenador do C2X (31988887777) não recebe: o Panteon cadastrou outro.
    expect(enviados.map((e) => e.telefone)).not.toContain("5531988887777");
  });

  it("sem coordenador em lugar nenhum, a falha fica registrada com o motivo", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(
      clienteFake({
        cad: { enterprise_id: "9001" },
        settings: [{ code: "TST", coordenador_entity_id: null, enterprise_id: "9001" }],
      }) as never,
      { enterpriseId: "9001", entityId: "cliente-1", etapa: "correcao", etapaAnterior: "validacao" },
    );

    expect(r?.coordenador.ok).toBe(false);
    const falha = gravados.find((g) => g.tipo === "etapa_correcao_coordenador");
    expect(falha).toMatchObject({
      erro: "Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
      status: "falhou",
    });
  });
});

describe("repetição", () => {
  it("NÃO avisa quando a etapa foi regravada igual — upsert repetido não é novidade", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(clienteFake({}) as never, {
      enterpriseId: "39",
      entityId: "cliente-1",
      etapa: "revisao",
      etapaAnterior: "revisao",
    });

    expect(r).toBeNull();
    expect(enviados).toHaveLength(0);
    expect(gravados).toHaveLength(0);
  });

  it("etapa fora da lista de avisos não dispara nada", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    const r = await avisarEtapa(clienteFake({}) as never, {
      entityId: "cliente-1",
      etapa: "etapa-que-nao-existe",
    });

    expect(r).toBeNull();
    expect(enviados).toHaveLength(0);
  });
});

describe("privacidade da reprovação", () => {
  it("o corretor NÃO recebe o motivo financeiro; o coordenador recebe", async () => {
    limpar();
    const { avisarEtapa } = await import("./esteira-avisos");
    await avisarEtapa(
      clienteFake({ cad: { motivo: "Restrições de R$ 21.750,59 acima do limite de R$ 5.000,00" } }) as never,
      { enterpriseId: "39", entityId: "cliente-1", etapa: "revisao", etapaAnterior: "credito" },
    );

    const paraCorretor = enviados.find((e) => e.telefone === "5531997250000");
    const paraCoordenador = enviados.find((e) => e.telefone === "5531988887777");

    // Score, negativação e valor de dívida são dados do CLIENTE. O corretor é terceiro: ele
    // precisa saber que parou e com quem está a decisão, não o extrato de quem comprou.
    expect(paraCorretor?.text).not.toContain("21.750");
    expect(paraCorretor?.text).toContain("não passou na análise de crédito");
    // O coordenador decide, então o motivo entra. (Ele vai por anexo quando há PDF; sem PDF, texto.)
    expect(paraCoordenador?.text ?? anexos.length > 0).toBeTruthy();
  });
});
