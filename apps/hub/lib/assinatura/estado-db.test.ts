import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import payloadReal from "./__fixtures__/clicksign-sign-com-bounce.json";
import { lerEventoDoWebhook } from "./clicksign/webhook";
import {
  aplicarEventoDaClicksign,
  cardAndouDepoisDe,
  concluirAssinaturaDoCard,
  moverCardDaTemis,
  registrarEventoDeAssinatura,
  ultimaAssinaturaDoComprador,
} from "./estado-db";
import { type ItemDoQuadro, lerQuadro } from "./registro-db";

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
        // ⚠️ NATIVA: desde a F2 só a venda nativa tem card e data movidos pelo envelope.
        origem: "panteon",
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

/** O contrato da Vitória fechado pela Clicksign, com a data da compradora no quadro (F2). */
const ENVELOPE_QUE_FECHOU = {
  fechadoEm: "2026-09-26T12:00:00.000-03:00",
  finalidade: "contrato" as const,
  provedor: "clicksign" as const,
  signatarios: [
    { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k-comprador", email: "", nome: "Vitória", ordem: 1, papel: "comprador" },
  ],
};

describe("o webhook de assinado", () => {
  it("card contrato vai para Pré-faturamento e a venda FICA em assinatura; o cadastro não é escrito", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });

    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", ENVELOPE_QUE_FECHOU);

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("prazo_legal");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("assinatura");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
    expect(b.consultas.some((q) => q.tabela === "hercules_unidades")).toBe(false);
  });

  it("venda ainda em contrato (o reflexo do envio falhou): alcança assinatura, nunca faturado", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "contrato" } });

    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", ENVELOPE_QUE_FECHOU);

    const venda = b.linha("hercules_propostas", "venda-vitoria");
    expect(venda).toMatchObject({ data_faturamento: null, etapa: "assinatura", etapa_por: null });
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({ autor_nome: null, de: "contrato", para: "assinatura" }),
    ]);
  });

  it("venda distratada com card pendurado em assinatura: o card anda, a venda não ressuscita", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "distrato" } });
    await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", ENVELOPE_QUE_FECHOU);
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("distrato");
  });
});

// ── O WEBHOOK PELA FUNÇÃO DA 0195 (F1 da fonte única, 28/09/2026) ─────────────────
//
// ⚠️ O QUE ERA: o webhook fazia `update` direto do estado (13 `signature_started` gravaram
// "aguardando" DEPOIS de um `sign`, em 5 documentos), só olhava o evento que disparou (o `sign` que
// vinha no histórico de um `add_signer` se perdia), aceitava o metadata para pintar o envelope mais
// recente da proposta com marcas de outro documento, e o prazo de 7 dias procurava a data do
// comprador por um `envelope_id` nulo em 226 de 226 eventos.
//
// ⚠️ A FUNÇÃO AQUI É UM RECORTE, NÃO A REGRA. O dublê abaixo faz só o que estes testes precisam
// enxergar do lado de fora (a chave casa a marca, o estado anda para a frente, o documento é
// conferido, o quadro mesclado volta). A regra inteira mora no SQL da 0195, e quem a prova é o
// ensaio `0195_o_contrato_mora_no_panteon.ensaio.sql`.

const ORDEM_DO_ESTADO: Record<string, number> = { aguardando: 2, desconhecido: 1, parcial: 3, rascunho: 0 };

