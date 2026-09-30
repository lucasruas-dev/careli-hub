import { describe, expect, it, vi } from "vitest";

// A BAIXA DO HUB (29/09/2026): o boleto pago no Asaas quita a parcela do Garden no espelho.
// Tudo sintético: nenhum nome, CPF ou código de cliente real. O mapa de lotes dos testes de decisão
// é de mentira (antigo 900+), para o teste não depender do retrato conferido; só o último bloco
// confere o mapa de verdade, com o caso de dois lotes que motivou o pedido.
//
// O servidor do Apolo arrasta MySQL e metade do Panteon, e a escrita da ficha mora atrás dele: os
// dois saem daqui, e a escrita é testada pelo dublê das dependências.
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => null }));
vi.mock("@/lib/lsoft/carteira", () => ({ salvarParcelaDoLsoft: vi.fn() }));

import {
  aplicarBaixasDoHub,
  autorDaBaixa,
  avisosDaBaixa,
  type BaixaAnterior,
  baixasParaGravar,
  cobrancasDoAutor,
  competenciasAtrasadas,
  decidirBaixasDoHub,
  decisoesDoCliente,
  type DependenciasDaEscrita,
  type DocumentoDoBoleto,
  MAPA_DO_GARDEN,
  type MapaDeLotes,
  MOTIVO_FORA_DO_FINANCEIRO,
  type PagamentoDoBoleto,
  type ParcelaDoEspelho,
  type SerieDoBoleto,
} from "./baixa-do-hub";

// ── O cenário ───────────────────────────────────────────────────────────────

/** Um mapa de mentira: Q90 L01 ↔ 901, Q90 L02 ↔ 902, Q90 L03 ↔ 903, Q90 L04 ↔ 904. */
const MAPA: MapaDeLotes = {
  antigoDoNovo: (unidade) =>
    ({ "Q90 L01": "901", "Q90 L02": "902", "Q90 L03": "903", "Q90 L04": "904" })[unidade] ?? null,
  novoDoAntigo: (lote) => ({ "901": "Q90 L01", "902": "Q90 L02", "903": "Q90 L03", "904": "Q90 L04" })[lote] ?? null,
};

const CPF_A = "111.111.111-11";
const CPF_B = "222.222.222-22";

const pagamento = (sobre: Partial<PagamentoDoBoleto> = {}): PagamentoDoBoleto => ({
  cobrancaId: "pay_1",
  competencia: "2026-09",
  pagoEm: "2026-09-09",
  sequencia: 1,
  situacao: "RECEIVED",
  unidade: "Q90-L01",
  valorPago: 2201.02,
  ...sobre,
});

const parcela = (sobre: Partial<ParcelaDoEspelho> = {}): ParcelaDoEspelho => ({
  clienteCodigo: "C1",
  dataRecebido: null,
  id: "p1",
  lote: "901",
  observacoes: "LOTE: 901 - QUADRA: 90",
  paga: false,
  parcela: "007/084",
  parcelaTotal: 84,
  valor: 2119.05,
  valorRecebido: 0,
  vencimento: "2026-09-10",
  ...sobre,
});

const serie = (unidade: string, totalParcelas: null | number = 84, competencia = "2026-09"): SerieDoBoleto => ({
  competencia,
  sequencia: 1,
  totalParcelas,
  unidade,
});

const doc = (unidade: string, documento = CPF_A): DocumentoDoBoleto => ({ documento, unidade });

/** O cenário padrão: o cliente C1 (CPF A, marcado) com o lote Q90 L01 (antigo 901). */
function decidir(sobre: {
  baixasAnteriores?: BaixaAnterior[];
  caixa?: Set<string>;
  clientes?: Array<{ codigo: string; cpf: null | string }>;
  competencias?: string[];
  documentos?: DocumentoDoBoleto[];
  pagamentos?: PagamentoDoBoleto[];
  parcelas?: ParcelaDoEspelho[];
  series?: SerieDoBoleto[];
} = {}) {
  return decidirBaixasDoHub({
    baixasAnteriores: sobre.baixasAnteriores ?? [],
    caixa: sobre.caixa,
    clientes: sobre.clientes ?? [{ codigo: "C1", cpf: "11111111111" }],
    competencias: sobre.competencias,
    documentos: sobre.documentos ?? [doc("Q90 L01")],
    mapa: MAPA,
    pagamentos: sobre.pagamentos ?? [pagamento()],
    parcelas: sobre.parcelas ?? [parcela()],
    series: sobre.series ?? [serie("Q90 L01")],
  });
}

// ── A decisão ───────────────────────────────────────────────────────────────

