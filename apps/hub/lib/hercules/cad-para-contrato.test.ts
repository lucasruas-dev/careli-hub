import { beforeEach, describe, expect, it, vi } from "vitest";

// A BARRA DO CONTRATO — a CAD do titular tem que estar APROVADA.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ A TRAVA NÃO SUMIU, ELA SE DESLOCOU. No mesmo dia, minutos antes: *"pode deixar os coordenadores
// emitirem proposta sem a cad esta credenciada. ela pode estar em validacao ou em qualquer outro
// estagio"*. A proposta nasce com a CAD em andamento; o contrato só sai com ela aprovada. Este
// arquivo prova que a barra lê `credenciado` (a verdade sobre a CAD) e NÃO `podeGerarProposta` (a
// porta afrouxada) — se ela lesse o segundo, nasceria aberta exatamente para quem existe para deter.
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026), e é por isso que o escopo
// sai da UNIDADE e é EXPANDIDO:
//   select p.etapa, count(*), count(*) filter (where p.empreendimento_id is null),
//          count(*) filter (where p.unidade_id is null), count(*) filter (where u.enterprise_id is null)
//     from hercules_propostas p left join hercules_unidades u on u.id = p.unidade_id
//    where p.workspace_id='careli' and p.aberta
//      and p.etapa in ('proposta','contrato','assinatura','faturado') group by 1;
//     → 33 propostas vivas SEM `empreendimento_id`, e ZERO sem unidade e ZERO sem `enterprise_id`.
//   Dos 13 cards de contrato vivos da Têmis, só 4 casam pelo `enterprise_id` EXATO: comparar id com
//   id barraria 9 clientes CREDENCIADOS, porque a CAD mora no PAI (35) e a venda no FILHO (36/37/41).

const estado = vi.hoisted(() => ({
  cadastro: [] as Array<Record<string, unknown>>,
  cadastroFalha: false,
  esteira: [] as Array<Record<string, unknown>>,
  identificadores: [] as Array<{ entity_id: string; value_hash: string }>,
  propostas: [] as Array<Record<string, unknown>>,
  unidades: [] as Array<Record<string, unknown>>,
  erroEm: null as null | string,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => {
    if (estado.cadastroFalha) throw new Error("PostgREST caiu");
    return estado.cadastro;
  },
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { id: "group:Vale do Ouro", stageIds: ["35", "36", "37", "41"] },
  ],
}));

import { hashIdentifier } from "@/lib/apolo/server";

import { recusaDaCadDaProposta, recusaDaCadParaContrato } from "./cad-para-contrato";

/**
 * Client falso no mesmo espírito do de `cliente-credenciado.test.ts`: encadeável, "thenable", e TODO
 * filtro é respeitado de verdade. Um fixture que ignorasse os filtros passaria com a função quebrada
 * — o escopo do empreendimento é exatamente o que decide esta barra.
 */
function clienteFake() {
  return {
    from(tabela: string) {
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];

      const combina = (linha: Record<string, unknown>) =>
        filtros.every((f) => f.coluna in linha && f.valores.includes(linha[f.coluna]));

      const responder = (unico: boolean) => {
        if (estado.erroEm === tabela) return { data: null, error: { message: "timeout" } };
        const fonte =
          tabela === "apolo_entities"
            ? []
            : tabela === "apolo_entity_identifiers"
              ? estado.identificadores
              : tabela === "apolo_esteira"
                ? estado.esteira
                : tabela === "hercules_propostas"
                  ? estado.propostas
                  : tabela === "hercules_unidades"
                    ? estado.unidades
                    : [];
        const achadas = (fonte as Array<Record<string, unknown>>).filter(combina);
        return { data: unico ? (achadas[0] ?? null) : achadas, error: null };
      };

      const cadeia: Record<string, unknown> = {
        eq(coluna: string, valor: unknown) {
          filtros.push({ coluna, valores: [valor] });
          return cadeia;
        },
        in(coluna: string, valores: unknown[]) {
          filtros.push({ coluna, valores });
          return cadeia;
        },
        maybeSingle: () => Promise.resolve(responder(true)),
        select: () => cadeia,
        then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve(responder(false)).then(ok, falha),
      };
      return cadeia;
    },
  } as unknown as Parameters<typeof recusaDaCadParaContrato>[0];
}