function comAFuncaoDa0195(b: Banco): Array<Record<string, unknown>> {
  const chamadas: Array<Record<string, unknown>> = [];
  const rpc = async (_nome: string, args: Record<string, unknown>) => {
    chamadas.push(args);
    const linha = b.linha("temis_envelopes", String(args.p_envelope));
    if (!linha) return { data: [], error: null };
    const antes = String(linha.estado);
    const doc = typeof args.p_documento === "string" ? args.p_documento : null;
    if (doc && linha.provedor_documento_id && linha.provedor_documento_id !== doc) {
      return {
        data: [{ estado_antes: antes, estado_depois: antes, mudou_estado: false, recusa: "documento_diferente" }],
        error: null,
      };
    }
    if (doc) linha.provedor_documento_id = doc;

    const quadro = ((linha.signatarios ?? []) as Array<Record<string, unknown>>).map((item) => ({ ...item }));
    for (const marca of (args.p_marcas ?? []) as Array<Record<string, string>>) {
      const pelaChave = quadro.find((i) => marca.chave && i.chave === marca.chave);
      const doEmail = quadro.filter((i) => String(i.email).toLowerCase() === marca.email);
      const alvo = pelaChave ?? (doEmail.length === 1 ? doEmail[0] : undefined);
      if (alvo && marca.assinado_em && !alvo.assinado_em) alvo.assinado_em = marca.assinado_em;
    }
    const assinaram = quadro.filter((i) => i.assinado_em).length;

    let depois = antes;
    const terminal = !(antes in ORDEM_DO_ESTADO);
    const proposto = typeof args.p_estado === "string" ? args.p_estado : null;
    if (
      !terminal &&
      proposto &&
      proposto !== "desconhecido" &&
      (ORDEM_DO_ESTADO[proposto] ?? 4) > (ORDEM_DO_ESTADO[antes] ?? 4)
    ) {
      depois = proposto;
    }
    if (!terminal && assinaram > 0 && (ORDEM_DO_ESTADO[depois] ?? 4) < 3) depois = "parcial";
    let fechado = (linha.fechado_em as null | string) ?? null;
    if (depois === "assinado" && !fechado) {
      const datas = quadro.map((i) => String(i.assinado_em ?? "")).sort();
      fechado =
        (args.p_fechado_em as null | string) ??
        (assinaram === quadro.length ? (datas[datas.length - 1] ?? null) : null);
    }
    Object.assign(linha, { estado: depois, fechado_em: fechado, signatarios: quadro });
    return {
      data: [
        {
          assinaram,
          estado_antes: antes,
          estado_depois: depois,
          fechado,
          mudou_estado: antes !== depois,
          quadro,
          recusa: null,
          total: quadro.length,
        },
      ],
      error: null,
    };
  };
  (b.cliente as unknown as { rpc: typeof rpc }).rpc = rpc;
  return chamadas;
}

/** O payload de um documento da Clicksign, no formato v1 do payload real. */
function payloadDoDocumento(c: {
  doc?: string;
  evento: string;
  eventos: Array<{ chave: string; email: string; nome: string; quando: string }>;
  metadata?: Record<string, string>;
  signatarios?: Array<{ chave: string; email: string }>;
  status?: string;
}): Record<string, unknown> {
  return {
    document: {
      events: c.eventos.map((e) => ({
        data: { signer: { documentation: "123.456.789-01", email: e.email, key: e.chave, name: e.nome } },
        name: "sign",
        occurred_at: e.quando,
      })),
      key: c.doc ?? "doc-1",
      metadata: c.metadata ?? {},
      signers: (c.signatarios ?? []).map((s) => ({ email: s.email, key: s.chave })),
      status: c.status ?? "running",
    },
    event: { data: {}, name: c.evento, occurred_at: "2026-09-26T15:00:00.000-03:00" },
  };
}

function envelopeDaVitoria(patch: Linha = {}): Linha {
  return {
    envelope_id: "env-vitoria",
    estado: "aguardando",
    // ⚠️ 0195: só o envelope de CONTRATO move o card de contrato e a venda (F2).
    finalidade: "contrato",
    id: "reg-vitoria",
    proposta_id: "venda-vitoria",
    provedor: "clicksign",
    provedor_documento_id: "doc-1",
    signatarios: [
      { chave: "k-comprador", email: "compradora@x.com", nome: "Vitória", ordem: 1, papel: "comprador" },
      { chave: "k-vendedora", email: "vendedora@x.com", nome: "Vendedora", ordem: 2, papel: "vendedora" },
      { chave: "k-testemunha", email: "testemunha@x.com", nome: "Testemunha", ordem: 3, papel: "testemunha" },
    ],
    workspace_id: "careli",
    ...patch,
  };
}

