import { afterEach, describe, expect, it, vi } from "vitest";

// A CARTEIRA DO LSOFT NO FINANCEIRO DO PORTAL (29/09/2026): as partes puras, a soma com o C2X e a
// leitura com um banco de mentira. Tudo sintético: nenhum nome, CPF ou código de cliente real.
//
// O servidor do Apolo arrasta MySQL e metade do Panteon; aqui só interessa o cliente do Supabase,
// que o dublê abaixo substitui (fora dos testes da leitura ele é `null`).
const duble = vi.hoisted(() => ({ banco: null as unknown }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => duble.banco }));

import type { ApoloCarteiraSummary } from "@/lib/apolo/carteira";
import type { CatalogoParaId } from "@/lib/apolo/c2x-pelo-id";

import {
  carteiraDoLsoftNoRecorte,
  codigoDaUnidade,
  diasEntre,
  EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO,
  juntarNaCarteira,
  lerCarteiraDoLsoftNoFinanceiro,
  loteDoCliente,
  type LoteDoBoleto,
  montarCarteiraDoLsoft,
  type ParcelaDaCarteiraNoFinanceiro,
  quadraELoteDoBoleto,
  recorteDoLsoft,
  resumoVazio,
  somarResumos,
} from "./carteira-no-financeiro";

const GARDEN = EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO[0]!;

afterEach(() => {
  duble.banco = null;
  vi.restoreAllMocks();
});

// ── O lote do boleto ────────────────────────────────────────────────────────

describe("quadraELoteDoBoleto", () => {
  it("lê o formato da planilha de boletos e as variações de digitação", () => {
    expect(quadraELoteDoBoleto("Q06 L14")).toEqual({ lote: "14", quadra: "06" });
    expect(quadraELoteDoBoleto("Q6-L14")).toEqual({ lote: "14", quadra: "06" });
    expect(quadraELoteDoBoleto("q06 l4")).toEqual({ lote: "04", quadra: "06" });
    expect(quadraELoteDoBoleto(" Q13 L365 ")).toEqual({ lote: "365", quadra: "13" });
  });

  it("recusa o que não é quadra e lote (o código solto que existe na tabela)", () => {
    expect(quadraELoteDoBoleto("00000487")).toBeNull();
    expect(quadraELoteDoBoleto("")).toBeNull();
    expect(quadraELoteDoBoleto("APTO 205 · BL 04")).toBeNull();
  });
});

describe("codigoDaUnidade", () => {
  it("monta o código do C2X e do masterplan: prefixo + quadra(2) + lote(2)", () => {
    expect(codigoDaUnidade("GDN", "06", "14")).toBe("GDN0614");
    expect(codigoDaUnidade("GDN", "01", "01")).toBe("GDN0101");
  });
});

