import { describe, expect, it, vi } from "vitest";

import { ETAPAS_ESTEIRA } from "./esteira";
import { etapaTemAviso } from "./esteira-avisos";

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

// O coordenador mora no C2X. Aqui devolvemos um fixo para o teste falar de destinatários, não de
// integração com o legado.
vi.mock("@/lib/apolo/empreendimentos", () => ({
  loadApoloEnterpriseCadastro: vi.fn(async () => ({
    cadastros: [
      {
        code: "VOC",
        players: [{ name: "Coordenador Teste", phone: "31988887777", relation: "coordenador_vendas" }],
      },
    ],
    ok: true,
  })),
}));

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

// Client de mentira: responde as quatro tabelas que `avisarEtapa` toca.
function clienteFake(opts: {
  cad?: Partial<LinhaCad>;
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

  const encadeavel = (linhas: unknown[]) => {
    const self: Record<string, unknown> = {};
    for (const metodo of ["eq", "in", "order", "limit"]) {
      self[metodo] = () => self;
    }
    self.limit = () => Promise.resolve({ data: linhas });
    self.maybeSingle = () => Promise.resolve({ data: linhas[0] ?? null });
    self.then = (r: (v: { data: unknown[] }) => unknown) => r({ data: linhas });
    return self;
  };

  return {
    from(tabela: string) {
      if (tabela === "apolo_esteira") return { select: () => encadeavel([cad]) };
      if (tabela === "apolo_entities") {
        return { select: () => encadeavel([{ display_name: "JOAO BATISTA FRAGA", legal_name: null }]) };
      }
      if (tabela === "apolo_enterprise_settings") return { select: () => encadeavel([{ code: "VOC" }]) };
      if (tabela === "apolo_contacts") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              in: () => ({
                order: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: telefones[id] ? [{ value: telefones[id] }] : [],
                      }),
                  }),
                }),
              }),
            }),
          }),
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