describe("o webhook aplica pela função da 0195", () => {
  it("add_signer com um sign no histórico chama a função COM a marca de quem assinou", async () => {
    const b = bancoDaVitoria();
    b.semear("temis_envelopes", envelopeDaVitoria());
    const chamadas = comAFuncaoDa0195(b);

    const payload = payloadDoDocumento({
      evento: "add_signer",
      eventos: [{ chave: "k-comprador", email: "Compradora@X.com", nome: "Vitória", quando: "2026-09-26T13:00:00Z" }],
    });
    const r = await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      p_documento: "doc-1",
      p_envelope: "reg-vitoria",
      p_estado: null,
      p_marcas: [{ assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k-comprador", email: "compradora@x.com" }],
    });
    // O estado anda PELA MARCA (parcial derivado), não pelo nome do evento.
    expect(r).toMatchObject({ aplicado: true, envelopeIdDoRegistro: "env-vitoria", estado: "parcial" });
  });

  it("⚠️ pelo metadata só adota linha SEM documento; linha com outro documento fica intacta", async () => {
    const b = bancoDaVitoria();
    b.semear("temis_envelopes", envelopeDaVitoria({ provedor_documento_id: "doc-velho" }));
    const chamadas = comAFuncaoDa0195(b);

    const payload = payloadDoDocumento({
      doc: "doc-novo",
      evento: "sign",
      eventos: [{ chave: "k-comprador", email: "compradora@x.com", nome: "Vitória", quando: "2026-09-26T13:00:00Z" }],
      metadata: { proposta_id: "venda-vitoria" },
    });
    const evento = { ...lerEventoDoWebhook(JSON.stringify(payload)), envelopeId: null };
    const r = await aplicarEventoDaClicksign(b.cliente, evento, payload);

    expect(chamadas).toEqual([]);
    expect(r.aplicado).toBe(false);
    expect(b.linha("temis_envelopes", "reg-vitoria")?.estado).toBe("aguardando");
  });

  it("pelo metadata, a linha sem documento é achada e adota o documento do evento", async () => {
    const b = bancoDaVitoria();
    b.semear("temis_envelopes", envelopeDaVitoria({ envelope_id: null, provedor_documento_id: null }));
    const chamadas = comAFuncaoDa0195(b);

    const payload = payloadDoDocumento({
      doc: "doc-novo",
      evento: "signature_started",
      eventos: [],
      metadata: { proposta_id: "venda-vitoria" },
    });
    await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ p_documento: "doc-novo", p_envelope: "reg-vitoria" });
    expect(b.linha("temis_envelopes", "reg-vitoria")?.provedor_documento_id).toBe("doc-novo");
  });

  it("sem a 0195 no banco, o evento não aplica nada (e não lança)", async () => {
    const b = bancoDaVitoria();
    b.semear("temis_envelopes", envelopeDaVitoria());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (b.cliente as unknown as { rpc: unknown }).rpc = async () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });

    const payload = payloadDoDocumento({ evento: "signature_started", eventos: [] });
    const r = await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(r.aplicado).toBe(false);
    expect(b.consultas.some((q) => q.tabela === "temis_envelopes" && q.operacao === "update")).toBe(false);
  });

  it("ponta a ponta: o fechamento com o sign do comprador no histórico chega em arrependimento_inicio com a data DELE", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial" }));
    comAFuncaoDa0195(b);

    // A compradora assinou às 10h; a vendedora às 11h; a TESTEMUNHA por último, às 12h (Brasília).
    const payload = payloadDoDocumento({
      evento: "sign",
      eventos: [
        { chave: "k-testemunha", email: "testemunha@x.com", nome: "Testemunha", quando: "2026-09-26T15:00:00Z" },
        { chave: "k-vendedora", email: "vendedora@x.com", nome: "Vendedora", quando: "2026-09-26T14:00:00Z" },
        { chave: "k-comprador", email: "compradora@x.com", nome: "Vitória", quando: "2026-09-26T13:00:00Z" },
      ],
      signatarios: [
        { chave: "k-comprador", email: "compradora@x.com" },
        { chave: "k-vendedora", email: "vendedora@x.com" },
        { chave: "k-testemunha", email: "testemunha@x.com" },
      ],
      status: "closed",
    });
    const r = await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(r).toMatchObject({ aplicado: true, estado: "assinado" });
    const card = b.linha("temis_trabalhos", "card-vitoria");
    expect(card?.estagio).toBe("prazo_legal");
    // ⚠️ A DATA DA COMPRADORA (vinda do QUADRO que a função devolveu), e não a da testemunha, nem
    // o fechamento, nem "agora".
    expect(card?.arrependimento_inicio).toBe("2026-09-26T10:00:00.000-03:00");
    expect(b.linha("temis_envelopes", "reg-vitoria")?.fechado_em).toBe("2026-09-26T12:00:00.000-03:00");
  });

  // ⚠️ O QUADRO GRAVADO ANTES DA 0195 NÃO TEM `chave` (revisão da F1, medido em 28/09/2026: 4 dos 7
  // contratos em `parcial` sem nenhum item com chave). A função casa as marcas deles pelo e-mail
  // único; a leitura do quadro devolvido descartava o item sem chave, o quadro chegava VAZIO e o
  // prazo começava no fechamento. Era o bug 8.3 vivo em todo contrato já enviado.
  it("ponta a ponta com o quadro ANTIGO, sem chave: o prazo ainda começa na assinatura do comprador", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    const semChave = (envelopeDaVitoria().signatarios as Array<Record<string, unknown>>).map(
      ({ chave: _chave, ...resto }) => resto,
    );
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial", signatarios: semChave }));
    comAFuncaoDa0195(b);

    const payload = payloadDoDocumento({
      evento: "sign",
      eventos: [
        { chave: "k-testemunha", email: "testemunha@x.com", nome: "Testemunha", quando: "2026-09-26T15:00:00Z" },
        { chave: "k-vendedora", email: "vendedora@x.com", nome: "Vendedora", quando: "2026-09-26T14:00:00Z" },
        { chave: "k-comprador", email: "compradora@x.com", nome: "Vitória", quando: "2026-09-26T13:00:00Z" },
      ],
      signatarios: [
        { chave: "k-comprador", email: "compradora@x.com" },
        { chave: "k-vendedora", email: "vendedora@x.com" },
        { chave: "k-testemunha", email: "testemunha@x.com" },
      ],
      status: "closed",
    });
    const r = await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(r).toMatchObject({ aplicado: true, estado: "assinado" });
    const card = b.linha("temis_trabalhos", "card-vitoria");
    expect(card?.estagio).toBe("prazo_legal");
    // A compradora (10h), e não o fechamento (12h, a testemunha).
    expect(card?.arrependimento_inicio).toBe("2026-09-26T10:00:00.000-03:00");
  });

  it("o reenvio do mesmo webhook de fechamento não move o card de novo (só a borda move)", async () => {
    const b = bancoDaVitoria({ card: { estagio: "prazo_legal" }, venda: { etapa: "assinatura" } });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "assinado", fechado_em: "2026-09-26T12:00:00.000-03:00" }));
    comAFuncaoDa0195(b);

    const payload = payloadDoDocumento({ evento: "auto_close", eventos: [], status: "closed" });
    await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(b.consultas.some((q) => q.tabela === "temis_trabalhos" && q.operacao === "update")).toBe(false);
  });
});