describe("loteDoCliente", () => {
  const lote = (documento: string, unidade: string, incerta = false): LoteDoBoleto => ({
    documento,
    incerta,
    unidade,
  });

  it("casa pelo CPF só dígitos, com ou sem máscara dos dois lados", () => {
    const r = loteDoCliente({
      cpf: "111.111.111-11",
      lotes: [lote("11111111111", "Q06 L14"), lote("22222222222", "Q07 L01")],
      quadrasNoLsoft: new Set(),
    });
    expect(r).toEqual({ outros: [], principal: { incerta: false, lote: "14", quadra: "06" } });
  });

  it("sem boleto no CPF (ou sem CPF), não há lote: a tela diz 'lote a confirmar'", () => {
    const lotes = [lote("22222222222", "Q07 L01")];
    expect(loteDoCliente({ cpf: "11111111111", lotes, quadrasNoLsoft: new Set() }).principal).toBeNull();
    expect(loteDoCliente({ cpf: null, lotes, quadrasNoLsoft: new Set() }).principal).toBeNull();
    // Um rótulo que não é lote não vira lote.
    expect(
      loteDoCliente({ cpf: "11111111111", lotes: [lote("11111111111", "00000487")], quadrasNoLsoft: new Set() })
        .principal,
    ).toBeNull();
  });

  it("dois lotes: mostra um e cita o outro, em ordem de quadra e lote", () => {
    const r = loteDoCliente({
      cpf: "11111111111",
      lotes: [lote("11111111111", "Q04 L14"), lote("11111111111", "Q04 L13")],
      quadrasNoLsoft: new Set(),
    });
    expect(r.principal).toEqual({ incerta: false, lote: "13", quadra: "04" });
    expect(r.outros).toEqual(["Q04 L14"]);
  });

  it("o lote de conversão certa vence o incerto, mesmo vindo depois na ordem", () => {
    // O caso medido em 29/09/2026: um segundo lote no mesmo CPF, incerto e de outra quadra.
    const r = loteDoCliente({
      cpf: "11111111111",
      lotes: [lote("11111111111", "Q07 L28", true), lote("11111111111", "Q13 L20")],
      quadrasNoLsoft: new Set(),
    });
    expect(r.principal).toEqual({ incerta: false, lote: "20", quadra: "13" });
    // O outro lote é citado, mas marcado: ninguém confirmou que ele é deste cliente.
    expect(r.outros).toEqual(["Q07 L28 (em conferência)"]);
  });

  it("entre dois lotes certos, vence o da quadra que o LSoft conhece", () => {
    const r = loteDoCliente({
      cpf: "11111111111",
      lotes: [lote("11111111111", "Q07 L10"), lote("11111111111", "Q08 L07")],
      quadrasNoLsoft: new Set([8]),
    });
    expect(r.principal).toEqual({ incerta: false, lote: "07", quadra: "08" });
    expect(r.outros).toEqual(["Q07 L10"]);
  });

  it("o único lote, mesmo incerto, é o principal, e a marca segue junto", () => {
    const r = loteDoCliente({
      cpf: "11111111111",
      lotes: [lote("11111111111", "Q17 L02", true)],
      quadrasNoLsoft: new Set([17]),
    });
    expect(r.principal).toEqual({ incerta: true, lote: "02", quadra: "17" });
  });
});

describe("diasEntre", () => {
  it("é o datediff do MySQL, em dias corridos", () => {
    expect(diasEntre("2026-09-28", "2026-09-29")).toBe(1);
    expect(diasEntre("2026-03-10", "2026-09-29")).toBe(203);
    expect(diasEntre("2026-09-29", "2026-09-29")).toBe(0);
    expect(diasEntre("lixo", "2026-09-29")).toBe(0);
  });
});

// ── A carteira montada ──────────────────────────────────────────────────────

const HOJE = "2026-09-29";

let proximoId = 0;
function parcela(
  clienteCodigo: string,
  valor: number,
  vencimento: null | string,
  extra: Partial<ParcelaDaCarteiraNoFinanceiro> = {},
): ParcelaDaCarteiraNoFinanceiro {
  proximoId += 1;
  return {
    clienteCodigo,
    dataRecebido: null,
    id: `p-${proximoId}`,
    paga: false,
    quadra: null,
    valor,
    valorRecebido: 0,
    vencimento,
    ...extra,
  };
}

