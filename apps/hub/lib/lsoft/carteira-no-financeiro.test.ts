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
import { chaveDaLinhaDaCarteira } from "@/modules/incorporador/chave-da-linha";

import {
  carteiraDoLsoftNoRecorte,
  codigoDaUnidade,
  diasEntre,
  dividirPorLote,
  EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO,
  juntarNaCarteira,
  lerCarteiraDoLsoftNoFinanceiro,
  loteDoCliente,
  type LoteDoBoleto,
  montarCarteiraDoLsoft,
  type ParcelaDaCarteiraNoFinanceiro,
  partesIguaisEmCentavos,
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
    lote: null,
    observacoes: null,
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
    // O lote antigo 150 da quadra 6 é o Q06 L14 do boleto.
    const doLote = { lote: "150", quadra: "6" };
    const { summary, units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C1", cpf: "11111111111", nome: "Cliente Um" }],
      parcelas: [
        // Paga no mês corrente, com desconto: entra no Pago e na Recuperação pelo RECEBIDO (990),
        // e no previsto pelo nominal (1.000).
        parcela("C1", 1000, "2026-09-10", { ...doLote, dataRecebido: "2026-09-12", paga: true, valorRecebido: 990 }),
        // Paga em agosto: Pago sim, Recuperação não.
        parcela("C1", 1000, "2026-08-10", { ...doLote, dataRecebido: "2026-08-11", paga: true, valorRecebido: 1000 }),
        // Vencida: a mais antiga dá o maior atraso.
        parcela("C1", 500, "2026-07-10", doLote),
        parcela("C1", 500, "2026-09-28", doLote),
        // Vence HOJE: a receber (o C2X só vence com due_date < hoje), mas já no previsto.
        parcela("C1", 700, HOJE, doLote),
        // Futura.
        parcela("C1", 800, "2026-12-10", doLote),
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
      id: "lsoft:C1:GDN0614",
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

  it("dois lotes no CPF e as parcelas sem lote no LSoft: uma linha no principal; o outro lote é aviso, o 'sem lote' é nota", () => {
    const parcelas = [parcela("C2", 100, "2026-12-10"), parcela("C2", 100, "2027-01-10")];
    const { units } = montarCarteiraDoLsoft({
      ...base,
      clientes: [{ codigo: "C2", cpf: "22222222222", nome: "Cliente Dois" }],
      parcelas,
    });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ code: "GDN0413", totalContract: 200 });
    // ⚠️ O defeito do LSoft não vai para a tela do loteador: fica na nota, para o time adm.
    expect(units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q04 L14."]);
    expect(units[0]).not.toHaveProperty("notas");
    const [linha] = dividirPorLote({ cpf: "22222222222", lotes: base.lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual(["2 parcelas sem lote no LSoft."]);
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
      // O antigo 284 é o Q17 L02 (o mapa tem a quadra dele em branco).
      parcelas: [parcela("C4", 100, "2026-12-10", { lote: "284", quadra: "12" })],
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
      parcelas: [parcela("C1", 100, "2026-12-10", { lote: "150" }), parcela("OUTRO", 999, "2026-12-10")],
    });
    expect(units.map((u) => u.id)).toEqual(["lsoft:C1:GDN0614"]);
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

// ── Uma linha por lote (Lucas, 29/09/2026: "se ele tem dois lotes, tem que ter duas linhas") ──

describe("uma linha por (cliente, lote novo)", () => {
  // Os lotes do boleto de cada CPF sintético. Os números antigos são os do mapa real: 397 = Q12 L26,
  // 400 = Q12 L29, 216 = Q04 L14, 217 = Q04 L13, 287 = Q17 L03, 297 = Q16 L14, 179 = Q06 L18.
  const lotes: LoteDoBoleto[] = [
    { documento: "55555555555", incerta: false, unidade: "Q12 L26" },
    { documento: "55555555555", incerta: false, unidade: "Q12-L29" },
    { documento: "66666666666", incerta: false, unidade: "Q04 L13" },
    { documento: "66666666666", incerta: false, unidade: "Q04 L14" },
    { documento: "77777777777", incerta: false, unidade: "Q17 L03" },
    { documento: "88888888888", incerta: false, unidade: "Q13 L04" },
    { documento: "99999999999", incerta: false, unidade: "Q06 L18" },
  ];
  const montar = (clientes: Array<{ codigo: string; cpf: string }>, parcelas: ParcelaDaCarteiraNoFinanceiro[]) =>
    montarCarteiraDoLsoft({
      clientes: clientes.map((c) => ({ ...c, nome: `Cliente ${c.codigo}` })),
      hoje: HOJE,
      lotes,
      nomeDoEmpreendimento: "Garden",
      parcelas,
      prefixoDoCodigo: "GDN",
    });

  // O caso do print de 29/09: dois lotes no mesmo CPF, cada sequência "em partes" no seu lote.
  const L397 = { lote: "397", observacoes: "PARC. OBRA LOTE: 397 - QUADRA: 12", quadra: "12" };
  const L400 = { lote: "400", observacoes: "PARC. OBRA | LOTE: 400 - QUADRA: 12", quadra: "12" };
  const doisLotes = () => [
    parcela("C5", 2201.02, "2026-08-10", { ...L397, dataRecebido: "2026-08-09", paga: true, valorRecebido: 2201.02 }),
    parcela("C5", 2201.02, "2026-09-10", L397),
    parcela("C5", 2201.02, "2026-10-10", L397),
    parcela("C5", 2207.18, "2026-08-10", { ...L400, dataRecebido: "2026-09-08", paga: true, valorRecebido: 2207.18 }),
    parcela("C5", 2207.18, "2026-09-10", L400),
    parcela("C5", 2207.18, "2026-06-10", L400),
    parcela("C5", 2207.18, "2026-11-10", L400),
  ];

  it("dois lotes com parcelas próprias: duas linhas, cada uma com os números SÓ das parcelas dela", () => {
    const { summary, units } = montar([{ codigo: "C5", cpf: "555.555.555-55" }], doisLotes());

    expect(units.map((u) => u.code).sort()).toEqual(["GDN1226", "GDN1229"]);
    const l26 = units.find((u) => u.code === "GDN1226")!;
    const l29 = units.find((u) => u.code === "GDN1229")!;
    expect(l26).toMatchObject({
      avisos: [],
      block: "12",
      id: "lsoft:C5:GDN1226",
      lot: "26",
      lsoftCodigo: "C5",
      maxOverdueDays: diasEntre("2026-09-10", HOJE),
      overdueAmount: 2201.02,
      overdueInstallments: 1,
      paidAmount: 2201.02,
      toReceiveAmount: 2201.02,
      totalContract: 6603.06,
    });
    expect(l29).toMatchObject({
      avisos: [],
      block: "12",
      id: "lsoft:C5:GDN1229",
      lot: "29",
      lsoftCodigo: "C5",
      maxOverdueDays: diasEntre("2026-06-10", HOJE),
      overdueAmount: 4414.36,
      overdueInstallments: 2,
      paidAmount: 2207.18,
      toReceiveAmount: 2207.18,
      totalContract: 8828.72,
    });
    // ⚠️ O aviso "o mesmo CPF também tem o lote Q12 L29" deixou de existir: ele virou linha.
    expect(units.flatMap((u) => u.avisos)).toEqual([]);

    // Um cliente, dois contratos; a recuperação do mês só pega o pagamento de setembro.
    expect(summary).toMatchObject({
      clients: 1,
      contracts: 2,
      overdueClients: 1,
      overdueInstallments: 3,
      paidAmount: 4408.2,
      recoveryAmount: 2207.18,
    });
  });

  it("as duas linhas do mesmo cliente têm chave própria na tabela, e abrem a mesma ficha", () => {
    const { units } = montar([{ codigo: "C5", cpf: "55555555555" }], doisLotes());
    const chaves = units.map((u) => chaveDaLinhaDaCarteira(u));
    expect(new Set(chaves).size).toBe(2);
    expect(new Set(units.map((u) => u.lsoftCodigo))).toEqual(new Set(["C5"]));
  });

  it("⚠️ a partilha não cria nem some dinheiro: as linhas somam o mesmo que uma linha por cliente", () => {
    // Medido em 29/09/2026 nos 106 do Garden (a mesma conta, no banco): carteira R$ 35.041.558,35,
    // recebido R$ 4.484.836,13, em aberto R$ 30.556.722,22, antes e depois da partilha. Aqui, com
    // dados sintéticos: a mesma carteira montada com os lotes do boleto (várias linhas por cliente)
    // e sem boleto nenhum (uma linha por cliente, "Lote a confirmar") dá o mesmo dinheiro.
    const clientes = [
      { codigo: "C5", cpf: "55555555555" },
      { codigo: "C6", cpf: "66666666666" },
      { codigo: "C8", cpf: "88888888888" },
    ];
    const parcelas = [
      ...doisLotes(),
      parcela("C6", 1000.33, "2026-01-10", { lote: "216", observacoes: "LOTE: 216 E 217 QUADRA: 04" }),
      parcela("C6", 999.99, "2027-01-10", { lote: "216" }),
      parcela("C6", 10, "2026-02-10"),
      parcela("C8", 5000, "2026-05-10", { dataRecebido: "2026-05-10", lote: "377", paga: true, valorRecebido: 5100.5 }),
      parcela("C8", 10000, "2029-12-20", { lote: "297", observacoes: "LOTE 297 - QUADRA 16 - PARCELAS ANUAIS" }),
    ];
    const porLote = montar(clientes, parcelas);
    const porCliente = montarCarteiraDoLsoft({
      clientes: clientes.map((c) => ({ ...c, nome: c.codigo })),
      hoje: HOJE,
      lotes: [],
      nomeDoEmpreendimento: "Garden",
      parcelas,
      prefixoDoCodigo: "GDN",
    });

    expect(porCliente.units).toHaveLength(3);
    // C5: Q12 L26 e Q12 L29. C6: a sequência "216 E 217" repartida entre Q04 L13 e Q04 L14. C8: uma.
    expect(porLote.units).toHaveLength(5);
    const dinheiro = (s: ApoloCarteiraSummary) => ({
      expectedToDate: s.expectedToDate,
      overdueAmount: s.overdueAmount,
      paidAmount: s.paidAmount,
      recoveryAmount: s.recoveryAmount,
      toReceiveAmount: s.toReceiveAmount,
      totalPortfolio: s.totalPortfolio,
    });
    expect(dinheiro(porLote.summary)).toEqual(dinheiro(porCliente.summary));
    expect(porLote.summary.clients).toBe(3);
    expect(porLote.summary.contracts).toBe(5);
    // ⚠️ A QUANTIDADE de vencidas não é dinheiro: a vencida repartida conta uma vez em CADA lote,
    // como os dois boletos do hub (5 parcelas vencidas no LSoft, 6 nas linhas).
    expect(porCliente.summary.overdueInstallments).toBe(5);
    expect(porLote.summary.overdueInstallments).toBe(6);
    // E a soma das linhas fecha com o resumo, no centavo.
    const somaDasLinhas = porLote.units.reduce((soma, u) => soma + Math.round(u.totalContract * 100), 0) / 100;
    expect(somaDasLinhas).toBe(porLote.summary.totalPortfolio);
    // O centavo que sobra da divisão de 1.000,33 fica no lote da coluna (o 216, Q04 L14).
    const c6 = Object.fromEntries(porLote.units.filter((u) => u.lsoftCodigo === "C6").map((u) => [u.code, u]));
    expect(c6.GDN0414).toMatchObject({ overdueAmount: 500.17, totalContract: 1500.16 });
    expect(c6.GDN0413).toMatchObject({ overdueAmount: 510.16, totalContract: 510.16 });
  });

  it("⚠️ sequência conjunta de dois lotes do mesmo CPF: cada lote recebe metade de cada parcela, no centavo", () => {
    // O LSoft lança "LOTE: 216 E 217" como uma sequência só, com o 216 na coluna, e a parcela vale o
    // dobro da de um lote; o hub cobra um boleto por lote, de valor igual (medido em 29/09/2026).
    const { summary, units } = montar(
      [{ codigo: "C6", cpf: "66666666666" }],
      [
        parcela("C6", 4238.11, "2026-09-10", { lote: "216", observacoes: "LOTE: 216 E 217\r\nQUADRA: 04", quadra: "4" }),
        parcela("C6", 4238.1, "2026-08-10", {
          dataRecebido: "2026-09-02",
          lote: "216",
          observacoes: "LOTE: 216 E 217 QUADRA: 04",
          paga: true,
          quadra: "4",
          valorRecebido: 4300.01,
        }),
        parcela("C6", 4238.1, "2026-10-10", { lote: "216", observacoes: "LOTE: 216 E 217 QUADRA: 04", quadra: "4" }),
      ],
    );
    expect(units.map((u) => u.code).sort()).toEqual(["GDN0413", "GDN0414"]);
    const l13 = units.find((u) => u.code === "GDN0413")!;
    const l14 = units.find((u) => u.code === "GDN0414")!;
    // O centavo ímpar fica no lote da coluna (216 = Q04 L14), no nominal e no recebido.
    expect(l14).toMatchObject({
      id: "lsoft:C6:GDN0414",
      overdueAmount: 2119.06,
      overdueInstallments: 1,
      paidAmount: 2150.01,
      toReceiveAmount: 2119.05,
      totalContract: 6388.12,
    });
    expect(l13).toMatchObject({
      id: "lsoft:C6:GDN0413",
      overdueAmount: 2119.05,
      overdueInstallments: 1,
      paidAmount: 2150,
      toReceiveAmount: 2119.05,
      totalContract: 6388.1,
    });
    // O loteador vê o porquê da metade (a ficha que o clique abre mostra a parcela inteira), e o
    // outro lote do CPF não é repetido como "o mesmo CPF também tem".
    expect(l14.avisos).toEqual([
      "Parcelas divididas meio a meio com o lote Q04 L13: na ficha, os dois lotes estão numa parcela só.",
    ]);
    expect(l13.avisos).toEqual([
      "Parcelas divididas meio a meio com o lote Q04 L14: na ficha, os dois lotes estão numa parcela só.",
    ]);
    // Nenhum centavo nasce nem some: as duas linhas somam as três parcelas.
    expect(summary).toMatchObject({
      clients: 1,
      contracts: 2,
      overdueAmount: 4238.11,
      overdueClients: 1,
      overdueInstallments: 2,
      paidAmount: 4300.01,
      recoveryAmount: 4300.01,
      totalPortfolio: 12776.22,
    });
  });

  it("sequência conjunta de lotes de quadras diferentes (o texto 'LOTE: 122 E 93 QUADRA: 07 E 08') também é repartida", () => {
    const { units } = montarCarteiraDoLsoft({
      clientes: [{ codigo: "C3", cpf: "33333333333", nome: "Cliente C3" }],
      hoje: HOJE,
      lotes: [
        { documento: "33333333333", incerta: false, unidade: "Q07 L10" },
        { documento: "33333333333", incerta: false, unidade: "Q08 L07" },
      ],
      nomeDoEmpreendimento: "Garden",
      parcelas: [parcela("C3", 4238.1, "2027-01-10", { lote: "122", observacoes: "LOTE: 122 E 93 QUADRA: 07 E 08", quadra: "7" })],
      prefixoDoCodigo: "GDN",
    });
    expect(units.map((u) => [u.code, u.totalContract]).sort()).toEqual([
      ["GDN0710", 2119.05],
      ["GDN0807", 2119.05],
    ]);
  });

  it("⚠️ lote antigo sem número novo na sequência: a parcela fica INTEIRA no lote que existe, e o número antigo não vai ao loteador", () => {
    // Medido em 29/09/2026: nos 15 clientes com "LOTE: 90/91" e afins, o boleto é UM, do lote novo
    // que reuniu os antigos, e vale a parcela inteira. "(sem número novo)" enganava o loteador.
    const texto = "PARC. DE OBRA | LOTES: 287/288/289 - QUADRA: 17";
    const parcelas = [
      parcela("C7", 100, "2026-12-10", { observacoes: texto, quadra: "17" }),
      parcela("C7", 100, "2027-01-10", { observacoes: texto, quadra: "17" }),
    ];
    const { units } = montar([{ codigo: "C7", cpf: "77777777777" }], parcelas);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ avisos: [], code: "GDN1703", totalContract: 200 });
    const [linha] = dividirPorLote({ cpf: "77777777777", lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual(["As parcelas deste lote citam também os lotes antigos 288 e 289, que o mapa não converte."]);
  });

  it("sequência com um lote do CPF e um sem conversão não é repartida: fica no lote da coluna, e cita o outro lote do CPF só pelo número novo", () => {
    const parcelas = [
      parcela("C6", 300, "2026-12-10", { lote: "216", observacoes: "LOTE: 216 E 217 E 288 QUADRA: 04", quadra: "4" }),
    ];
    const { units } = montar([{ codigo: "C6", cpf: "66666666666" }], parcelas);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ code: "GDN0414", totalContract: 300 });
    // O Q04 L13 já está dito como coberto: não aparece de novo como "o mesmo CPF também tem".
    expect(units[0]!.avisos).toEqual(["As parcelas deste lote cobrem também o lote Q04 L13."]);
    const [linha] = dividirPorLote({ cpf: "66666666666", lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual(["As parcelas deste lote citam também o lote antigo 288, que o mapa não converte."]);
  });

  it("sequência que cita um lote que o boleto dá a outro CPF não é repartida: fica inteira, com nota e sem aviso", () => {
    // 297 = Q16 L14, que o boleto não liga ao 66666666666.
    const parcelas = [parcela("C6", 300, "2026-12-10", { lote: "216", observacoes: "LOTE: 216 E 297", quadra: "4" })];
    const { units } = montar([{ codigo: "C6", cpf: "66666666666" }], parcelas);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ code: "GDN0414", totalContract: 300 });
    expect(units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q04 L13."]);
    const [linha] = dividirPorLote({ cpf: "66666666666", lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual(["As parcelas deste lote citam também o lote Q16 L14, que o boleto não liga a este CPF."]);
  });

  it("sequência conjunta com um lote que também tem parcelas próprias: reparte, sem nenhum 'cobre também'", () => {
    const conjunta = { lote: "397", observacoes: "LOTE: 397 E 400 - QUADRA: 12", quadra: "12" };
    const { units } = montar(
      [{ codigo: "C5", cpf: "55555555555" }],
      [
        parcela("C5", 200, "2026-12-10", conjunta),
        parcela("C5", 200, "2027-01-10", conjunta),
        parcela("C5", 1000, "2027-02-10", L400),
      ],
    );
    const porCodigo = Object.fromEntries(units.map((u) => [u.code, u]));
    expect(porCodigo.GDN1226).toMatchObject({ totalContract: 200 });
    expect(porCodigo.GDN1229).toMatchObject({ totalContract: 1200 });
    expect(porCodigo.GDN1226!.avisos).toEqual([
      "Parcelas divididas meio a meio com o lote Q12 L29: na ficha, os dois lotes estão numa parcela só.",
    ]);
    // A linha do 400 tem parcela própria e parte repartida: o aviso diz quantas são repartidas.
    expect(porCodigo.GDN1229!.avisos).toEqual([
      "2 parcelas divididas meio a meio com o lote Q12 L26: na ficha, os dois lotes estão numa parcela só.",
    ]);
    expect(units.flatMap((u) => u.avisos).some((a) => a.includes("cobrem também"))).toBe(false);
  });

  it("'LOTEV 179' com a coluna vazia é o lote 179: vai para a linha dele, sem aviso de 'sem lote'", () => {
    const { units } = montar(
      [{ codigo: "C9", cpf: "99999999999" }],
      [
        parcela("C9", 100, "2026-12-10", { lote: "179", observacoes: "ENTRADA LOTE 179 - QUADRA 06", quadra: "6" }),
        parcela("C9", 50, "2027-12-20", { observacoes: "ENTRADA LOTEV 179 - QUADRA 06 - PARCELA ANUAL", quadra: "6" }),
      ],
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ avisos: [], code: "GDN0618", totalContract: 150 });
  });

  it("⚠️ lote que o boleto não liga ao CPF não vira linha: vai para o principal, com nota (e não aviso)", () => {
    // O caso medido em 29/09/2026: 2 parcelas anuais de um cliente lançadas no lote de outro.
    const parcelas = [
      parcela("C8", 1000, "2026-12-20", { lote: "377", observacoes: "LOTE 377 - QUADRA 13 - PARCELAS ANUAIS", quadra: "13" }),
      parcela("C8", 1000, "2029-12-20", { lote: "297", observacoes: "LOTE 297 - QUADRA 16 - PARCELAS ANUAIS", quadra: "16" }),
      parcela("C8", 1000, "2031-12-20", { lote: "297", observacoes: "LOTE 297 - QUADRA 16 - PARCELAS ANUAIS", quadra: "16" }),
    ];
    const { units } = montar([{ codigo: "C8", cpf: "88888888888" }], parcelas);
    expect(units).toHaveLength(1);
    // O erro de digitação do LSoft (o lote de outro comprador) não vai para a tela do loteador.
    expect(units[0]).toMatchObject({ avisos: [], code: "GDN1304", totalContract: 3000 });
    const [linha] = dividirPorLote({ cpf: "88888888888", lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual(["2 parcelas no LSoft com o lote Q16 L14, que o boleto não liga a este CPF."]);
  });

  it("lote fora do mapa e parcela sem lote vão para o principal, cada um com a sua nota", () => {
    const parcelas = [
      parcela("C9", 100, "2026-12-10", { lote: "179", quadra: "6" }),
      parcela("C9", 100, "2026-12-10", { lote: "383", quadra: "13" }),
      parcela("C9", 100, "2027-12-10", { quadra: "6" }),
    ];
    const { units } = montar([{ codigo: "C9", cpf: "99999999999" }], parcelas);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ avisos: [], code: "GDN0618", totalContract: 300 });
    const [linha] = dividirPorLote({ cpf: "99999999999", lotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linha!.notas).toEqual([
      "1 parcela sem lote no LSoft.",
      "1 parcela no lote antigo 383, sem conversão para o lote novo.",
    ]);
  });

  it("com duas linhas, as notas do cliente e o 'mesmo CPF também tem' saem SÓ na principal", () => {
    // Três lotes no boleto: dois com parcela própria e um sem nenhuma (o Q01 L01).
    const tresLotes: LoteDoBoleto[] = [
      ...lotes.filter((l) => l.documento === "55555555555"),
      { documento: "55555555555", incerta: false, unidade: "Q01 L01" },
    ];
    const parcelas = [
      parcela("C5", 100, "2026-12-10", L397),
      parcela("C5", 100, "2026-12-10", L400),
      parcela("C5", 10, "2027-12-10"),
      parcela("C5", 10, "2027-12-10", { lote: "297", observacoes: "LOTE 297 - QUADRA 16", quadra: "16" }),
      parcela("C5", 10, "2027-12-10", { lote: "383", quadra: "13" }),
    ];
    const linhas = dividirPorLote({ cpf: "55555555555", lotes: tresLotes, nomeDoEmpreendimento: "Garden", parcelas });
    expect(linhas.map((l) => `Q${l.lote!.quadra} L${l.lote!.lote}`)).toEqual(["Q12 L26", "Q12 L29"]);
    const [principal, outra] = linhas;
    expect(principal!.avisos).toEqual(["O mesmo CPF também tem o lote Q01 L01."]);
    expect(principal!.notas).toEqual([
      "1 parcela sem lote no LSoft.",
      "1 parcela no lote antigo 383, sem conversão para o lote novo.",
      "1 parcela no LSoft com o lote Q16 L14, que o boleto não liga a este CPF.",
    ]);
    expect(principal!.parcelas).toHaveLength(4);
    expect(outra!.avisos).toEqual([]);
    expect(outra!.notas).toEqual([]);
    expect(outra!.parcelas).toHaveLength(1);
  });

  it("lote só com parcela zerada não vira linha, o outro lote continua, e é ele que leva o 'mesmo CPF'", () => {
    const { summary, units } = montar(
      [{ codigo: "C5", cpf: "55555555555" }],
      [
        parcela("C5", 0, "2026-12-10", L397),
        parcela("C5", 0, "2026-08-10", { ...L397, dataRecebido: "2026-08-10", paga: true, valorRecebido: 0 }),
        parcela("C5", 300, "2026-12-10", L400),
      ],
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ code: "GDN1229", totalContract: 300 });
    // O Q12 L26 vem antes na ordem, mas não tem dinheiro: a linha dele não existe, e o aviso não
    // pode sumir com ela.
    expect(units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q12 L26."]);
    expect(summary).toMatchObject({ clients: 1, contracts: 1, totalPortfolio: 300 });
  });

  it("lote do boleto sem parcela nenhuma não vira linha vazia: é aviso na linha principal, e só nela", () => {
    const { units } = montar(
      [{ codigo: "C5", cpf: "55555555555" }],
      [parcela("C5", 100, "2026-12-10", L400), parcela("C5", 100, "2027-01-10", L400)],
    );
    expect(units).toHaveLength(1);
    // O principal é o lote que TEM parcela (o Q12 L29), e não o primeiro da ordem (o Q12 L26).
    expect(units[0]).toMatchObject({ code: "GDN1229", totalContract: 200 });
    expect(units[0]!.avisos).toEqual(["O mesmo CPF também tem o lote Q12 L26."]);
  });

  it("clientes com e sem vencida em linhas diferentes: inadimplentes contam o cliente, críticos contam a linha", () => {
    const vencidas = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"];
    const { summary } = montar(
      [{ codigo: "C5", cpf: "55555555555" }],
      [
        ...vencidas.map((v) => parcela("C5", 10, v, L397)),
        ...vencidas.map((v) => parcela("C5", 10, v, L400)),
      ],
    );
    expect(summary).toMatchObject({ clients: 1, contracts: 2, criticalContracts: 2, overdueClients: 1 });
  });
});

describe("dividirPorLote", () => {
  it("cliente sem parcela não tem linha", () => {
    expect(
      dividirPorLote({ cpf: "55555555555", lotes: [], nomeDoEmpreendimento: "Garden", parcelas: [] }),
    ).toEqual([]);
    expect(
      dividirPorLote({
        cpf: "55555555555",
        lotes: [{ documento: "55555555555", incerta: false, unidade: "Q12 L26" }],
        nomeDoEmpreendimento: "Garden",
        parcelas: [],
      }),
    ).toEqual([]);
  });

  it("texto que cita outro lote e não o da coluna é texto velho: não vira 'cobre também'", () => {
    const [linha] = dividirPorLote({
      cpf: "55555555555",
      lotes: [{ documento: "55555555555", incerta: false, unidade: "Q12 L26" }],
      nomeDoEmpreendimento: "Garden",
      parcelas: [parcela("C5", 100, "2026-12-10", { lote: "397", observacoes: "LOTE: 398 - QUADRA: 12" })],
    });
    expect(linha!.avisos).toEqual([]);
    expect(linha!.notas).toEqual([]);
    expect(linha!.parcelas.map((p) => p.valor)).toEqual([100]);
  });

  it("a parcela repartida aparece em cada linha com o mesmo id e só a sua parte", () => {
    const linhas = dividirPorLote({
      cpf: "55555555555",
      lotes: [
        { documento: "55555555555", incerta: false, unidade: "Q12 L26" },
        { documento: "55555555555", incerta: false, unidade: "Q12 L29" },
      ],
      nomeDoEmpreendimento: "Garden",
      parcelas: [parcela("C5", 0.03, "2026-12-10", { id: "px", lote: "397", observacoes: "LOTE: 397 E 400" })],
    });
    expect(linhas.map((l) => l.parcelas.map((p) => [p.id, p.valor]))).toEqual([[["px", 0.02]], [["px", 0.01]]]);
  });

  it("o outro lote da divisão, se estiver em conferência, é citado com a marca", () => {
    const [l26, l29] = dividirPorLote({
      cpf: "55555555555",
      lotes: [
        { documento: "55555555555", incerta: false, unidade: "Q12 L26" },
        { documento: "55555555555", incerta: true, unidade: "Q12 L29" },
      ],
      nomeDoEmpreendimento: "Garden",
      parcelas: [parcela("C5", 100, "2026-12-10", { lote: "397", observacoes: "LOTE: 397 E 400", quadra: "12" })],
    });
    expect(l26!.avisos).toEqual([
      "Parcelas divididas meio a meio com o lote Q12 L29 (em conferência): na ficha, os dois lotes estão numa parcela só.",
    ]);
    expect(l29!.avisos).toEqual([
      "Lote em conferência: a troca do lote antigo pelo novo ainda tem dúvida.",
      "Parcelas divididas meio a meio com o lote Q12 L26: na ficha, os dois lotes estão numa parcela só.",
    ]);
  });

  it("sequência de três lotes do mesmo CPF: três partes iguais, e o aviso diz 'em partes iguais'", () => {
    const linhas = dividirPorLote({
      cpf: "55555555555",
      lotes: [
        { documento: "55555555555", incerta: false, unidade: "Q12 L26" },
        { documento: "55555555555", incerta: false, unidade: "Q12 L29" },
        { documento: "55555555555", incerta: false, unidade: "Q04 L13" },
      ],
      nomeDoEmpreendimento: "Garden",
      parcelas: [parcela("C5", 100, "2026-12-10", { lote: "397", observacoes: "LOTE: 397 E 400 E 217", quadra: "12" })],
    });
    const porLote = Object.fromEntries(linhas.map((l) => [`Q${l.lote!.quadra} L${l.lote!.lote}`, l]));
    // 100,00 em três: o centavo que sobra fica no lote da coluna (397 = Q12 L26).
    expect(porLote["Q12 L26"]!.parcelas[0]!.valor).toBe(33.34);
    expect(porLote["Q12 L29"]!.parcelas[0]!.valor).toBe(33.33);
    expect(porLote["Q04 L13"]!.parcelas[0]!.valor).toBe(33.33);
    expect(porLote["Q12 L26"]!.avisos).toEqual([
      "Parcelas divididas em partes iguais com os lotes Q12 L29 e Q04 L13: na ficha, os 3 lotes estão numa parcela só.",
    ]);
  });
});

describe("partesIguaisEmCentavos", () => {
  it("divide sem criar nem perder centavo, com o resto na primeira parte", () => {
    expect(partesIguaisEmCentavos(423_810, 2)).toEqual([211_905, 211_905]);
    expect(partesIguaisEmCentavos(423_811, 2)).toEqual([211_906, 211_905]);
    expect(partesIguaisEmCentavos(100, 3)).toEqual([34, 33, 33]);
    expect(partesIguaisEmCentavos(0, 2)).toEqual([0, 0]);
    for (const [centavos, n] of [[1, 2], [99_999, 3], [123_457, 4]] as const) {
      expect(partesIguaisEmCentavos(centavos, n).reduce((a, b) => a + b, 0)).toBe(centavos);
    }
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
 *
 * ⚠️ E ELE SÓ DEVOLVE AS COLUNAS DO `select()` (revisão de 29/09/2026). Devolvendo a linha inteira,
 * a leitura que esquecesse `lote` e `observacoes` no select passava verde, e em produção o cliente de
 * dois lotes voltava a ser uma linha só. Os filtros continuam valendo sobre a linha inteira, como no
 * PostgREST (filtra por coluna que não vem no select).
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
      let colunas: null | string[] = null;
      const projetar = (linha: Linha): Linha =>
        colunas === null ? linha : Object.fromEntries(colunas.map((coluna) => [coluna, linha[coluna]]));
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
          return { count: todas.length, data: todas.slice(de, ate + 1).map(projetar), error: null };
        },
        select(lista?: string) {
          // "id, cliente_codigo, valor" → só essas chaves; sem lista (ou "*"), a linha inteira.
          const pedidas = (lista ?? "*").split(",").map((coluna) => coluna.trim()).filter(Boolean);
          colunas = pedidas.includes("*") ? null : pedidas;
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

  it("só devolve as colunas do select, e filtra por coluna que não veio nele", async () => {
    const banco = bancoFalso({ t: { linhas: [{ id: "a", lote: "397", tipo: "x" }, { id: "b", lote: "400", tipo: "y" }] } });
    const r = await banco.from("t").select("id, tipo").eq("lote", "397").order("id").range(0, 9);
    expect(r.data).toEqual([{ id: "a", tipo: "x" }]);
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
  // O antigo 150 da quadra 6 é o Q06 L14 do boleto.
  lote: "150",
  observacoes: null,
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

  it("lê o lote e o texto de cada parcela, e o cliente de dois lotes sai em duas linhas", async () => {
    duble.banco = bancoFalso({
      boletos_documentos: {
        linhas: [
          { documento: "55555555555", empreendimento: "garden", id: "b1", unidade: "Q12 L26", workspace_id: "careli" },
          { documento: "55555555555", empreendimento: "garden", id: "b2", unidade: "Q12-L29", workspace_id: "careli" },
        ],
      },
      boletos_parcelas: { linhas: [] },
      lsoft_classificacao_de_parcela: { linhas: [] },
      lsoft_clientes: { linhas: [clienteDoBanco("C5", "55555555555")] },
      lsoft_parcelas: {
        linhas: [
          parcelaDoBanco("p1", "C5", 2201.02, "2026-09-10", { lote: "397", quadra: "12" }),
          parcelaDoBanco("p2", "C5", 2207.18, "2026-09-10", { lote: "400", quadra: "12" }),
          // Coluna vazia: o lote sai do texto.
          parcelaDoBanco("p3", "C5", 10000, "2027-12-20", {
            lote: null,
            observacoes: "PARC. ANUAL LOTE: 397 - QUADRA: 12",
            quadra: "12",
          }),
        ],
      },
    });

    const r = await ler();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porCodigo = Object.fromEntries(r.data.units.map((u) => [u.code, u]));
    expect(Object.keys(porCodigo).sort()).toEqual(["GDN1226", "GDN1229"]);
    expect(porCodigo.GDN1226).toMatchObject({ avisos: [], overdueAmount: 2201.02, totalContract: 12201.02 });
    expect(porCodigo.GDN1229).toMatchObject({ avisos: [], overdueAmount: 2207.18, totalContract: 2207.18 });
    expect(r.data.summary).toMatchObject({ clients: 1, contracts: 2, totalPortfolio: 14408.2 });
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
