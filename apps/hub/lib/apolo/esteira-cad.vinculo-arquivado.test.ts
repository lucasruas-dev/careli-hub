import { describe, expect, it } from "vitest";

import { cadComVinculoArquivado, lerVinculosDeEmpreendimento } from "./esteira-cad";

// A TRAVA DO VÍNCULO ARQUIVADO, com o critério de TEMPO (revisão de 24/09/2026, terceira rodada).
//
// O caso que a trava existe para pegar é o do JONATAS: CAD no Veredas do Ouro (19) criada em 21/09, e o
// vínculo do 19 ARQUIVADO em 24/09 (a troca feita pela metade). O caso que ela passou a pegar sem
// querer: depois de um Mover do 35 para o 19 (o Mover arquiva o vínculo do 35), uma CAD NOVA no 35
// pelo portal ou pelo wizard, que não criam vínculo de empreendimento para prospect, nascia barrada no
// crédito, e o Mover não resolvia (o 19 já tem CAD). A régua: só conta o arquivamento feito DEPOIS que
// a CAD existia. Datas medidas em produção em 24/09/2026 (a CAD e o vínculo do Jonatas).

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>, falhas: Record<string, Linha> = {}) {
  const pedidos: string[] = [];
  const client = {
    from(tabela: string) {
      const q = { de: 0, filtros: [] as Array<[string, unknown]>, limite: Infinity };
      const executar = () => {
        pedidos.push(tabela);
        const falha = falhas[tabela];
        if (falha) return { data: null, error: falha };
        const linhas = (tabelas[tabela] ?? []).filter((linha) =>
          q.filtros.every(([coluna, valor]) => String(linha[coluna] ?? "") === String(valor)),
        );
        return { data: linhas.slice(q.de, q.de + q.limite).map((l) => ({ ...l })), error: null };
      };
      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        eq: (coluna: string, valor: unknown) => {
          q.filtros.push([coluna, valor]);
          return cadeia;
        },
        limit: (n: number) => {
          q.limite = n;
          return cadeia;
        },
        maybeSingle: () => {
          const r = executar();
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
        },
        order: () => cadeia,
        range: (de: number, ate: number) => {
          q.de = de;
          q.limite = ate - de + 1;
          return cadeia;
        },
        select: () => cadeia,
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve(executar()).then(ok, erro),
      });
      return cadeia;
    },
  };
  return { client: client as unknown as Parameters<typeof cadComVinculoArquivado>[0], pedidos };
}

const ENTIDADE = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";

