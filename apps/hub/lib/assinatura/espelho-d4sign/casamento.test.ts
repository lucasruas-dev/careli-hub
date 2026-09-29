import { describe, expect, it } from "vitest";

import { casarEnvioComAVenda, precisaDoComprador, type PropostaCandidata } from "./casamento";

// O CASAMENTO ENVELOPE D4SIGN → UNIDADE → PROPOSTA (seção 3 do plano da fonte única). Cada caso de borda
// da tabela da seção 3 é um teste aqui. Os documentos são fictícios (só dígitos, nunca de gente real).

const COMPRADOR = "11122233344";
const OUTRO = "99988877766";

function proposta(patch: Partial<PropostaCandidata> & { id: string }): PropostaCandidata {
  return {
    canceladaEm: null,
    criadoEm: "2026-09-01T10:00:00-03:00",
    documentoDoComprador: COMPRADOR,
    etapa: "contrato",
    noPai: false,
    origem: "panteon",
    origemC2xId: null,
    unidadeId: "u-filho",
    ...patch,
  };
}

const UNIDADE = { espelhoDe: null, id: "u-filho" };
const envio = (criadoEm: string, arId = 500) => ({ arId, criadoEm });

describe("regra 1: a proposta do pedido (ar_da_carga)", () => {
  it("liga à proposta da carga com origem_c2x_id = ar.id", () => {
    const doAr = proposta({ id: "p-carga", origem: "c2x", origemC2xId: 500 });
    const r = casarEnvioComAVenda(envio("2026-08-01T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: null,
      propostaDoAr: doAr,
      propostasDoTerreno: [doAr],
      unidade: UNIDADE,
    });
    expect(r).toEqual({ propostaId: "p-carga", regra: "ar_da_carga", unidadeId: "u-filho" });
  });

  it("contrato antigo de venda cancelada liga à proposta morta (é daquela venda)", () => {
    const morta = proposta({ canceladaEm: "2026-09-05T10:00:00-03:00", etapa: "cancelada", id: "p-morta", origem: "c2x", origemC2xId: 500 });
    const nativaViva = proposta({ criadoEm: "2026-09-21T21:35:00-03:00", id: "p-nativa" });
    const r = casarEnvioComAVenda(envio("2026-08-01T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: morta,
      propostasDoTerreno: [morta, nativaViva],
      unidade: UNIDADE,
    });
    expect(r.regra).toBe("ar_da_carga");
    expect(r.propostaId).toBe("p-morta");
  });

  it("pedido vivo com nativa viva no terreno: não liga, vira candidata (a duplicata da nativa)", () => {
    const doAr = proposta({ id: "p-carga", origem: "c2x", origemC2xId: 500 });
    const nativa = proposta({ id: "p-nativa" });
    const r = casarEnvioComAVenda(envio("2026-09-22T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: doAr,
      propostasDoTerreno: [doAr, nativa],
      unidade: UNIDADE,
    });
    expect(r).toEqual({
      candidata: { motivo: "ar_da_carga_com_nativa_viva", propostaId: "p-carga" },
      propostaId: null,
      regra: "sem_venda",
      unidadeId: "u-filho",
    });
  });
});

describe("regra 2: o pedido na sombra do pai (ar_da_carga_no_pai)", () => {
  const noPai = proposta({ etapa: "reserva", id: "p-pai", noPai: true, origem: "c2x", origemC2xId: 500, unidadeId: "u-pai" });

  it("aceita a NATIVA do filho do mesmo comprador (VOC, VOL, VOR com a reserva na sombra do VLO)", () => {
    const nativaDoFilho = proposta({ id: "p-voc" });
    const r = casarEnvioComAVenda(envio("2026-09-23T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: noPai,
      propostasDoTerreno: [noPai, nativaDoFilho],
      unidade: { espelhoDe: "u-filho", id: "u-pai" },
    });
    expect(r).toEqual({ propostaId: "p-voc", regra: "ar_da_carga_no_pai", unidadeId: "u-pai" });
  });

  it("aceita a venda da CARGA viva no filho do mesmo comprador", () => {
    const cargaDoFilho = proposta({ etapa: "assinatura", id: "p-carga-filho", origem: "c2x", origemC2xId: 777 });
    const r = casarEnvioComAVenda(envio("2026-08-10T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: noPai,
      propostasDoTerreno: [noPai, cargaDoFilho],
      unidade: { espelhoDe: "u-filho", id: "u-pai" },
    });
    expect(r.regra).toBe("ar_da_carga_no_pai");
    expect(r.propostaId).toBe("p-carga-filho");
  });

  it("comprador diferente no filho: a regra 2 não liga", () => {
    const deOutro = proposta({ documentoDoComprador: OUTRO, id: "p-outro" });
    const r = casarEnvioComAVenda(envio("2026-09-23T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: noPai,
      propostasDoTerreno: [noPai, deOutro],
      unidade: { espelhoDe: "u-filho", id: "u-pai" },
    });
    // ⚠️ FICA NA REGRA 1 (seção 3: a primeira que casa vence, e a regra 2 só troca com o MESMO comprador):
    // o contrato segue ligado à proposta do pedido, a sombra do pai, e nunca à venda de outra pessoa.
    expect(r).toEqual({ propostaId: noPai.id, regra: "ar_da_carga", unidadeId: "u-pai" });
  });
});