describe("ultimaAssinaturaDoComprador (bug 8.3)", () => {
  it("ignora coordenadora, testemunha e vendedora; fica com o último comprador ou cônjuge", () => {
    const quadro: ItemDoQuadro[] = [
      { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "a", email: "", nome: "", ordem: 1, papel: "comprador" },
      { assinado_em: "2026-09-26T10:30:00.000-03:00", chave: "b", email: "", nome: "", ordem: 1, papel: "conjuge" },
      { assinado_em: "2026-09-26T11:00:00.000-03:00", chave: "c", email: "", nome: "", ordem: 2, papel: "coordenadora" },
      { assinado_em: "2026-09-26T12:00:00.000-03:00", chave: "d", email: "", nome: "", ordem: 3, papel: "testemunha" },
      { assinado_em: "2026-09-26T13:00:00.000-03:00", chave: "e", email: "", nome: "", ordem: 4, papel: "vendedora" },
    ];
    expect(ultimaAssinaturaDoComprador(quadro)).toBe("2026-09-26T10:30:00.000-03:00");
  });

  it("comprador sem marca: nulo (quem chama cai no fechamento)", () => {
    expect(ultimaAssinaturaDoComprador([{ chave: "a", email: "", nome: "", ordem: 1, papel: "comprador" }])).toBeNull();
  });
});