describe("decidirBaixasDoHub: o caminho feliz", () => {
  it("boleto pago em setembro baixa a 007/084 com o valor e a data do Asaas", () => {
    const r = decidir();
    expect(r.decisoes).toHaveLength(1);
    expect(r.decisoes[0]).toMatchObject({
      baixa: { cobrancas: ["pay_1"], dataRecebido: "2026-09-09", parcelaId: "p1", valorRecebido: 2201.02 },
      classe: "baixa_nova",
      clienteCodigo: "C1",
      loteAntigo: "901",
      unidade: "Q90 L01",
    });
    expect(r.totais.baixa_nova).toEqual({ quantidade: 1, valor: 2201.02 });
  });

  it("NUNCA casa por valor: o boleto reajustado bem acima do nominal baixa a mesma parcela", () => {
    // ⚠️ O boleto do hub é reajustado e a parcela guarda o nominal. O recebido gravado é o do Asaas.
    const r = decidir({ pagamentos: [pagamento({ valorPago: 9999.99 })] });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
    expect(r.decisoes[0]?.baixa?.valorRecebido).toBe(9999.99);
  });

  it("a unidade com hífen (referência da cobrança) e com espaço (cadastro) é a mesma", () => {
    const r = decidir({ documentos: [doc("q90 l1")], pagamentos: [pagamento({ unidade: "Q90-L01" })] });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
  });

  it("o mesmo CPF com dois lotes: cada boleto baixa a parcela do SEU lote, com o seu valor", () => {
    // O caso do print de 29/09/2026, em forma sintética: dois lotes, duas 007/084 de 10/09.
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [
        pagamento({ cobrancaId: "pay_1", pagoEm: "2026-09-09", unidade: "Q90-L01", valorPago: 2201.02 }),
        pagamento({ cobrancaId: "pay_2", pagoEm: "2026-09-08", unidade: "Q90-L02", valorPago: 2207.18 }),
      ],
      parcelas: [
        parcela({ id: "p1", lote: "901" }),
        parcela({ id: "p2", lote: "902", observacoes: "LOTE: 902 - QUADRA: 90" }),
      ],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.decisoes.map((d) => [d.classe, d.baixa?.parcelaId, d.baixa?.valorRecebido, d.baixa?.dataRecebido])).toEqual([
      ["baixa_nova", "p1", 2201.02, "2026-09-09"],
      ["baixa_nova", "p2", 2207.18, "2026-09-08"],
    ]);
  });

  it("cadastro duplicado no LSoft (dois códigos no mesmo CPF): a parcela do lote decide o cliente", () => {
    const r = decidir({
      clientes: [
        { codigo: "C1", cpf: CPF_A },
        { codigo: "C9", cpf: CPF_A },
      ],
      parcelas: [parcela({ clienteCodigo: "C9", id: "p9" })],
    });
    expect(r.decisoes[0]).toMatchObject({ classe: "baixa_nova", clienteCodigo: "C9" });
  });
});

describe("decidirBaixasDoHub: qual parcela do mês", () => {
  const mensal = parcela({ id: "mensal", parcela: "007/084", parcelaTotal: 84 });
  const anual = parcela({ id: "anual", parcela: "002/007", parcelaTotal: 7, vencimento: "2026-09-06", valor: 10000 });

  it("mensal e anual no mesmo mês, boleto da série 84: baixa a mensal e deixa a anual", () => {
    const r = decidir({ parcelas: [mensal, anual] });
    expect(r.decisoes[0]?.baixa?.parcelaId).toBe("mensal");
  });

  it("o boleto da série 7 baixa a anual, e não a mensal", () => {
    const r = decidir({ parcelas: [mensal, anual], series: [serie("Q90 L01", 7)] });
    expect(r.decisoes[0]?.baixa?.parcelaId).toBe("anual");
  });

  it("sem a série no boleto, fica a mensal", () => {
    const r = decidir({ parcelas: [mensal, anual], series: [] });
    expect(r.decisoes[0]?.baixa?.parcelaId).toBe("mensal");
  });

  it("o resto da entrada (série 8) sozinho no mês é baixado quando o boleto é dessa série", () => {
    const r = decidir({ parcelas: [parcela({ parcela: "008/008", parcelaTotal: 8 })], series: [serie("Q90 L01", 8)] });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
  });

  it("sem a série no boleto e sem mensal no mês: conferir, e não a entrada no chute", () => {
    const r = decidir({ parcelas: [anual], series: [] });
    expect(r.decisoes[0]).toMatchObject({ classe: "conferir" });
    expect(r.decisoes[0]?.motivo).toMatch(/não diz a série/);
  });

  it("duas mensais do mesmo lote no mês (gêmeas do LSoft): conferir", () => {
    const r = decidir({ parcelas: [parcela({ id: "a" }), parcela({ id: "b" })] });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/2 parcelas da mesma série/);
  });

  it("série do boleto sem parcela correspondente no mês: conferir, dizendo que há outra série", () => {
    const r = decidir({ parcelas: [anual], series: [serie("Q90 L01", 84)] });
    expect(r.decisoes[0]?.motivo).toMatch(/série n\/084.*há 1 de outra série/);
  });

  it("parcela de outro mês não entra", () => {
    const r = decidir({ parcelas: [parcela({ vencimento: "2026-10-10" })] });
    expect(r.decisoes[0]?.motivo).toMatch(/Nenhuma parcela do lote antigo 901 vencendo em 09\/2026/);
  });

  it("parcela CONFIRMADA como subsídio da Caixa não é do cliente: não é baixada", () => {
    const r = decidir({ caixa: new Set(["p1"]) });
    expect(r.decisoes[0]?.classe).toBe("conferir");
  });

  it("parcela de outro cliente no mesmo lote antigo não é candidata", () => {
    const r = decidir({ parcelas: [parcela({ clienteCodigo: "OUTRO" })] });
    expect(r.decisoes[0]?.classe).toBe("conferir");
  });
});

