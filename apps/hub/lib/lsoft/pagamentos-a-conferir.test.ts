import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisaoDaBaixa } from "@/lib/lsoft/baixa-do-hub";

// Dados sintéticos: códigos e nomes inventados, documentos de mentira.

// O banco e a leitura da baixa são trocados; as réguas puras e a montagem são as de verdade.
const m = vi.hoisted(() => ({
  conferidos: { data: [] as unknown[], error: null as null | { code?: string; message: string } },
  insert: vi.fn(),
  lerBaixa: vi.fn(),
  tabelas: {} as Record<string, unknown[]>,
}));

vi.mock("@/lib/lsoft/baixa-do-hub", async (original) => ({
  ...(await original<typeof import("@/lib/lsoft/baixa-do-hub")>()),
  lerBaixaDoHub: m.lerBaixa,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from(tabela: string) {
      const resposta =
        tabela === "boletos_pagamentos_conferidos"
          ? m.conferidos
          : { data: m.tabelas[tabela] ?? [], error: null };
      const consulta = {
        eq: () => consulta,
        insert: (linha: unknown) => m.insert(tabela, linha),
        order: () => consulta,
        range: async () => resposta,
        select: () => consulta,
      };
      return consulta;
    },
  }),
}));

const { MOTIVO_FORA_DO_FINANCEIRO } = await import("@/lib/lsoft/baixa-do-hub");
const {
  chaveDoMotivo,
  donosDosLotes,
  impressaoDaChave,
  lerPagamentosAConferir,
  marcarPagamentoConferido,
  montarPagamentosAConferir,
  motivoParaOTime,
  observacaoValida,
  paraATela,
  tabelaDeConferidosAusente,
} = await import("@/lib/lsoft/pagamentos-a-conferir");
type ClienteDaLista = import("@/lib/lsoft/pagamentos-a-conferir").ClienteDaLista;
type ConferenciaFeita = import("@/lib/lsoft/pagamentos-a-conferir").ConferenciaFeita;

function decisao(parcial: Partial<DecisaoDaBaixa>): DecisaoDaBaixa {
  return {
    aviso: false,
    baixa: null,
    classe: "conferir",
    clienteCodigo: null,
    cobrancaId: "pay_a",
    competencia: "2026-09",
    loteAntigo: null,
    motivo: null,
    observacao: null,
    pagoEm: "2026-09-16",
    parcela: null,
    unidade: "Q12 L26",
    valorPago: 2201.02,
    ...parcial,
  };
}

const NINGUEM = new Map<string, ClienteDaLista>();
const NADA_CONFERIDO = new Map<string, ConferenciaFeita[]>();
const CLIENTES = new Map<string, ClienteDaLista>([
  ["00000900", { codigo: "00000900", nome: "CLIENTE NO FINANCEIRO" }],
  ["00000901", { codigo: "00000901", nome: "CLIENTE NA INTEGRACAO" }],
]);
const NO_FINANCEIRO = new Set(["00000900"]);

const montar = (decisoes: DecisaoDaBaixa[], extra: Partial<Parameters<typeof montarPagamentosAConferir>[0]> = {}) =>
  montarPagamentosAConferir({
    clientePorCodigo: CLIENTES,
    clientePorUnidade: NINGUEM,
    conferidos: NADA_CONFERIDO,
    decisoes,
    noFinanceiro: NO_FINANCEIRO,
    ...extra,
  });

const parcelaPaga = {
  dataRecebido: "2026-08-24",
  id: "p1",
  paga: true,
  rotulo: "007/084",
  valor: 2119.05,
  valorRecebido: 2209.59,
  vencimento: "2026-09-10",
};

