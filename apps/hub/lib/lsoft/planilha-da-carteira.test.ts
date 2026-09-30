import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

// O servidor do Apolo arrasta MySQL e metade do Panteon; aqui só interessa a planilha. As leituras
// recebem o cliente do banco por parâmetro, então o falso entra direto, sem rede. Só
// `exportarCarteiraDoLsoft` pega o banco e a lista por conta própria: os dois dublês abaixo existem
// para os testes dela (fora deles o banco é `null`, como antes).
const duble = vi.hoisted(() => ({ banco: null as unknown, carteira: null as unknown }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => duble.banco }));
vi.mock("@/lib/lsoft/carteira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lsoft/carteira")>()),
  lerCarteiraDoLsoft: async () => duble.carteira,
}));

import type { ClienteDaCarteira } from "@/lib/lsoft/carteira";
import {
  COLUNAS_DAS_PARCELAS,
  COLUNAS_DOS_CLIENTES,
  divergenciaDoPatrimonio,
  empreendimentoDoRecorte,
  exportarCarteiraDoLsoft,
  instanteNaCasa,
  lerParcelasDoRecorte,
  lerPatrimonioDoRecorte,
  linhaDaParcela,
  linhaDoCliente,
  nomeDoArquivo,
  type ParcelaDoArquivo,
  planilhaDaCarteiraLsoft,
  situacaoDaParcela,
} from "@/lib/lsoft/planilha-da-carteira";

// ── Dados sintéticos ────────────────────────────────────────────────────────

function cliente(sobrescreve: Partial<ClienteDaCarteira> = {}): ClienteDaCarteira {
  return {
    caixaALiberar: 0,
    caixaJaLiberado: 0,
    camposC2xPreenchidos: 5,
    camposC2xTotal: 9,
    celular: null,
    cidade: null,
    codigo: "00000001",
    cpf: "01234567890",
    cpfFormatado: "012.345.678-90",
    email: null,
    empreendimentos: ["Garden"],
    empreendimentosNaCarteira: [],
    enriquecidoEm: null,
    nome: "Maria da Silva",
    parcelas: 3,
    parcelasAbertas: 2,
    parcelasAValidar: 0,
    parcelasCaixa: 0,
    parcelasPagas: 1,
    parcelasVencidas: 1,
    patrimonioAReceber: 0,
    patrimonioParcelasAbertas: 0,
    proximoVencimento: "2026-09-28",
    saldoAberto: 2000,
    saldoVencido: 1000,
    statusValidacao: "em_analise",
    telefone: null,
    totalCaixa: 0,
    totalRecebido: 1000,
    unidades: ["Q01 L01", "Q01 L02", "Q02 L07"],
    valorAValidar: 0,
    ...sobrescreve,
  };
}

function parcela(sobrescreve: Partial<ParcelaDoArquivo> = {}): ParcelaDoArquivo {
  return {
    categoriaLsoft: 124,
    clienteCodigo: "00000001",
    dataRecebido: null,
    empreendimento: "Garden",
    id: "p-1",
    lote: "01",
    observacoes: "LOTE 01 QD 01",
    paga: false,
    parcela: "001/120",
    parcelaNumero: 1,
    parcelaTotal: 120,
    quadra: "01",
    subsidio: null,
    valor: 1000,
    valorRecebido: 0,
    vencimento: "2026-09-28",
    ...sobrescreve,
  };
}

const SEM_FILTRO = { busca: "", empreendimento: "", somentePatrimonio: false, somentePendentes: false };

/** 29/09/2026 às 22:30 em São Paulo: em UTC já é dia 30. É a janela em que o fuso morde. */
const NOITE_DO_DIA_29 = new Date("2026-09-30T01:30:00Z");
/** 30/09/2026 às 00:30 em São Paulo. */
const MADRUGADA_DO_DIA_30 = new Date("2026-09-30T03:30:00Z");

/** Lê o arquivo gerado de volta: é a única prova de que ele abre. */
async function abrir(buffer: ArrayBuffer) {
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(buffer);
  return livro;
}

function aba(livro: ExcelJS.Workbook, nome: string) {
  const achada = livro.getWorksheet(nome);
  if (!achada) throw new Error(`aba ${nome} não encontrada`);
  return achada;
}

const coluna = (colunas: readonly { titulo: string }[], titulo: string) =>
  colunas.findIndex((c) => c.titulo === titulo) + 1;

/** A aba Sobre como mapa de "item" para "valor". */
function sobreComoMapa(livro: ExcelJS.Workbook): Map<string, unknown> {
  const mapa = new Map<string, unknown>();
  aba(livro, "Sobre").eachRow((linha) => {
    mapa.set(String(linha.getCell(1).value), linha.getCell(2).value);
  });
  return mapa;
}

// ── A situação da parcela ───────────────────────────────────────────────────