describe("decidirBaixasDoHub: parcela de mais de um lote", () => {
  // "LOTE: 901 E 902": a coluna guarda o 901, o texto cita os dois, e o valor é dos dois.
  const deDois = parcela({ id: "dupla", lote: "901", observacoes: "LOTE: 901 E 902  QUADRA: 90", valor: 4238.1 });

  it("dois boletos, um por lote, os dois pagos: UMA baixa com a soma e a data do último", () => {
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [
        pagamento({ cobrancaId: "pay_1", pagoEm: "2026-09-08", unidade: "Q90-L01", valorPago: 2207.18 }),
        pagamento({ cobrancaId: "pay_2", pagoEm: "2026-09-12", unidade: "Q90-L02", valorPago: 2207.18 }),
      ],
      parcelas: [deDois],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.decisoes.map((d) => d.classe)).toEqual(["baixa_nova", "baixa_nova"]);
    expect(baixasParaGravar(r.decisoes)).toEqual([
      { cobrancas: ["pay_1", "pay_2"], dataRecebido: "2026-09-12", parcelaId: "dupla", valorRecebido: 4414.36 },
    ]);
    expect(r.decisoes[0]?.observacao).toMatch(/Parcela de 2 lotes/);
  });

  it("dois boletos, só um pago: NÃO baixa com metade do dinheiro", () => {
    // ⚠️ O defeito que isto evita: a parcela quitada com R$ 2.207,18 de recebido quando vale o dobro.
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [pagamento({ unidade: "Q90-L01", valorPago: 2207.18 })],
      parcelas: [deDois],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/Q90 L02 ainda não está pago/);
    expect(baixasParaGravar(r.decisoes)).toEqual([]);
  });

  it("um boleto só para os dois lotes (o outro lote não tem boleto próprio): baixa com ele", () => {
    const r = decidir({ pagamentos: [pagamento({ valorPago: 4414.34 })], parcelas: [deDois] });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
    expect(r.decisoes[0]?.baixa?.valorRecebido).toBe(4414.34);
  });

  it("o boleto do segundo lote acha a parcela pelo texto, mesmo sem ser o lote da coluna", () => {
    const r = decidir({
      documentos: [doc("Q90 L02")],
      pagamentos: [pagamento({ unidade: "Q90-L02", valorPago: 4414.34 })],
      parcelas: [deDois],
      series: [serie("Q90 L02")],
    });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
  });

  it("a parcela cita um lote fora do mapa: é o lote que a renumeração juntou, cobrado no mesmo boleto", () => {
    // O mapa é o conjunto das unidades de boleto: lote fora dele não tem boleto próprio.
    const r = decidir({ parcelas: [parcela({ observacoes: "LOTE: 901 E 999 QUADRA: 90" })] });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
    expect(r.decisoes[0]?.observacao).toMatch(/lotes antigos 901 e 999, cobrada num boleto só/);
  });

  it("...mas se o mesmo CPF tem boleto numa unidade que o mapa não conhece, conferir", () => {
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("00000487")],
      parcelas: [parcela({ observacoes: "LOTE: 901 E 999 QUADRA: 90" })],
    });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/999, fora do mapa, e o mesmo CPF tem boleto numa unidade que o mapa não conhece/);
  });

  it("o segundo lote cobrado num boleto de OUTRO CPF: conferir, e não a parcela quitada com metade", () => {
    // ⚠️ Achado da revisão de 29/09/2026: antes, o boleto do 901 sozinho quitava a parcela dos dois
    // lotes, porque o 902 em outro CPF contava como "sem boleto próprio".
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02", CPF_B)],
      parcelas: [deDois],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.decisoes[0]).toMatchObject({ aviso: true, classe: "conferir" });
    expect(r.decisoes[0]?.motivo).toMatch(/boleto de Q90 L02 está em outro CPF/);
    expect(baixasParaGravar(r.decisoes)).toEqual([]);
  });

  it("o segundo lote com boleto em dois CPFs (um deles o do cliente): conferir", () => {
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02"), doc("Q90 L02", CPF_B)],
      parcelas: [deDois],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/outro CPF/);
  });
});

