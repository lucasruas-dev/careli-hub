import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha, ORIGENS_DA_0153 } from "@/lib/hercules/banco-em-memoria.para-teste";

import { MOVER_VENDAS, reconciliarVendasAssinadas } from "./envelope-na-venda";

// A RECONCILIAÇÃO (F2 da fonte única, plano, seção 7, Integridade I5).
//
// ⚠️ O CASO: a função da 0195 gravou "assinado" e o `after()` do webhook morreu antes de mover o card
// e gravar a data (ou o orçamento do cron cortou entre a RPC e o efeito). A borda não volta: o
// próximo evento encontra "assinado" e `mudouEstado` é falso. Sem a varredura, card e data ficariam
// para trás para sempre.

const bancos: Banco[] = [];
afterEach(() => {
  for (const b of bancos) expect(b.problemas).toEqual([]);
  bancos.length = 0;
  vi.restoreAllMocks();
});

function banco(c: { card?: Linha; envelope?: Linha; venda?: Linha } = {}): Banco {
  const b = criarBanco(
    {
      hercules_proposta_etapas: [],
      hercules_propostas: [
        {
          cancelada_em: null,
          cancelamento_pedido_em: null,
          data_assinatura: null,
          etapa: "assinatura",
          id: "venda-1",
          origem: "panteon",
          workspace_id: "careli",
          ...c.venda,
        },
      ],
      temis_envelopes: [
        {
          criado_em: "2026-09-20T12:00:00.000Z",
          enviado_em: "2026-09-20T12:01:00.000Z",
          envelope_id: "env-1",
          estado: "assinado",
          falha: null,
          fechado_em: "2026-09-26T15:00:00.000-03:00",
          finalidade: "contrato",
          id: "reg-1",
          origem: "panteon",
          proposta_id: "venda-1",
          provedor: "clicksign",
          signatarios: [
            { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k1", email: "c@x.com", nome: "C", ordem: 1, papel: "comprador" },
            { assinado_em: "2026-09-26T15:00:00.000-03:00", chave: "k2", email: "v@x.com", nome: "V", ordem: 2, papel: "vendedora" },
          ],
          trabalho_id: "card-1",
          workspace_id: "careli",
          ...c.envelope,
        },
      ],
      temis_trabalho_etapas: [],
      temis_trabalhos: [
        {
          estagio: "assinatura",
          estagio_desde: "2026-09-21T12:00:00.000Z",
          id: "card-1",
          proposta_id: "venda-1",
          tipo: "contrato",
          workspace_id: "careli",
          ...c.card,
        },
      ],
    },
    { origensDaPassagem: [...ORIGENS_DA_0153, "conclusao", "espelho_d4sign"] },
  );
  bancos.push(b);
  return b;
}

// A rodada de verdade grava; a chave da D4Sign vai por extenso em cada teste.
const GRAVA = { gravar: true, limite: 20 };

/** Uma segunda venda nativa, assinada pela Clicksign e com card em Em assinatura: um alvo que sempre se resolve. */
function semearOutraVenda(b: Banco, sufixo: string) {
  b.semear("hercules_propostas", {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    data_assinatura: null,
    etapa: "assinatura",
    id: `venda-${sufixo}`,
    origem: "panteon",
    workspace_id: "careli",
  });
  b.semear("temis_envelopes", {
    criado_em: "2026-09-20T12:00:00.000Z",
    enviado_em: "2026-09-20T12:01:00.000Z",
    envelope_id: `env-${sufixo}`,
    estado: "assinado",
    falha: null,
    fechado_em: "2026-09-26T15:00:00.000-03:00",
    finalidade: "contrato",
    id: `reg-${sufixo}`,
    origem: "panteon",
    proposta_id: `venda-${sufixo}`,
    provedor: "clicksign",
    signatarios: [
      { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k1", email: "c@x.com", nome: "C", ordem: 1, papel: "comprador" },
    ],
    trabalho_id: `card-${sufixo}`,
    workspace_id: "careli",
  });
  b.semear("temis_trabalhos", {
    estagio: "assinatura",
    estagio_desde: "2026-09-21T12:00:00.000Z",
    id: `card-${sufixo}`,
    proposta_id: `venda-${sufixo}`,
    tipo: "contrato",
    workspace_id: "careli",
  });
}

const escreveu = (b: Banco) => b.consultas.some((q) => q.operacao !== "select");

describe("reconciliarVendasAssinadas: a conclusão que ficou para trás", () => {
  it("⚠️ o efeito que falhou depois da RPC é refeito na rodada seguinte, UMA vez", async () => {
    const b = banco();

    const primeira = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: MOVER_VENDAS });
    expect(primeira.refeitas).toBe(1);
    expect(b.linha("temis_trabalhos", "card-1")).toMatchObject({
      arrependimento_inicio: "2026-09-26T10:00:00.000-03:00",
      estagio: "prazo_legal",
    });
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBe("2026-09-26");

    const segunda = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: MOVER_VENDAS });
    expect(segunda).toEqual({ planejadas: 0, puladas: {}, refeitas: 0 });
    expect(b.linhas("temis_trabalho_etapas")).toHaveLength(1);
  });

  it("card já no Pré-faturamento e só a data faltando: grava a data, sem mexer no card", async () => {
    const b = banco({ card: { arrependimento_inicio: "2026-09-26T10:00:00.000-03:00", estagio: "prazo_legal" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: false });
    expect(r.refeitas).toBe(1);
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBe("2026-09-26");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([]);
  });

  it("⚠️ a D4Sign só é refeita com moverVendas (a chave do espelho); a Clicksign sempre", async () => {
    const b = banco({ envelope: { origem: "c2x", provedor: "d4sign" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: false });
    expect(r).toEqual({ planejadas: 0, puladas: { mover_vendas_desligado: 1 }, refeitas: 0 });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
  });

  it("⚠️ D4Sign com a chave ligada: o card em Análise passa por Em assinatura e chega ao Pré-faturamento", async () => {
    const b = banco({
      card: { estagio: "analise" },
      envelope: { origem: "c2x", provedor: "d4sign" },
      venda: { etapa: "contrato" },
    });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(r).toEqual({ planejadas: 1, puladas: {}, refeitas: 1 });
    expect(b.linha("temis_trabalhos", "card-1")).toMatchObject({
      // D4Sign: o prazo começa no fechamento.
      arrependimento_inicio: "2026-09-26T15:00:00.000-03:00",
      estagio: "prazo_legal",
    });
    expect(b.linhas("temis_trabalho_etapas").map((l) => [l.de, l.para, l.origem])).toEqual([
      ["analise", "assinatura", "espelho_d4sign"],
      ["assinatura", "prazo_legal", "espelho_d4sign"],
    ]);
    expect(b.linha("hercules_propostas", "venda-1")).toMatchObject({ data_assinatura: "2026-09-26", etapa: "assinatura" });
  });

  it("venda com pedido de cancelamento: pulada, com o motivo", async () => {
    const b = banco({ venda: { cancelamento_pedido_em: "2026-09-27T12:00:00.000Z" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(r).toEqual({ planejadas: 0, puladas: { pedido_de_cancelamento: 1 }, refeitas: 0 });
  });

  it("o limite por rodada é respeitado", async () => {
    const b = banco();
    const r = await reconciliarVendasAssinadas(b.cliente, { gravar: true, limite: 0, moverVendas: true });
    expect(r).toEqual({ planejadas: 0, puladas: { limite: 1 }, refeitas: 0 });
  });

  it("envelope de distrato assinado não entra (só contrato)", async () => {
    const b = banco({ envelope: { finalidade: "distrato" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(r).toEqual({ planejadas: 0, puladas: {}, refeitas: 0 });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
  });
});

describe("reconciliarVendasAssinadas: o que não se resolve não gasta o limite", () => {
  it("⚠️ Clicksign assinada com o card em Análise e a data já gravada: pulada, e a venda seguinte é refeita", async () => {
    const b = banco({ card: { estagio: "analise" }, venda: { data_assinatura: "2026-09-26" } });
    semearOutraVenda(b, "2");
    const r = await reconciliarVendasAssinadas(b.cliente, { gravar: true, limite: 1, moverVendas: true });
    expect(r).toEqual({ planejadas: 1, puladas: { clicksign_card_fora_de_assinatura: 1 }, refeitas: 1 });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("analise");
    expect(b.linha("temis_trabalhos", "card-2")?.estagio).toBe("prazo_legal");
  });

  it("⚠️ assinado sem fechado_em: sem_data_real, sem gastar o limite", async () => {
    const b = banco({ envelope: { fechado_em: null } });
    semearOutraVenda(b, "2");
    const r = await reconciliarVendasAssinadas(b.cliente, { gravar: true, limite: 1, moverVendas: true });
    expect(r).toEqual({ planejadas: 1, puladas: { sem_data_real: 1 }, refeitas: 1 });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("temis_trabalhos", "card-2")?.estagio).toBe("prazo_legal");
  });

  it("venda faturada com a data já gravada nem é lida", async () => {
    const b = banco({ card: { estagio: "assinatura" }, venda: { data_assinatura: "2026-09-26", etapa: "faturado" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(r).toEqual({ planejadas: 0, puladas: {}, refeitas: 0 });
    expect(b.consultas.some((q) => q.tabela === "temis_envelopes")).toBe(false);
  });

  it("⚠️ o quadro (jsonb com nome e e-mail) só é lido de quem vai ser refeito", async () => {
    const b = banco();
    semearOutraVenda(b, "2");
    const r = await reconciliarVendasAssinadas(b.cliente, { gravar: true, limite: 1, moverVendas: true });
    expect(r).toMatchObject({ planejadas: 1, puladas: { limite: 1 }, refeitas: 1 });
    const leiturasDoQuadro = b.consultas.filter(
      (q) => q.tabela === "temis_envelopes" && q.filtros.some((f) => f.startsWith("in:id=")),
    );
    expect(leiturasDoQuadro.map((q) => q.filtros)).toEqual([["in:id=reg-1"]]);
  });
});

describe("reconciliarVendasAssinadas: a entrada da D4Sign que passou com a chave desligada", () => {
  // ⚠️ A ORDEM DA F3: `--gravar` sem mover vendas insere o envelope vivo (`novo` → `aguardando`) com a
  // chave desligada. A borda não volta; quando a chave liga, só a reconciliação leva o card.
  const vivoNaD4Sign = { estado: "aguardando", fechado_em: null, origem: "c2x", provedor: "d4sign" };

  it("com a chave ligada: o card em Análise vai para Em assinatura e a venda para assinatura, uma vez", async () => {
    const b = banco({ card: { estagio: "analise" }, envelope: vivoNaD4Sign, venda: { etapa: "contrato" } });

    const primeira = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(primeira).toEqual({ planejadas: 1, puladas: {}, refeitas: 1 });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-1")).toMatchObject({ data_assinatura: null, etapa: "assinatura" });
    expect(b.linhas("temis_trabalho_etapas")).toEqual([
      expect.objectContaining({ de: "analise", origem: "espelho_d4sign", para: "assinatura" }),
    ]);

    const segunda = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(segunda).toEqual({ planejadas: 0, puladas: {}, refeitas: 0 });
    expect(b.linhas("temis_trabalho_etapas")).toHaveLength(1);
  });

  it("com a chave desligada: pulada, e nada se move", async () => {
    const b = banco({ card: { estagio: "analise" }, envelope: vivoNaD4Sign, venda: { etapa: "contrato" } });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: false });
    expect(r).toEqual({ planejadas: 0, puladas: { mover_vendas_desligado: 1 }, refeitas: 0 });
    expect(escreveu(b)).toBe(false);
  });

  it("a Clicksign viva não é entrada (quem move o card é o envio da Têmis)", async () => {
    const b = banco({
      card: { estagio: "analise" },
      envelope: { estado: "parcial", fechado_em: null },
      venda: { etapa: "contrato" },
    });
    const r = await reconciliarVendasAssinadas(b.cliente, { ...GRAVA, moverVendas: true });
    expect(r).toEqual({ planejadas: 0, puladas: {}, refeitas: 0 });
    expect(escreveu(b)).toBe(false);
  });
});

describe("reconciliarVendasAssinadas: o ensaio", () => {
  it("⚠️ gravar: false escolhe os alvos e não escreve nada, nem na Clicksign", async () => {
    const b = banco();
    const r = await reconciliarVendasAssinadas(b.cliente, { gravar: false, limite: 20, moverVendas: false });
    expect(r).toEqual({ planejadas: 1, puladas: {}, refeitas: 0 });
    expect(escreveu(b)).toBe(false);
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBeNull();
  });
});
