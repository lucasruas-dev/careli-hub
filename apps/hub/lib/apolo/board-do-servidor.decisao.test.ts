import { beforeEach, describe, expect, it, vi } from "vitest";

// A RÉGUA DAS ETAPAS DE DECISÃO (pré-venda, credenciado, indeferido) quando quem grava é o portal que
// opera sozinho.
//
// Decisão do Lucas (16/09/2026): a Cecílio faz crédito e credenciamento no portal. No Apolo essas
// etapas só chegam pelo servidor do crédito e do PIX, porque não existe botão que credencie sem
// crédito; aberta a porta a um PATCH direto, a régua passa a morar no servidor. Travado aqui:
//   • credenciado (e pré-venda) sem crédito aprovado: recusado;
//   • credenciado com a pré-venda ligada e sem PIX gerado: recusado (a reserva do lote não conta);
//   • indeferido sem motivo: recusado; e (revisão de 16/09/2026) só a partir da revisão de crédito e
//     nunca com PIX gerado, porque indeferir a CAD credenciada deixava o PIX pago no Asaas órfão;
//   • leitura que falha: 503, nunca "pode gravar".

const m = vi.hoisted(() => ({
  cad: vi.fn(),
  credito: vi.fn(),
}));

vi.mock("@/lib/apolo/esteira-cad", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/esteira-cad")>()),
  lerCadDaEsteira: m.cad,
}));
vi.mock("@/lib/serasa/consulta-servico", () => ({ creditoDaCad: m.credito }));

import {
  conferirEtapaDeDecisao,
  type FatosDaDecisao,
  recusaDaEtapaDeDecisao,
} from "./board-do-servidor";

const ENTIDADE = "11111111-2222-4333-8444-555555555555";

const fatos = (parcial: Partial<FatosDaDecisao> = {}): FatosDaDecisao => ({
  creditoAprovado: true,
  etapaAtual: "credito",
  pixGerado: false,
  prevendaHabilitada: false,
  ...parcial,
});