describe("decidirBaixasDoHub: o que vai para a conferência", () => {
  it("CPF do boleto sem cliente marcado com o Garden no Financeiro", () => {
    const r = decidir({ clientes: [{ codigo: "C1", cpf: CPF_B }] });
    expect(r.decisoes[0]).toMatchObject({ classe: "conferir", parcela: null });
    expect(r.decisoes[0]?.motivo).toMatch(/Financeiro/);
  });

  it("unidade sem CPF no cadastro de boletos, e unidade com dois CPFs", () => {
    expect(decidir({ documentos: [] }).decisoes[0]?.motivo).toMatch(/Sem CPF/);
    expect(decidir({ documentos: [doc("Q90 L01"), doc("Q90 L01", CPF_B)] }).decisoes[0]?.motivo).toMatch(
      /mais de um CPF/,
    );
  });

  it("lote fora do mapa e unidade ilegível", () => {
    expect(decidir({ pagamentos: [pagamento({ unidade: "Q77-L07" })] }).decisoes[0]?.motivo).toMatch(/fora do mapa/);
    expect(decidir({ pagamentos: [pagamento({ unidade: "APTO 205" })] }).decisoes[0]?.motivo).toMatch(/ilegível/);
  });

  it("pago sem data ou sem valor no Asaas", () => {
    expect(decidir({ pagamentos: [pagamento({ pagoEm: null })] }).decisoes[0]?.classe).toBe("conferir");
    expect(decidir({ pagamentos: [pagamento({ valorPago: null })] }).decisoes[0]?.classe).toBe("conferir");
  });

  it("duas cobranças pagas para o mesmo lote no mês: nenhuma vence", () => {
    const r = decidir({
      pagamentos: [pagamento({ cobrancaId: "pay_1" }), pagamento({ cobrancaId: "pay_1b" })],
    });
    expect(r.decisoes.map((d) => d.classe)).toEqual(["conferir", "conferir"]);
    expect(r.decisoes[0]?.motivo).toMatch(/2 cobranças pagas para o mesmo lote/);
  });
});

