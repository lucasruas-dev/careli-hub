import { beforeEach, describe, expect, it, vi } from "vitest";

// `lerCarteiraDoLsoft` pega o banco sozinho; o dublê entra no lugar do servidor do Apolo (que
// arrasta MySQL e metade do Panteon). Fora dos testes da leitura, o banco não é usado.
const duble = vi.hoisted(() => ({ banco: null as unknown }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => duble.banco }));

import { type ClienteDaCarteira, lerCarteiraDoLsoft } from "@/lib/lsoft/carteira";
import { EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO } from "@/lib/lsoft/carteira-no-financeiro";
import {
  CATEGORIA_NO_FINANCEIRO,
  colunaNaCarteiraAusente,
  descontarDaCarteira,
  devolucaoDoCampo,
  type LinhaPorEmpreendimento,
  linhaDoQueFicaNoPar,
  linhaPorEmpreendimentoDaView,
  listaNaCarteira,
  naCarteiraQueOFinanceiroLe,
  parcelaVaiParaOFinanceiro,
  parcelasQueFicam,
  type ParcelaQueFicaNoPar,
  rotuloDoSelo,
  saiDoRecorte,
} from "@/lib/lsoft/na-carteira";

// ── Dados sintéticos (nenhum nome, CPF ou código real) ──────────────────────

function cliente(sobrescreve: Partial<ClienteDaCarteira> = {}): ClienteDaCarteira {
  return {
    caixaALiberar: 0,
    caixaJaLiberado: 0,
    camposC2xPreenchidos: 9,
    camposC2xTotal: 9,
    celular: null,
    cidade: null,
    codigo: "C2",
    cpf: null,
    cpfFormatado: null,
    email: null,
    // ⚠️ O CADASTRO SÓ COM O GARDEN, como em produção: medido em 29/09/2026, 10 dos 11 que têm
    // outra carteira além do Garden têm `lsoft_clientes.empreendimentos` = {Garden}. A outra
    // carteira (Giant Towers etc.) só aparece nas parcelas, isto é, nas linhas da 0107.
    empreendimentos: ["Garden"],
    empreendimentosNaCarteira: [],
    enriquecidoEm: null,
    nome: "Cliente Dois",
    parcelas: 10,
    parcelasAbertas: 6,
    parcelasAValidar: 0,
    parcelasCaixa: 0,
    parcelasPagas: 4,
    parcelasVencidas: 2,
    patrimonioAReceber: 0,
    patrimonioParcelasAbertas: 0,
    proximoVencimento: "2026-10-01",
    saldoAberto: 6000.3,
    saldoVencido: 1500.1,
    statusValidacao: "em_analise",
    telefone: null,
    totalCaixa: 0,
    totalRecebido: 4000.2,
    unidades: ["APTO 1503", "Q01 L02"],
    valorAValidar: 0,
    ...sobrescreve,
  };
}

function linha(sobrescreve: Partial<LinhaPorEmpreendimento> = {}): LinhaPorEmpreendimento {
  return {
    codigo: "C2",
    empreendimento: "Garden",
    parcelas: 7,
    parcelasAbertas: 4,
    parcelasCaixa: 0,
    parcelasPagas: 3,
    parcelasVencidas: 1,
    proximoVencimento: "2026-10-01",
    saldoAberto: 4000.1,
    saldoVencido: 1000.05,
    totalRecebido: 3000.1,
    unidades: ["Q01 L02"],
    ...sobrescreve,
  };
}

const GIANT = linha({
  empreendimento: "Giant Towers",
  parcelas: 3,
  parcelasAbertas: 2,
  parcelasPagas: 1,
  parcelasVencidas: 1,
  proximoVencimento: "2026-11-05",
  saldoAberto: 2000.2,
  saldoVencido: 500.05,
  totalRecebido: 1000.1,
  unidades: ["APTO 1503"],
});

// ── listaNaCarteira ─────────────────────────────────────────────────────────

describe("listaNaCarteira", () => {
  it("antes da migration a coluna nem vem: vira lista vazia, e nunca tira ninguém da tela", () => {
    expect(listaNaCarteira(undefined)).toEqual([]);
    expect(listaNaCarteira(null)).toEqual([]);
    expect(listaNaCarteira("{Garden}")).toEqual([]);
  });

  it("limpa espaço, vazio e repetido", () => {
    expect(listaNaCarteira([" Garden ", "", "Garden", "On Sky"])).toEqual(["Garden", "On Sky"]);
  });
});

// ── colunaNaCarteiraAusente ─────────────────────────────────────────────────

describe("colunaNaCarteiraAusente", () => {
  it("reconhece a coluna que ainda não existe (Postgres 42703 e PostgREST schema cache)", () => {
    expect(
      colunaNaCarteiraAusente({
        code: "42703",
        message: "column lsoft_clientes.empreendimentos_na_carteira does not exist",
      }),
    ).toBe(true);
    expect(
      colunaNaCarteiraAusente({
        code: "PGRST204",
        message: "Could not find the 'empreendimentos_na_carteira' column of 'lsoft_clientes' in the schema cache",
      }),
    ).toBe(true);
  });

  it("qualquer outro erro NÃO vira 'ninguém no Financeiro': rede, timeout, outra coluna", () => {
    expect(colunaNaCarteiraAusente(null)).toBe(false);
    expect(colunaNaCarteiraAusente({ message: "canceling statement due to statement timeout" })).toBe(false);
    expect(colunaNaCarteiraAusente({ code: "42703", message: "column lsoft_clientes.outra does not exist" })).toBe(false);
    expect(colunaNaCarteiraAusente({ message: "fetch failed (empreendimentos_na_carteira)" })).toBe(false);
  });
});