describe("montarCarteiraDoLsoft", () => {
  const base = {
    hoje: HOJE,
    lotes: [
      { documento: "11111111111", incerta: false, unidade: "Q06 L14" },
      { documento: "22222222222", incerta: false, unidade: "Q04 L13" },
      { documento: "22222222222", incerta: false, unidade: "Q04 L14" },
    ],
    nomeDoEmpreendimento: "Garden",
    prefixoDoCodigo: "GDN",
  };

  it("cada campo: pago e recuperação pelo recebido, a receber, vencido e previsto pelo nominal", () => {
    const { summary, units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas: [
        // Paga no mês corrente, com desconto: entra no Pago e na Recuperação pelo RECEBIDO (990),
        // e no previsto pelo nominal (1.000).
        parcela("C1", 1000, "2026-09-10", { dataRecebido: "2026-09-12", paga: true, valorRecebido: 990 }),
        // Paga em agosto: Pago sim, Recuperação não.
        parcela("C1", 1000, "2026-08-10", { dataRecebido: "2026-08-11", paga: true, valorRecebido: 1000 }),
        // Vencida: a mais antiga dá o maior atraso.
        parcela("C1", 500, "2026-07-10"),
        parcela("C1", 500, "2026-09-28"),
        // Vence HOJE: a receber (o C2X só vence com due_date < hoje), mas já no previsto.
        parcela("C1", 700, HOJE),
        // Futura.
        parcela("C1", 800, "2026-12-10"),
      ],
    });

    expect(units).toHaveLength(1);
    const [u] = units;
    expect(u).toMatchObject({
      avisos: [],
      block: "06",
      client: "Cliente Um",
      code: "GDN0614",
      contractCode: null,
      empreendimento: "Garden",
      faturadoAt: null,
      id: "lsoft:C1",
      imobiliaria: null,
      liquido: null,
      lot: "14",
      lsoftCodigo: "C1",
      maxOverdueDays: diasEntre("2026-07-10", HOJE),
      origem: "lsoft",
      overdueAmount: 1000,
      overdueInstallments: 2,
      paidAmount: 1990,
      temContrato: false,
      toReceiveAmount: 1500,
      totalContract: 4490,
    });
    // O fechamento: VGV = pago + a receber + vencido.
    expect(u!.paidAmount + u!.toReceiveAmount + u!.overdueAmount).toBe(u!.totalContract);

    expect(summary).toEqual({
      clients: 1,
      contracts: 1,
      criticalContracts: 0,
      // 1.000 vencidos sobre 3.700 previstos até hoje (2.000 NOMINAIS pagos + 1.000 vencidos + 700
      // de hoje): o previsto é o que era devido, e não o que entrou.
      delinquencyRate: 1000 / 3700,
      expectedToDate: 3700,
      overdueAmount: 1000,
      overdueClients: 1,
      overdueInstallments: 2,
      paidAmount: 1990,
      recoveryAmount: 990,
      toReceiveAmount: 1500,
      totalPortfolio: 4490,
    });
  });

  it("⚠️ 'copiar e colar': Recebido e Carteira total iguais aos da tela LSoft Integração (view 0107)", () => {
    // A régua da tela LSoft (CarteiraLsoft.tsx): Recebido = soma do `valor_recebido` das pagas
    // (`total_recebido` da 0107); Carteira total = saldo aberto (nominal das abertas) + recebido.
    // Quem pagou atrasado recebeu com juros; quem pagou antes, com desconto. O Financeiro não pode
    // mudar esse número na colagem (Lucas, 29/09/2026: *"é só copiar e colar na carteira"*).
    const parcelas = [
      parcela("C1", 1000, "2026-05-10", { dataRecebido: "2026-06-02", paga: true, valorRecebido: 1037.4 }),
      parcela("C1", 1000, "2026-06-10", { dataRecebido: "2026-06-01", paga: true, valorRecebido: 950 }),
      parcela("C1", 1000, "2026-07-10", { dataRecebido: "2026-07-10", paga: true, valorRecebido: 1000 }),
      parcela("C1", 1000, "2026-08-10"),
      parcela("C1", 1000, "2027-01-10"),
      parcela("C2", 500, "2026-09-10", { dataRecebido: "2026-09-15", paga: true, valorRecebido: 512.35 }),
      parcela("C2", 500, "2026-12-10"),
    ];
    const totalRecebido = 1037.4 + 950 + 1000 + 512.35;
    const saldoAberto = 1000 + 1000 + 500;

    const { summary, units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [
        { codigo: "C1", cpf: "11111111111", nome: "Cliente Um" },
        { codigo: "C2", cpf: "22222222222", nome: "Cliente Dois" },
      ],
      parcelas,
    });

    expect(summary.paidAmount).toBe(Math.round(totalRecebido * 100) / 100);
    expect(summary.totalPortfolio).toBe(Math.round((saldoAberto + totalRecebido) * 100) / 100);
    expect(summary.toReceiveAmount + summary.overdueAmount).toBe(saldoAberto);
    // A linha bate com a soma do "Recebido" da ficha do cliente, parcela a parcela.
    expect(units.find((u) => u.lsoftCodigo === "C1")?.paidAmount).toBe(2987.4);
    expect(units.find((u) => u.lsoftCodigo === "C2")?.paidAmount).toBe(512.35);
  });

  it("parcela confirmada como subsídio da Caixa sai da carteira do cliente (a régua da 0107)", () => {
    const daCaixa = parcela("C1", 50_000, "2026-01-10");
    const { summary } = montarCarteiraDoLsoft({
      ...base,
      caixa: new Set([daCaixa.id]),
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas: [daCaixa, parcela("C1", 100, "2026-12-10")],
    });
    expect(summary.totalPortfolio).toBe(100);
    expect(summary.overdueAmount).toBe(0);
  });

  it("mais de 3 vencidas é contrato crítico, como no C2X", () => {
    const { summary } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas: ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((v) => parcela("C1", 10, v)),
    });
    expect(summary.criticalContracts).toBe(1);
    expect(summary.overdueInstallments).toBe(4);
  });

  it("dois lotes no CPF: uma linha, o dinheiro inteiro, e o outro lote citado", () => {
    const { units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C2", cpf: "22222222222", nome: "Cliente Dois" }],
      parcelas: [parcela("C2", 100, "2026-12-10"), parcela("C2", 100, "2027-01-10")],
    });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ code: "GDN0413", totalContract: 200 });
    expect(units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q04 L14."]);
  });

  it("sem boleto no CPF: 'lote a confirmar', sem quadra nem lote inventados", () => {
    const { units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C3", cpf: "33333333333", nome: "Cliente Três" }],
      parcelas: [parcela("C3", 100, "2026-12-10")],
    });
    expect(units[0]).toMatchObject({ block: null, code: "Lote a confirmar", lot: null });
    expect(units[0]!.avisos).toEqual(["Lote a confirmar: não há boleto do Garden neste CPF."]);
  });

  it("lote incerto no boleto: a linha avisa que o lote está em conferência", () => {
    const { units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C4", cpf: "44444444444", nome: "Cliente Quatro" }],
      lotes: [{ documento: "44444444444", incerta: true, unidade: "Q17 L02" }],
      parcelas: [parcela("C4", 100, "2026-12-10")],
    });
    expect(units[0]!.code).toBe("GDN1702");
    expect(units[0]!.avisos).toEqual([
      "Lote em conferência: a troca do lote antigo pelo novo ainda tem dúvida.",
    ]);
  });

  it("cliente marcado sem parcela no empreendimento não vira linha vazia; código repetido não conta duas vezes", () => {
    const { summary, units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [
        { codigo: "C1", cpf: "11111111111", nome: "Cliente Um" },
        { codigo: "C1", cpf: "11111111111", nome: "Cliente Um" },
        { codigo: "C9", cpf: null, nome: "Sem parcela" },
      ],
      parcelas: [parcela("C1", 100, "2026-12-10"), parcela("OUTRO", 999, "2026-12-10")],
    });
    expect(units.map((u) => u.id)).toEqual(["lsoft:C1"]);
    expect(summary).toMatchObject({ clients: 1, contracts: 1, totalPortfolio: 100 });
  });

  it("soma no centavo: milhares de parcelas quebradas não deixam resíduo de ponto flutuante", () => {
    const parcelas = Array.from({ length: 3000 }, () => parcela("C1", 0.1, "2027-01-10"));
    const { summary } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas,
    });
    expect(summary.totalPortfolio).toBe(300);
    expect(summary.toReceiveAmount).toBe(300);
  });

  it("carteira sem vencimento algum: inadimplência zero, e não divisão por zero", () => {
    const { summary } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas: [parcela("C1", 100, "2027-01-10"), parcela("C1", 100, null)],
    });
    expect(summary.delinquencyRate).toBe(0);
    expect(summary.expectedToDate).toBe(0);
    // Sem vencimento conta como a receber, nunca como vencido.
    expect(summary.toReceiveAmount).toBe(200);
  });
});

