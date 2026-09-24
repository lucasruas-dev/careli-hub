import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import { cardAndouDepoisDe, concluirAssinaturaDoCard, moverCardDaTemis } from "./estado-db";

// A OUTRA METADE DO COMPARAR-E-TROCAR.
//
// ⚠️ O QUE ESTA REGRA IMPEDE É UM ENVIO DESFAZER UMA DECISÃO HUMANA. O POST do envio leva de 40 a
// 90 segundos e a linha do envelope só nasce lá pelo meio: nessa janela não existe envelope nenhum
// para a volta conferir, o botão de devolver nasce habilitado depois de um F5, e o card ia para a
// Análise — até o envio terminar e empurrá-lo de volta para "assinatura", com o contrato VELHO na
// rua. O `.eq("estagio", …)` de `retorno-para-correcao.ts` protege o sentido card → Análise; esta
// protege o sentido oposto, que é o único que aquele não tem como ver.

describe("cardAndouDepoisDe", () => {
  it("sem carimbo: move, que é o comportamento de ontem", () => {
    // Os chamadores que não sabem quando começaram (a rota de gerar contrato) continuam movendo o
    // card como sempre moveram. A regra só entra quando alguém oferece a prova.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", null)).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", undefined)).toBe(false);
  });

  it("carimbo mais novo que `estagio_desde`: o card não andou, então move", () => {
    // O card está onde estava quando a operação começou: ninguém mexeu nele no meio do caminho.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", "2026-09-12T14:01:30.000Z")).toBe(false);
  });

  it("carimbo mais velho que `estagio_desde`: o card andou durante a operação, não move", () => {
    // O coordenador devolveu o card para a Análise com este envio no ar. Quem decidiu por último
    // decidiu com o quadro na frente.
    expect(cardAndouDepoisDe("2026-09-12T14:01:30+00:00", "2026-09-12T14:00:00.000Z")).toBe(true);
  });

  it("⚠️ compara como data, nunca como texto: o `+00:00` e o `Z` são o mesmo instante", () => {
    // Em ordem alfabética "+" vem antes de "Z", e o mesmo instante pareceria mais antigo ou mais
    // novo conforme quem escreveu a string — o PostgREST ou o nosso `toISOString()`.
    expect(cardAndouDepoisDe("2026-09-12T14:00:00+00:00", "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T11:00:00-03:00", "2026-09-12T14:00:00.000Z")).toBe(false);
  });

  it("dado ausente ou ilegível não segura o card: a regra só recusa com prova", () => {
    // Card parado é board desatualizado, que a leitura seguinte conserta; card empurrado
    // indevidamente é uma decisão humana desfeita em silêncio. Os dois preços não são iguais.
    expect(cardAndouDepoisDe(null, "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("ontem de manhã", "2026-09-12T14:00:00.000Z")).toBe(false);
    expect(cardAndouDepoisDe("2026-09-12T14:01:30+00:00", "quando o Lucas clicou")).toBe(false);
  });
});

// ── O CARD ANDA E A VENDA VAI JUNTO ─────────────────────────────────────────────
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules, pode
// corrigir isso, o contrato da vitoria tem que estar em assinatura"*. Medido em produção em
// 24/09/2026: os 5 envios de 23/09 (pela Nívea) moveram o card para "assinatura" e deixaram a venda
// em `contrato` (5 de 5), porque `moverCardDaTemis` movia SÓ o card.
//
// O banco é o de memória (`banco-em-memoria.para-teste.ts`), com a passagem de etapa e o reflexo DE
// VERDADE: o que se mede é o que chega às tabelas.

const bancosDoReflexo: Banco[] = [];
afterEach(() => {
  for (const b of bancosDoReflexo) expect(b.problemas).toEqual([]);
  bancosDoReflexo.length = 0;
  vi.restoreAllMocks();
});

function bancoDaVitoria(c: { card?: Linha; outros?: Linha[]; venda?: Linha } = {}): Banco {
  const b = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        data_assinatura: null,
        data_faturamento: null,
        etapa: "contrato",
        etapa_desde: "2026-09-20T12:00:00.000Z",
        id: "venda-vitoria",
        unidade_id: "uni-vitoria",
        workspace_id: "careli",
        ...c.venda,
      },
    ],
    hercules_unidades: [
      { codigo: "VOL0101", enterprise_id: "40", id: "uni-vitoria", situacao: "reservada", workspace_id: "careli" },
    ],
    temis_assinatura_eventos: [],
    temis_envelopes: [],
    temis_trabalho_etapas: [],
    temis_trabalhos: [
      {
        estagio: "contrato",
        estagio_desde: "2026-09-22T12:00:00.000Z",
        id: "card-vitoria",
        proposta_id: "venda-vitoria",
        tipo: "contrato",
        workspace_id: "careli",
        ...c.card,
      },
      ...(c.outros ?? []),
    ],
  });
  bancosDoReflexo.push(b);
  return b;
}