// ── saiDoRecorte ────────────────────────────────────────────────────────────

describe("saiDoRecorte", () => {
  it("com o empreendimento escolhido, sai só quem tem AQUELE no Financeiro", () => {
    expect(saiDoRecorte(["Garden"], "Garden")).toBe(true);
    expect(saiDoRecorte(["Garden"], "Giant Towers")).toBe(false);
    expect(saiDoRecorte([], "Garden")).toBe(false);
  });
});

// ── descontarDaCarteira ─────────────────────────────────────────────────────

// ── A régua do Financeiro ───────────────────────────────────────────────────

describe("a régua do Financeiro (categoria)", () => {
  it("é a MESMA categoria que o Financeiro lê: senão o que sai daqui não é o que aparece lá", () => {
    expect(CATEGORIA_NO_FINANCEIRO).toEqual(
      Object.fromEntries(EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO.map((e) => [e.chaveLsoft, e.categoriaLsoft])),
    );
  });

  it("empreendimento marcado que o Financeiro não lê continua na integração", () => {
    expect(naCarteiraQueOFinanceiroLe(["Garden", "On Sky"])).toEqual(["Garden"]);
    expect(naCarteiraQueOFinanceiroLe(["Vale do Sol"])).toEqual([]);
  });

  it("vai para o Financeiro só a parcela do par marcado NA categoria dele", () => {
    const garden = (categoriaLsoft: null | number) => ({ categoriaLsoft, empreendimento: "Garden" });
    expect(parcelaVaiParaOFinanceiro(garden(124), ["Garden"])).toBe(true);
    // A 17 (patrimônio), uma categoria qualquer e a sem categoria ficam.
    expect(parcelaVaiParaOFinanceiro(garden(17), ["Garden"])).toBe(false);
    expect(parcelaVaiParaOFinanceiro(garden(118), ["Garden"])).toBe(false);
    expect(parcelaVaiParaOFinanceiro(garden(null), ["Garden"])).toBe(false);
    // Par não marcado fica, qualquer que seja a categoria.
    expect(parcelaVaiParaOFinanceiro(garden(124), [])).toBe(false);
  });
});

// ── linhaDoQueFicaNoPar ─────────────────────────────────────────────────────

describe("linhaDoQueFicaNoPar", () => {
  const parcela = (sobrescreve: Partial<ParcelaQueFicaNoPar> = {}): ParcelaQueFicaNoPar => ({
    clienteCodigo: "C1",
    ehCaixa: false,
    empreendimento: "Garden",
    lote: "02",
    paga: false,
    quadra: "01",
    valor: 100,
    valorRecebido: 0,
    vencimento: "2026-10-10",
    ...sobrescreve,
  });

  it("soma como a view 0107: sem a Caixa, vencida só ANTES de hoje, recebido só de paga", () => {
    const linha = linhaDoQueFicaNoPar(
      "C1",
      "Garden",
      [
        parcela({ valor: 50.1, vencimento: "2026-09-28" }), // vencida
        parcela({ valor: 60.2, vencimento: "2026-09-29" }), // vence HOJE: não é vencida
        parcela({ paga: true, valor: 70, valorRecebido: 69.9, vencimento: "2026-08-01" }),
        parcela({ ehCaixa: true, lote: "09", valor: 1000 }), // Caixa: fora das contas, mas a unidade entra
        parcela({ clienteCodigo: "OUTRO", valor: 999 }), // de outro cliente: não entra
        parcela({ empreendimento: "Giant Towers", valor: 999 }), // de outro par: não entra
      ],
      "2026-09-29",
    );
    expect(linha).toEqual({
      codigo: "C1",
      empreendimento: "Garden",
      parcelas: 3,
      parcelasAbertas: 2,
      parcelasCaixa: 1,
      parcelasPagas: 1,
      parcelasVencidas: 1,
      proximoVencimento: "2026-09-28",
      saldoAberto: 110.3,
      saldoVencido: 50.1,
      totalRecebido: 69.9,
      unidades: ["Q01 L02", "Q01 L09"],
    });
  });

  it("a unidade sai no texto da view: só a quadra, só o lote, ou nenhuma", () => {
    const linha = linhaDoQueFicaNoPar(
      "C1",
      "Garden",
      [parcela({ lote: null }), parcela({ quadra: null }), parcela({ lote: null, quadra: null })],
      "2026-09-29",
    );
    expect(linha.unidades).toEqual(["L02", "Q01"]);
  });
});

// ── descontarDaCarteira ─────────────────────────────────────────────────────