// ── A soma com o C2X (item 2) ───────────────────────────────────────────────

const resumo = (parcial: Partial<ApoloCarteiraSummary>): ApoloCarteiraSummary => ({
  ...resumoVazio(),
  ...parcial,
});

describe("somarResumos", () => {
  it("soma os absolutos e RECALCULA a inadimplência sobre a soma, nunca a média dos percentuais", () => {
    // C2X: 100 vencidos sobre 1.000 previstos (10%). LSoft: 0 sobre 9.000 (0%).
    // Média dos percentuais daria 5%; o certo é 100 / 10.000 = 1%.
    const c2x = resumo({
      clients: 3,
      contracts: 4,
      criticalContracts: 1,
      delinquencyRate: 0.1,
      expectedToDate: 1000,
      overdueAmount: 100,
      overdueClients: 1,
      overdueInstallments: 2,
      paidAmount: 900,
      recoveryAmount: 50,
      toReceiveAmount: 5000,
      totalPortfolio: 6000,
    });
    const lsoft = resumo({
      clients: 2,
      contracts: 2,
      expectedToDate: 9000,
      paidAmount: 9000,
      recoveryAmount: 10,
      toReceiveAmount: 20_000,
      totalPortfolio: 29_000,
    });

    const soma = somarResumos(c2x, lsoft);
    expect(soma).toEqual({
      clients: 5,
      contracts: 6,
      criticalContracts: 1,
      delinquencyRate: 0.01,
      expectedToDate: 10_000,
      overdueAmount: 100,
      overdueClients: 1,
      overdueInstallments: 2,
      paidAmount: 9900,
      recoveryAmount: 60,
      toReceiveAmount: 25_000,
      totalPortfolio: 35_000,
    });
    expect(soma.delinquencyRate).not.toBe((c2x.delinquencyRate + lsoft.delinquencyRate) / 2);
  });

  it("não herda a taxa de nenhum dos lados: previsto zero dá zero", () => {
    const soma = somarResumos(resumo({ delinquencyRate: 0.5 }), resumo({ delinquencyRate: 0.5 }));
    expect(soma.delinquencyRate).toBe(0);
  });

  it("soma no centavo", () => {
    const soma = somarResumos(resumo({ paidAmount: 0.1 }), resumo({ paidAmount: 0.2 }));
    expect(soma.paidAmount).toBe(0.3);
  });
});