describe("o envio para assinatura leva a venda junto (DEFEITO 1)", () => {
  it("o caso da Vitória: card contrato > assinatura e venda contrato > assinatura, com autor e histórico", async () => {
    const b = bancoDaVitoria();

    const r = await moverCardDaTemis(
      b.cliente,
      "venda-vitoria",
      "assinatura",
      { id: "u-nivea", nome: "Nivea" },
      "2026-09-23T14:00:00.000Z",
    );

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("assinatura");
    const venda = b.linha("hercules_propostas", "venda-vitoria");
    expect(venda).toMatchObject({ etapa: "assinatura", etapa_por: "Nivea" });
    expect(venda?.etapa_desde).not.toBe("2026-09-20T12:00:00.000Z");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({
        autor_nome: "Nivea",
        de: "contrato",
        motivo: "Envio para assinatura na Têmis",
        para: "assinatura",
        proposta_id: "venda-vitoria",
      }),
    ]);
    // E a função passa a CONTAR o que fez: os cards movidos e o reflexo de cada um.
    expect(r.movidos.map((c) => c.id)).toEqual(["card-vitoria"]);
    expect(r.reflexos).toEqual([{ de: "contrato", feito: "andou", para: "assinatura" }]);
    // O cadastro da unidade não é tocado por movimento nenhum do card de contrato.
    expect(b.consultas.some((q) => q.tabela === "hercules_unidades" && q.operacao !== "select")).toBe(false);
  });

  it("Gerar contrato (análise > contrato): a venda já estava em contrato, nada se escreve nela", async () => {
    const b = bancoDaVitoria({ card: { estagio: "analise" } });
    const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "contrato", { id: "u-1", nome: "Nivea" });
    expect(r.reflexos).toEqual([{ feito: "ja_estava" }]);
    expect(b.consultas.some((q) => q.tabela === "hercules_propostas" && q.operacao === "update")).toBe(false);
  });

  it("card devolvido para a Análise DURANTE o envio (cardAndouDepoisDe): nem o card nem a venda andam", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = bancoDaVitoria({ card: { estagio: "analise", estagio_desde: "2026-09-23T14:00:30.000Z" } });

    const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "assinatura", { id: "u-1", nome: "Nivea" }, "2026-09-23T14:00:00.000Z");

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("analise");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("contrato");
    expect(r).toEqual({ movidos: [], reflexos: [] });
  });

  it("o card de cancelamento na mesma proposta não anda e não reflete", async () => {
    const b = bancoDaVitoria({
      outros: [
        {
          estagio: "analise",
          estagio_desde: "2026-09-22T12:00:00.000Z",
          id: "card-pedido",
          proposta_id: "venda-vitoria",
          tipo: "cancelamento",
          workspace_id: "careli",
        },
      ],
    });
    const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "assinatura", { id: "u-1", nome: "Nivea" });
    expect(b.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("analise");
    expect(r.movidos.map((c) => c.id)).toEqual(["card-vitoria"]);
    expect(r.reflexos).toHaveLength(1);
  });
});

// ── GERAR CONTRATO ATRASADO NÃO PUXA O CARD NEM A VENDA PARA TRÁS ──────────────
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU O DEFEITO ANTIGO QUE O REFLEXO PIOROU. `contrato-servico.ts` chama
// `moverCardDaTemis(sb, propostaId, "contrato", autor)` sem carimbo, e `cardsQueAceitam` só tirava
// `faturado` e `indeferido`: uma aba velha (ou uma chamada direta a /api/temis/contrato/gerar) com o
// card em "Em assinatura" ou no Pré-faturamento devolvia o card para Contrato. Com o reflexo, a venda
// ia junto de `assinatura` para `contrato` com o envelope vivo ou já assinado. O caminho de volta é
// um só, a volta para correção (retorno-para-correcao.ts), que mata o envelope antes.

describe("Gerar contrato com o card já adiante (aba velha)", () => {
  it.each(["assinatura", "prazo_legal"])(
    "card em %s: nem o card nem a venda andam para trás",
    async (estagio) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const b = bancoDaVitoria({ card: { estagio }, venda: { etapa: "assinatura" } });

      const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "contrato", { id: "u-1", nome: "Nivea" });

      expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe(estagio);
      expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("assinatura");
      expect(r).toEqual({ movidos: [], reflexos: [] });
      expect(b.consultas.some((q) => q.operacao === "update")).toBe(false);
      expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
      expect(b.linhas("temis_trabalho_etapas")).toEqual([]);
    },
  );

  it("o envio atrasado também não puxa o Pré-faturamento de volta para Em assinatura", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = bancoDaVitoria({ card: { estagio: "prazo_legal" }, venda: { etapa: "assinatura" } });
    const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "assinatura", { id: "u-1", nome: "Nivea" });
    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("prazo_legal");
    expect(r).toEqual({ movidos: [], reflexos: [] });
  });

  it("Gerar de novo com o card em Contrato continua permitido (o card não anda para trás)", async () => {
    const b = bancoDaVitoria({ card: { estagio: "contrato" } });
    const r = await moverCardDaTemis(b.cliente, "venda-vitoria", "contrato", { id: "u-1", nome: "Nivea" });
    expect(r.movidos.map((c) => c.id)).toEqual(["card-vitoria"]);
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("contrato");
  });
});

describe("o webhook de assinado", () => {
  it("card contrato vai para Pré-faturamento e a venda FICA em assinatura; o cadastro não é escrito", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });

    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria");

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("prazo_legal");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("assinatura");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
    expect(b.consultas.some((q) => q.tabela === "hercules_unidades")).toBe(false);
  });

  it("venda ainda em contrato (o reflexo do envio falhou): alcança assinatura, nunca faturado", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "contrato" } });

    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria");

    const venda = b.linha("hercules_propostas", "venda-vitoria");
    expect(venda).toMatchObject({ data_faturamento: null, etapa: "assinatura", etapa_por: null });
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({ autor_nome: null, de: "contrato", para: "assinatura" }),
    ]);
  });

  it("venda distratada com card pendurado em assinatura: o card anda, a venda não ressuscita", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "distrato" } });
    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("distrato");
  });
});