describe("situacaoDaParcela", () => {
  it("paga é paga, venha o vencimento que vier", () => {
    expect(situacaoDaParcela({ paga: true, vencimento: "2020-01-01" }, "2026-09-29")).toBe("Paga");
  });

  it("a régua é a da view: vencimento ESTRITAMENTE antes de hoje", () => {
    expect(situacaoDaParcela({ paga: false, vencimento: "2026-09-28" }, "2026-09-29")).toBe("Vencida");
    // A que vence hoje ainda está a vencer (`vencimento < current_date` na 0097 e na 0107).
    expect(situacaoDaParcela({ paga: false, vencimento: "2026-09-29" }, "2026-09-29")).toBe("A vencer");
    expect(situacaoDaParcela({ paga: false, vencimento: "2026-10-10" }, "2026-09-29")).toBe("A vencer");
  });

  it("sem vencimento nunca vence, como no Postgres (null < data não é verdadeiro)", () => {
    expect(situacaoDaParcela({ paga: false, vencimento: null }, "2026-09-29")).toBe("A vencer");
  });
});

// ── As linhas ───────────────────────────────────────────────────────────────

describe("linhaDoCliente", () => {
  it("traz TODAS as unidades (a tela mostra só duas) e o cadastro como 5/9", () => {
    const linha = linhaDoCliente(cliente());
    expect(linha.unidades).toBe("Q01 L01, Q01 L02, Q02 L07");
    expect(linha.cadastroC2x).toBe("5/9");
    expect(linha.validacao).toBe("Em análise");
    expect(linha.patrimonio).toBe("Não");
  });

  it("sem o CPF formatado do LSoft, formata os dígitos em vez de deixar o Excel comer o zero", () => {
    expect(linhaDoCliente(cliente({ cpfFormatado: null })).documento).toBe("012.345.678-90");
  });

  it("sem CPF nenhum, a célula fica vazia, e não 'null' escrito", () => {
    expect(linhaDoCliente(cliente({ cpf: null, cpfFormatado: null })).documento).toBe("");
  });

  it("com empreendimento escolhido, o cadastro sai em branco, e não o 0/9 inventado pela falta da coluna", () => {
    // A view por empreendimento (0107) não tem campos_c2x_*; `lerCarteiraDoLsoft` completa com 0 e 9.
    const doValeDoSol = cliente({ camposC2xPreenchidos: 0, camposC2xTotal: 9, statusValidacao: "validado" });
    expect(linhaDoCliente(doValeDoSol, true).cadastroC2x).toBe("");
    expect(linhaDoCliente(cliente(), false).cadastroC2x).toBe("5/9");
  });
});

describe("linhaDaParcela", () => {
  it("parcela em aberto com recebido zero não mostra 0: nada foi recebido ainda", () => {
    expect(linhaDaParcela(parcela(), cliente(), "2026-09-29").valorRecebido).toBeNull();
  });

  it("parcela paga mostra o recebido e a data como texto dd/mm/aaaa", () => {
    const linha = linhaDaParcela(
      parcela({ dataRecebido: "2026-09-02", paga: true, valorRecebido: 1000 }),
      cliente(),
      "2026-09-29",
    );
    expect(linha.valorRecebido).toBe(1000);
    expect(linha.recebidoEm).toBe("02/09/2026");
    expect(linha.situacao).toBe("Paga");
  });

  it("quebra de linha e caractere de controle do Access viram espaço, e não XML inválido", () => {
    const sujo = `LOTE 01${String.fromCharCode(10)}QD 01${String.fromCharCode(1)}  FIM`;
    expect(linhaDaParcela(parcela({ observacoes: sujo }), cliente(), "2026-09-29").observacoes).toBe(
      "LOTE 01 QD 01 FIM",
    );
  });

  it("o subsídio da Caixa sai com o rótulo da tela", () => {
    expect(linhaDaParcela(parcela({ subsidio: "confirmada" }), cliente(), "2026-09-29").subsidio).toBe(
      "Confirmada",
    );
    expect(linhaDaParcela(parcela({ subsidio: "a_validar" }), cliente(), "2026-09-29").subsidio).toBe(
      "A validar",
    );
    expect(linhaDaParcela(parcela(), cliente(), "2026-09-29").subsidio).toBe("");
  });

  it("sem o texto da parcela, monta a numeração dos números", () => {
    expect(linhaDaParcela(parcela({ parcela: null }), cliente(), "2026-09-29").parcela).toBe("1/120");
  });
});

// ── O arquivo ───────────────────────────────────────────────────────────────