describe("juntarNaCarteira", () => {
  it("sem LSoft, devolve a carteira do C2X intacta (o mesmo objeto)", () => {
    const c2x = { summary: resumo({ totalPortfolio: 10 }), units: [{ id: "1" }] };
    expect(juntarNaCarteira(c2x, null)).toBe(c2x);
  });

  it("com LSoft, soma o resumo e põe as unidades do LSoft depois das do C2X", () => {
    const junta = juntarNaCarteira(
      { summary: resumo({ expectedToDate: 100, overdueAmount: 50, totalPortfolio: 100 }), units: [{ id: "1" }] },
      { summary: resumo({ expectedToDate: 400, totalPortfolio: 400 }), units: [{ id: "lsoft:C1" }] },
    );
    expect(junta.units.map((u) => u.id)).toEqual(["1", "lsoft:C1"]);
    expect(junta.summary.totalPortfolio).toBe(500);
    expect(junta.summary.delinquencyRate).toBe(0.1);
  });
});

// ── O recorte: o que vai ao C2X e o que vem do LSoft ────────────────────────

describe("recorteDoLsoft", () => {
  const catalogo: CatalogoParaId = [
    { codes: ["GDN"], id: "39", stageIds: ["39"] },
    { codes: ["VOC", "VOL"], id: "group:Vale do Ouro", stageIds: ["37", "36"] },
  ];

  it("com o Garden no recorte: o 39 e a sigla dele saem do C2X e vão para o LSoft", () => {
    const r = recorteDoLsoft({ catalogo, codes: ["GDN", "VOC", "VOL"], ids: [36, 37, 39] });
    expect(r.idsDoC2x).toEqual([36, 37]);
    expect(r.codesDoC2x).toEqual(["VOC", "VOL"]);
    expect(r.noRecorte).toEqual([{ codes: ["GDN"], empreendimento: GARDEN }]);
  });

  it("só o Garden: nada vai ao C2X", () => {
    const r = recorteDoLsoft({ catalogo, codes: ["GDN"], ids: [39] });
    expect(r.idsDoC2x).toEqual([]);
    expect(r.codesDoC2x).toEqual([]);
    expect(r.noRecorte).toHaveLength(1);
  });

  it("sem o Garden: ids e siglas saem exatamente como entraram", () => {
    const r = recorteDoLsoft({ catalogo, codes: ["VOC"], ids: [37] });
    expect(r).toEqual({ codesDoC2x: ["VOC"], idsDoC2x: [37], noRecorte: [] });
  });

  it("sigla que o catálogo não traduz fica com o C2X (ele devolve zero); o id decide o recorte", () => {
    const r = recorteDoLsoft({ catalogo, codes: ["GDX"], ids: [39] });
    expect(r.idsDoC2x).toEqual([]);
    expect(r.codesDoC2x).toEqual(["GDX"]);
    expect(r.noRecorte).toEqual([{ codes: [], empreendimento: GARDEN }]);
  });
});