describe("descontarDaCarteira", () => {
  it("com o cadastro só com {Garden} (como em produção), os empreendimentos que ficam vêm das linhas", () => {
    // Revisão de 29/09/2026: tirar o Garden só do cadastro deixava a coluna VAZIA, com o saldo do
    // Giant Towers aparecendo como de empreendimento nenhum, na tela e no Excel.
    const aClassificar = linha({ empreendimento: "A classificar", unidades: [] });
    const { cliente: restante } = descontarDaCarteira(
      cliente({ empreendimentos: ["Garden"] }),
      ["Garden"],
      [linha(), GIANT, aClassificar],
    );
    expect(restante?.empreendimentos).toEqual(["Giant Towers", "A classificar"]);
  });

  it("o que o cadastro tem além do Garden continua, sem repetir", () => {
    const { cliente: restante } = descontarDaCarteira(
      cliente({ empreendimentos: ["Garden", "Giant Towers"] }),
      ["Garden"],
      [linha(), GIANT],
    );
    expect(restante?.empreendimentos).toEqual(["Giant Towers"]);
  });

  it("parcela do par fora da categoria do Financeiro FICA: o cliente só do Garden não some", () => {
    // O par Garden tem 8 parcelas na 0107: 7 da 124 (vão para o Financeiro) e 1 da 17, que o
    // Financeiro não lê. Antes da revisão, as 8 saíam daqui e a da 17 não aparecia em tela nenhuma.
    const garden = linha({ parcelas: 8, parcelasAbertas: 5, saldoAberto: 4050.1 });
    const soGarden = cliente({
      parcelas: 8,
      parcelasAbertas: 5,
      parcelasPagas: 3,
      parcelasVencidas: 1,
      saldoAberto: 4050.1,
      saldoVencido: 1000.05,
      totalRecebido: 3000.1,
      unidades: ["Q01 L02"],
    });
    const fica = linha({
      parcelas: 1,
      parcelasAbertas: 1,
      parcelasPagas: 0,
      parcelasVencidas: 0,
      proximoVencimento: "2099-12-01",
      saldoAberto: 50,
      saldoVencido: 0,
      totalRecebido: 0,
      unidades: ["Q01 L02"],
    });

    const { cliente: restante, inexato } = descontarDaCarteira(soGarden, ["Garden"], [garden], [fica]);
    expect(inexato).toBe(false);
    expect(restante).toMatchObject({
      empreendimentos: ["Garden"],
      parcelas: 1,
      parcelasAbertas: 1,
      parcelasPagas: 0,
      parcelasVencidas: 0,
      proximoVencimento: "2099-12-01",
      saldoAberto: 50,
      saldoVencido: 0,
      totalRecebido: 0,
      unidades: ["Q01 L02"],
    });
  });

  it("a parte que fica de OUTRO cliente ou de par não marcado não entra", () => {
    const soGarden = cliente({ parcelas: 7, parcelasAbertas: 4, parcelasPagas: 3, saldoAberto: 4000.1, totalRecebido: 3000.1 });
    const deOutro = linha({ codigo: "OUTRO", parcelas: 1 });
    const naoMarcado = linha({ empreendimento: "On Sky", parcelas: 1 });
    expect(descontarDaCarteira(soGarden, ["Garden"], [linha()], [deOutro, naoMarcado]).cliente).toBeNull();
  });

  it("em Todos, o cliente perde a parte do Garden e fica só com a outra carteira, no centavo", () => {
    const { cliente: restante, inexato } = descontarDaCarteira(cliente(), ["Garden"], [linha(), GIANT]);

    expect(inexato).toBe(false);
    expect(restante).toMatchObject({
      empreendimentos: ["Giant Towers"],
      parcelas: 3,
      parcelasAbertas: 2,
      parcelasPagas: 1,
      parcelasVencidas: 1,
      proximoVencimento: "2026-11-05",
      saldoAberto: 2000.2,
      saldoVencido: 500.05,
      totalRecebido: 1000.1,
      unidades: ["APTO 1503"],
    });
  });

  it("quem só tinha o Garden fica sem parcela e SAI da integração", () => {
    const soGarden = cliente({
      empreendimentos: ["Garden"],
      parcelas: 7,
      parcelasAbertas: 4,
      parcelasPagas: 3,
      parcelasVencidas: 1,
      saldoAberto: 4000.1,
      saldoVencido: 1000.05,
      totalRecebido: 3000.1,
      unidades: ["Q01 L02"],
    });
    expect(descontarDaCarteira(soGarden, ["Garden"], [linha()])).toEqual({ cliente: null, inexato: false });
  });

  it("sem nada no Financeiro, devolve o MESMO cliente, sem tocar em nada", () => {
    const original = cliente();
    expect(descontarDaCarteira(original, [], [linha(), GIANT]).cliente).toBe(original);
  });

  it("a unidade com o mesmo texto noutra carteira que fica NÃO some junto", () => {
    const { cliente: restante } = descontarDaCarteira(
      cliente({ unidades: ["Q01 L02", "Q09 L09"] }),
      ["Garden"],
      [linha({ unidades: ["Q01 L02", "Q09 L09"] }), { ...GIANT, unidades: ["Q09 L09"] }],
    );
    expect(restante?.unidades).toEqual(["Q09 L09"]);
  });

  it("o próximo vencimento só muda se ele era do que subiu", () => {
    // O menor era do Giant: continua.
    const giantVenceAntes = descontarDaCarteira(
      cliente({ proximoVencimento: "2026-09-30" }),
      ["Garden"],
      [linha({ proximoVencimento: "2026-10-01" }), { ...GIANT, proximoVencimento: "2026-09-30" }],
    );
    expect(giantVenceAntes.cliente?.proximoVencimento).toBe("2026-09-30");

    // A outra carteira não tem parcela em aberto: não sobra próximo vencimento.
    const semAberto = descontarDaCarteira(
      cliente(),
      ["Garden"],
      [linha(), { ...GIANT, parcelasAbertas: 0, proximoVencimento: null, saldoAberto: 0, saldoVencido: 0 }],
    );
    expect(semAberto.cliente?.proximoVencimento).toBeNull();
  });

  it("os campos da Caixa, da curadoria e do patrimônio NÃO são tocados (a 0097 não os tem)", () => {
    const { cliente: restante } = descontarDaCarteira(
      cliente({ parcelasAValidar: 2, patrimonioAReceber: 50, valorAValidar: 10 }),
      ["Garden"],
      [linha(), GIANT],
    );
    expect(restante).toMatchObject({ parcelasAValidar: 2, patrimonioAReceber: 50, valorAValidar: 10 });
  });

  it("linha que sai com Caixa confirmada é desconto INEXATO: a 0107 não diz quanto dela está em aberto", () => {
    const { inexato } = descontarDaCarteira(cliente(), ["Garden"], [linha({ parcelasCaixa: 2 }), GIANT]);
    expect(inexato).toBe(true);
  });

  it("conta que passaria do zero para no zero e avisa: nada de '-R$ 12' na tela", () => {
    const { cliente: restante, inexato } = descontarDaCarteira(
      cliente({ saldoVencido: 900 }),
      ["Garden"],
      [linha({ saldoVencido: 1000.05 }), GIANT],
    );
    expect(inexato).toBe(true);
    expect(restante?.saldoVencido).toBe(0);
  });

  it("só olha as linhas DESTE cliente", () => {
    const { cliente: restante } = descontarDaCarteira(cliente(), ["Garden"], [linha({ codigo: "OUTRO" }), GIANT]);
    expect(restante?.parcelas).toBe(10);
  });
});