const HERCULES: Linha[] = [
  { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", pai_id: "h-vlo" },
  { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", pai_id: "h-vlo" },
  { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", pai_id: "h-vlo" },
  { c2x_enterprise_id: "19", codigo: "VDO", id: "h-vdo", nome: "Veredas do Ouro", pai_id: null },
].map((l) => ({ ...l, workspace_id: "careli" }));

/** Medido em 24/09/2026: a CAD do Jonatas nasceu em 21/09 18:14:52 (chegou_em e created_at). */
const CAD_DO_JONATAS = "2026-09-21T18:14:52.208+00:00";
/** Medido em 24/09/2026: o vínculo do 19 foi arquivado em 24/09 15:50:13 (metadata e updated_at). */
const ARQUIVADO_DO_JONATAS = "2026-09-24T15:50:13.602Z";

const cad = (enterpriseId: string, chegouEm: null | string, createdAt: null | string): Linha => ({
  chegou_em: chegouEm,
  created_at: createdAt,
  entity_id: ENTIDADE,
  enterprise_id: enterpriseId,
});

const ativo = (enterpriseId: string): Linha => ({
  entity_id: ENTIDADE,
  id: `v-${enterpriseId}`,
  metadata: { enterpriseId },
  relationship_type: "empreendimento",
  status: "verified",
  updated_at: "2026-09-01T00:00:00.000Z",
});

const arquivado = (
  enterpriseId: string,
  datas: { arquivadoEm?: unknown; updatedAt?: unknown },
): Linha => ({
  entity_id: ENTIDADE,
  id: `v-${enterpriseId}-arquivado`,
  metadata: {
    enterpriseId,
    ...(datas.arquivadoEm === undefined ? {} : { arquivadoEm: datas.arquivadoEm }),
  },
  relationship_type: "empreendimento",
  status: "archived",
  updated_at: datas.updatedAt ?? null,
});

const perguntar = (tabelas: { esteira: Linha[]; vinculos: Linha[] }, enterpriseIdDaCad: string) => {
  const banco = bancoFalso({
    apolo_esteira: tabelas.esteira,
    apolo_relationships: tabelas.vinculos,
    hercules_empreendimentos: HERCULES,
  });
  return { banco, resposta: cadComVinculoArquivado(banco.client, ENTIDADE, enterpriseIdDaCad) };
};

describe("cadComVinculoArquivado: só conta o arquivamento feito DEPOIS que a CAD existia", () => {
  it("o caso do Jonatas (CAD de 21/09, vínculo do 19 arquivado em 24/09): TRAVA", async () => {
    const { resposta } = perguntar(
      {
        esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
        vinculos: [
          arquivado("19", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: ARQUIVADO_DO_JONATAS }),
          ativo("35"),
        ],
      },
      "19",
    );
    expect(await resposta).toBe(true);
  });

  it("CAD NOVA no 35 depois de um Mover do 35 para o 19 (vínculo do 35 arquivado ANTES): NÃO trava", async () => {
    // Sem o critério de tempo, esta CAD nascia barrada no crédito sem saída: o portal e o wizard não
    // criam vínculo de empreendimento para prospect, e o Mover 35 -> 19 responde 409 (o 19 já tem CAD).
    const { resposta } = perguntar(
      {
        esteira: [
          cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS),
          cad("35", "2026-09-25T10:00:00.000Z", "2026-09-25T10:00:00.000Z"),
        ],
        vinculos: [
          arquivado("35", { arquivadoEm: "2026-09-24T16:00:00.000Z", updatedAt: "2026-09-24T16:00:00.000Z" }),
          ativo("19"),
        ],
      },
      "35",
    );
    expect(await resposta).toBe(false);
  });

  it("a CAD do Jonatas REENVIADA pelo portal depois do arquivamento (upsert com chegou_em novo): continua travando", async () => {
    // O upsert do CAD público e do wizard grava `chegou_em = agora` na MESMA linha; `created_at` só
    // nasce no INSERT. Vale a data mais antiga das duas, senão reenviar abriria a trava.
    const { resposta } = perguntar(
      {
        esteira: [cad("19", "2026-09-26T09:00:00.000Z", CAD_DO_JONATAS)],
        vinculos: [
          arquivado("19", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: ARQUIVADO_DO_JONATAS }),
          ativo("35"),
        ],
      },
      "19",
    );
    expect(await resposta).toBe(true);
  });

  it("arquivado no MESMO instante em que a CAD nasceu: trava (o limite é inclusivo)", async () => {
    const instante = "2026-09-24T15:50:13.602Z";
    const { resposta } = perguntar(
      {
        esteira: [cad("19", instante, instante)],
        vinculos: [arquivado("19", { arquivadoEm: instante, updatedAt: instante }), ativo("35")],
      },
      "19",
    );
    expect(await resposta).toBe(true);
  });

  describe("de onde vem a data do arquivamento", () => {
    it("metadata.arquivadoEm vence o updated_at (outra escrita pode mexer no updated_at depois)", async () => {
      // Arquivado ANTES da CAD pelo metadata, mas com updated_at mexido DEPOIS: não trava.
      const { resposta } = perguntar(
        {
          esteira: [cad("35", "2026-09-25T10:00:00.000Z", "2026-09-25T10:00:00.000Z")],
          vinculos: [
            arquivado("35", { arquivadoEm: "2026-09-24T16:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" }),
          ],
        },
        "35",
      );
      expect(await resposta).toBe(false);
    });

    it("sem metadata.arquivadoEm, vale o updated_at: depois da CAD trava, antes não", async () => {
      const depois = perguntar(
        {
          esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
          vinculos: [arquivado("19", { updatedAt: ARQUIVADO_DO_JONATAS }), ativo("35")],
        },
        "19",
      );
      expect(await depois.resposta).toBe(true);

      const antes = perguntar(
        {
          esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
          vinculos: [arquivado("19", { updatedAt: "2026-09-20T00:00:00.000Z" }), ativo("35")],
        },
        "19",
      );
      expect(await antes.resposta).toBe(false);
    });

    it("metadata.arquivadoEm ilegível cai no updated_at", async () => {
      const { resposta } = perguntar(
        {
          esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
          vinculos: [arquivado("19", { arquivadoEm: "ontem", updatedAt: ARQUIVADO_DO_JONATAS }), ativo("35")],
        },
        "19",
      );
      expect(await resposta).toBe(true);
    });

    it("vínculo arquivado SEM nenhuma data legível: não trava (travar sem prova de tempo é o beco sem saída)", async () => {
      // Não acontece com linha real: `updated_at` é NOT NULL (0026_apolo_core) e é lido junto. O
      // Jonatas tem as duas datas, então esta ausência não o reabre (o primeiro teste deste bloco).
      const { resposta } = perguntar(
        {
          esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
          vinculos: [arquivado("19", { arquivadoEm: null, updatedAt: null }), ativo("35")],
        },
        "19",
      );
      expect(await resposta).toBe(false);
    });
  });

  it("CAD que não é achada na esteira: trava, como antes (sem saber desde quando ela existe, não há prova)", async () => {
    const { resposta } = perguntar(
      {
        esteira: [],
        vinculos: [arquivado("19", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: ARQUIVADO_DO_JONATAS }), ativo("35")],
      },
      "19",
    );
    expect(await resposta).toBe(true);
  });

  it("sem vínculo arquivado (quase todas): não trava e nem lê o cadastro nem a esteira", async () => {
    const { banco, resposta } = perguntar(
      { esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)], vinculos: [ativo("19")] },
      "19",
    );
    expect(await resposta).toBe(false);
    expect(banco.pedidos).toEqual(["apolo_relationships"]);
  });

  it("vínculo arquivado de OUTRO produto não conta, e nem a data da CAD é lida", async () => {
    const { banco, resposta } = perguntar(
      {
        esteira: [cad("19", CAD_DO_JONATAS, CAD_DO_JONATAS)],
        vinculos: [arquivado("35", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: ARQUIVADO_DO_JONATAS })],
      },
      "19",
    );
    expect(await resposta).toBe(false);
    expect(banco.pedidos).not.toContain("apolo_esteira");
  });

  it("a leitura da data da CAD que falha LANÇA (quem chama responde 503, nunca 'pode seguir')", async () => {
    const banco = bancoFalso(
      {
        apolo_relationships: [
          arquivado("19", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: ARQUIVADO_DO_JONATAS }),
          ativo("35"),
        ],
        hercules_empreendimentos: HERCULES,
      },
      { apolo_esteira: { message: "timeout" } },
    );
    await expect(cadComVinculoArquivado(banco.client, ENTIDADE, "19")).rejects.toThrow();
  });
});

describe("lerVinculosDeEmpreendimento: a data do arquivamento", () => {
  it("só o arquivado tem data; o metadata vence o updated_at; sem data legível é null", async () => {
    const banco = bancoFalso({
      apolo_relationships: [
        ativo("35"),
        arquivado("19", { arquivadoEm: ARQUIVADO_DO_JONATAS, updatedAt: "2026-09-30T00:00:00.000Z" }),
        { ...arquivado("20", { updatedAt: "2026-09-22T00:00:00.000Z" }), id: "v-20" },
        { ...arquivado("38", { arquivadoEm: 42, updatedAt: "nunca" }), id: "v-38" },
      ],
    });
    const vinculos = await lerVinculosDeEmpreendimento(banco.client, ENTIDADE);
    const por = (id: string) => vinculos.find((v) => v.id === id)?.arquivadoEm;
    expect(por("v-35")).toBeNull();
    expect(por("v-19-arquivado")).toBe(ARQUIVADO_DO_JONATAS);
    expect(por("v-20")).toBe("2026-09-22T00:00:00.000Z");
    expect(por("v-38")).toBeNull();
  });
});