// ── A leitura, com um banco de mentira ──────────────────────────────────────

type Linha = Record<string, unknown>;
type Tabela = { erro?: { code?: string; message: string }; linhas?: Linha[] };

/**
 * Um Supabase de mentira: aplica `eq`, `in` e `contains`, ordena pelo campo pedido e pagina pelo
 * `range`, com a contagem exata na primeira página. É o bastante para a leitura provar que leu tudo.
 *
 * ⚠️ ELE CASTIGA O QUE O POSTGREST CASTIGA (revisão de 29/09/2026). Sem `.order()`, cada página sai
 * de uma ordem diferente (crescente nas chamadas pares, decrescente nas ímpares), e a leitura que
 * esqueceu a ordem repete linha entre páginas, como o PostgREST fez em `lsoft_parcelas` em
 * 24/09/2026. E o `log` guarda a coluna de cada `.order()` e o tamanho de cada `.in()`, para o teste
 * afirmar a chave única e o lote de 100: um falso que ordena sozinho e aceita `.in()` de qualquer
 * tamanho deixava os dois defeitos passarem verdes.
 */
function bancoFalso(tabelas: Record<string, Tabela>) {
  const log = {
    ins: [] as Array<{ tabela: string; tamanho: number }>,
    ordens: [] as Array<{ coluna: string; tabela: string }>,
  };
  let chamadas = 0;
  return {
    from(nome: string) {
      const tabela = tabelas[nome] ?? { linhas: [] };
      const filtros: Array<(linha: Linha) => boolean> = [];
      let ordem: null | string = null;
      const consulta = {
        contains(coluna: string, valores: unknown[]) {
          filtros.push((l) => valores.every((v) => ((l[coluna] as unknown[]) ?? []).includes(v)));
          return consulta;
        },
        eq(coluna: string, valor: unknown) {
          filtros.push((l) => l[coluna] === valor);
          return consulta;
        },
        in(coluna: string, valores: unknown[]) {
          log.ins.push({ tabela: nome, tamanho: valores.length });
          filtros.push((l) => valores.includes(l[coluna]));
          return consulta;
        },
        order(coluna: string) {
          log.ordens.push({ coluna, tabela: nome });
          ordem = coluna;
          return consulta;
        },
        async range(de: number, ate: number) {
          if (tabela.erro) return { count: null, data: null, error: tabela.erro };
          const chave = ordem ?? "id";
          const todas = (tabela.linhas ?? [])
            .filter((l) => filtros.every((f) => f(l)))
            .sort((a, b) => String(a[chave]).localeCompare(String(b[chave])));
          chamadas += 1;
          if (ordem === null && chamadas % 2 === 0) todas.reverse();
          return { count: todas.length, data: todas.slice(de, ate + 1), error: null };
        },
        select() {
          return consulta;
        },
      };
      return consulta;
    },
    log,
  };
}

describe("o banco de mentira castiga a leitura sem ordem", () => {
  it("sem .order(), duas páginas seguidas repetem linha (e com ordem, não)", async () => {
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ id: `p-${String(i).padStart(4, "0")}` }));

    const semOrdem = bancoFalso({ t: { linhas } });
    const a = await semOrdem.from("t").select().range(0, 999);
    const b = await semOrdem.from("t").select().range(1000, 1999);
    const idsSemOrdem = [...(a.data ?? []), ...(b.data ?? [])].map((l) => l.id);
    expect(new Set(idsSemOrdem).size).toBeLessThan(idsSemOrdem.length);

    const comOrdem = bancoFalso({ t: { linhas } });
    const c = await comOrdem.from("t").select().order("id").range(0, 999);
    const d = await comOrdem.from("t").select().order("id").range(1000, 1999);
    const idsComOrdem = [...(c.data ?? []), ...(d.data ?? [])].map((l) => l.id);
    expect(new Set(idsComOrdem).size).toBe(1500);
  });
});