describe("lerQuadro (revisão da F1)", () => {
  it("item sem chave entra na leitura, com a chave provisória da posição", () => {
    expect(
      lerQuadro([
        { assinado_em: "2026-09-26T10:00:00.000-03:00", email: "a@x.com", nome: "A", ordem: 1, papel: "comprador" },
        { chave: "k-2", email: "b@x.com", nome: "B", ordem: 2, papel: "vendedora" },
        "torto",
      ]),
    ).toEqual([
      { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "tmp:1", email: "a@x.com", nome: "A", ordem: 1, papel: "comprador" },
      { chave: "k-2", email: "b@x.com", nome: "B", ordem: 2, papel: "vendedora" },
    ]);
  });
});

describe("registrarEventoDeAssinatura (bugs 8.2 e 8.8)", () => {
  it("grava o envelope_id da NOSSA linha e o payload REDUZIDO", async () => {
    const b = bancoDaVitoria();
    const evento = lerEventoDoWebhook(JSON.stringify(payloadReal));

    await registrarEventoDeAssinatura(b.cliente, {
      aplicado: true,
      assinaturaCabecalho: "content-hmac",
      assinaturaConferida: true,
      envelopeIdDoRegistro: "env-da-linha",
      evento,
      headers: {},
      payload: payloadReal,
    });

    const [gravado] = b.linhas("temis_assinatura_eventos");
    expect(gravado?.envelope_id).toBe("env-da-linha");
    const texto = JSON.stringify(gravado?.payload);
    for (const proibida of ["documentation", "birthday", "latitude", "longitude", "address"]) {
      expect(texto).not.toContain(`"${proibida}"`);
    }
    // O que a casa lê continua lá.
    expect(texto).toContain("mariana.bandeira@exemplo.test");
  });

  it("o NÃO conferido grava só o esqueleto", async () => {
    const b = bancoDaVitoria();
    const evento = lerEventoDoWebhook(JSON.stringify(payloadReal));

    await registrarEventoDeAssinatura(b.cliente, {
      aplicado: false,
      assinaturaCabecalho: null,
      assinaturaConferida: false,
      evento,
      headers: {},
      payload: payloadReal,
      tamanho: 10_716,
    });

    const [gravado] = b.linhas("temis_assinatura_eventos");
    expect(gravado?.payload).toEqual({
      __esqueleto: true,
      chaves: ["event", "document"],
      evento: "sign",
      tamanho: 10_716,
    });
  });
});

// ── F2 DA FONTE ÚNICA: O WEBHOOK PELA PORTA ÚNICA, E A CONCLUSÃO COM COMPARAR-E-TROCAR ──────────
//
// ⚠️ O webhook passou a levar o contrato por `aplicarEnvelopeNaVenda` (as guardas da venda nativa,
// viva e sem pedido de cancelamento, e só com data real) e a conclusão passou a escolher o card pela
// FINALIDADE do envelope, com `.eq("estagio", "assinatura")` no update.

/** O fechamento da Vitória pela Clicksign: todos assinaram, a compradora primeiro. */
function payloadDoFechamento(): Record<string, unknown> {
  return payloadDoDocumento({
    evento: "sign",
    eventos: [
      { chave: "k-testemunha", email: "testemunha@x.com", nome: "Testemunha", quando: "2026-09-26T15:00:00Z" },
      { chave: "k-vendedora", email: "vendedora@x.com", nome: "Vendedora", quando: "2026-09-26T14:00:00Z" },
      { chave: "k-comprador", email: "compradora@x.com", nome: "Vitória", quando: "2026-09-26T13:00:00Z" },
    ],
    signatarios: [
      { chave: "k-comprador", email: "compradora@x.com" },
      { chave: "k-vendedora", email: "vendedora@x.com" },
      { chave: "k-testemunha", email: "testemunha@x.com" },
    ],
    status: "closed",
  });
}