// ── parcelasQueFicam ────────────────────────────────────────────────────────

describe("parcelasQueFicam", () => {
  it("tira só o par (cliente, empreendimento) que está no Financeiro", () => {
    const parcelas = [
      { categoriaLsoft: 124, clienteCodigo: "C2", empreendimento: "Garden", id: "a" },
      { categoriaLsoft: 118, clienteCodigo: "C2", empreendimento: "Giant Towers", id: "b" },
      { categoriaLsoft: 124, clienteCodigo: "C3", empreendimento: "Garden", id: "c" },
    ];
    const ficam = parcelasQueFicam(parcelas, new Map([["C2", ["Garden"]]]));
    expect(ficam.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("parcela do par marcado FORA da categoria do Financeiro fica: não some das duas telas", () => {
    const parcelas = [
      { categoriaLsoft: 124, clienteCodigo: "C2", empreendimento: "Garden", id: "a" },
      { categoriaLsoft: 17, clienteCodigo: "C2", empreendimento: "Garden", id: "patrimonio" },
      { categoriaLsoft: null, clienteCodigo: "C2", empreendimento: "Garden", id: "sem-categoria" },
    ];
    const ficam = parcelasQueFicam(parcelas, new Map([["C2", ["Garden"]]]));
    expect(ficam.map((p) => p.id)).toEqual(["patrimonio", "sem-categoria"]);
  });
});

// ── devolucaoDoCampo (o --desfazer do script) ───────────────────────────────

describe("devolucaoDoCampo", () => {
  const SUBIDA = "script (subida)";
  const DESFAZER = "script --desfazer";
  const devolucao = (campo: string, valorAtual: null | string, entradas: Array<[string, null | string, null | string]>) =>
    devolucaoDoCampo({
      autorDaSubida: SUBIDA,
      autorDoDesfazer: DESFAZER,
      campo,
      entradas: entradas.map(([autor, valorAnterior, valorNovo]) => ({ autor, valorAnterior, valorNovo })),
      valorAtual,
    });

  it("devolve o status, o carimbo e a observação de antes da subida", () => {
    expect(devolucao("status_validacao", "validado", [[SUBIDA, "pendente", "validado"]])).toEqual({
      acao: "devolve",
      valor: "pendente",
    });
    expect(devolucao("validado_por", SUBIDA, [[SUBIDA, null, SUBIDA]])).toEqual({ acao: "devolve", valor: null });
    expect(
      devolucao("observacao_validacao", "Garden validado e migrado", [[SUBIDA, null, "Garden validado e migrado"]]),
    ).toEqual({ acao: "devolve", valor: null });
  });

  it("o carimbo é comparado como instante: '+00:00' do banco = 'Z' que o script mandou", () => {
    expect(
      devolucao("validado_em", "2026-09-29T23:10:00.123+00:00", [[SUBIDA, null, "2026-09-29T23:10:00.123Z"]]),
    ).toEqual({ acao: "devolve", valor: null });
  });

  it("status sem valor é 'pendente', como a tela e a trilha escrevem", () => {
    expect(devolucao("status_validacao", "validado", [[SUBIDA, null, "validado"]])).toEqual({
      acao: "devolve",
      valor: "pendente",
    });
  });

  it("quem mexeu na tela depois da subida vence, com aviso", () => {
    expect(
      devolucao("status_validacao", "em_analise", [
        [SUBIDA, "pendente", "validado"],
        ["Pessoa do time", "validado", "em_analise"],
      ]),
    ).toEqual({ acao: "fica", aviso: "foi mudado depois da subida" });
    // A tela troca o carimbo sem trilha: o valor de hoje não é mais o da subida.
    expect(devolucao("validado_por", "Pessoa do time", [[SUBIDA, null, SUBIDA]])).toEqual({
      acao: "fica",
      aviso: "não é mais o que a subida gravou",
    });
  });

  it("rodar o desfazer duas vezes não desfaz a volta, e não avisa nada", () => {
    expect(
      devolucao("status_validacao", "pendente", [
        [SUBIDA, "pendente", "validado"],
        [DESFAZER, "validado", "pendente"],
      ]),
    ).toEqual({ acao: "fica", aviso: null });
  });

  it("campo que a subida não mexeu fica de fora", () => {
    expect(devolucao("status_validacao", "em_analise", [["Pessoa do time", "pendente", "em_analise"]])).toEqual({
      acao: "sem-subida",
    });
    expect(devolucao("status_validacao", "pendente", [])).toEqual({ acao: "sem-subida" });
  });
});

// ── rotuloDoSelo ────────────────────────────────────────────────────────────

describe("rotuloDoSelo", () => {
  it("usa o nome do empreendimento, sem travessão", () => {
    expect(rotuloDoSelo([])).toBeNull();
    expect(rotuloDoSelo(["Garden"])).toBe("Garden no Financeiro");
    expect(rotuloDoSelo(["Garden", "On Sky"])).toBe("Garden e On Sky no Financeiro");
    expect(rotuloDoSelo(["Garden", "On Sky", "Guaimbé"])).toBe("Garden, On Sky e Guaimbé no Financeiro");
  });
});

// ── linhaPorEmpreendimentoDaView ────────────────────────────────────────────

describe("linhaPorEmpreendimentoDaView", () => {
  it("numeric do PostgREST chega como texto e vira número; próximo vencimento vazio vira nulo", () => {
    expect(
      linhaPorEmpreendimentoDaView({
        codigo: "C2",
        empreendimento: "Garden",
        parcelas: 7,
        parcelas_abertas: 4,
        parcelas_caixa: 0,
        parcelas_pagas: 3,
        parcelas_vencidas: 1,
        proximo_vencimento: null,
        saldo_aberto: "4000.10",
        saldo_vencido: "1000.05",
        total_recebido: "3000.10",
        unidades: ["Q01 L02"],
      }),
    ).toEqual(linha({ proximoVencimento: null }));
  });
});

// ── lerCarteiraDoLsoft com a carteira do Financeiro ─────────────────────────

type Linha = Record<string, unknown>;
type Consulta = { colunas: string; filtros: Array<[string, string, unknown]>; ordens: string[]; tabela: string };

/**
 * Um PostgREST de mentira: filtra (eq, neq, in, e o `or` de `is.null`/`neq`/`eq`), ordena, pagina,
 * conta e corta em 1.000, e só resolve no `await`, como o de verdade. Dentro do `or`, o `ilike` da
 * busca por nome passa tudo (não é o que se testa aqui). Registra cada consulta.
 */
function bancoFalso(
  tabelas: Record<string, Linha[]>,
  opcoes: { erro?: { code?: string; message: string; tabela: string } } = {},
) {
  const consultas: Consulta[] = [];

  const banco = {
    from(tabela: string) {
      const estado = {
        colunas: "*",
        contar: false,
        filtros: [] as Consulta["filtros"],
        ordens: [] as string[],
        range: null as [number, number] | null,
      };

      const resolver = () => {
        consultas.push({ colunas: estado.colunas, filtros: estado.filtros, ordens: estado.ordens, tabela });
        if (opcoes.erro?.tabela === tabela) {
          return { count: null, data: null, error: { code: opcoes.erro.code, message: opcoes.erro.message } };
        }
        let linhas = (tabelas[tabela] ?? []).filter((l) =>
          estado.filtros.every(([op, coluna, valor]) => {
            if (op === "eq") return l[coluna] === valor;
            if (op === "in") return (valor as unknown[]).includes(l[coluna]);
            if (op === "or") {
              return coluna.split(",").some((termo) => {
                const [campo = "", operador, ...resto] = termo.split(".");
                const alvo = resto.join(".");
                const atual = l[campo];
                if (operador === "is" && alvo === "null") return atual === null || atual === undefined;
                // Como no Postgres, `neq` não casa nulo.
                if (operador === "neq") return atual !== null && atual !== undefined && String(atual) !== alvo;
                if (operador === "eq") return String(atual) === alvo;
                return true;
              });
            }
            // `neq.{}` numa coluna text[]: a lista não vazia.
            if (op === "neq" && valor === "{}") return Array.isArray(l[coluna]) && (l[coluna] as unknown[]).length > 0;
            return l[coluna] !== valor;
          }),
        );
        for (const campo of [...estado.ordens].reverse()) {
          linhas = [...linhas].sort((a, b) => String(a[campo]).localeCompare(String(b[campo])));
        }
        const total = linhas.length;
        const [de, ate] = estado.range ?? [0, 999];
        linhas = linhas.slice(de, Math.min(ate + 1, de + 1000));
        return { count: estado.contar ? total : null, data: linhas, error: null };
      };

      const consulta = {
        eq(coluna: string, valor: unknown) {
          estado.filtros.push(["eq", coluna, valor]);
          return consulta;
        },
        in(coluna: string, valores: readonly unknown[]) {
          estado.filtros.push(["in", coluna, valores]);
          return consulta;
        },
        limit() {
          return consulta;
        },
        maybeSingle() {
          const r = resolver();
          return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: r.error });
        },
        neq(coluna: string, valor: unknown) {
          estado.filtros.push(["neq", coluna, valor]);
          return consulta;
        },
        or(expressao: string) {
          estado.filtros.push(["or", expressao, null]);
          return consulta;
        },
        order(coluna: string) {
          estado.ordens.push(coluna);
          return consulta;
        },
        // Como no supabase-js, `range` NÃO resolve: o código real ainda encadeia `.eq()` depois dele.
        range(de: number, ate: number) {
          estado.range = [de, ate];
          return consulta;
        },
        select(colunas: string, opcoesDoSelect?: { count?: string }) {
          estado.colunas = colunas;
          estado.contar = opcoesDoSelect?.count === "exact";
          return consulta;
        },
        // `await` direto na consulta: é assim que o supabase-js resolve.
        then(ok: (valor: unknown) => unknown, falha?: (erro: unknown) => unknown) {
          return Promise.resolve(resolver()).then(ok, falha);
        },
      };
      return consulta;
    },
  };

  return { banco, consultas };
}

/** A linha da 0097 (visão Todos), crua como o PostgREST devolve. */
const daVisaoTodos = (codigo: string, sobrescreve: Linha = {}): Linha => ({
  codigo,
  empreendimentos: ["Garden"],
  nome: `Cliente ${codigo}`,
  parcelas: 7,
  parcelas_abertas: 4,
  parcelas_pagas: 3,
  parcelas_vencidas: 1,
  proximo_vencimento: "2026-10-01",
  saldo_aberto: "4000.10",
  saldo_vencido: "1000.05",
  status_validacao: "validado",
  total_recebido: "3000.10",
  unidades: ["Q01 L02"],
  ...sobrescreve,
});

/** A linha da 0107 (por empreendimento), crua. */
const daVisaoPorEmpreendimento = (codigo: string, empreendimento: string, sobrescreve: Linha = {}): Linha => ({
  ...daVisaoTodos(codigo),
  empreendimento,
  empreendimentos: undefined,
  parcelas_caixa: 0,
  ...sobrescreve,
});

/**
 * C1: só Garden, no Financeiro. C2: Garden (no Financeiro) + Giant Towers. C3: só Garden, ficou
 * na integração (tinha observação na planilha).
 */
function cenario() {
  const giantDoC2 = {
    parcelas: 3,
    parcelas_abertas: 2,
    parcelas_pagas: 1,
    parcelas_vencidas: 1,
    proximo_vencimento: "2026-11-05",
    saldo_aberto: "2000.20",
    saldo_vencido: "500.05",
    total_recebido: "1000.10",
    unidades: ["APTO 1503"],
  };
  return {
    lsoft_carteira_por_cliente: [
      daVisaoTodos("C1"),
      daVisaoTodos("C2", {
        // O cadastro não conhece o Giant Towers (como em produção); só a 0107 conhece.
        empreendimentos: ["Garden"],
        parcelas: 10,
        parcelas_abertas: 6,
        parcelas_pagas: 4,
        parcelas_vencidas: 2,
        saldo_aberto: "6000.30",
        saldo_vencido: "1500.10",
        total_recebido: "4000.20",
        unidades: ["APTO 1503", "Q01 L02"],
      }),
      daVisaoTodos("C3", { saldo_aberto: "100.00", unidades: ["Q05 L01"] }),
    ],
    lsoft_carteira_por_cliente_empreendimento: [
      daVisaoPorEmpreendimento("C1", "Garden"),
      daVisaoPorEmpreendimento("C2", "Garden"),
      daVisaoPorEmpreendimento("C2", "Giant Towers", giantDoC2),
      daVisaoPorEmpreendimento("C3", "Garden", { saldo_aberto: "100.00", unidades: ["Q05 L01"] }),
    ],
    lsoft_clientes: [
      { codigo: "C1", empreendimentos_na_carteira: ["Garden"] },
      { codigo: "C2", empreendimentos_na_carteira: ["Garden"] },
      { codigo: "C3", empreendimentos_na_carteira: [] },
    ],
    lsoft_parcelas: [],
    lsoft_sincronizacoes: [],
  };
}

describe("lerCarteiraDoLsoft com a carteira do Financeiro", () => {
  beforeEach(() => {
    duble.banco = null;
  });

  it("em Todos: C1 some, C2 fica só com o Giant Towers, C3 não muda; o resumo soma depois do desconto", async () => {
    duble.banco = bancoFalso(cenario()).banco;

    const lida = await lerCarteiraDoLsoft({});
    if (!lida.ok) throw new Error(lida.erro);

    expect(lida.clientes.map((c) => c.codigo)).toEqual(["C2", "C3"]);
    const c2 = lida.clientes.find((c) => c.codigo === "C2");
    expect(c2).toMatchObject({
      empreendimentos: ["Giant Towers"],
      empreendimentosNaCarteira: ["Garden"],
      parcelas: 3,
      saldoAberto: 2000.2,
      unidades: ["APTO 1503"],
    });
    expect(lida.clientes.find((c) => c.codigo === "C3")?.empreendimentosNaCarteira).toEqual([]);
    expect(lida.resumo.clientes).toBe(2);
    expect(lida.resumo.saldoAberto).toBeCloseTo(2100.2, 2);
  });

  it("com o Garden escolhido, sai quem tem o Garden no Financeiro; no Giant Towers, C2 fica, com o selo", async () => {
    duble.banco = bancoFalso(cenario()).banco;
    const garden = await lerCarteiraDoLsoft({ empreendimento: "Garden" });
    if (!garden.ok) throw new Error(garden.erro);
    expect(garden.clientes.map((c) => c.codigo)).toEqual(["C3"]);
    expect(garden.resumo.clientes).toBe(1);

    const giant = await lerCarteiraDoLsoft({ empreendimento: "Giant Towers" });
    if (!giant.ok) throw new Error(giant.erro);
    expect(giant.clientes.map((c) => [c.codigo, c.empreendimentosNaCarteira])).toEqual([["C2", ["Garden"]]]);
    expect(giant.clientes[0]?.saldoAberto).toBe(2000.2);
  });

  it("antes da migration (coluna inexistente) a tela segue igual à de hoje, sem erro", async () => {
    duble.banco = bancoFalso(cenario(), {
      erro: {
        code: "42703",
        message: "column lsoft_clientes.empreendimentos_na_carteira does not exist",
        tabela: "lsoft_clientes",
      },
    }).banco;

    const lida = await lerCarteiraDoLsoft({});
    if (!lida.ok) throw new Error(lida.erro);
    expect(lida.clientes.map((c) => c.codigo)).toEqual(["C1", "C2", "C3"]);
    expect(lida.clientes.every((c) => c.empreendimentosNaCarteira.length === 0)).toBe(true);
    expect(lida.clientes.find((c) => c.codigo === "C2")?.saldoAberto).toBe(6000.3);
  });

  it("outro erro ao ler quem está no Financeiro derruba a leitura: nada de dinheiro contado duas vezes", async () => {
    duble.banco = bancoFalso(cenario(), { erro: { message: "timeout", tabela: "lsoft_clientes" } }).banco;
    const lida = await lerCarteiraDoLsoft({});
    expect(lida.ok).toBe(false);
    expect(lida.ok ? "" : lida.erro).toMatch(/Financeiro falhou/);
  });

  it("sem a view por empreendimento não há desconto, e a leitura recusa em vez de mostrar o total cheio", async () => {
    duble.banco = bancoFalso(cenario(), {
      erro: { message: "timeout", tabela: "lsoft_carteira_por_cliente_empreendimento" },
    }).banco;
    const lida = await lerCarteiraDoLsoft({});
    expect(lida.ok).toBe(false);
  });

  it("'incluirQuemEstaNoFinanceiro' devolve todo mundo com o total cheio, mas marcado", async () => {
    duble.banco = bancoFalso(cenario()).banco;
    const lida = await lerCarteiraDoLsoft({ incluirQuemEstaNoFinanceiro: true });
    if (!lida.ok) throw new Error(lida.erro);
    expect(lida.clientes.map((c) => [c.codigo, c.empreendimentosNaCarteira.length])).toEqual([
      ["C1", 1],
      ["C2", 1],
      ["C3", 0],
    ]);
    expect(lida.clientes.find((c) => c.codigo === "C2")?.saldoAberto).toBe(6000.3);
  });

  it("parcela do Garden FORA da 124 fica na integração, em Todos e no recorte do Garden", async () => {
    // C1 tem 8 parcelas no Garden: 7 da 124 (o Financeiro lê) e 1 da 17 (o Financeiro NÃO lê).
    // Antes da revisão de 29/09/2026, as 8 saíam daqui e a da 17 sumia das duas telas.
    const base = cenario();
    const comA17 = (linha: Linha) =>
      linha.codigo === "C1" ? { ...linha, parcelas: 8, parcelas_abertas: 5, saldo_aberto: "4050.10" } : linha;
    const parcela = (id: string, categoria: null | number, valor: number, vencimento: string): Linha => ({
      categoria_lsoft: categoria,
      cliente_codigo: "C1",
      empreendimento: "Garden",
      id,
      lote: "02",
      paga: false,
      quadra: "01",
      valor,
      valor_recebido: 0,
      vencimento,
    });
    const falso = bancoFalso({
      ...base,
      lsoft_carteira_por_cliente: base.lsoft_carteira_por_cliente.map(comA17),
      lsoft_carteira_por_cliente_empreendimento: base.lsoft_carteira_por_cliente_empreendimento.map(comA17),
      // A da 124 está aqui só para provar que a leitura a deixa de fora.
      lsoft_parcelas: [parcela("p124", 124, 100, "2026-10-01"), parcela("p17", 17, 50, "2099-12-01")],
    });
    duble.banco = falso.banco;

    const todos = await lerCarteiraDoLsoft({});
    if (!todos.ok) throw new Error(todos.erro);
    expect(todos.clientes.map((c) => c.codigo)).toEqual(["C1", "C2", "C3"]);
    expect(todos.clientes.find((c) => c.codigo === "C1")).toMatchObject({
      empreendimentos: ["Garden"],
      empreendimentosNaCarteira: ["Garden"],
      parcelas: 1,
      parcelasAbertas: 1,
      patrimonioAReceber: 50,
      proximoVencimento: "2099-12-01",
      saldoAberto: 50,
    });

    const leitura = falso.consultas.find(
      (c) => c.tabela === "lsoft_parcelas" && c.filtros.some(([op]) => op === "or"),
    );
    // `neq` não casa nulo no PostgREST: sem o `is.null`, a parcela sem categoria sumiria.
    expect(leitura?.filtros).toContainEqual(["or", "categoria_lsoft.is.null,categoria_lsoft.neq.124", null]);
    expect(leitura?.ordens).toEqual(["id"]);

    const garden = await lerCarteiraDoLsoft({ empreendimento: "Garden" });
    if (!garden.ok) throw new Error(garden.erro);
    expect(garden.clientes.map((c) => [c.codigo, c.parcelas, c.saldoAberto])).toEqual([
      ["C1", 1, 50],
      ["C3", 7, 100],
    ]);
  });

  it("empreendimento marcado que o Financeiro não lê não tira ninguém daqui, nem ganha selo", async () => {
    const base = cenario();
    duble.banco = bancoFalso({
      ...base,
      lsoft_clientes: [...base.lsoft_clientes.filter((c) => c.codigo !== "C3"), { codigo: "C3", empreendimentos_na_carteira: ["Vale do Sol"] }],
    }).banco;

    const lida = await lerCarteiraDoLsoft({});
    if (!lida.ok) throw new Error(lida.erro);
    expect(lida.clientes.find((c) => c.codigo === "C3")).toMatchObject({ empreendimentosNaCarteira: [], saldoAberto: 100 });
  });

  it("lê em lotes de 100, com ordem fixa, e a lista de quem subiu pela chave", async () => {
    // 150 clientes com o Garden no Financeiro e uma segunda carteira: todos ficam, com desconto.
    const codigos = Array.from({ length: 150 }, (_, i) => `X${String(i).padStart(4, "0")}`);
    const falso = bancoFalso({
      lsoft_carteira_por_cliente: codigos.map((codigo) =>
        daVisaoTodos(codigo, { empreendimentos: ["Garden"], parcelas: 8, parcelas_abertas: 5 }),
      ),
      lsoft_carteira_por_cliente_empreendimento: codigos.flatMap((codigo) => [
        daVisaoPorEmpreendimento(codigo, "Garden"),
        daVisaoPorEmpreendimento(codigo, "On Sky", {
          parcelas: 1,
          parcelas_abertas: 1,
          parcelas_pagas: 0,
          parcelas_vencidas: 0,
          saldo_aberto: "10.00",
          saldo_vencido: "0",
          total_recebido: "0",
          unidades: [],
        }),
      ]),
      lsoft_clientes: codigos.map((codigo) => ({ codigo, empreendimentos_na_carteira: ["Garden"] })),
      lsoft_parcelas: [],
      lsoft_sincronizacoes: [],
    });
    duble.banco = falso.banco;

    const lida = await lerCarteiraDoLsoft({});
    if (!lida.ok) throw new Error(lida.erro);
    expect(lida.clientes).toHaveLength(150);
    expect(lida.clientes.every((c) => c.parcelas === 1 && c.empreendimentos.join() === "On Sky")).toBe(true);

    const daLista = falso.consultas.filter((c) => c.tabela === "lsoft_clientes");
    expect(daLista.every((c) => c.ordens[0] === "codigo")).toBe(true);
    expect(daLista[0]?.filtros).toContainEqual(["neq", "empreendimentos_na_carteira", "{}"]);

    const daView = falso.consultas.filter((c) => c.tabela === "lsoft_carteira_por_cliente_empreendimento");
    expect(daView).toHaveLength(2);
    for (const consulta of daView) {
      expect(consulta.ordens).toEqual(["codigo", "empreendimento"]);
      const lote = consulta.filtros.find(([op]) => op === "in")?.[2] as unknown[];
      expect(lote.length).toBeLessThanOrEqual(100);
    }
  });
});
