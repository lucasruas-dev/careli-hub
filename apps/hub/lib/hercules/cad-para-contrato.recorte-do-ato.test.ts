import { beforeEach, describe, expect, it, vi } from "vitest";

// A BARRA DA CAD, AS TRÊS CORREÇÕES QUE A REVISÃO PEDIU: o recorte do TIPO do card, a frase que diz o
// que fazer NA PORTA CERTA, e o escopo de grupo que não depende do C2X estar no ar.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ 1. O RECORTE DO TIPO EXISTIA EM UMA DAS QUATRO PORTAS, E A DECISÃO ESTAVA ESCRITA COMO SE
// VALESSE EM TODAS. `marcarAtividade` tinha `depois.tipo === "contrato" && ...`
// (`lib/temis/trabalhos-db.ts:1050`), com a razão certa: *"sem ela, uma CAD em revisão travaria o
// cancelamento de uma venda"*. `prepararEnvio` e `gerarContratoDaProposta` penduravam a barra SÓ no
// `propostaId`. E o painel "Quem assina" é servido para QUATRO tipos de card
// (`modules/temis/blocks/trabalho/tela-de-trabalho.tsx:2203` com `EXIGE_ASSINATURA`,
// `lib/temis/trabalhos.ts:145`: contrato, cancelamento_correcao, cessao e distrato), chamando
// `/assinatura/enviar?proposta=` com o MESMO propostaId da venda, porque o card de saída nasce com
// `propostaId: args.venda.id` (`lib/temis/cancelar-contrato-servico.ts:685`). Resultado: o distrato, a
// cessão e o cancelamento por correção daquela venda recebiam a recusa da CAD — trava retroativa na
// SAÍDA, e com a frase mandando "pedir o credenciamento" sobre um documento que ENCERRA a venda.
//
// ⚠️ MEDIDO EM 26/09/2026 (`bxgukywoxgivlrhjkwjx`, só SELECT):
//   select t.tipo, t.estagio, t.unidade, t.enterprise_id, t.cliente_nome, p.origem, p.etapa
//     from temis_trabalhos t left join hercules_propostas p on p.id = t.proposta_id
//    where t.tipo in ('cancelamento','cancelamento_correcao','cessao','distrato')
//      and t.estagio not in ('faturado','indeferido');
//     → UMA linha: `distrato` em `analise`, "Quadra D · Lote 10", enterprise 38, CLEIBER JOSE
//       FERREIRA, proposta origem `c2x` em etapa `assinatura`.
//   select p.origem, p.etapa, count(distinct d.proposta_id) from hercules_documentos d
//     join hercules_propostas p on p.id = d.proposta_id
//    where d.tipo='contrato' and d.removido_em is null group by 1,2;
//     → panteon/assinatura 7 e panteon/contrato 6 (13 propostas, TODAS origem `panteon`).
// Ou seja: sem vítima hoje (o distrato vivo é barrado ANTES, por `contratoVigenteDaProposta`, que
// recusa com 409 "ainda não tem contrato gerado"), e com vítima no primeiro dia em que uma venda
// nativa com contrato gerado tiver a CAD fora de `credenciado` — e a esteira anda POR TELA.
//
// ⚠️ 2. A FRASE ERA ÚNICA E DAVA A INSTRUÇÃO ERRADA EM TRÊS DAS QUATRO PORTAS: terminava sempre com
// *"envie para contrato depois"*, que só serve à porta 1. Nas outras três a venda JÁ ESTÁ em
// `contrato`.
//
// ⚠️ 3. O ESCOPO DE GRUPO DEPENDIA DO C2X: `catalogoDeEmpreendimentos` NUNCA lança (devolve
// `cache?.valor ?? []`), e com o catálogo vazio a CAD que mora só no grupo era recusada por engano.
// Medido: 2 linhas de grupo em `apolo_esteira`, as duas `group:Lagoa Bonita` e as duas `credenciado`.

const estado = vi.hoisted(() => ({
  cadastro: [] as Array<Record<string, unknown>>,
  /** O catálogo que o C2X devolveria. Vazio = C2X fora do ar com cache frio. */
  catalogo: [] as Array<{ id: string; stageIds: string[] }>,
  esteira: [] as Array<Record<string, unknown>>,
  identificadores: [] as Array<{ entity_id: string; value_hash: string }>,
  propostas: [] as Array<Record<string, unknown>>,
  trabalhos: [] as Array<Record<string, unknown>>,
  unidades: [] as Array<Record<string, unknown>>,
  erroEm: null as null | string,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => estado.cadastro,
}));

// ⚠️ O `GRUPOS_DO_CATALOGO` DO MOCK É LITERAL DE PROPÓSITO: que a constante de verdade case com o
// `agrupar` do C2X é provado em `lib/apolo/catalogo-empreendimentos.grupos-sem-c2x.test.ts`. O que
// este arquivo prova é que a barra CAI NELE quando o catálogo volta vazio.
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => estado.catalogo,
  GRUPOS_DO_CATALOGO: [
    { id: "group:Lagoa Bonita", stageIds: ["33", "27", "32"] },
    { id: "group:Vale do Ouro", stageIds: ["37", "36", "41"] },
  ],
}));