describe("regra 3: a nativa do mesmo comprador", () => {
  it("VOC0306: a nativa cancelada ANTES do envio está fora; liga à viva do mesmo comprador", () => {
    const cancelada = proposta({
      canceladaEm: "2026-09-21T12:00:00-03:00",
      criadoEm: "2026-09-16T10:00:00-03:00",
      etapa: "cancelada",
      id: "p-cancelada",
    });
    const viva = proposta({ criadoEm: "2026-09-21T21:35:00-03:00", id: "p-viva" });
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [cancelada, viva],
      unidade: UNIDADE,
    });
    expect(r).toEqual({ propostaId: "p-viva", regra: "nativa_do_mesmo_comprador", unidadeId: "u-filho" });
  });

  it("VOL1106: envio ENTRE a criação e o cancelamento da primeira liga à primeira (é a venda daquele contrato)", () => {
    const primeira = proposta({
      canceladaEm: "2026-09-21T12:00:00-03:00",
      criadoEm: "2026-09-15T10:00:00-03:00",
      etapa: "cancelada",
      id: "p-primeira",
    });
    const segunda = proposta({ criadoEm: "2026-09-24T10:00:00-03:00", id: "p-segunda" });
    const r = casarEnvioComAVenda(envio("2026-09-18T10:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [primeira, segunda],
      unidade: UNIDADE,
    });
    expect(r.propostaId).toBe("p-primeira");
  });

  it("comprador diferente não casa: sem_venda com a candidata comprador_diferente", () => {
    const deOutro = proposta({ documentoDoComprador: OUTRO, id: "p-outro" });
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [deOutro],
      unidade: UNIDADE,
    });
    expect(r).toEqual({
      candidata: { motivo: "comprador_diferente", propostaId: "p-outro" },
      propostaId: null,
      regra: "sem_venda",
      unidadeId: "u-filho",
    });
  });

  it("sem o documento do C2X ninguém casa (não se liga por proximidade)", () => {
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: null,
      propostaDoAr: null,
      propostasDoTerreno: [proposta({ id: "p-nativa" })],
      unidade: UNIDADE,
    });
    expect(r.propostaId).toBeNull();
  });

  it("nativa criada DEPOIS do envio vira candidata e não liga", () => {
    const depois = proposta({ criadoEm: "2026-09-25T10:00:00-03:00", id: "p-depois" });
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [depois],
      unidade: UNIDADE,
    });
    expect(r).toEqual({
      candidata: { motivo: "nativa_depois_do_envio", propostaId: "p-depois" },
      propostaId: null,
      regra: "sem_venda",
      unidadeId: "u-filho",
    });
  });

  it("terreno pela união da régua: a nativa da GLEBA IRMÃ entra (quem monta o terreno é terreno.ts)", () => {
    const naIrma = proposta({ id: "p-vor", unidadeId: "u-vor" });
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [naIrma],
      unidade: { espelhoDe: null, id: "u-voc" },
    });
    expect(r).toEqual({ propostaId: "p-vor", regra: "nativa_do_mesmo_comprador", unidadeId: "u-voc" });
  });

  it("entre duas nativas de pé do mesmo comprador, a mais recente", () => {
    const velha = proposta({ criadoEm: "2026-09-01T10:00:00-03:00", id: "p-velha" });
    const nova = proposta({ criadoEm: "2026-09-10T10:00:00-03:00", id: "p-nova" });
    const r = casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
      documentoDoCompradorNoC2x: COMPRADOR,
      propostaDoAr: null,
      propostasDoTerreno: [velha, nova],
      unidade: UNIDADE,
    });
    expect(r.propostaId).toBe("p-nova");
  });
});

describe("sem unidade e sem venda", () => {
  it("unidade que o Panteon não tem: sem_unidade", () => {
    expect(
      casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
        documentoDoCompradorNoC2x: null,
        propostaDoAr: null,
        propostasDoTerreno: [],
        unidade: null,
      }),
    ).toEqual({ propostaId: null, regra: "sem_unidade", unidadeId: null });
  });

  it("terreno sem proposta: sem_venda sem candidata", () => {
    expect(
      casarEnvioComAVenda(envio("2026-09-22T09:00:00-03:00"), {
        documentoDoCompradorNoC2x: COMPRADOR,
        propostaDoAr: null,
        propostasDoTerreno: [],
        unidade: UNIDADE,
      }),
    ).toEqual({ candidata: null, propostaId: null, regra: "sem_venda", unidadeId: "u-filho" });
  });
});

describe("quem precisa do documento do comprador (a consulta 3 é só dos candidatos)", () => {
  it("pedido fora do pai não precisa", () => {
    const doAr = proposta({ id: "p-carga", origem: "c2x", origemC2xId: 500 });
    expect(precisaDoComprador({ propostaDoAr: doAr, propostasDoTerreno: [doAr], unidade: UNIDADE })).toBe(false);
  });

  it("pedido no pai com venda viva no filho precisa", () => {
    const noPai = proposta({ id: "p-pai", noPai: true, origem: "c2x", origemC2xId: 500 });
    const filho = proposta({ id: "p-filho" });
    expect(precisaDoComprador({ propostaDoAr: noPai, propostasDoTerreno: [noPai, filho], unidade: UNIDADE })).toBe(true);
  });

  it("sem pedido e com nativa no terreno precisa; sem nativa, não", () => {
    expect(precisaDoComprador({ propostaDoAr: null, propostasDoTerreno: [proposta({ id: "p" })], unidade: UNIDADE })).toBe(true);
    expect(
      precisaDoComprador({
        propostaDoAr: null,
        propostasDoTerreno: [proposta({ id: "c", origem: "c2x" })],
        unidade: UNIDADE,
      }),
    ).toBe(false);
  });
});