describe("planilhaDaCarteiraLsoft", () => {
  it("abre com as três abas, os cabeçalhos certos e os totais", async () => {
    const livro = await abrir(
      await planilhaDaCarteiraLsoft({
        agora: NOITE_DO_DIA_29,
        clientes: [cliente(), cliente({ codigo: "00000002", cpfFormatado: "987.654.321-00", nome: "João" })],
        filtro: SEM_FILTRO,
        parcelas: [
          parcela(),
          parcela({ id: "p-2", paga: true, valorRecebido: 1000, dataRecebido: "2026-09-02" }),
          parcela({ clienteCodigo: "00000002", id: "p-3", valor: 500 }),
        ],
        sincronizadoEm: "2026-09-24T18:05:00Z",
      }),
    );

    expect(livro.worksheets.map((w) => w.name)).toEqual(["Clientes", "Parcelas", "Sobre"]);

    const clientes = aba(livro, "Clientes");
    expect((clientes.getRow(1).values as unknown[]).slice(1)).toEqual(COLUNAS_DOS_CLIENTES.map((c) => c.titulo));
    // Cabeçalho + 2 clientes + total.
    expect(clientes.rowCount).toBe(4);
    const aReceber = coluna(COLUNAS_DOS_CLIENTES, "A receber");
    expect(clientes.getRow(4).getCell(1).value).toBe("2 cliente(s)");
    expect(clientes.getRow(4).getCell(aReceber).value).toBe(4000);
    expect(clientes.getRow(4).font?.bold).toBe(true);

    const parcelas = aba(livro, "Parcelas");
    expect((parcelas.getRow(1).values as unknown[]).slice(1)).toEqual(COLUNAS_DAS_PARCELAS.map((c) => c.titulo));
    expect(parcelas.rowCount).toBe(5);
    const valor = coluna(COLUNAS_DAS_PARCELAS, "Valor");
    const recebido = coluna(COLUNAS_DAS_PARCELAS, "Valor recebido");
    expect(parcelas.getRow(5).getCell(1).value).toBe("3 parcela(s)");
    expect(parcelas.getRow(5).getCell(valor).value).toBe(2500);
    expect(parcelas.getRow(5).getCell(recebido).value).toBe(1000);

    // Cabeçalho congelado com filtro, como as outras exportações da casa.
    expect(parcelas.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(parcelas.autoFilter).toBeTruthy();
  });

  it("CPF é TEXTO com o zero à esquerda; dinheiro é NÚMERO com formato de moeda", async () => {
    const livro = await abrir(
      await planilhaDaCarteiraLsoft({
        agora: NOITE_DO_DIA_29,
        clientes: [cliente()],
        filtro: SEM_FILTRO,
        parcelas: [parcela()],
        sincronizadoEm: null,
      }),
    );

    const clientes = aba(livro, "Clientes");
    const cpf = clientes.getRow(2).getCell(coluna(COLUNAS_DOS_CLIENTES, "CPF/CNPJ"));
    expect(cpf.value).toBe("012.345.678-90");
    expect(typeof cpf.value).toBe("string");

    const aReceber = clientes.getRow(2).getCell(coluna(COLUNAS_DOS_CLIENTES, "A receber"));
    expect(aReceber.value).toBe(2000);
    expect(aReceber.numFmt).toBe("R$ #,##0.00");

    const parcelas = aba(livro, "Parcelas");
    expect(parcelas.getRow(2).getCell(coluna(COLUNAS_DAS_PARCELAS, "CPF/CNPJ")).value).toBe("012.345.678-90");
    expect(parcelas.getRow(2).getCell(coluna(COLUNAS_DAS_PARCELAS, "Valor")).value).toBe(1000);
  });

  it("data é TEXTO dd/mm/aaaa, e o que não existe é célula VAZIA, não zero nem 'null'", async () => {
    const livro = await abrir(
      await planilhaDaCarteiraLsoft({
        agora: NOITE_DO_DIA_29,
        clientes: [cliente()],
        filtro: SEM_FILTRO,
        parcelas: [parcela({ lote: null, quadra: null })],
        sincronizadoEm: null,
      }),
    );

    const linha = aba(livro, "Parcelas").getRow(2);
    expect(linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Vencimento")).value).toBe("28/09/2026");
    expect(linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Recebido em")).value).toBeNull();
    expect(linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Valor recebido")).value).toBeNull();
    expect(linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Quadra")).value).toBeNull();
    expect(linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Subsídio Caixa")).value).toBeNull();

    const proximo = aba(livro, "Clientes").getRow(2).getCell(coluna(COLUNAS_DOS_CLIENTES, "Próximo vencimento"));
    expect(proximo.value).toBe("28/09/2026");
  });

  it("na virada do dia vale São Paulo: às 22h30 do dia 29 a parcela do dia 29 ainda está a vencer", async () => {
    const gerar = async (agora: Date) => {
      const livro = await abrir(
        await planilhaDaCarteiraLsoft({
          agora,
          clientes: [cliente()],
          filtro: SEM_FILTRO,
          parcelas: [parcela({ vencimento: "2026-09-29" })],
          sincronizadoEm: null,
        }),
      );
      return aba(livro, "Parcelas").getRow(2).getCell(coluna(COLUNAS_DAS_PARCELAS, "Situação")).value;
    };

    // Em UTC já seria dia 30 e a parcela sairia "Vencida" três horas antes da hora.
    expect(await gerar(NOITE_DO_DIA_29)).toBe("A vencer");
    expect(await gerar(MADRUGADA_DO_DIA_30)).toBe("Vencida");
  });

  it("a aba Parcelas segue a ordem dos clientes da tela e, dentro de cada um, o vencimento", async () => {
    const livro = await abrir(
      await planilhaDaCarteiraLsoft({
        agora: NOITE_DO_DIA_29,
        // A tela ordena por nome: "Ana" (2) antes de "Bruno" (1).
        clientes: [cliente({ codigo: "2", nome: "Ana" }), cliente({ codigo: "1", nome: "Bruno" })],
        filtro: SEM_FILTRO,
        parcelas: [
          parcela({ clienteCodigo: "1", id: "a", vencimento: "2026-01-10" }),
          parcela({ clienteCodigo: "2", id: "b", vencimento: "2026-03-10" }),
          parcela({ clienteCodigo: "2", id: "c", vencimento: null }),
          parcela({ clienteCodigo: "2", id: "d", vencimento: "2026-02-10" }),
        ],
        sincronizadoEm: null,
      }),
    );

    const parcelas = aba(livro, "Parcelas");
    const vencimentos = [2, 3, 4, 5].map((n) => [
      parcelas.getRow(n).getCell(coluna(COLUNAS_DAS_PARCELAS, "Cliente")).value,
      parcelas.getRow(n).getCell(coluna(COLUNAS_DAS_PARCELAS, "Vencimento")).value,
    ]);
    expect(vencimentos).toEqual([
      ["Ana", "10/02/2026"],
      ["Ana", "10/03/2026"],
      ["Ana", null],
      ["Bruno", "10/01/2026"],
    ]);
  });

  it("a aba Sobre diz o filtro, a data da carga no fuso de São Paulo e a regra do recorte", async () => {
    const comEmpreendimento = sobreComoMapa(
      await abrir(
        await planilhaDaCarteiraLsoft({
          agora: NOITE_DO_DIA_29,
          clientes: [cliente()],
          filtro: { busca: "Maria", empreendimento: "Vale do Sol", somentePatrimonio: true, somentePendentes: false },
          parcelas: [parcela()],
          sincronizadoEm: "2026-09-24T18:05:00Z",
        }),
      ),
    );

    expect(comEmpreendimento.get("Tela")).toBe("LSoft Integração");
    expect(comEmpreendimento.get("Empreendimento")).toBe("Vale do Sol");
    expect(comEmpreendimento.get("Busca")).toBe("Maria");
    expect(comEmpreendimento.get("Só o que falta validar")).toBe("Não");
    expect(comEmpreendimento.get("Só patrimônio")).toBe("Sim");
    expect(comEmpreendimento.get("Dados do LSoft de")).toBe("24/09/2026 15:05");
    expect(comEmpreendimento.get("Gerado em")).toBe("29/09/2026 22:30");
    expect(comEmpreendimento.get("Clientes")).toBe(1);
    expect(comEmpreendimento.get("Parcelas")).toBe(1);
    expect(String(comEmpreendimento.get("A receber"))).toContain("NÃO contam a parcela confirmada");
    // A 0107 tira a Caixa confirmada também do Recebido (`not p.eh_caixa and p.paga`), e as duas
    // views só somam recebido de parcela paga: o arquivo diz, porque a aba Parcelas soma tudo.
    expect(String(comEmpreendimento.get("A receber"))).toContain("O Recebido");
    expect(String(comEmpreendimento.get("Recebido"))).toContain("parcela já paga");
    expect(String(comEmpreendimento.get("Aba Parcelas"))).toContain("Valor recebido");
    expect(String(comEmpreendimento.get("Aba Parcelas"))).toContain("Caixa confirmada");
    expect(String(comEmpreendimento.get("Cadastro p/ C2X"))).toContain("em branco");

    const todos = sobreComoMapa(
      await abrir(
        await planilhaDaCarteiraLsoft({
          agora: NOITE_DO_DIA_29,
          clientes: [cliente()],
          filtro: SEM_FILTRO,
          parcelas: [],
          sincronizadoEm: null,
        }),
      ),
    );
    expect(todos.get("Empreendimento")).toBe("Todos os empreendimentos");
    expect(todos.get("Busca")).toBe("Nenhuma");
    expect(todos.get("Dados do LSoft de")).toBe("Sem carga registrada");
    // Na visão de todos, a view (0097) soma inclusive o que é da Caixa, e o arquivo diz isso.
    expect(String(todos.get("A receber"))).toContain("inclusive as confirmadas");
    expect(String(todos.get("Recebido"))).toContain("parcela já paga");
    // A carteira que subiu para o Financeiro não está no arquivo, e ele diz isso nas duas visões.
    expect(String(todos.get("Financeiro"))).toContain("não entra neste arquivo");
    expect(String(comEmpreendimento.get("Financeiro"))).toContain("não entra neste arquivo");
    // Em Todos o cadastro vem da 0097, que tem a coluna: nada de nota sobre ele.
    expect(todos.has("Cadastro p/ C2X")).toBe(false);

    // ⚠️ Nenhum texto do arquivo usa travessão (preferência do Lucas para texto que o cliente lê).
    for (const valor of [...comEmpreendimento.values(), ...todos.values()]) {
      expect(String(valor)).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it("com empreendimento escolhido, a célula do cadastro fica VAZIA na aba Clientes; em Todos, 5/9", async () => {
    const celulaDoCadastro = async (empreendimento: string) => {
      const livro = await abrir(
        await planilhaDaCarteiraLsoft({
          agora: NOITE_DO_DIA_29,
          clientes: [cliente()],
          filtro: { ...SEM_FILTRO, empreendimento },
          parcelas: [],
          sincronizadoEm: null,
        }),
      );
      return aba(livro, "Clientes").getRow(2).getCell(coluna(COLUNAS_DOS_CLIENTES, "Cadastro p/ C2X")).value;
    };

    expect(await celulaDoCadastro("Vale do Sol")).toBeNull();
    expect(await celulaDoCadastro("")).toBe("5/9");
  });

  it("sem cliente nenhum, o arquivo sai coerente: cabeçalhos, totais zerados e o filtro escrito", async () => {
    const livro = await abrir(
      await planilhaDaCarteiraLsoft({
        agora: NOITE_DO_DIA_29,
        clientes: [],
        filtro: { ...SEM_FILTRO, somentePendentes: true },
        parcelas: [],
        sincronizadoEm: null,
      }),
    );

    const clientes = aba(livro, "Clientes");
    expect(clientes.rowCount).toBe(2);
    expect(clientes.getRow(2).getCell(1).value).toBe("0 cliente(s)");
    expect(clientes.getRow(2).getCell(coluna(COLUNAS_DOS_CLIENTES, "A receber")).value).toBe(0);
    expect(aba(livro, "Parcelas").getRow(2).getCell(1).value).toBe("0 parcela(s)");

    const sobre = sobreComoMapa(livro);
    expect(sobre.get("Clientes")).toBe(0);
    expect(sobre.get("Só o que falta validar")).toBe("Sim");
  });
});

describe("nomeDoArquivo", () => {
  it("tira acento, espaço e pontuação do empreendimento", () => {
    expect(nomeDoArquivo("Vale do Ouro - 2", "2026-09-29")).toBe("lsoft-vale-do-ouro-2-2026-09-29.xlsx");
    expect(nomeDoArquivo("Guaimbé", "2026-09-29")).toBe("lsoft-guaimbe-2026-09-29.xlsx");
    expect(nomeDoArquivo("Ed. Cristal", "2026-09-29")).toBe("lsoft-ed-cristal-2026-09-29.xlsx");
  });

  it("sem empreendimento, 'todos'", () => {
    expect(nomeDoArquivo(null, "2026-09-29")).toBe("lsoft-todos-2026-09-29.xlsx");
  });
});

describe("empreendimentoDoRecorte", () => {
  it("fora da lista do espelho é ignorado, como a leitura da tela faz", () => {
    expect(empreendimentoDoRecorte("Vale do Sol")).toBe("Vale do Sol");
    expect(empreendimentoDoRecorte("Inventado")).toBeNull();
    expect(empreendimentoDoRecorte("")).toBeNull();
  });
});

describe("instanteNaCasa", () => {
  it("formata no fuso de São Paulo, sem vírgula", () => {
    expect(instanteNaCasa("2026-09-30T01:30:00Z")).toBe("29/09/2026 22:30");
    expect(instanteNaCasa(null)).toBe("");
    expect(instanteNaCasa("lixo")).toBe("");
  });
});

describe("divergenciaDoPatrimonio", () => {
  const patrimonio = (sobrescreve: Partial<ParcelaDoArquivo>) => parcela({ categoriaLsoft: 17, ...sobrescreve });

  it("fecha quando a lista e as parcelas contam o mesmo patrimônio em aberto", () => {
    expect(
      divergenciaDoPatrimonio(
        [cliente({ patrimonioAReceber: 1500, patrimonioParcelasAbertas: 2 })],
        [
          patrimonio({ id: "a", valor: 1000 }),
          patrimonio({ id: "b", valor: 500 }),
          // Paga e fora da 17 não entram: é a regra de `lerCarteiraDoLsoft`.
          patrimonio({ id: "c", paga: true, valor: 999 }),
          parcela({ id: "d", valor: 999 }),
        ],
      ),
    ).toBeNull();
  });

  it("acusa quando a lista veio com o patrimônio zerado (a leitura dele falhou calada)", () => {
    expect(
      divergenciaDoPatrimonio([cliente()], [patrimonio({ id: "a", valor: 1000 })]),
    ).toMatch(/1 cliente\(s\)/);
  });
});

// ── A leitura das parcelas ──────────────────────────────────────────────────

type Linha = Record<string, unknown>;

/**
 * Um PostgREST de mentira: filtra, ordena, pagina, conta e CORTA em `teto` linhas por resposta,
 * como o de verdade faz com 1.000. Registra cada consulta para o teste conferir o que foi pedido.
 */
function bancoFalso(
  tabelas: Record<string, Linha[]>,
  opcoes: { falharEm?: { de: number; tabela: string }; teto?: number } = {},
) {
  const consultas: Array<{
    filtros: Array<[string, string, unknown]>;
    ordem: null | string;
    range: [number, number];
    tabela: string;
  }> = [];

  const banco = {
    from(tabela: string) {
      const estado = { contar: false, filtros: [] as Array<[string, string, unknown]>, ordem: null as null | string };
      const consulta = {
        eq(coluna: string, valor: unknown) {
          estado.filtros.push(["eq", coluna, valor]);
          return consulta;
        },
        in(coluna: string, valores: readonly unknown[]) {
          estado.filtros.push(["in", coluna, valores]);
          return consulta;
        },
        order(coluna: string) {
          estado.ordem = coluna;
          return consulta;
        },
        range(de: number, ate: number) {
          consultas.push({ filtros: estado.filtros, ordem: estado.ordem, range: [de, ate], tabela });
          if (opcoes.falharEm?.tabela === tabela && opcoes.falharEm.de === de) {
            return Promise.resolve({ count: null, data: null, error: { message: "timeout" } });
          }
          let linhas = (tabelas[tabela] ?? []).filter((linha) =>
            estado.filtros.every(([op, c, v]) =>
              op === "in" ? (v as unknown[]).includes(linha[c]) : linha[c] === v,
            ),
          );
          if (estado.ordem) {
            const campo = estado.ordem;
            linhas = [...linhas].sort((a, b) => String(a[campo]).localeCompare(String(b[campo])));
          }
          const teto = opcoes.teto ?? 1000;
          return Promise.resolve({
            count: estado.contar ? linhas.length : null,
            data: linhas.slice(de, Math.min(ate + 1, de + teto)),
            error: null,
          });
        },
        select(_colunas: string, opcoesDoSelect?: { count?: string }) {
          estado.contar = opcoesDoSelect?.count === "exact";
          return consulta;
        },
      };
      return consulta;
    },
  };

  return { banco: banco as unknown as Parameters<typeof lerParcelasDoRecorte>[0], consultas };
}

/** 250 clientes; o cliente 0 tem 1.200 parcelas (passa de uma página sozinho), os outros, duas. */
function carteiraGrande() {
  const codigos = Array.from({ length: 250 }, (_, i) => String(i).padStart(8, "0"));
  const parcelas: Linha[] = [];
  let seq = 0;
  for (const [indice, codigo] of codigos.entries()) {
    const quantas = indice === 0 ? 1200 : 2;
    for (let n = 0; n < quantas; n += 1) {
      seq += 1;
      parcelas.push({
        categoria_lsoft: 124,
        cliente_codigo: codigo,
        empreendimento: n % 2 === 0 ? "Garden" : "Vale do Sol",
        id: `id-${String(seq).padStart(6, "0")}`,
        paga: false,
        valor: 100,
        vencimento: "2026-10-10",
      });
    }
  }
  return { codigos, parcelas };
}

describe("lerParcelasDoRecorte", () => {
  it("lê tudo, em lotes de 100 clientes, paginado e SEMPRE ordenado por id", async () => {
    const { codigos, parcelas } = carteiraGrande();
    const { banco, consultas } = bancoFalso({ lsoft_classificacao_de_parcela: [], lsoft_parcelas: parcelas });

    const lidas = await lerParcelasDoRecorte(banco, { codigos, empreendimento: null });

    expect(lidas).toHaveLength(parcelas.length);
    expect(new Set(lidas.map((p) => p.id)).size).toBe(parcelas.length);

    for (const consulta of consultas) {
      // ⚠️ Sem ordem fixa o PostgREST repete e pula linha entre páginas (medido em 24/09/2026).
      expect(consulta.ordem).toBe("id");
      const lista = consulta.filtros.find(([op]) => op === "in")?.[2] as unknown[];
      // ⚠️ Lista grande no `.in()` estoura a URL (700 ids = 400 Bad Request).
      expect(lista.length).toBeLessThanOrEqual(100);
    }
    // O primeiro lote (cliente 0 com 1.200 + 99 × 2) precisou de duas páginas.
    expect(consultas.filter((c) => c.tabela === "lsoft_parcelas" && c.range[0] === 1000)).toHaveLength(1);
  });

  it("com empreendimento escolhido, lê SÓ as parcelas dele", async () => {
    const { codigos, parcelas } = carteiraGrande();
    const { banco, consultas } = bancoFalso({ lsoft_classificacao_de_parcela: [], lsoft_parcelas: parcelas });

    const lidas = await lerParcelasDoRecorte(banco, { codigos, empreendimento: "Vale do Sol" });

    expect(lidas.length).toBe(parcelas.filter((p) => p.empreendimento === "Vale do Sol").length);
    expect(lidas.every((p) => p.empreendimento === "Vale do Sol")).toBe(true);
    for (const consulta of consultas.filter((c) => c.tabela === "lsoft_parcelas")) {
      expect(consulta.filtros).toContainEqual(["eq", "empreendimento", "Vale do Sol"]);
    }
  });

  it("casa o subsídio da Caixa pela parcela; a classe 'carteira' não é subsídio; duplicata vale a confirmada", async () => {
    const { banco } = bancoFalso({
      lsoft_classificacao_de_parcela: [
        { classe: "caixa", cliente_codigo: "1", id: "k1", parcela_id: "p1", situacao: "a_validar" },
        { classe: "caixa", cliente_codigo: "1", id: "k2", parcela_id: "p1", situacao: "confirmada" },
        { classe: "carteira", cliente_codigo: "1", id: "k3", parcela_id: "p2", situacao: "confirmada" },
        { classe: "caixa", cliente_codigo: "1", id: "k4", parcela_id: "p3", situacao: "rejeitada" },
      ],
      lsoft_parcelas: [
        { cliente_codigo: "1", empreendimento: "Vale do Sol", id: "p1", paga: false, valor: 170455 },
        { cliente_codigo: "1", empreendimento: "Vale do Sol", id: "p2", paga: false, valor: 10 },
        { cliente_codigo: "1", empreendimento: "Vale do Sol", id: "p3", paga: false, valor: 10 },
      ],
    });

    const lidas = await lerParcelasDoRecorte(banco, { codigos: ["1"], empreendimento: null });
    expect(Object.fromEntries(lidas.map((p) => [p.id, p.subsidio]))).toEqual({
      p1: "confirmada",
      p2: null,
      p3: "rejeitada",
    });
  });

  it("erro no meio da paginação derruba a leitura: nada de arquivo pela metade", async () => {
    const { codigos, parcelas } = carteiraGrande();
    // A primeira página do primeiro lote vem inteira; a segunda (a partir da linha 1.000) falha.
    const { banco } = bancoFalso(
      { lsoft_classificacao_de_parcela: [], lsoft_parcelas: parcelas },
      { falharEm: { de: 1000, tabela: "lsoft_parcelas" } },
    );

    await expect(lerParcelasDoRecorte(banco, { codigos, empreendimento: null })).rejects.toThrow(/falhou/);
  });

  it("servidor que corta abaixo do esperado é pego pela contagem, e não passa calado", async () => {
    const { codigos, parcelas } = carteiraGrande();
    // Um PostgREST com `max-rows` 500: a primeira página volta com 500 e o laço acharia que acabou.
    const { banco } = bancoFalso(
      { lsoft_classificacao_de_parcela: [], lsoft_parcelas: parcelas },
      { teto: 500 },
    );

    await expect(lerParcelasDoRecorte(banco, { codigos, empreendimento: null })).rejects.toThrow(
      /incompleta/,
    );
  });

  it("sem cliente, não consulta nada", async () => {
    const { banco, consultas } = bancoFalso({});
    expect(await lerParcelasDoRecorte(banco, { codigos: [], empreendimento: null })).toEqual([]);
    expect(consultas).toHaveLength(0);
  });
});

// ── A exportação inteira: a prova do patrimônio vem ANTES dos checkboxes ────

describe("exportarCarteiraDoLsoft", () => {
  /** Parcela de patrimônio (categoria 17) em aberto, no formato do banco. */
  const patrimonioEmAberto = (id: string, clienteCodigo: string, valor: number): Linha => ({
    categoria_lsoft: 17,
    cliente_codigo: clienteCodigo,
    empreendimento: "Garden",
    id,
    paga: false,
    valor,
    vencimento: "2026-10-10",
  });

  const lista = (clientes: ClienteDaCarteira[]) => ({
    clientes,
    ok: true,
    resumo: { sincronizadoEm: null },
  });

  const SO_PATRIMONIO = { ...SEM_FILTRO, somentePatrimonio: true };

  it("com 'Só patrimônio', patrimônio zerado calado na lista NÃO vira arquivo vazio com cara de completo", async () => {
    // `lerCarteiraDoLsoft` engoliu a falha do patrimônio (carteira.ts, só loga) e devolveu todos
    // zerados. O checkbox tiraria os dois da lista, e a conferência antiga comparava vazio com vazio.
    duble.carteira = lista([cliente({ codigo: "A" }), cliente({ codigo: "B" })]);
    duble.banco = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [patrimonioEmAberto("p1", "A", 1000), patrimonioEmAberto("p2", "B", 500)],
    }).banco;

    const resultado = await exportarCarteiraDoLsoft(SO_PATRIMONIO, NOITE_DO_DIA_29);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? "" : resultado.erro).toMatch(/patrimônio de 2 cliente\(s\) não fechou/);
  });

  it("falha PARCIAL (uma página do patrimônio perdida) também é pega, e não some só um cliente", async () => {
    // A ficou certo (página 1); B ficou zerado (página 2 perdida). O checkbox deixaria só A.
    duble.carteira = lista([
      cliente({ codigo: "A", patrimonioAReceber: 1000, patrimonioParcelasAbertas: 1 }),
      cliente({ codigo: "B" }),
    ]);
    duble.banco = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [patrimonioEmAberto("p1", "A", 1000), patrimonioEmAberto("p2", "B", 500)],
    }).banco;

    const resultado = await exportarCarteiraDoLsoft(SO_PATRIMONIO, NOITE_DO_DIA_29);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? "" : resultado.erro).toMatch(/1 cliente\(s\)/);
  });

  it("se a própria prova não consegue ler, a exportação recusa em vez de confiar na lista", async () => {
    duble.carteira = lista([cliente({ codigo: "A", patrimonioAReceber: 1000, patrimonioParcelasAbertas: 1 })]);
    duble.banco = bancoFalso(
      { lsoft_classificacao_de_parcela: [], lsoft_parcelas: [patrimonioEmAberto("p1", "A", 1000)] },
      { falharEm: { de: 0, tabela: "lsoft_parcelas" } },
    ).banco;

    const resultado = await exportarCarteiraDoLsoft(SO_PATRIMONIO, NOITE_DO_DIA_29);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? "" : resultado.erro).toMatch(/patrimônio falhou/);
  });

  it("lista saudável com 'Só patrimônio': sai o arquivo só com quem tem patrimônio", async () => {
    duble.carteira = lista([
      cliente({ codigo: "A", patrimonioAReceber: 1000, patrimonioParcelasAbertas: 1 }),
      cliente({ codigo: "B" }),
    ]);
    duble.banco = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [
        patrimonioEmAberto("p1", "A", 1000),
        { ...patrimonioEmAberto("p2", "B", 300), categoria_lsoft: 124 },
      ],
    }).banco;

    const resultado = await exportarCarteiraDoLsoft(SO_PATRIMONIO, NOITE_DO_DIA_29);
    expect(resultado).toMatchObject({ clientes: 1, nome: "lsoft-todos-2026-09-29.xlsx", ok: true, parcelas: 1 });
  });

  it("a aba Parcelas NÃO traz o par (cliente, empreendimento) que já está no Financeiro", async () => {
    // A lista já vem descontada (`lerCarteiraDoLsoft`): A ficou aqui pelo Giant Towers, com o Garden
    // no Financeiro; B tem o Garden na integração (não subiu).
    duble.carteira = lista([
      cliente({ codigo: "A", empreendimentos: ["Giant Towers"], empreendimentosNaCarteira: ["Garden"] }),
      cliente({ codigo: "B" }),
    ]);
    const emAberto = (id: string, clienteCodigo: string, empreendimento: string): Linha => ({
      categoria_lsoft: 124,
      cliente_codigo: clienteCodigo,
      empreendimento,
      id,
      paga: false,
      valor: 100,
      vencimento: "2026-10-10",
    });
    duble.banco = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [
        emAberto("p1", "A", "Garden"),
        emAberto("p2", "A", "Garden"),
        emAberto("p3", "A", "Giant Towers"),
        emAberto("p4", "B", "Garden"),
      ],
    }).banco;

    const resultado = await exportarCarteiraDoLsoft(SEM_FILTRO, NOITE_DO_DIA_29);
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(resultado).toMatchObject({ clientes: 2, parcelas: 2 });

    const parcelas = aba(await abrir(resultado.arquivo), "Parcelas");
    const pares: Array<[unknown, unknown]> = [];
    parcelas.eachRow((linha, numero) => {
      if (numero === 1 || numero === parcelas.rowCount) return;
      pares.push([
        linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Código")).value,
        linha.getCell(coluna(COLUNAS_DAS_PARCELAS, "Empreendimento")).value,
      ]);
    });
    expect(pares.sort()).toEqual([
      ["A", "Giant Towers"],
      ["B", "Garden"],
    ]);
  });

  it("parcela do par no Financeiro FORA da categoria dele fica na aba Parcelas, e o patrimônio fecha", async () => {
    // A tem o Garden no Financeiro, mas uma parcela do Garden é da 17 (patrimônio), que o Financeiro
    // não lê. Antes da revisão de 29/09/2026 ela saía do arquivo com o par inteiro: não estava em
    // tela nenhuma, e a conferência do patrimônio recusava o arquivo (lista 50, parcelas 0).
    duble.carteira = lista([
      cliente({
        codigo: "A",
        empreendimentos: ["Garden", "Giant Towers"],
        empreendimentosNaCarteira: ["Garden"],
        patrimonioAReceber: 50,
        patrimonioParcelasAbertas: 1,
      }),
    ]);
    const emAberto = (id: string, empreendimento: string, categoria: number, valor: number): Linha => ({
      categoria_lsoft: categoria,
      cliente_codigo: "A",
      empreendimento,
      id,
      paga: false,
      valor,
      vencimento: "2026-10-10",
    });
    duble.banco = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [
        emAberto("p1", "Garden", 124, 100),
        emAberto("p2", "Garden", 17, 50),
        emAberto("p3", "Giant Towers", 118, 100),
      ],
    }).banco;

    const resultado = await exportarCarteiraDoLsoft(SEM_FILTRO, NOITE_DO_DIA_29);
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(resultado).toMatchObject({ clientes: 1, parcelas: 2 });
  });

  it("a prova do patrimônio lê o recorte do empreendimento, ordenada e contada", async () => {
    duble.carteira = lista([cliente({ codigo: "A", patrimonioAReceber: 1000, patrimonioParcelasAbertas: 1 })]);
    const falso = bancoFalso({
      lsoft_classificacao_de_parcela: [],
      lsoft_parcelas: [
        { ...patrimonioEmAberto("p1", "A", 1000), empreendimento: "Vale do Sol" },
        // Patrimônio do mesmo cliente noutro empreendimento: fora do recorte, não entra na prova.
        patrimonioEmAberto("p2", "A", 700),
      ],
    });
    duble.banco = falso.banco;

    const resultado = await exportarCarteiraDoLsoft(
      { ...SEM_FILTRO, empreendimento: "Vale do Sol" },
      NOITE_DO_DIA_29,
    );
    expect(resultado.ok).toBe(true);

    const prova = falso.consultas.find((c) => c.filtros.some(([, coluna]) => coluna === "categoria_lsoft"));
    expect(prova?.ordem).toBe("id");
    expect(prova?.filtros).toContainEqual(["eq", "empreendimento", "Vale do Sol"]);
    expect(prova?.filtros).toContainEqual(["eq", "paga", false]);
  });
});

describe("lerPatrimonioDoRecorte", () => {
  it("servidor que corta abaixo do esperado é pego pela contagem", async () => {
    const parcelas = Array.from({ length: 1200 }, (_, i) => ({
      categoria_lsoft: 17,
      cliente_codigo: "A",
      empreendimento: "Garden",
      id: `id-${String(i).padStart(6, "0")}`,
      paga: false,
      valor: 1,
    }));
    const { banco } = bancoFalso({ lsoft_parcelas: parcelas }, { teto: 500 });
    await expect(lerPatrimonioDoRecorte(banco, null)).rejects.toThrow(/incompleta/);
  });
});