describe("decidirBaixasDoHub: idempotência e trilha", () => {
  it("parcela já paga (na ficha ou no Access): ja_paga, sem baixa, dizendo se o valor bate", () => {
    const igual = decidir({ parcelas: [parcela({ paga: true, valorRecebido: 2201.02 })] });
    expect(igual.decisoes[0]).toMatchObject({ baixa: null, classe: "ja_paga" });
    expect(igual.decisoes[0]?.observacao).toMatch(/mesmo valor/);

    const diferente = decidir({ parcelas: [parcela({ paga: true, valorRecebido: 2119.05 })] });
    expect(diferente.decisoes[0]?.observacao).toMatch(/2\.119,05.*2\.201,02/);
    expect(baixasParaGravar(diferente.decisoes)).toEqual([]);
  });

  it("a rodada seguinte à baixa do hub vê a mesma parcela como ja_paga", () => {
    const r = decidir({
      baixasAnteriores: [{ cobrancaId: "pay_1", parcelaId: "p1" }],
      parcelas: [parcela({ paga: true, valorRecebido: 2201.02 })],
    });
    expect(r.decisoes[0]?.classe).toBe("ja_paga");
  });

  it("a cobrança que já baixou outra parcela não baixa uma segunda", () => {
    const r = decidir({ baixasAnteriores: [{ cobrancaId: "pay_1", parcelaId: "p-velha" }] });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/já deu baixa em outra parcela/);
  });

  it("a parcela que outra cobrança já baixou não é baixada de novo", () => {
    const r = decidir({ baixasAnteriores: [{ cobrancaId: "pay_outra", parcelaId: "p1" }] });
    expect(r.decisoes[0]?.motivo).toMatch(/Outra cobrança já deu baixa/);
  });

  it("parcela que o hub marcou como paga e que foi REABERTA na ficha: conferir, e não baixa de novo", () => {
    // ⚠️ Achado da revisão de 29/09/2026: reabrir zera o recebido e a data, e sem esta regra o cron
    // quitava a parcela outra vez na hora seguinte, sem ninguém conseguir desfazer.
    const r = decidir({
      baixasAnteriores: [
        { cobrancaId: "pay_1", marcouPaga: false, parcelaId: "p1" },
        { cobrancaId: "pay_1", marcouPaga: true, parcelaId: "p1" },
      ],
      parcelas: [parcela({ editadaPor: "Fulana (careli)", paga: false, valorRecebido: 0 })],
    });
    expect(r.decisoes[0]).toMatchObject({ aviso: true, classe: "conferir" });
    expect(r.decisoes[0]?.motivo).toMatch(/voltou a ficar em aberto/);
    expect(baixasParaGravar(r.decisoes)).toEqual([]);
  });

  it("a rodada que parou no meio (recebido gravado, sem o 'paga' do hub na trilha) termina o serviço", () => {
    const r = decidir({
      baixasAnteriores: [{ cobrancaId: "pay_1", marcouPaga: false, parcelaId: "p1" }],
      parcelas: [parcela({ editadaPor: "Hub · boleto Asaas pay_1", paga: false, valorRecebido: 2201.02 })],
    });
    expect(r.decisoes[0]?.classe).toBe("baixa_nova");
  });

  it("a trilha falhou e só o editada_por lembra: a cobrança não baixa uma segunda parcela", () => {
    // ⚠️ `salvarParcelaDoLsoft` devolve ok mesmo quando a trilha falha: o editada_por é a 2ª memória.
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      parcelas: [
        parcela({ id: "p1" }),
        parcela({ editadaPor: "Hub · boleto Asaas pay_1", id: "p-velha", lote: "902", observacoes: null, paga: true }),
      ],
    });
    expect(r.decisoes[0]?.classe).toBe("conferir");
    expect(r.decisoes[0]?.motivo).toMatch(/já deu baixa em outra parcela/);
  });

  it("a trilha falhou e só o editada_por lembra: outra cobrança não baixa a mesma parcela", () => {
    const r = decidir({ parcelas: [parcela({ editadaPor: "Hub · boleto Asaas pay_outra" })] });
    expect(r.decisoes[0]?.motivo).toMatch(/Outra cobrança já deu baixa/);
  });

  it("estorno depois da baixa do hub vai para a conferência; estorno sem baixa, não", () => {
    const comBaixa = decidir({
      baixasAnteriores: [{ cobrancaId: "pay_1", parcelaId: "p1" }],
      pagamentos: [pagamento({ situacao: "REFUNDED" })],
    });
    expect(comBaixa.decisoes[0]?.motivo).toMatch(/desfez este pagamento \(REFUNDED\)/);

    const semBaixa = decidir({ pagamentos: [pagamento({ situacao: "REFUNDED" })] });
    expect(semBaixa.decisoes).toEqual([]);
    expect(semBaixa.fora.naoPagos).toBe(1);
  });
});