const CPF = "52998224725";

/** A família do Vale do Ouro, como está no cadastro: a CAD mora no pai 35, a venda no filho 37. */
const FAMILIA_DO_VALE = [
  { c2xEnterpriseId: "35", id: "vlo", paiId: null },
  { c2xEnterpriseId: "36", id: "vol", paiId: "vlo" },
  { c2xEnterpriseId: "37", id: "voc", paiId: "vlo" },
  { c2xEnterpriseId: "41", id: "vor", paiId: "vlo" },
];

function comCad(etapa: string, enterpriseId: string) {
  return [
    {
      atualizado_em: "2026-09-26T12:00:00.000Z",
      chegou_em: null,
      created_at: "2026-09-01T12:00:00.000Z",
      enterprise_id: enterpriseId,
      entity_id: "ent-1",
      etapa,
    },
  ];
}

beforeEach(() => {
  estado.cadastro = FAMILIA_DO_VALE;
  estado.cadastroFalha = false;
  estado.esteira = [];
  estado.identificadores = [{ entity_id: "ent-1", value_hash: hashIdentifier("cpf", CPF) }];
  estado.propostas = [];
  estado.unidades = [];
  estado.erroEm = null;
});

describe("a barra do contrato exige a CAD APROVADA", () => {
  it("deixa passar a CAD credenciada", async () => {
    estado.esteira = comCad("credenciado", "37");

    expect(await recusaDaCadParaContrato(clienteFake(), { documento: CPF, enterpriseId: "37" })).toBe(
      null,
    );
  });

  // ⚠️ O CORAÇÃO DESTE ARQUIVO. `validacao` é a etapa que o Lucas liberou para a PROPOSTA no mesmo
  // dia (`podeGerarProposta` = true no modo do coordenador). Se a barra lesse aquele campo, este
  // teste passaria com a barra aberta.
  it("barra a CAD em validação, e diz a etapa real e o que fazer", async () => {
    estado.esteira = comCad("validacao", "37");

    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: CPF,
      enterpriseId: "37",
    });

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe("validacao");
    expect(recusa?.erro).toContain("em validação de cadastro");
    expect(recusa?.erro).toContain("Credenciado");
    // Nunca só "não permitido": tem que dizer o que fazer.
    expect(recusa?.erro).toMatch(/coordenação/i);
  });

  it.each(["revisao", "credito", "correcao", "prevenda", "indeferido"])(
    "barra a CAD em %s",
    async (etapa) => {
      estado.esteira = comCad(etapa, "37");

      const recusa = await recusaDaCadParaContrato(clienteFake(), {
        documento: CPF,
        enterpriseId: "37",
      });

      expect(recusa?.status).toBe(409);
      expect(recusa?.etapa).toBe(etapa);
    },
  );

  it("barra quem não tem CAD nenhuma neste empreendimento", async () => {
    estado.esteira = [];

    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: CPF,
      enterpriseId: "37",
    });

    expect(recusa?.status).toBe(409);
    expect(recusa?.etapa).toBe(null);
    expect(recusa?.erro).toContain("não tem CAD neste empreendimento");
  });

  // ⚠️ A ARMADILHA MEDIDA: 9 dos 13 cards vivos têm a CAD no PAI. Sem a expansão de família esta
  // barra recusaria cliente credenciado na cara de quem emite, que é pior que não ter barra.
  it("aceita a CAD credenciada no PAI quando a venda está no FILHO", async () => {
    estado.esteira = comCad("credenciado", "35");

    expect(await recusaDaCadParaContrato(clienteFake(), { documento: CPF, enterpriseId: "37" })).toBe(
      null,
    );
  });

  it("aceita a CAD credenciada no GRUPO do catálogo", async () => {
    estado.esteira = comCad("credenciado", "group:Vale do Ouro");

    expect(await recusaDaCadParaContrato(clienteFake(), { documento: CPF, enterpriseId: "37" })).toBe(
      null,
    );
  });

  it("não deixa a CAD nova de um irmão apagar a credenciada do pai", async () => {
    estado.esteira = [
      ...comCad("credenciado", "35"),
      {
        atualizado_em: "2026-09-26T23:00:00.000Z",
        chegou_em: null,
        created_at: "2026-09-26T23:00:00.000Z",
        enterprise_id: "37",
        entity_id: "ent-2",
        etapa: "validacao",
      },
    ];
    estado.identificadores = [
      { entity_id: "ent-1", value_hash: hashIdentifier("cpf", CPF) },
      { entity_id: "ent-2", value_hash: hashIdentifier("cpf", CPF) },
    ];

    expect(await recusaDaCadParaContrato(clienteFake(), { documento: CPF, enterpriseId: "37" })).toBe(
      null,
    );
  });
});

