import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha, ORIGENS_DA_0153 } from "@/lib/hercules/banco-em-memoria.para-teste";

import {
  aplicarEnvelopeNaVenda,
  diaDaAssinatura,
  inicioDoArrependimento,
  MOVER_VENDAS,
  type MudancaDoEnvelope,
} from "./envelope-na-venda";
import type { ItemDoQuadro } from "./registro-db";

// O ENVELOPE → CARD → VENDA, POR UMA PORTA SÓ (F2 da fonte única, plano, seção 7).
//
// Lucas, 28/09/2026: *"Sim, anda sozinho"* (o card da venda nativa assinada pela D4Sign do C2X) e a
// data de assinatura gravada na venda. O banco é o de memória, com a passagem de etapa e o reflexo
// DE VERDADE: o que se mede é o que chega às tabelas. As origens aceitas são as da 0195 (a 0153 mais
// `conclusao` e `espelho_d4sign`), que é aplicada antes do deploy.

const bancos: Banco[] = [];
afterEach(() => {
  for (const b of bancos) expect(b.problemas).toEqual([]);
  bancos.length = 0;
  vi.restoreAllMocks();
});

function banco(c: { card?: Linha; venda?: Linha; outros?: Linha[] } = {}): Banco {
  const b = criarBanco(
    {
      hercules_proposta_etapas: [],
      hercules_propostas: [
        {
          cancelada_em: null,
          cancelamento_pedido_em: null,
          data_assinatura: null,
          etapa: "contrato",
          etapa_desde: "2026-09-20T12:00:00.000Z",
          id: "venda-1",
          origem: "panteon",
          unidade_id: "uni-1",
          workspace_id: "careli",
          ...c.venda,
        },
      ],
      temis_trabalho_etapas: [],
      temis_trabalhos: [
        {
          estagio: "analise",
          estagio_desde: "2026-09-22T12:00:00.000Z",
          id: "card-1",
          proposta_id: "venda-1",
          tipo: "contrato",
          workspace_id: "careli",
          ...c.card,
        },
        ...(c.outros ?? []),
      ],
    },
    { origensDaPassagem: [...ORIGENS_DA_0153, "conclusao", "espelho_d4sign"] },
  );
  bancos.push(b);
  return b;
}

const quadro: ItemDoQuadro[] = [
  { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "c2x:1", email: "", nome: "Compradora", ordem: 1, papel: "comprador" },
  { assinado_em: "2026-09-26T09:00:00.000-03:00", chave: "c2x:2", email: "", nome: "Cônjuge", ordem: 1, papel: "conjuge" },
  { assinado_em: "2026-09-26T15:00:00.000-03:00", chave: "c2x:3", email: "", nome: "Vendedora", ordem: 2, papel: "vendedora" },
];

function mudanca(p: {
  antes?: MudancaDoEnvelope["estadoAntes"];
  depois: MudancaDoEnvelope["estadoDepois"];
  envelope?: Partial<MudancaDoEnvelope["envelope"]>;
}): MudancaDoEnvelope {
  return {
    envelope: {
      fechadoEm: null,
      finalidade: "contrato",
      id: "reg-1",
      origem: "c2x",
      propostaId: "venda-1",
      provedor: "d4sign",
      signatarios: quadro,
      ...p.envelope,
    },
    estadoAntes: p.antes ?? "novo",
    estadoDepois: p.depois,
  };
}

const LIGADO = { moverVendas: true };
const escreveu = (b: Banco, tabela: string) => b.consultas.some((q) => q.tabela === tabela && q.operacao === "update");