describe("decidirBaixasDoHub: o corte de setembro e os totais", () => {
  it("competência antes de 2026-09 não é tocada", () => {
    const r = decidir({ pagamentos: [pagamento({ competencia: "2026-08" })], parcelas: [parcela({ vencimento: "2026-08-10" })] });
    expect(r.decisoes).toEqual([]);
    expect(r.fora.antesDoCorte).toBe(1);
  });

  it("boleto em aberto ou vencido não é pagamento", () => {
    const r = decidir({ pagamentos: [pagamento({ pagoEm: null, situacao: "OVERDUE", valorPago: null })] });
    expect(r.decisoes).toEqual([]);
    expect(r.fora.naoPagos).toBe(1);
  });

  it("`competencias` limita a uma competência", () => {
    const r = decidir({
      competencias: ["2026-10"],
      pagamentos: [pagamento(), pagamento({ cobrancaId: "pay_out", competencia: "2026-10" })],
      parcelas: [parcela(), parcela({ id: "p10", vencimento: "2026-10-10" })],
      series: [serie("Q90 L01"), serie("Q90 L01", 84, "2026-10")],
    });
    expect(r.decisoes.map((d) => d.cobrancaId)).toEqual(["pay_out"]);
  });

  it("os totais contam pagamentos por classe, em centavos exatos", () => {
    const r = decidir({
      clientes: [{ codigo: "C1", cpf: CPF_A }],
      documentos: [doc("Q90 L01"), doc("Q90 L02"), doc("Q90 L03", CPF_B)],
      pagamentos: [
        pagamento({ cobrancaId: "a", unidade: "Q90-L01", valorPago: 0.1 }),
        pagamento({ cobrancaId: "b", unidade: "Q90-L02", valorPago: 0.2 }),
        pagamento({ cobrancaId: "c", unidade: "Q90-L03", valorPago: 1000 }),
      ],
      parcelas: [parcela({ id: "p1" }), parcela({ id: "p2", lote: "902", observacoes: null, paga: true, valorRecebido: 0.2 })],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    expect(r.totais).toEqual({
      baixa_nova: { quantidade: 1, valor: 0.1 },
      conferir: { quantidade: 1, valor: 1000 },
      ja_paga: { quantidade: 1, valor: 0.2 },
    });
  });
});

describe("avisosDaBaixa: o que a rodada automática escreve no log", () => {
  it("conferência de verdade e já paga com valor diferente viram linha; rotina vira contagem", () => {
    const r = decidir({
      clientes: [{ codigo: "C1", cpf: CPF_A }],
      documentos: [doc("Q90 L01"), doc("Q90 L02"), doc("Q90 L03", CPF_B), doc("Q90 L04")],
      pagamentos: [
        pagamento({ cobrancaId: "pay_ok", unidade: "Q90-L01" }),
        pagamento({ cobrancaId: "pay_dif", unidade: "Q90-L02", valorPago: 2223.07 }),
        pagamento({ cobrancaId: "pay_rotina", unidade: "Q90-L03" }),
        pagamento({ cobrancaId: "pay_sem_parcela", unidade: "Q90-L04" }),
      ],
      parcelas: [
        parcela({ id: "p1" }),
        parcela({ id: "p2", lote: "902", observacoes: null, paga: true, valorRecebido: 2209.59 }),
      ],
      series: [serie("Q90 L01"), serie("Q90 L02"), serie("Q90 L04")],
    });
    const avisos = avisosDaBaixa(r.decisoes);
    expect(avisos.rotina).toBe(1);
    expect(avisos.linhas).toHaveLength(2);
    expect(avisos.linhas[0]).toMatch(/^já paga com valor diferente · cobrança pay_dif · cliente C1 · Q90 L02 \(antigo 902\) · 2026-09 · parcela 007\/084 · Já paga na ficha com R\$\s2\.209,59/);
    expect(avisos.linhas[1]).toMatch(/^conferir · cobrança pay_sem_parcela · cliente C1 · Q90 L04 \(antigo 904\)/);
    // Sem CPF nem nome no log.
    expect(avisos.linhas.join("\n")).not.toMatch(/111\.?111|222\.?222/);
    expect(r.decisoes.find((d) => d.cobrancaId === "pay_rotina")?.motivo).toBe(MOTIVO_FORA_DO_FINANCEIRO);
  });

  it("o estorno depois da baixa do hub é aviso", () => {
    const r = decidir({
      baixasAnteriores: [{ cobrancaId: "pay_1", marcouPaga: true, parcelaId: "p1" }],
      pagamentos: [pagamento({ situacao: "CHARGEBACK_REQUESTED" })],
      parcelas: [parcela({ paga: true, valorRecebido: 2201.02 })],
    });
    expect(avisosDaBaixa(r.decisoes).linhas).toEqual([
      expect.stringMatching(/^conferir · cobrança pay_1 .*desfez este pagamento \(CHARGEBACK_REQUESTED\)/),
    ]);
  });

  it("baixa nova e já paga com o mesmo valor não são aviso", () => {
    expect(avisosDaBaixa(decidir().decisoes)).toEqual({ linhas: [], rotina: 0 });
    const igual = decidir({ parcelas: [parcela({ paga: true, valorRecebido: 2201.02 })] });
    expect(avisosDaBaixa(igual.decisoes)).toEqual({ linhas: [], rotina: 0 });
  });
});

describe("decisoesDoCliente: o recorte do --cliente vale para a gravação", () => {
  // Dois clientes: C1 (CPF A) no Q90 L01 e C2 (CPF B) no Q90 L03, os dois com baixa nova.
  const r = decidir({
    clientes: [
      { codigo: "C1", cpf: CPF_A },
      { codigo: "C2", cpf: CPF_B },
    ],
    documentos: [doc("Q90 L01"), doc("Q90 L03", CPF_B)],
    pagamentos: [
      pagamento({ cobrancaId: "pay_c1", unidade: "Q90-L01" }),
      pagamento({ cobrancaId: "pay_c2", unidade: "Q90-L03" }),
    ],
    parcelas: [parcela({ id: "p1" }), parcela({ clienteCodigo: "C2", id: "p3", lote: "903", observacoes: null })],
    series: [serie("Q90 L01"), serie("Q90 L03")],
  });

  it("só o cliente pedido é gravado", async () => {
    expect(baixasParaGravar(r.decisoes)).toHaveLength(2);
    const doC1 = decisoesDoCliente(r.decisoes, "C1");
    expect(doC1.map((d) => d.cobrancaId)).toEqual(["pay_c1"]);
    const { chamadas, deps } = dependencias();
    const escrita = await aplicarBaixasDoHub(doC1, { deps });
    expect(escrita.aplicadas).toBe(1);
    expect(new Set(chamadas.map((c) => c.parcelaId))).toEqual(new Set(["p1"]));
  });

  it("código vazio não é 'todos': não devolve nada", () => {
    expect(decisoesDoCliente(r.decisoes, "  ")).toEqual([]);
  });

  it("a parcela de dois lotes não se parte: os dois boletos ficam, com a soma", () => {
    const dupla = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [
        pagamento({ cobrancaId: "pay_1", unidade: "Q90-L01", valorPago: 2207.18 }),
        pagamento({ cobrancaId: "pay_2", unidade: "Q90-L02", valorPago: 2207.18 }),
      ],
      parcelas: [parcela({ observacoes: "LOTE: 901 E 902" })],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    const doC1 = decisoesDoCliente(dupla.decisoes, "C1");
    expect(doC1).toHaveLength(2);
    expect(baixasParaGravar(doC1)).toEqual([
      { cobrancas: ["pay_1", "pay_2"], dataRecebido: "2026-09-09", parcelaId: "p1", valorRecebido: 4414.36 },
    ]);
  });
});

describe("competenciasAtrasadas: o mês velho que a sincronização ainda pergunta ao Asaas", () => {
  it("em setembro de 2026 não há mês anterior (a baixa do hub começa nele)", () => {
    expect(competenciasAtrasadas("2026-09")).toEqual([]);
  });

  it("em outubro, setembro; em novembro, setembro e outubro", () => {
    expect(competenciasAtrasadas("2026-10")).toEqual(["2026-09"]);
    expect(competenciasAtrasadas("2026-11")).toEqual(["2026-09", "2026-10"]);
  });

  it("a janela é de duas competências, e atravessa a virada do ano", () => {
    expect(competenciasAtrasadas("2027-01")).toEqual(["2026-11", "2026-12"]);
    expect(competenciasAtrasadas("2027-02", { janela: 3 })).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("janela zero ou competência ilegível: nada", () => {
    expect(competenciasAtrasadas("2026-12", { janela: 0 })).toEqual([]);
    expect(competenciasAtrasadas("dez/2026")).toEqual([]);
  });
});

// ── A escrita ───────────────────────────────────────────────────────────────

function dependencias(sobre: Partial<DependenciasDaEscrita> = {}) {
  const chamadas: Array<{ campos: Record<string, unknown>; parcelaId: string; autor: string; autorOrigem?: string }> = [];
  const deps: DependenciasDaEscrita = {
    lerParcela: async () => ({ paga: false }),
    salvar: async (args) => {
      chamadas.push(args as (typeof chamadas)[number]);
      return { alterados: 1, ok: true };
    },
    ...sobre,
  };
  return { chamadas, deps };
}

describe("aplicarBaixasDoHub", () => {
  it("grava em DUAS chamadas: recebido e data primeiro, o 'paga' depois, com o autor do hub", () => {
    // ⚠️ Numa chamada só, `salvarParcelaDoLsoft` troca o recebido pelo nominal ao virar paga.
    const { chamadas, deps } = dependencias();
    return aplicarBaixasDoHub(decidir().decisoes, { deps }).then((r) => {
      expect(r).toEqual({ adiadas: 0, aplicadas: 1, falhas: [], puladas: 0 });
      expect(chamadas).toEqual([
        {
          autor: "Hub · boleto Asaas pay_1",
          autorOrigem: "careli",
          campos: { data_recebido: "2026-09-09", valor_recebido: "2201.02" },
          parcelaId: "p1",
        },
        { autor: "Hub · boleto Asaas pay_1", autorOrigem: "careli", campos: { paga: "true" }, parcelaId: "p1" },
      ]);
    });
  });

  it("a parcela de dois lotes é gravada UMA vez, com a soma e as duas cobranças no autor", async () => {
    const r = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [
        pagamento({ cobrancaId: "pay_1", unidade: "Q90-L01", valorPago: 2207.18 }),
        pagamento({ cobrancaId: "pay_2", unidade: "Q90-L02", valorPago: 2207.18 }),
      ],
      parcelas: [parcela({ observacoes: "LOTE: 901 E 902" })],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    });
    const { chamadas, deps } = dependencias();
    const escrita = await aplicarBaixasDoHub(r.decisoes, { deps });
    expect(escrita.aplicadas).toBe(1);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toMatchObject({
      autor: "Hub · boleto Asaas pay_1 + pay_2",
      campos: { valor_recebido: "4414.36" },
    });
  });

  it("parcela paga por outra mão entre a leitura e a escrita: não é tocada", async () => {
    const { chamadas, deps } = dependencias({ lerParcela: async () => ({ paga: true }) });
    const r = await aplicarBaixasDoHub(decidir().decisoes, { deps });
    expect(r.puladas).toBe(1);
    expect(chamadas).toEqual([]);
  });

  it("não grava ja_paga nem conferir", async () => {
    const { chamadas, deps } = dependencias();
    await aplicarBaixasDoHub(decidir({ parcelas: [parcela({ paga: true, valorRecebido: 1 })] }).decisoes, { deps });
    await aplicarBaixasDoHub(decidir({ documentos: [] }).decisoes, { deps });
    expect(chamadas).toEqual([]);
  });

  it("a falha de uma não para as outras, e a falha no 'paga' diz que o recebido ficou gravado", async () => {
    const decisoes = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [pagamento({ cobrancaId: "pay_1", unidade: "Q90-L01" }), pagamento({ cobrancaId: "pay_2", unidade: "Q90-L02" })],
      parcelas: [parcela({ id: "p1" }), parcela({ id: "p2", lote: "902", observacoes: null })],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    }).decisoes;
    let chamada = 0;
    const { deps } = dependencias({
      salvar: async () => {
        chamada += 1;
        // A 1ª baixa falha já no recebido; a 2ª grava o recebido e falha no "paga".
        if (chamada === 1) return { erro: "rede", ok: false };
        if (chamada === 3) return { erro: "timeout", ok: false };
        return { alterados: 1, ok: true };
      },
    });
    const r = await aplicarBaixasDoHub(decisoes, { deps });
    expect(r.aplicadas).toBe(0);
    expect(r.falhas).toEqual([
      { cobrancas: "pay_1", erro: "rede" },
      { cobrancas: "pay_2", erro: "Recebido gravado, mas a parcela não foi marcada como paga: timeout" },
    ]);
  });

  it("o limite e o prazo adiam o resto para a próxima rodada", async () => {
    const decisoes = decidir({
      documentos: [doc("Q90 L01"), doc("Q90 L02")],
      pagamentos: [pagamento({ cobrancaId: "pay_1", unidade: "Q90-L01" }), pagamento({ cobrancaId: "pay_2", unidade: "Q90-L02" })],
      parcelas: [parcela({ id: "p1" }), parcela({ id: "p2", lote: "902", observacoes: null })],
      series: [serie("Q90 L01"), serie("Q90 L02")],
    }).decisoes;
    const noLimite = await aplicarBaixasDoHub(decisoes, { deps: dependencias().deps, limite: 1 });
    expect(noLimite).toMatchObject({ adiadas: 1, aplicadas: 1 });
    const semPrazo = await aplicarBaixasDoHub(decisoes, { deps: dependencias().deps, prazo: Date.now() - 1 });
    expect(semPrazo).toMatchObject({ adiadas: 2, aplicadas: 0 });
  });
});