describe("recusaDaEtapaDeDecisao (sem I/O)", () => {
  it("etapas do coordenador não passam pela régua", () => {
    for (const etapa of ["validacao", "credito", "correcao", "revisao"]) {
      expect(recusaDaEtapaDeDecisao({ etapa, fatos: null, motivo: "" })).toBeNull();
    }
  });

  it("indeferido exige motivo, antes de qualquer fato", () => {
    expect(recusaDaEtapaDeDecisao({ etapa: "indeferido", fatos: null, motivo: "   " })?.status).toBe(400);
    const emRevisao = fatos({ creditoAprovado: false, etapaAtual: "revisao" });
    expect(recusaDaEtapaDeDecisao({ etapa: "indeferido", fatos: emRevisao, motivo: "Renda" })).toBeNull();
  });

  it("indeferido só a partir da revisão, e nunca com PIX gerado", () => {
    for (const etapaAtual of ["credenciado", "prevenda", "validacao", "credito", "correcao", null]) {
      const recusa = recusaDaEtapaDeDecisao({
        etapa: "indeferido",
        fatos: fatos({ etapaAtual }),
        motivo: "Renda",
      });
      expect(recusa?.status).toBe(409);
      expect(recusa?.error).toContain("revisão");
    }
    const comPix = recusaDaEtapaDeDecisao({
      etapa: "indeferido",
      fatos: fatos({ etapaAtual: "revisao", pixGerado: true }),
      motivo: "Renda",
    });
    expect(comPix?.status).toBe(409);
    expect(comPix?.error).toContain("PIX");
    // Já indeferida: regravar não decide nada de novo.
    expect(
      recusaDaEtapaDeDecisao({ etapa: "indeferido", fatos: fatos({ etapaAtual: "indeferido" }), motivo: "x" }),
    ).toBeNull();
    // Sem fatos (leitura falhou), com motivo: 503.
    expect(recusaDaEtapaDeDecisao({ etapa: "indeferido", fatos: null, motivo: "Renda" })?.status).toBe(503);
  });

  it("credenciado e pré-venda sem crédito aprovado: 409", () => {
    for (const etapa of ["credenciado", "prevenda"]) {
      const recusa = recusaDaEtapaDeDecisao({ etapa, fatos: fatos({ creditoAprovado: false }), motivo: "" });
      expect(recusa?.status).toBe(409);
      expect(recusa?.error).toContain("não está aprovado");
    }
  });

  it("credenciado com a pré-venda ligada só com PIX gerado", () => {
    const semPix = fatos({ prevendaHabilitada: true, pixGerado: false });
    expect(recusaDaEtapaDeDecisao({ etapa: "credenciado", fatos: semPix, motivo: "" })?.status).toBe(409);
    const comPix = fatos({ prevendaHabilitada: true, pixGerado: true });
    expect(recusaDaEtapaDeDecisao({ etapa: "credenciado", fatos: comPix, motivo: "" })).toBeNull();
    // Pré-venda desligada: credenciado segue direto, sem PIX (é o destino do aprovado).
    expect(recusaDaEtapaDeDecisao({ etapa: "credenciado", fatos: fatos(), motivo: "" })).toBeNull();
    // Ir PARA a pré-venda não exige PIX: é lá que ele é gerado.
    expect(
      recusaDaEtapaDeDecisao({ etapa: "prevenda", fatos: fatos({ prevendaHabilitada: true }), motivo: "" }),
    ).toBeNull();
  });

  it("sem fatos (leitura falhou): 503", () => {
    expect(recusaDaEtapaDeDecisao({ etapa: "credenciado", fatos: null, motivo: "" })?.status).toBe(503);
  });

  it("regravar a etapa em que a CAD já está não decide nada de novo", () => {
    const jaCredenciada = fatos({ creditoAprovado: true, etapaAtual: "credenciado", prevendaHabilitada: true });
    expect(recusaDaEtapaDeDecisao({ etapa: "credenciado", fatos: jaCredenciada, motivo: "" })).toBeNull();
  });
});

function clienteFalso(opts: { erro?: boolean; setting: null | Record<string, unknown> }) {
  const cadeia: Record<string, unknown> = {};
  Object.assign(cadeia, {
    eq: () => cadeia,
    maybeSingle: () =>
      Promise.resolve(
        opts.erro ? { data: null, error: { message: "timeout" } } : { data: opts.setting, error: null },
      ),
    select: () => cadeia,
  });
  return { from: () => cadeia } as unknown as Parameters<typeof conferirEtapaDeDecisao>[0];
}

const LIGADA = { prevenda_habilitada: true, valor_pix: 1000 };