describe("fail-closed: erro de leitura é 503, nunca liberação e nunca acusação ao cliente", () => {
  it("a esteira que não responde vira 503", async () => {
    estado.erroEm = "apolo_esteira";

    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: CPF,
      enterpriseId: "37",
    });

    expect(recusa?.status).toBe(503);
    // A frase não pode dizer que a CAD está errada: nós é que não conseguimos perguntar.
    expect(recusa?.erro).not.toMatch(/não está aprovada|não credenciad/i);
  });

  it("o cadastro que não carrega vira 503, e NÃO um escopo menor", async () => {
    estado.cadastroFalha = true;
    estado.esteira = comCad("credenciado", "35");

    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: CPF,
      enterpriseId: "37",
    });

    expect(recusa?.status).toBe(503);
  });

  it("unidade sem empreendimento vira 503, e não recusa", async () => {
    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: CPF,
      enterpriseId: null,
    });

    expect(recusa?.status).toBe(503);
  });

  it("proposta sem documento do titular é 409 com o que consertar", async () => {
    const recusa = await recusaDaCadParaContrato(clienteFake(), {
      documento: "",
      enterpriseId: "37",
    });

    expect(recusa?.status).toBe(409);
    expect(recusa?.erro).toMatch(/CPF ou o CNPJ do titular/i);
  });
});

describe("a barra a partir da proposta lê o escopo da UNIDADE", () => {
  beforeEach(() => {
    estado.propostas = [
      { cliente_documento: CPF, id: "prop-1", unidade_id: "uni-1", workspace_id: "careli" },
    ];
    estado.unidades = [{ enterprise_id: "37", id: "uni-1", workspace_id: "careli" }];
  });

  it("passa com a CAD credenciada no pai da unidade", async () => {
    estado.esteira = comCad("credenciado", "35");

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-1")).toBe(null);
  });

  it("barra a CAD em revisão", async () => {
    estado.esteira = comCad("revisao", "35");

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1");

    expect(recusa?.status).toBe(409);
    expect(recusa?.erro).toContain("em revisão pela coordenação");
  });

  // ⚠️ MEDIDO: 33 propostas vivas não têm `empreendimento_id`, e 100% delas têm unidade com
  // `enterprise_id`. Pendurar a barra na coluna da proposta viraria 503 para essas 33.
  it("resolve a proposta SEM empreendimento_id pela unidade", async () => {
    estado.propostas = [
      {
        cliente_documento: CPF,
        empreendimento_id: null,
        id: "prop-1",
        unidade_id: "uni-1",
        workspace_id: "careli",
      },
    ];
    estado.esteira = comCad("credenciado", "35");

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-1")).toBe(null);
  });

  it("card sem proposta vinculada não é barrado: não há titular para conferir", async () => {
    expect(await recusaDaCadDaProposta(clienteFake(), null)).toBe(null);
  });

  // Elo quebrado é defeito nosso, e a disciplina é a de `recusaPorVendaDesfeita`: deixa passar e
  // grita no log, em vez de congelar um card sem ter medido nada.
  it("proposta que não existe no banco não é barrada", async () => {
    estado.propostas = [];

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-fantasma")).toBe(null);
  });

  it("a leitura da proposta que falha vira 503", async () => {
    estado.erroEm = "hercules_propostas";

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1");

    expect(recusa?.status).toBe(503);
  });
});