describe("o autor da trilha", () => {
  it("vai e volta, com uma ou duas cobranças; autor de gente não é do hub", () => {
    expect(cobrancasDoAutor(autorDaBaixa(["pay_1"]))).toEqual(["pay_1"]);
    expect(cobrancasDoAutor(autorDaBaixa(["pay_2", "pay_1"]))).toEqual(["pay_1", "pay_2"]);
    expect(cobrancasDoAutor("Fulano (cecilio-rocha)")).toEqual([]);
    expect(cobrancasDoAutor(null)).toEqual([]);
  });
});

// ── O mapa de verdade ───────────────────────────────────────────────────────

describe("MAPA_DO_GARDEN (o retrato conferido de 29/09/2026)", () => {
  it("o caso do print: Q12 L26 é o antigo 397 e Q12 L29 é o 400, com hífen ou espaço", () => {
    expect(MAPA_DO_GARDEN.antigoDoNovo("Q12 L26")).toBe("397");
    expect(MAPA_DO_GARDEN.antigoDoNovo("Q12 L29")).toBe("400");
    expect(MAPA_DO_GARDEN.novoDoAntigo("397")).toBe("Q12 L26");
    expect(MAPA_DO_GARDEN.novoDoAntigo("0400")).toBe("Q12 L29");
  });

  it("lote que não está no mapa volta nulo", () => {
    expect(MAPA_DO_GARDEN.antigoDoNovo("Q99 L99")).toBeNull();
    expect(MAPA_DO_GARDEN.novoDoAntigo("99999")).toBeNull();
  });
});