describe("motivoParaOTime", () => {
  it("a já paga com outro valor pede para conferir se é o mesmo pagamento, com os dois valores e as duas datas", () => {
    const { detalhe, motivo } = motivoParaOTime(
      decisao({ aviso: true, classe: "ja_paga", pagoEm: "2026-09-16T12:00:00Z", parcela: parcelaPaga, valorPago: 2223.07 }),
    );
    expect(motivo).toContain("pagamento em dobro");
    expect(detalhe).toContain("2.209,59");
    expect(detalhe).toContain("24/08/2026");
    expect(detalhe).toContain("2.223,07");
    expect(detalhe).toContain("16/09/2026");
    expect(detalhe).not.toContain("soma");
  });

  it("⚠️ parcela de dois lotes: o detalhe avisa que a comparação é com a soma dos boletos", () => {
    const { detalhe } = motivoParaOTime(
      decisao({
        aviso: true,
        classe: "ja_paga",
        observacao:
          "Já paga na ficha com R$ 4.238,10; o Asaas recebeu R$ 4.414,36. Parcela de 2 lotes (Q04 L13 e Q04 L14): recebido é a soma, R$ 4.414,36.",
        parcela: { ...parcelaPaga, valorRecebido: 4238.1 },
        valorPago: 2207.18,
      }),
    );
    expect(detalhe).toContain("mais de um lote");
    expect(detalhe).toContain("soma");
  });

  // ⚠️ OS TEXTOS SÃO OS DE `baixa-do-hub.ts`. Frase nova lá precisa de frase aqui e de uma linha
  // nesta lista (há um aviso no cabeçalho dos motivos de lá).
  const CRUS = [
    MOTIVO_FORA_DO_FINANCEIRO,
    "O Asaas desfez este pagamento (REFUNDED) depois que o hub deu baixa na parcela; reabra à mão se for o caso.",
    "Pagamento sem valor ou sem data no Asaas.",
    "Unidade do boleto ilegível.",
    "Lote Q13 L10 fora do mapa do lote antigo para o novo.",
    "Sem CPF para Q13 L10 no cadastro de boletos.",
    "Q13 L10 tem mais de um CPF no cadastro de boletos.",
    "Nenhuma parcela do lote antigo 382 vencendo em 09/2026.",
    "Nenhuma parcela da série n/084 do lote antigo 382 em 09/2026 (há 1 de outra série).",
    "2 parcelas da mesma série do lote antigo 382 vencem em 09/2026: não dá para escolher uma com segurança.",
    "2 cobranças pagas para o mesmo lote em 09/2026.",
    "Boletos de CPFs diferentes apontam para a mesma parcela.",
    "A parcela cobre o lote antigo 288, fora do mapa, e o mesmo CPF tem boleto numa unidade que o mapa não conhece.",
    "A parcela cobre 2 lotes, e o boleto de Q04 L13 está em outro CPF: não dá para saber quanto desta parcela já entrou.",
    "A parcela cobre 2 lotes cobrados em boletos separados, e o de Q04 L13 ainda não está pago em 09/2026.",
    "Esta cobrança já deu baixa em outra parcela: não baixa uma segunda.",
    "Outra cobrança já deu baixa nesta parcela: é pagamento em dobro ou lote trocado.",
    "O hub já tinha dado baixa nesta parcela e ela voltou a ficar em aberto (reaberta na ficha ou desfeita por uma carga do LSoft): não baixa de novo sozinho.",
  ];

  it("⚠️ cada motivo da baixa tem a PRÓPRIA frase, sem o jargão do log (lote antigo, CPF, série, cobrança)", () => {
    const GENERICA = "O hub não conseguiu dar baixa neste boleto sozinho. Confira a ficha do cliente.";
    const frases = new Set<string>();
    for (const cru of CRUS) {
      const { motivo } = motivoParaOTime(decisao({ motivo: cru }));
      expect(motivo, cru).not.toMatch(/lote antigo|CPF|série|cobrança|—/i);
      expect(motivo, cru).not.toBe(GENERICA);
      frases.add(motivo);
    }
    expect(frases.size).toBe(CRUS.length);
  });

  it("os dois textos de série sem parcela dividem a mesma frase", () => {
    const a = motivoParaOTime(decisao({ motivo: "Nenhuma parcela da série n/084 do lote antigo 382 em 09/2026 (há 1 de outra série)." }));
    const b = motivoParaOTime(decisao({ motivo: "O boleto não diz a série e nenhuma parcela mensal do lote antigo 382 vence em 09/2026." }));
    expect(a.motivo).toBe(b.motivo);
  });

  it("⚠️ a parcela que cobre OUTRO lote fora do mapa não vira 'o lote deste boleto não tem correspondência'", () => {
    const daParcela = motivoParaOTime(decisao({ motivo: "A parcela cobre o lote antigo 288, fora do mapa, e o mesmo CPF tem boleto numa unidade que o mapa não conhece." }));
    const doBoleto = motivoParaOTime(decisao({ motivo: "Lote Q13 L10 fora do mapa do lote antigo para o novo." }));
    expect(daParcela.motivo).toContain("outro lote");
    expect(doBoleto.motivo).toContain("lote deste boleto");
  });

  it("o estorno de parcela baixada à mão usa a frase do estorno", () => {
    const { motivo } = motivoParaOTime(
      decisao({ motivo: "O Asaas desfez este pagamento (REFUNDED); veja se a parcela foi baixada à mão e precisa ser reaberta." }),
    );
    expect(motivo).toContain("desfeito no Asaas");
  });

  it("o motivo desconhecido cai na frase genérica, e nunca no texto cru", () => {
    expect(motivoParaOTime(decisao({ motivo: "texto interno qualquer do lote antigo 9" })).motivo).toBe(
      "O hub não conseguiu dar baixa neste boleto sozinho. Confira a ficha do cliente.",
    );
  });
});