describe("o webhook na porta única (F2)", () => {
  it("⚠️ o contrato fecha: card no Pré-faturamento e data_assinatura gravada na venda nativa (dia em Brasília)", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial" }));
    comAFuncaoDa0195(b);

    const payload = payloadDoFechamento();
    await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("prazo_legal");
    // A data do mesmo instante do prazo: a compradora, 10h de 26/09 em Brasília.
    expect(b.linha("hercules_propostas", "venda-vitoria")?.data_assinatura).toBe("2026-09-26");
  });

  it("⚠️ venda com pedido de cancelamento aberto: o envelope fecha, mas nem card nem data andam", async () => {
    const b = bancoDaVitoria({
      card: { estagio: "assinatura" },
      venda: { cancelamento_pedido_em: "2026-09-25T12:00:00.000Z", etapa: "assinatura" },
    });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial" }));
    comAFuncaoDa0195(b);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const payload = payloadDoFechamento();
    const r = await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(r).toMatchObject({ aplicado: true, estado: "assinado" });
    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.data_assinatura).toBeNull();
    // ⚠️ O contrato assinado parado não some calado: vai ao log com os ids e ao motivo que a rota loga.
    expect(r.motivo).toContain("venda venda-vitoria: card nada");
    const linhas = aviso.mock.calls.map((c) => String(c[0]));
    expect(linhas.some((l) => l.includes("venda-vitoria") && l.includes("pedido de cancelamento aberto"))).toBe(true);
    expect(linhas.join("\n")).not.toMatch(/@/);
  });

  it("envelope de CESSÃO assinado conclui o card de cessão, e o de contrato fica onde está", async () => {
    const b = bancoDaVitoria({
      card: { estagio: "assinatura" },
      outros: [
        { estagio: "assinatura", estagio_desde: "2026-09-22T12:00:00.000Z", id: "card-cessao", proposta_id: "venda-vitoria", tipo: "cessao", workspace_id: "careli" },
      ],
      venda: { etapa: "assinatura" },
    });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial", finalidade: "cessao", trabalho_id: "card-cessao" }));
    comAFuncaoDa0195(b);

    const payload = payloadDoFechamento();
    await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(b.linha("temis_trabalhos", "card-cessao")?.estagio).toBe("faturado");
    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("assinatura");
    // A cessão não grava data de assinatura na venda.
    expect(b.linha("hercules_propostas", "venda-vitoria")?.data_assinatura).toBeNull();
  });

  it("envelope sem finalidade assinado: nenhum card é concluído (não se sabe o que foi assinado)", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.semear("temis_envelopes", envelopeDaVitoria({ estado: "parcial", finalidade: null }));
    comAFuncaoDa0195(b);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const payload = payloadDoFechamento();
    await aplicarEventoDaClicksign(b.cliente, lerEventoDoWebhook(JSON.stringify(payload)), payload);

    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("assinatura");
  });
});

describe("concluirAssinaturaDoCard (F2)", () => {
  it("⚠️ comparar-e-trocar: o card que saiu de Em assinatura entre a leitura e o update não é concluído", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.depois(
      (q) => q.tabela === "temis_trabalhos" && q.operacao === "select",
      (banco) => {
        const card = banco.linha("temis_trabalhos", "card-vitoria");
        if (card) card.estagio = "analise";
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const r = await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", ENVELOPE_QUE_FECHOU);

    expect(r).toBe("nada");
    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("analise");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([]);
  });

  it("⚠️ sem data real (nem do comprador, nem do provedor) o card NÃO anda: nada de 'agora'", async () => {
    const b = bancoDaVitoria({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const r = await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", {
      ...ENVELOPE_QUE_FECHOU,
      fechadoEm: null,
      signatarios: [{ chave: "k", email: "", nome: "Vitória", ordem: 1, papel: "comprador" }],
    });

    expect(r).toBe("sem_data_real");
    expect(b.linha("temis_trabalhos", "card-vitoria")?.estagio).toBe("assinatura");
  });

  it("card já no Pré-faturamento: já estava, sem escrever", async () => {
    const b = bancoDaVitoria({ card: { estagio: "prazo_legal" }, venda: { etapa: "assinatura" } });
    const r = await concluirAssinaturaDoCard(b.cliente, "venda-vitoria", ENVELOPE_QUE_FECHOU);
    expect(r).toBe("ja_estava");
    expect(b.consultas.some((q) => q.tabela === "temis_trabalhos" && q.operacao === "update")).toBe(false);
  });
});