import { hashIdentifier } from "@/lib/apolo/server";

import {
  oAtoEDaCompraEVenda,
  recusaDaCadDaProposta,
  recusaDaCadDoAtoDoContrato,
  recusaDaCadParaContrato,
} from "./cad-para-contrato";

/** Client falso encadeável que RESPEITA os filtros: é o escopo que decide esta barra. */
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
                    : tabela === "temis_trabalhos"
                      ? estado.trabalhos
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

/** A família do Vale do Ouro: a CAD mora no pai 35, a venda no filho 37. */
const FAMILIA_DO_VALE = [
  { c2xEnterpriseId: "35", id: "vlo", paiId: null },
  { c2xEnterpriseId: "36", id: "vol", paiId: "vlo" },
  { c2xEnterpriseId: "37", id: "voc", paiId: "vlo" },
  { c2xEnterpriseId: "41", id: "vor", paiId: "vlo" },
];

/** A família da Lagoa Bonita (PAN-124): pai 31 (LAB) e as três glebas 27, 32, 33. */
const FAMILIA_DA_LAGOA = [
  { c2xEnterpriseId: "31", id: "lab", paiId: null },
  { c2xEnterpriseId: "27", id: "lbr", paiId: "lab" },
  { c2xEnterpriseId: "32", id: "lbp", paiId: "lab" },
  { c2xEnterpriseId: "33", id: "lbf", paiId: "lab" },
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

function card(tipo: string, estagio: string) {
  return { estagio, proposta_id: "prop-1", tipo };
}

beforeEach(() => {
  estado.cadastro = FAMILIA_DO_VALE;
  estado.catalogo = [{ id: "group:Vale do Ouro", stageIds: ["35", "36", "37", "41"] }];
  estado.esteira = [];
  estado.identificadores = [{ entity_id: "ent-1", value_hash: hashIdentifier("cpf", CPF) }];
  estado.propostas = [
    { cliente_documento: CPF, id: "prop-1", unidade_id: "uni-1", workspace_id: "careli" },
  ];
  estado.trabalhos = [];
  estado.unidades = [{ enterprise_id: "37", id: "uni-1", workspace_id: "careli" }];
  estado.erroEm = null;
});

describe("o recorte do TIPO do card: a barra não tranca a SAÍDA da venda", () => {
  it("card vivo de contrato com a CAD em revisão É barrado", async () => {
    estado.esteira = comCad("revisao", "35");
    estado.trabalhos = [card("contrato", "contrato")];

    const recusa = await recusaDaCadDoAtoDoContrato(clienteFake(), "prop-1", "gerar_contrato");

    expect(recusa?.status).toBe(409);
    expect(recusa?.erro).toContain("em revisão pela coordenação");
  });

  // ⚠️ O CASO CARO É A CAD `indeferido`: é a situação que PRODUZ o distrato, e era a que trancava a
  // saída. O Lucas barrou a venda NASCER, não a venda ser DESFEITA.
  it.each(["cancelamento", "cancelamento_correcao", "cessao", "distrato"])(
    "card vivo de %s com a CAD INDEFERIDA não é barrado: o ato DESFAZ a venda",
    async (tipo) => {
      estado.esteira = comCad("indeferido", "35");
      estado.trabalhos = [card(tipo, "contrato")];

      expect(
        await recusaDaCadDoAtoDoContrato(clienteFake(), "prop-1", "mandar_para_assinatura"),
      ).toBe(null);
      expect(await oAtoEDaCompraEVenda(clienteFake(), "prop-1")).toBe(false);
    },
  );

  it("o card de contrato ENCERRADO não sustenta a barra: o vivo é o distrato", async () => {
    estado.esteira = comCad("correcao", "35");
    estado.trabalhos = [card("contrato", "faturado"), card("distrato", "analise")];

    expect(await recusaDaCadDoAtoDoContrato(clienteFake(), "prop-1", "mandar_para_assinatura")).toBe(
      null,
    );
  });

  // ⚠️ FAIL-CLOSED NA DÚVIDA: com um card de contrato VIVO ao lado do distrato, o envio pode ser o da
  // compra e venda, e é o ato caro que não pode passar por engano.
  it("contrato vivo AO LADO do distrato mantém a barra", async () => {
    estado.esteira = comCad("validacao", "35");
    estado.trabalhos = [card("contrato", "contrato"), card("distrato", "analise")];

    const recusa = await recusaDaCadDoAtoDoContrato(
      clienteFake(),
      "prop-1",
      "mandar_para_assinatura",
    );

    expect(recusa?.status).toBe(409);
  });

  // Quem chama sem card nenhum é o Gerar, que ainda VAI abrir o card da venda: deixar passar aí
  // abriria exatamente a porta caríssima.
  it("proposta SEM card nenhum mantém a barra", async () => {
    estado.esteira = comCad("validacao", "35");
    estado.trabalhos = [];

    expect(await oAtoEDaCompraEVenda(clienteFake(), "prop-1")).toBe(true);
    expect(
      (await recusaDaCadDoAtoDoContrato(clienteFake(), "prop-1", "gerar_contrato"))?.status,
    ).toBe(409);
  });

  it("a leitura dos cards que falha mantém a barra, nunca libera", async () => {
    estado.esteira = comCad("validacao", "35");
    estado.erroEm = "temis_trabalhos";

    expect(await oAtoEDaCompraEVenda(clienteFake(), "prop-1")).toBe(true);
  });

  it("com a CAD credenciada segue passando, seja qual for o card", async () => {
    estado.esteira = comCad("credenciado", "35");
    estado.trabalhos = [card("contrato", "contrato")];

    expect(await recusaDaCadDoAtoDoContrato(clienteFake(), "prop-1", "gerar_contrato")).toBe(null);
  });
});

describe("a última oração da frase diz o que fazer NA PORTA em que ela apareceu", () => {
  beforeEach(() => {
    estado.esteira = comCad("validacao", "35");
  });

  it.each([
    ["enviar_para_contrato", "envie para contrato depois"],
    ["gerar_contrato", "gere o contrato depois"],
    ["mandar_para_assinatura", "mande para assinatura depois"],
    ["marcar_atividade", "marque a atividade depois"],
  ] as const)("ato %s termina com %s", async (ato, oracao) => {
    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1", ato);

    expect(recusa?.erro).toContain(oracao);
    // O miolo continua um só nas quatro.
    expect(recusa?.erro).toContain("em validação de cadastro");
    expect(recusa?.erro).toContain("O contrato só sai depois que a CAD for aprovada");
  });

  // ⚠️ A PORTA 1 CONTINUA SENDO O PADRÃO: quem não diz o ato é `app/api/incorporador/venda/contrato`.
  it("sem ato declarado, a frase é a da porta 1", async () => {
    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1");

    expect(recusa?.erro).toContain("envie para contrato depois");
  });

  it("a recusa por titular sem documento também fala da porta certa", async () => {
    const recusa = await recusaDaCadParaContrato(
      clienteFake(),
      { documento: "", enterpriseId: "37" },
      "mandar_para_assinatura",
    );

    expect(recusa?.erro).toContain("antes de mandar para assinatura");
  });
});

describe("a CAD INDEFERIDA não convida a cobrar uma decisão que a coordenação já tomou", () => {
  it("não manda pedir o credenciamento, e apresenta as duas saídas", async () => {
    estado.esteira = comCad("indeferido", "35");

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1", "enviar_para_contrato");

    expect(recusa?.etapa).toBe("indeferido");
    expect(recusa?.erro).toContain("com o cadastro indeferido");
    // ⚠️ O QUE NÃO PODE FICAR: `indeferido` é decisão FINAL de reprovar o cliente
    // (`cliente-credenciado.ts:73`), e "peça o credenciamento à coordenação" manda insistir.
    expect(recusa?.erro).not.toContain("peça o credenciamento");
    expect(recusa?.erro).not.toContain("envie para contrato depois");
    expect(recusa?.erro).toMatch(/REPROVOU/);
    expect(recusa?.erro).toMatch(/cancelada/);
    expect(recusa?.erro).toMatch(/reabre/);
  });

  it("as outras etapas continuam mandando pedir o credenciamento", async () => {
    estado.esteira = comCad("correcao", "35");

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1");

    expect(recusa?.erro).toContain("peça o credenciamento");
  });
});

describe("o escopo de GRUPO não depende do C2X estar no ar", () => {
  beforeEach(() => {
    estado.cadastro = FAMILIA_DA_LAGOA;
    estado.unidades = [{ enterprise_id: "33", id: "uni-1", workspace_id: "careli" }];
  });

  // ⚠️ O DEFEITO MEDIDO: com o catálogo vazio, `escopoDeQuemVende` sobrava só com a família (31, 27,
  // 32, 33) e o id `group:Lagoa Bonita` desaparecia do escopo — 1 credenciado recusado por engano a
  // cada instabilidade do legado.
  it("com o catálogo VAZIO, a CAD gravada no grupo continua valendo", async () => {
    estado.catalogo = [];
    estado.esteira = comCad("credenciado", "group:Lagoa Bonita");

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-1")).toBe(null);
  });

  it("com o catálogo cheio, nada muda", async () => {
    estado.catalogo = [{ id: "group:Lagoa Bonita", stageIds: ["27", "32", "33"] }];
    estado.esteira = comCad("credenciado", "group:Lagoa Bonita");

    expect(await recusaDaCadDaProposta(clienteFake(), "prop-1")).toBe(null);
  });

  // O critério de `comIdsDoGrupo` continua: o grupo só entra quando a família cobre TODAS as divisões.
  it("família que não cobre o grupo inteiro não ganha o id de grupo", async () => {
    estado.catalogo = [];
    estado.cadastro = [{ c2xEnterpriseId: "33", id: "lbf", paiId: null }];
    estado.esteira = comCad("credenciado", "group:Lagoa Bonita");

    const recusa = await recusaDaCadDaProposta(clienteFake(), "prop-1");

    expect(recusa?.status).toBe(409);
  });
});