describe("conferirEtapaDeDecisao (os fatos da CAD)", () => {
  beforeEach(() => {
    m.cad.mockReset();
    m.credito.mockReset();
    m.cad.mockImplementation(async () => ({ etapa: "credito", pagamento_ref: null, pago_em: null }));
    m.credito.mockImplementation(async () => ({ aprovado: true, fonte: "consulta" }));
  });

  const conferir = (etapa: string, setting: null | Record<string, unknown> = null, erro = false) =>
    conferirEtapaDeDecisao(clienteFalso({ erro, setting }), ENTIDADE, {
      enterpriseId: "39",
      etapa,
      motivo: undefined,
    });

  it("credenciado sem crédito aprovado: recusado, com a CAD e o empreendimento do escopo", async () => {
    m.credito.mockImplementation(async () => ({ aprovado: false, fonte: "consulta" }));
    const recusa = await conferir("credenciado");
    expect(recusa?.status).toBe(409);
    expect(m.cad).toHaveBeenCalledWith(expect.anything(), ENTIDADE, "etapa, pagamento_ref, pago_em", {
      enterpriseId: "39",
    });
    expect(m.credito).toHaveBeenCalledWith(
      expect.objectContaining({ enterpriseId: "39", entityId: ENTIDADE, etapaAtual: "credito" }),
    );
  });

  it("pré-venda ligada: a reserva otimista do lote ('reservado:...') não é PIX gerado", async () => {
    m.cad.mockImplementation(async () => ({
      etapa: "prevenda",
      pagamento_ref: "reservado:1726500000000",
      pago_em: null,
    }));
    expect((await conferir("credenciado", LIGADA))?.status).toBe(409);
  });

  it("pré-venda ligada com cobrança emitida (ou paga): credencia", async () => {
    m.cad.mockImplementation(async () => ({ etapa: "prevenda", pagamento_ref: "pay_abc", pago_em: null }));
    expect(await conferir("credenciado", LIGADA)).toBeNull();
    m.cad.mockImplementation(async () => ({ etapa: "prevenda", pagamento_ref: null, pago_em: "2026-09-16" }));
    expect(await conferir("credenciado", LIGADA)).toBeNull();
  });

  it("pré-venda com flag ligada mas SEM valor não é pré-venda (a mesma regra do Board)", async () => {
    expect(await conferir("credenciado", { prevenda_habilitada: true, valor_pix: null })).toBeNull();
  });

  it("leitura da configuração falhou: 503 (não dispensa o PIX por engano)", async () => {
    expect((await conferir("credenciado", LIGADA, true))?.status).toBe(503);
  });

  it("leitura da esteira falhou: 503", async () => {
    m.cad.mockImplementation(async () => {
      throw new Error("apolo_esteira: leitura falhou");
    });
    expect((await conferir("prevenda"))?.status).toBe(503);
  });

  it("indeferido sem motivo não lê nada", async () => {
    const recusa = await conferir("indeferido");
    expect(recusa?.status).toBe(400);
    expect(m.cad).not.toHaveBeenCalled();
    expect(m.credito).not.toHaveBeenCalled();
  });

  const indeferir = (setting: null | Record<string, unknown> = null) =>
    conferirEtapaDeDecisao(clienteFalso({ setting }), ENTIDADE, {
      enterpriseId: "39",
      etapa: "indeferido",
      motivo: "Renda não comprovada",
    });

  it("indeferido com motivo: lê a etapa e o PIX da CAD do escopo, sem consultar o crédito", async () => {
    m.cad.mockImplementation(async () => ({ etapa: "revisao", pagamento_ref: null, pago_em: null }));
    expect(await indeferir()).toBeNull();
    expect(m.cad).toHaveBeenCalledWith(expect.anything(), ENTIDADE, "etapa, pagamento_ref, pago_em", {
      enterpriseId: "39",
    });
    expect(m.credito).not.toHaveBeenCalled();
  });

  it("indeferir a CAD credenciada com PIX pago: recusado (o pagamento ficaria órfão)", async () => {
    m.cad.mockImplementation(async () => ({
      etapa: "credenciado",
      pagamento_ref: "pay_abc",
      pago_em: "2026-09-10",
    }));
    const recusa = await indeferir(LIGADA);
    expect(recusa?.status).toBe(409);
    expect(recusa?.error).toContain("PIX");
  });

  it("indeferir: a reserva otimista do lote não conta como PIX, mas fora da revisão continua recusado", async () => {
    m.cad.mockImplementation(async () => ({
      etapa: "revisao",
      pagamento_ref: "reservado:1726500000000",
      pago_em: null,
    }));
    expect(await indeferir()).toBeNull();
    m.cad.mockImplementation(async () => ({ etapa: "prevenda", pagamento_ref: null, pago_em: null }));
    expect((await indeferir())?.status).toBe(409);
  });

  it("indeferir com a leitura da esteira falhando: 503", async () => {
    m.cad.mockImplementation(async () => {
      throw new Error("apolo_esteira: leitura falhou");
    });
    expect((await indeferir())?.status).toBe(503);
  });
});