const clienteDoBanco = (codigo: string, cpf: string, naCarteira: string[] = ["Garden"]) => ({
  codigo,
  cpf,
  empreendimentos_na_carteira: naCarteira,
  nome: `Cliente ${codigo}`,
});

const parcelaDoBanco = (id: string, cliente: string, valor: number, vencimento: string, extra: Linha = {}) => ({
  categoria_lsoft: 124,
  cliente_codigo: cliente,
  data_recebido: null,
  empreendimento: "Garden",
  id,
  paga: false,
  quadra: "06",
  valor: String(valor),
  valor_recebido: "0",
  vencimento,
  ...extra,
});

describe("lerCarteiraDoLsoftNoFinanceiro", () => {
  const ler = () => lerCarteiraDoLsoftNoFinanceiro({ empreendimento: GARDEN, hoje: HOJE, nome: "Garden" });

  it("antes da migration 0199 (coluna inexistente): carteira vazia, e a tela fica como hoje", async () => {
    duble.banco = bancoFalso({
      lsoft_clientes: {
        erro: {
          code: "42703",
          message: "column lsoft_clientes.empreendimentos_na_carteira does not exist",
        },
      },
    });
    const r = await ler();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.colunaAusente).toBe(true);
    expect(r.data.units).toEqual([]);
    expect(r.data.summary).toEqual(resumoVazio());
  });

  it("qualquer outra falha é falha, e não carteira vazia calada", async () => {
    duble.banco = bancoFalso({ lsoft_clientes: { erro: { message: "canceling statement due to statement timeout" } } });
    const r = await ler();
    expect(r).toEqual({ erro: "canceling statement due to statement timeout", ok: false });
  });

  it("falha nas parcelas derruba a leitura inteira (tudo ou nada)", async () => {
    duble.banco = bancoFalso({
      lsoft_clientes: { linhas: [clienteDoBanco("C1", "11111111111")] },
      lsoft_parcelas: { erro: { message: "rede" } },
    });
    expect((await ler()).ok).toBe(false);
  });

  it("lê só quem está na carteira, só o Garden da categoria 124, e casa o lote novo pelo CPF", async () => {
    duble.banco = bancoFalso({
      boletos_documentos: {
        linhas: [
          { documento: "11111111111", empreendimento: "garden", id: "b1", unidade: "Q06 L14", workspace_id: "careli" },
          { documento: "11111111111", empreendimento: "garden", id: "b2", unidade: "Q07 L28", workspace_id: "careli" },
        ],
      },
      boletos_parcelas: {
        linhas: [
          { empreendimento: "garden", id: "x1", unidade: "Q07 L28", unidade_incerta: true, workspace_id: "careli" },
        ],
      },
      lsoft_classificacao_de_parcela: { linhas: [] },
      lsoft_clientes: {
        linhas: [
          clienteDoBanco("C1", "111.111.111-11"),
          // Ainda na integração: não entra.
          clienteDoBanco("C2", "22222222222", []),
        ],
      },
      lsoft_parcelas: {
        linhas: [
          parcelaDoBanco("p1", "C1", 1000, "2026-08-10", { data_recebido: "2026-09-02", paga: true, valor_recebido: "1000" }),
          parcelaDoBanco("p2", "C1", 500, "2026-09-10"),
          parcelaDoBanco("p3", "C1", 700, "2026-12-10"),
          // Outro empreendimento do mesmo cliente: continua na integração.
          parcelaDoBanco("p4", "C1", 9999, "2026-01-10", { categoria_lsoft: 17, empreendimento: "Giant Towers" }),
          parcelaDoBanco("p5", "C2", 8888, "2026-01-10"),
        ],
      },
    });

    const r = await ler();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.units).toHaveLength(1);
    expect(r.data.units[0]).toMatchObject({
      code: "GDN0614",
      lsoftCodigo: "C1",
      overdueAmount: 500,
      paidAmount: 1000,
      toReceiveAmount: 700,
      totalContract: 2200,
    });
    expect(r.data.units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q07 L28 (em conferência)."]);
    expect(r.data.summary).toMatchObject({ clients: 1, recoveryAmount: 1000, totalPortfolio: 2200 });
  });
});

