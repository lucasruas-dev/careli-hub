import { describe, expect, it } from "vitest";

import { podeEmitirContrato, type VendaParaEmitir } from "./emitir-contrato";

const PRONTA: VendaParaEmitir = {
  contratoJaEmitido: false,
  documentosPublicados: ["contrato"],
  planoTemMinuta: true,
  situacao: "confirmada",
};

describe("emitir contrato a partir da venda", () => {
  it("venda confirmada, com minuta e plano vinculado, emite", () => {
    expect(podeEmitirContrato(PRONTA).ok).toBe(true);
  });

  // ⚠️ NO SALÃO O RASCUNHO É O MOMENTO EM QUE DUAS PESSOAS DISPUTAM O MESMO LOTE: gerar documento
  // dele poria no papel uma venda que ainda pode não existir.
  it("rascunho não emite", () => {
    const r = podeEmitirContrato({ ...PRONTA, situacao: "rascunho" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.porque).toContain("rascunho");
  });

  it("cancelada não emite", () => {
    expect(podeEmitirContrato({ ...PRONTA, situacao: "cancelada" }).ok).toBe(false);
  });

  // ⚠️ UM CONTRATO POR VENDA: sem a trava, dois cliques abrem dois trabalhos e o board mostra a
  // mesma pessoa duas vezes na fila de assinatura.
  it("não emite duas vezes", () => {
    const r = podeEmitirContrato({ ...PRONTA, contratoJaEmitido: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.porque).toContain("já foi emitido");
  });

  it("sem minuta publicada no empreendimento, não emite", () => {
    const r = podeEmitirContrato({ ...PRONTA, documentosPublicados: ["distrato"] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.porque.toLowerCase()).toContain("minuta");
  });

  // ⚠️ O PLANO DECIDE A MINUTA. Com o empreendimento tendo minuta e o plano sem vínculo, a
  // confecção chegaria sem saber qual texto usar — depois de o card já ter nascido.
  it("plano sem minuta vinculada não emite", () => {
    const r = podeEmitirContrato({ ...PRONTA, planoTemMinuta: false });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.porque).toContain("plano");
  });

  // ⚠️ A ORDEM DAS PERGUNTAS É DE QUEM RESOLVE: fato da venda antes de configuração de outra
  // pessoa. Perguntar pela minuta primeiro mandaria o operador atrás do jurídico para descobrir,
  // no fim, que a venda estava cancelada.
  it("venda cancelada é dita antes de faltar minuta", () => {
    const r = podeEmitirContrato({
      ...PRONTA,
      documentosPublicados: [],
      planoTemMinuta: false,
      situacao: "cancelada",
    });
    expect(r.ok === false && r.porque).toContain("cancelada");
  });
});