describe("aplicarEnvelopeNaVenda: a D4Sign entrando em assinatura", () => {
  it("⚠️ novo → parcial com card em Análise: card para Em assinatura (espelho_d4sign) e venda contrato → assinatura", async () => {
    const b = banco();
    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "parcial" }), LIGADO);

    expect(efeito).toMatchObject({ card: "andou", dataDeAssinatura: "nao_se_aplica" });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-1")?.etapa).toBe("assinatura");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([
      expect.objectContaining({ de: "analise", origem: "espelho_d4sign", para: "assinatura", quem: null }),
    ]);
    // ⚠️ A frase do histórico da venda não diz "na Têmis" (a Têmis não enviou) nem cita provedor.
    const [linhaDaVenda] = b.linhas("hercules_proposta_etapas");
    expect(linhaDaVenda).toMatchObject({ de: "contrato", motivo: "Contrato enviado para assinatura", para: "assinatura" });
    expect(String(linhaDaVenda?.motivo)).not.toMatch(/D4Sign|C2X|Clicksign|espelho/);
    // Nada de data num envelope que só entrou em assinatura.
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBeNull();
  });

  it("aguardando → parcial não é borda: nada", async () => {
    const b = banco();
    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ antes: "aguardando", depois: "parcial" }), LIGADO);
    expect(efeito.card).toBe("nada");
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
    expect(b.consultas.some((q) => q.tabela === "hercules_propostas")).toBe(false);
  });

  it("card já em Em assinatura: não regrava estagio_desde nem a passagem", async () => {
    const b = banco({ card: { estagio: "assinatura", estagio_desde: "2026-09-23T12:00:00.000Z" }, venda: { etapa: "assinatura" } });
    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "aguardando" }), LIGADO);
    expect(efeito.card).toBe("ja_estava");
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
    expect(b.linha("temis_trabalhos", "card-1")?.estagio_desde).toBe("2026-09-23T12:00:00.000Z");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([]);
  });

  it("⚠️ comparar-e-trocar: o card que outra mão moveu entre a leitura e o update não volta", async () => {
    const b = banco({ card: { estagio: "contrato" } });
    // Logo depois de o espelho ler os cards, alguém devolve o card para a Análise.
    b.depois(
      (q) => q.tabela === "temis_trabalhos" && q.operacao === "select",
      (banco) => {
        const card = banco.linha("temis_trabalhos", "card-1");
        if (card) Object.assign(card, { estagio: "analise", estagio_desde: "2026-09-28T12:00:00.000Z" });
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "aguardando" }), LIGADO);

    expect(efeito.card).not.toBe("andou");
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("analise");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([]);
    expect(b.linha("hercules_propostas", "venda-1")?.etapa).toBe("contrato");
  });

  it("a Clicksign em aguardando/parcial não move nada (o envio da Têmis já moveu)", async () => {
    const b = banco();
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ antes: "rascunho", depois: "aguardando", envelope: { origem: "panteon", provedor: "clicksign" } }),
      LIGADO,
    );
    expect(efeito.card).toBe("nada");
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
  });

  it("só o card de CONTRATO anda: a cessão aberta na mesma venda fica onde está", async () => {
    const b = banco({
      outros: [
        { estagio: "contrato", estagio_desde: "2026-09-22T12:00:00.000Z", id: "card-cessao", proposta_id: "venda-1", tipo: "cessao", workspace_id: "careli" },
      ],
    });
    await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "aguardando" }), LIGADO);
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("temis_trabalhos", "card-cessao")?.estagio).toBe("contrato");
  });
});

describe("aplicarEnvelopeNaVenda: as guardas (qualquer 'não' devolve nada, com motivo)", () => {
  it("moverVendas desligado: nada, sem ler o banco", async () => {
    const b = banco();
    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "parcial" }), { moverVendas: false });
    expect(efeito.card).toBe("nada");
    expect(b.consultas).toEqual([]);
  });

  it("⚠️ a chave do espelho está LIGADA desde 29/09/2026 (OK do Lucas, depois da prova da F3)", () => {
    expect(MOVER_VENDAS).toBe(true);
  });

  it("finalidade distrato: nada (só o contrato move a venda)", async () => {
    const b = banco();
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00", finalidade: "distrato" } }),
      LIGADO,
    );
    expect(efeito).toMatchObject({ card: "nada", dataDeAssinatura: "nao_se_aplica" });
    expect(b.consultas).toEqual([]);
  });

  it("proposta da carga: nada, e a data do legado não é tocada", async () => {
    const b = banco({ venda: { origem: "c2x" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } }),
      LIGADO,
    );
    expect(efeito.card).toBe("nada");
    expect(escreveu(b, "hercules_propostas")).toBe(false);
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
  });

  it("venda desfeita: recusado, e ninguém anda", async () => {
    const b = banco({ venda: { etapa: "distrato" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } }),
      LIGADO,
    );
    expect(efeito.card).toBe("recusado");
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
    expect(escreveu(b, "hercules_propostas")).toBe(false);
  });

  it("⚠️ venda com pedido de cancelamento aberto (a LBF): nada, com o motivo", async () => {
    const b = banco({ venda: { cancelamento_pedido_em: "2026-09-25T12:00:00.000Z" } });
    const efeito = await aplicarEnvelopeNaVenda(b.cliente, mudanca({ depois: "parcial" }), LIGADO);
    expect(efeito.card).toBe("nada");
    expect(efeito.motivo).toContain("pedido de cancelamento");
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
  });
});