describe("donosDosLotes", () => {
  const clientes = [
    { codigo: "00000901", cpf: "111.111.111-11", nome: "CLIENTE UM" },
    { codigo: "00000902", cpf: "22222222222", nome: "CLIENTE DOIS" },
    { codigo: "00000903", cpf: "22222222222", nome: "CADASTRO DUPLICADO" },
    { codigo: "00000904", cpf: null, nome: "SEM DOCUMENTO" },
  ];

  it("acha o dono pelo documento, com a unidade escrita com hífen ou espaço", () => {
    const donos = donosDosLotes({ clientes, documentos: [{ documento: "11111111111", unidade: "Q15-L20" }] });
    expect(donos.get("Q15 L20")).toEqual({ codigo: "00000901", nome: "CLIENTE UM" });
  });

  it("⚠️ lote com dois documentos, documento de dois clientes ou cliente sem documento: sem dono", () => {
    const donos = donosDosLotes({
      clientes,
      documentos: [
        { documento: "11111111111", unidade: "Q01 L01" },
        { documento: "22222222222", unidade: "Q01 L01" },
        { documento: "22222222222", unidade: "Q02 L02" },
        { documento: "", unidade: "Q03 L03" },
        { documento: "99999999999", unidade: "Q04 L04" },
      ],
    });
    expect([...donos.keys()]).toEqual([]);
  });
});