describe("lerCarteiraDoLsoftNoFinanceiro com muitos clientes e muitas parcelas", () => {
  it("lê em lotes de 100 e em páginas de 1.000 sem perder nem repetir parcela", async () => {
    // 150 clientes (2 lotes) com 12 parcelas cada: 1.800 parcelas, mais de uma página por lote.
    const clientes = Array.from({ length: 150 }, (_, i) => clienteDoBanco(`C${String(i).padStart(3, "0")}`, `9${i}`));
    const parcelas = clientes.flatMap((c, i) =>
      Array.from({ length: 12 }, (_, j) =>
        parcelaDoBanco(`p-${String(i).padStart(3, "0")}-${String(j).padStart(2, "0")}`, c.codigo, 10, "2027-01-10"),
      ),
    );
    const banco = bancoFalso({
      boletos_documentos: { linhas: [] },
      boletos_parcelas: { linhas: [] },
      lsoft_classificacao_de_parcela: { linhas: [] },
      lsoft_clientes: { linhas: clientes },
      lsoft_parcelas: { linhas: parcelas },
    });
    duble.banco = banco;

    const r = await lerCarteiraDoLsoftNoFinanceiro({ empreendimento: GARDEN, hoje: HOJE, nome: "Garden" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.units).toHaveLength(150);
    expect(r.data.summary.totalPortfolio).toBe(150 * 12 * 10);

    // ⚠️ O LOTE DE 100 NO `.in()`: 700 ids na URL já deram 400 nesta casa.
    const lotes = banco.log.ins.map((chamada) => chamada.tamanho);
    expect(lotes.length).toBeGreaterThan(0);
    expect(Math.max(...lotes)).toBeLessThanOrEqual(100);
    // ⚠️ TODA LEITURA PAGINADA ORDENA PELA CHAVE ÚNICA DA TABELA. Sem ordem fixa o PostgREST repete e
    // pula linha entre páginas e o total ainda bate (24/09/2026).
    const chaveUnica: Record<string, string> = {
      boletos_documentos: "id",
      boletos_parcelas: "id",
      lsoft_classificacao_de_parcela: "id",
      lsoft_clientes: "codigo",
      lsoft_parcelas: "id",
    };
    for (const [tabela, chave] of Object.entries(chaveUnica)) {
      const ordens = banco.log.ordens.filter((o) => o.tabela === tabela).map((o) => o.coluna);
      expect(ordens.length, `${tabela} foi lida`).toBeGreaterThan(0);
      expect(new Set(ordens), `${tabela} ordenada por ${chave}`).toEqual(new Set([chave]));
    }
  });
});

describe("carteiraDoLsoftNoRecorte", () => {
  it("a falha vira aviso para a tela, sem derrubar nada, e o detalhe técnico fica no log", async () => {
    duble.banco = bancoFalso({ lsoft_clientes: { erro: { message: "relation lsoft_x does not exist" } } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await carteiraDoLsoftNoRecorte({
      hoje: HOJE,
      noRecorte: [{ codes: ["GDN"], empreendimento: GARDEN }],
      nomePorCode: new Map([["GDN", "Garden"]]),
    });

    expect(r.carteira).toEqual({ summary: resumoVazio(), units: [] });
    expect(r.empreendimentos).toEqual(["Garden"]);
    expect(r.aviso).toBe(
      "Não foi possível ler a carteira do Garden agora. Ela ficou fora desta tela; tente de novo em alguns minutos.",
    );
    // A mensagem do banco NÃO vai para a tela do cliente externo.
    expect(r.aviso).not.toContain("relation");
    expect(log).toHaveBeenCalled();
  });

  it("sem Supabase configurado também é aviso, e não exceção", async () => {
    duble.banco = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await carteiraDoLsoftNoRecorte({
      hoje: HOJE,
      noRecorte: [{ codes: [], empreendimento: GARDEN }],
      nomePorCode: new Map(),
    });
    // Sem sigla no mapa, o nome é o padrão do empreendimento.
    expect(r.empreendimentos).toEqual(["Garden"]);
    expect(r.aviso).toContain("Garden");
  });
});