describe("aplicarEnvelopeNaVenda: o assinado", () => {
  it("⚠️ assinado sem fechadoEm nem data do comprador: sem_data_real, e nada se move", async () => {
    const semData = quadro.map(({ assinado_em: _a, ...resto }) => resto);
    const b = banco({ card: { estagio: "assinatura" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ antes: "parcial", depois: "assinado", envelope: { origem: "panteon", provedor: "clicksign", signatarios: semData } }),
      LIGADO,
    );
    expect(efeito).toMatchObject({ card: "nada", dataDeAssinatura: "sem_data_real" });
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
    expect(escreveu(b, "hercules_propostas")).toBe(false);
  });

  it("⚠️ D4Sign: o prazo começa no FECHAMENTO, e o card passa por Em assinatura antes do Pré-faturamento", async () => {
    const b = banco({ card: { estagio: "contrato" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ antes: "desconhecido", depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } }),
      LIGADO,
    );
    expect(efeito).toMatchObject({ card: "andou", dataDeAssinatura: "gravada" });
    const card = b.linha("temis_trabalhos", "card-1");
    expect(card).toMatchObject({ arrependimento_inicio: "2026-09-26T15:00:00.000-03:00", estagio: "prazo_legal" });
    expect(b.linhas("temis_trabalho_etapas").map((l) => [l.de, l.para, l.origem])).toEqual([
      ["contrato", "assinatura", "espelho_d4sign"],
      ["assinatura", "prazo_legal", "espelho_d4sign"],
    ]);
    const venda = b.linha("hercules_propostas", "venda-1");
    expect(venda).toMatchObject({ data_assinatura: "2026-09-26", etapa: "assinatura" });
  });

  it("⚠️ Clicksign: o prazo começa na última assinatura de comprador ou cônjuge, e a data é desse dia", async () => {
    const b = banco({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({
        antes: "parcial",
        depois: "assinado",
        envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00", origem: "panteon", provedor: "clicksign" },
      }),
      LIGADO,
    );
    expect(efeito).toMatchObject({ card: "andou", dataDeAssinatura: "gravada" });
    // A compradora (10h), e não a vendedora (15h, o fechamento).
    expect(b.linha("temis_trabalhos", "card-1")?.arrependimento_inicio).toBe("2026-09-26T10:00:00.000-03:00");
    expect(b.linhas("temis_trabalho_etapas")).toEqual([
      expect.objectContaining({ de: "assinatura", origem: "webhook_assinatura", para: "prazo_legal" }),
    ]);
  });

  it("data_assinatura só se nula: a que já existe não é trocada", async () => {
    const b = banco({ card: { estagio: "assinatura" }, venda: { data_assinatura: "2026-09-01", etapa: "assinatura" } });
    const efeito = await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ antes: "parcial", depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } }),
      LIGADO,
    );
    expect(efeito.dataDeAssinatura).toBe("ja_tinha");
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBe("2026-09-01");
  });

  it("⚠️ 23:30 de Brasília grava o PRÓPRIO dia (o `Z` seria o dia seguinte)", async () => {
    const b = banco({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    await aplicarEnvelopeNaVenda(
      b.cliente,
      mudanca({ antes: "parcial", depois: "assinado", envelope: { fechadoEm: "2026-09-12T02:30:00.000Z" } }),
      LIGADO,
    );
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBe("2026-09-11");
  });

  it("o mesmo assinado aplicado duas vezes: a segunda não move nem regrava nada", async () => {
    const b = banco({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    const m = mudanca({ antes: "parcial", depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } });
    await aplicarEnvelopeNaVenda(b.cliente, m, LIGADO);
    const passagens = b.linhas("temis_trabalho_etapas").length;
    const segunda = await aplicarEnvelopeNaVenda(b.cliente, m, LIGADO);
    expect(segunda).toMatchObject({ card: "ja_estava", dataDeAssinatura: "ja_tinha" });
    expect(b.linhas("temis_trabalho_etapas")).toHaveLength(passagens);
  });
});

describe("as regras puras", () => {
  it("inicioDoArrependimento: D4Sign é sempre o fechamento; Clicksign, o último comprador ou cônjuge", () => {
    expect(inicioDoArrependimento("d4sign", quadro, "2026-09-26T15:00:00.000-03:00")).toBe("2026-09-26T15:00:00.000-03:00");
    expect(inicioDoArrependimento("d4sign", quadro, null)).toBeNull();
    expect(inicioDoArrependimento("clicksign", quadro, "2026-09-26T15:00:00.000-03:00")).toBe("2026-09-26T10:00:00.000-03:00");
    expect(inicioDoArrependimento("clicksign", [], "2026-09-26T15:00:00.000-03:00")).toBe("2026-09-26T15:00:00.000-03:00");
    expect(inicioDoArrependimento("clicksign", [], "ontem")).toBeNull();
  });

  it("diaDaAssinatura: o dia em Brasília, nunca o slice do texto", () => {
    expect(diaDaAssinatura("2026-09-11T23:30:00.000-03:00")).toBe("2026-09-11");
    expect(diaDaAssinatura("2026-09-12T02:30:00.000Z")).toBe("2026-09-11");
    expect(diaDaAssinatura(null)).toBeNull();
  });
});

describe("aplicarEnvelopeNaVenda: as falhas do banco (nunca lança, nunca escreve pela metade)", () => {
  const assinadoD4Sign = () =>
    mudanca({ antes: "parcial", depois: "assinado", envelope: { fechadoEm: "2026-09-26T15:00:00.000-03:00" } });

  it("⚠️ a leitura da venda falhou: recusado, data falhou, e nada é escrito", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.falhar((q) => q.tabela === "hercules_propostas" && q.operacao === "select");

    const efeito = await aplicarEnvelopeNaVenda(b.cliente, assinadoD4Sign(), LIGADO);

    expect(efeito).toMatchObject({ card: "recusado", dataDeAssinatura: "falhou" });
    expect(b.consultas.some((q) => q.operacao !== "select")).toBe(false);
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
  });

  it("a gravação da data falhou: o card anda, e a data fica como `falhou` (a reconciliação refaz)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco({ card: { estagio: "assinatura" }, venda: { etapa: "assinatura" } });
    b.falhar(
      (q) => q.tabela === "hercules_propostas" && q.operacao === "update" && q.filtros.includes("is:data_assinatura=null"),
    );

    const efeito = await aplicarEnvelopeNaVenda(b.cliente, assinadoD4Sign(), LIGADO);

    expect(efeito).toMatchObject({ card: "andou", dataDeAssinatura: "falhou" });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("prazo_legal");
    expect(b.linha("hercules_propostas", "venda-1")?.data_assinatura).toBeNull();
  });

  it("⚠️ venda com cancelada_em preenchida e etapa ainda viva: recusado, e ninguém anda", async () => {
    const b = banco({
      card: { estagio: "assinatura" },
      venda: { cancelada_em: "2026-09-25T12:00:00.000Z", etapa: "assinatura" },
    });

    const efeito = await aplicarEnvelopeNaVenda(b.cliente, assinadoD4Sign(), LIGADO);

    expect(efeito).toMatchObject({ card: "recusado", dataDeAssinatura: "nao_se_aplica" });
    expect(escreveu(b, "temis_trabalhos")).toBe(false);
    expect(escreveu(b, "hercules_propostas")).toBe(false);
  });
});