describe("montarPagamentosAConferir", () => {
  it("baixa nova de cliente no Financeiro não entra: o hub resolve na próxima rodada", () => {
    const grupos = montar([decisao({ classe: "baixa_nova", clienteCodigo: "00000900" })]);
    expect(grupos).toEqual({ conferir: [], integracao: [] });
  });

  it("⚠️ boleto pago com a parcela em aberto de quem está na integração: grupo da integração, pedindo a baixa", () => {
    const grupos = montar([decisao({ classe: "baixa_nova", clienteCodigo: "00000901", cobrancaId: "pay_aberta" })]);
    expect(grupos.conferir).toEqual([]);
    expect(grupos.integracao).toHaveLength(1);
    expect(grupos.integracao[0]).toMatchObject({
      clienteCodigo: "00000901",
      clienteNome: "CLIENTE NA INTEGRACAO",
      motivo: "Boleto pago, e a parcela está em aberto na ficha. Falta dar a baixa.",
    });
  });

  it("⚠️ já paga na ficha com o MESMO valor não entra, esteja o cliente no Financeiro ou na integração", () => {
    const grupos = montar([
      decisao({ classe: "ja_paga", clienteCodigo: "00000900", cobrancaId: "pay_1" }),
      decisao({ classe: "ja_paga", clienteCodigo: "00000901", cobrancaId: "pay_2" }),
    ]);
    expect(grupos).toEqual({ conferir: [], integracao: [] });
  });

  it("⚠️ já paga com OUTRO valor pede decisão também para quem está na integração (não fica escondida na rotina)", () => {
    const grupos = montar([
      decisao({ aviso: true, classe: "ja_paga", clienteCodigo: "00000901", cobrancaId: "pay_dobro", parcela: parcelaPaga }),
    ]);
    expect(grupos.integracao).toEqual([]);
    expect(grupos.conferir[0]?.motivo).toContain("pagamento em dobro");
  });

  it("lote do boleto que não bate com as parcelas pede decisão, com o cliente da decisão", () => {
    const grupos = montar([
      decisao({
        aviso: true,
        clienteCodigo: "00000901",
        cobrancaId: "pay_lote",
        motivo: "Nenhuma parcela do lote antigo 382 vencendo em 09/2026.",
        unidade: "Q13-L10",
      }),
    ]);
    expect(grupos.conferir[0]).toMatchObject({ clienteCodigo: "00000901", unidade: "Q13 L10" });
  });

  it("⚠️ documento que não é de ninguém: diz isso e aponta a ficha que tem o lote, só quando é UMA", () => {
    const semDono = decisao({ cobrancaId: "pay_x", loteAntigo: "418", motivo: MOTIVO_FORA_DO_FINANCEIRO });
    const umaFicha = montar([semDono], { fichasDoLote: { "418": ["00000901"] } }).conferir[0];
    expect(umaFicha).toMatchObject({
      clienteCodigo: "00000901",
      clienteNome: "CLIENTE NA INTEGRACAO",
      motivo: "O documento deste boleto não é de nenhum cliente do LSoft. Confira de quem é o boleto.",
    });
    expect(umaFicha?.detalhe).toContain("parcelas deste lote");

    const duasFichas = montar([semDono], { fichasDoLote: { "418": ["00000900", "00000901"] } }).conferir[0];
    expect(duasFichas).toMatchObject({ clienteCodigo: null, clienteNome: null, detalhe: null });

    const nenhuma = montar([semDono]).conferir[0];
    expect(nenhuma).toMatchObject({ clienteCodigo: null, clienteNome: null });
    expect(montar([semDono]).integracao).toEqual([]);
  });

  it("⚠️ o conferido sai, mas volta se a mesma cobrança aparecer por OUTRO motivo, dizendo quem conferiu antes", () => {
    const primeiro = decisao({ aviso: true, cobrancaId: "pay_x", motivo: "Nenhuma parcela do lote antigo 382 vencendo em 09/2026." });
    const conferidos = new Map<string, ConferenciaFeita[]>([
      ["pay_x", [{ chave: chaveDoMotivo(primeiro), em: "2026-09-30T11:00:00Z", observacao: "lote corrigido", por: "Usuária (portal)" }]],
    ]);

    expect(montar([primeiro], { conferidos }).conferir).toEqual([]);

    const voltou = montar(
      [
        decisao({
          aviso: true,
          cobrancaId: "pay_x",
          motivo: "O Asaas desfez este pagamento (REFUNDED) depois que o hub deu baixa na parcela; reabra à mão se for o caso.",
        }),
      ],
      { conferidos },
    ).conferir;
    expect(voltou.map((item) => item.cobrancaId)).toEqual(["pay_x"]);
    expect(voltou[0]?.conferidoAntes).toEqual({ em: "2026-09-30T11:00:00Z", observacao: "lote corrigido", por: "Usuária (portal)" });
  });

  it("a já paga conferida volta quando o valor da ficha muda (a chave leva os valores)", () => {
    const antes = decisao({
      aviso: true,
      classe: "ja_paga",
      cobrancaId: "pay_y",
      observacao: "Já paga na ficha com R$ 2.209,59; o Asaas recebeu R$ 2.223,07.",
    });
    const depois = { ...antes, observacao: "Já paga na ficha com R$ 2.000,00; o Asaas recebeu R$ 2.223,07." };
    const conferidos = new Map<string, ConferenciaFeita[]>([
      ["pay_y", [{ chave: chaveDoMotivo(antes), em: "2026-09-30", observacao: "ok", por: "x" }]],
    ]);

    expect(montar([antes], { conferidos }).conferir).toEqual([]);
    expect(montar([depois], { conferidos }).conferir).toHaveLength(1);
  });

  it("o mais recente vem primeiro, e a data do pagamento sai só com o dia", () => {
    const grupos = montar([
      decisao({ aviso: true, cobrancaId: "pay_set", competencia: "2026-09", motivo: "Unidade do boleto ilegível." }),
      decisao({
        aviso: true,
        cobrancaId: "pay_out",
        competencia: "2026-10",
        motivo: "Unidade do boleto ilegível.",
        pagoEm: "2026-10-09T03:00:00+00:00",
      }),
    ]);
    expect(grupos.conferir.map((item) => item.cobrancaId)).toEqual(["pay_out", "pay_set"]);
    expect(grupos.conferir[0]?.pagoEm).toBe("2026-10-09");
  });

  it("⚠️ o que vai para a TELA não leva a chave crua nem CPF: só a impressão do motivo", () => {
    const [item] = montar([
      decisao({ aviso: true, clienteCodigo: "00000900", motivo: "Nenhuma parcela do lote antigo 382 vencendo em 09/2026." }),
    ]).conferir;
    expect(item?.chave).toContain("lote antigo 382");
    const naTela = paraATela(item as NonNullable<typeof item>);
    expect(Object.keys(naTela).sort()).toEqual(
      [
        "clienteCodigo",
        "clienteNome",
        "cobrancaId",
        "competencia",
        "conferidoAntes",
        "detalhe",
        "impressao",
        "motivo",
        "pagoEm",
        "parcela",
        "unidade",
        "valorPago",
      ].sort(),
    );
    expect(JSON.stringify(naTela)).not.toMatch(/lote antigo|CPF/);
    expect(naTela.impressao).toBe(impressaoDaChave(item?.chave ?? ""));
    expect(naTela.impressao).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("observacaoValida", () => {
  it("limpa, corta espaços e recusa a vazia, a curta demais e a que não é texto", () => {
    expect(observacaoValida("  baixa dada   na ficha\n em 30/09 ")).toBe("baixa dada na ficha em 30/09");
    expect(observacaoValida("ok")).toBeNull();
    expect(observacaoValida("   ")).toBeNull();
    expect(observacaoValida(123)).toBeNull();
    expect(observacaoValida("a".repeat(501))).toBeNull();
    expect(observacaoValida("a".repeat(500))).toHaveLength(500);
  });
});

describe("tabelaDeConferidosAusente", () => {
  it("reconhece a tabela que ainda não existe (antes da migration 0200), e só ela", () => {
    expect(tabelaDeConferidosAusente({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(tabelaDeConferidosAusente({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(
      tabelaDeConferidosAusente({
        code: "XX",
        message: "Could not find the table 'public.boletos_pagamentos_conferidos' in the schema cache",
      }),
    ).toBe(true);
    expect(tabelaDeConferidosAusente({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(tabelaDeConferidosAusente(null)).toBe(false);
  });
});

// ── A LEITURA E A CONFERÊNCIA, COM O BANCO DE MENTIRA ───────────────────────

const A_CONFERIR = decisao({
  aviso: true,
  clienteCodigo: "00000900",
  cobrancaId: "pay_vivo",
  motivo: "Nenhuma parcela do lote antigo 382 vencendo em 09/2026.",
});

beforeEach(() => {
  m.conferidos = { data: [], error: null };
  m.insert.mockReset().mockResolvedValue({ error: null });
  m.tabelas = {
    boletos_documentos: [],
    lsoft_clientes: [{ codigo: "00000900", cpf: "11111111111", nome: "CLIENTE NO FINANCEIRO" }],
  };
  m.lerBaixa.mockReset().mockResolvedValue({
    colunaAusente: false,
    fichasDoLote: {},
    noFinanceiro: ["00000900"],
    resultado: { decisoes: [A_CONFERIR], fora: { antesDoCorte: 0, naoPagos: 0 }, totais: {} },
  });
});

describe("lerPagamentosAConferir", () => {
  it("⚠️ pede a régua para TODOS os clientes e os estornos, e devolve os itens sem a chave crua", async () => {
    const leitura = await lerPagamentosAConferir();
    expect(m.lerBaixa).toHaveBeenCalledWith(expect.objectContaining({ clientes: "todos", todosOsDesfeitos: true }));
    expect(leitura.ok && leitura.grupos.conferir.map((item) => item.cobrancaId)).toEqual(["pay_vivo"]);
    expect(JSON.stringify(leitura)).not.toContain("lote antigo");
  });

  it("antes da migration 0200 a lista vem inteira, avisando que o Conferido não está disponível", async () => {
    m.conferidos = { data: [], error: { code: "PGRST205", message: "Could not find the table" } };
    const leitura = await lerPagamentosAConferir();
    expect(leitura).toMatchObject({ conferidoIndisponivel: true, ok: true });
  });

  it("falha na leitura da baixa ou dos conferidos (que não seja a tabela ausente) devolve erro, e não lista pela metade", async () => {
    m.conferidos = { data: [], error: { code: "57014", message: "statement timeout" } };
    expect((await lerPagamentosAConferir()).ok).toBe(false);

    m.conferidos = { data: [], error: null };
    m.lerBaixa.mockRejectedValue(new Error("parcelas do Garden: leitura incompleta"));
    expect((await lerPagamentosAConferir()).ok).toBe(false);
  });
});

describe("marcarPagamentoConferido", () => {
  const pedido = (parcial: Partial<Parameters<typeof marcarPagamentoConferido>[0]> = {}) => ({
    autor: "Usuária Teste (cecilio-rocha)",
    cobrancaId: "pay_vivo",
    impressao: impressaoDaChave(chaveDoMotivo(A_CONFERIR)),
    observacao: "lote corrigido na ficha",
    origem: "incorporador" as const,
    ...parcial,
  });

  it("grava a cobrança, o motivo da LISTA (nunca do pedido), o autor e o empreendimento fixo", async () => {
    expect(await marcarPagamentoConferido(pedido())).toEqual({ ok: true });
    expect(m.insert).toHaveBeenCalledTimes(1);
    expect(m.insert).toHaveBeenCalledWith("boletos_pagamentos_conferidos", {
      cobranca_id: "pay_vivo",
      conferido_origem: "incorporador",
      conferido_por: "Usuária Teste (cecilio-rocha)",
      empreendimento: "garden",
      motivo: chaveDoMotivo(A_CONFERIR),
      observacao: "lote corrigido na ficha",
      workspace_id: "careli",
    });
  });

  it("⚠️ cobrança que não está na lista viva: 404, e nada é gravado", async () => {
    expect(await marcarPagamentoConferido(pedido({ cobrancaId: "pay_de_outro_lugar" }))).toMatchObject({ ok: false, status: 404 });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("⚠️ o motivo mudou desde que a pessoa abriu a lista: 409, e nada é gravado", async () => {
    expect(await marcarPagamentoConferido(pedido({ impressao: impressaoDaChave("conferir|outro motivo") }))).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("antes da migration 0200: 503, sem tentar gravar", async () => {
    m.conferidos = { data: [], error: { code: "42P01", message: "relation does not exist" } };
    expect(await marcarPagamentoConferido(pedido())).toMatchObject({ ok: false, status: 503 });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("erro do banco na gravação vira 503; a linha que outra pessoa gravou no mesmo instante conta como feita", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    m.insert.mockResolvedValue({ error: { code: "57014", message: "timeout" } });
    expect(await marcarPagamentoConferido(pedido())).toMatchObject({ ok: false, status: 503 });

    m.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    expect(await marcarPagamentoConferido(pedido())).toEqual({ ok: true });
    erro.mockRestore();
  });
});
