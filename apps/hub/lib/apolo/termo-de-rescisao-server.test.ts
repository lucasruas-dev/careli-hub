import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  montarExtratoDoContrato,
  TIPO_ATO,
  TIPO_MENSAL,
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteParcelaBruta,
} from "./extrato-cliente";
import { deducaoDe } from "./rescisao";
import { carregarTermoDeRescisao } from "./termo-de-rescisao-server";

// A LEITURA DO TERMO DE RESCISÃO — os três bancos simulados, e o que cada falha vira.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA É A DIFERENÇA ENTRE "NÃO CONSEGUI LER" E "NÃO TEM". São as duas
// respostas que o papel não pode confundir: posse ilegível tratada como "sem posse" tira a fruição
// do termo calada; premissa ilegível tratada como "sem premissa" imprime "praxe" sobre um
// empreendimento que tem cadastro. A ÚNICA ausência que segue em frente é a da TABELA das premissas
// (migration 0166 pendente) — porque ali não existe cadastro para perder.
//
// ⚠️ E METADE É LIDA COMO TEXTO, pela mesma razão da rota da posse: o `workspace_id` trocado por um
// uuid não dá erro de tipo nem quebra teste de comportamento com cliente simulado — ele só casa zero
// linhas em produção.

const FONTE = readFileSync(join(__dirname, "termo-de-rescisao-server.ts"), "utf8");
const CODIGO = FONTE.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

const HOJE = "2026-09-16";

const estado = vi.hoisted(() => ({
  comSupabase: true,
  consultasAoSupabase: [] as Array<{ filtros: Array<[string, unknown]>; tabela: string }>,
  extrato: null as unknown,
  falhaNoC2x: false,
  linhaDoC2x: { enterprise_id: 37, texto_da_corretagem: null as null | string },
  respostas: {} as Record<string, { data: unknown; error: null | { code?: string; message: string } }>,
}));

vi.mock("@/lib/apolo/extrato-cliente-c2x", () => ({
  loadExtratoDoCliente: vi.fn(async () => estado.extrato),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async () => {
        if (estado.falhaNoC2x) throw new Error("ETIMEDOUT");
        return [[estado.linhaDoC2x]];
      },
    },
  }),
}));

vi.mock("@/lib/apolo/server", () => {
  /** Um construtor de consulta que só anota os filtros e devolve a resposta combinada da tabela. */
  function consulta(tabela: string) {
    const registro = { filtros: [] as Array<[string, unknown]>, tabela };
    estado.consultasAoSupabase.push(registro);

    const chave = () => {
      if (tabela !== "hercules_empreendimentos") return tabela;
      return registro.filtros.some(([coluna]) => coluna === "id")
        ? "hercules_empreendimentos:pai"
        : "hercules_empreendimentos";
    };
    const resposta = () => estado.respostas[chave()] ?? { data: null, error: null };

    const construtor = {
      eq: (coluna: string, valor: unknown) => {
        registro.filtros.push([coluna, valor]);
        return construtor;
      },
      in: (coluna: string, valor: unknown) => {
        registro.filtros.push([coluna, valor]);
        return construtor;
      },
      maybeSingle: async () => resposta(),
      select: () => construtor,
      then: (resolver: (valor: unknown) => unknown) => Promise.resolve(resposta()).then(resolver),
    };
    return construtor;
  }

  return {
    createApoloAdminClient: () => (estado.comSupabase ? { from: consulta } : null),
  };
});

// ───────────────────────────────────────────────────────────────────────────────────────────────

const CONTRATO: ExtratoClienteContrato = {
  area: 400,
  codigo: "VOC0101",
  dataAssinatura: null,
  dataAto: "2025-01-10",
  empreendimentoCodigo: "VOC",
  empreendimentoNome: "VALE DO OURO",
  encerrado: false,
  estagio: 4,
  estagioNome: "Faturado",
  id: 900002,
  indiceCorrecao: "IPCA ANUAL",
  jurosContratuais: null,
  lote: "01",
  planoPadraoParcelas: 120,
  planoParcelas: 120,
  planoPersonalizado: false,
  precoTabela: 150000,
  quadra: "01",
  titulares: [
    { documentoMascarado: "***.123.456-**", nome: "CLIENTE DE TESTE", ordem: 1, percentual: null },
  ],
};

function parcela(sobre: Partial<ExtratoClienteParcelaBruta> & { id: number }): ExtratoClienteParcelaBruta {
  return {
    aExcluir: false,
    boletoUrl: "https://asaas.test/boleto",
    competencia: null,
    descricao: null,
    faturaUrl: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcelaAtual: null,
    parcelaTotal: 120,
    sinalAtual: null,
    sinalTotal: null,
    statusId: 6,
    tipo: "Parcela",
    tipoId: TIPO_MENSAL,
    valorInicial: 0,
    valorPago: 0,
    vencimento: null,
    ...sobre,
  };
}

function extratoDe(contrato: Partial<ExtratoClienteContrato> = {}): { data: ExtratoClienteData; ok: true } {
  const relatorio = montarExtratoDoContrato({
    contrato: { ...CONTRATO, ...contrato },
    hoje: HOJE,
    parcelas: [
      parcela({
        id: 1,
        pagamento: "2025-01-10",
        statusId: 5,
        tipo: "Ato",
        tipoId: TIPO_ATO,
        valorInicial: 15000,
        valorPago: 15000,
        vencimento: "2025-01-10",
      }),
      parcela({ id: 2, parcelaAtual: 1, statusId: 7, valorInicial: 1200, vencimento: "2026-08-10" }),
      parcela({ id: 3, parcelaAtual: 2, valorInicial: 1200, vencimento: "2026-10-10" }),
    ],
  });

  return {
    data: {
      cliente: { c2xId: 77, documentoMascarado: "***.123.456-**", nome: "CLIENTE DE TESTE" },
      contratos: [relatorio],
      posicaoEm: HOJE,
    },
    ok: true,
  };
}

const TABELA_AUSENTE = {
  code: "PGRST205",
  message: "Could not find the table 'public.hercules_premissas_de_rescisao' in the schema cache",
};

beforeEach(() => {
  estado.comSupabase = true;
  estado.consultasAoSupabase = [];
  estado.extrato = extratoDe();
  estado.falhaNoC2x = false;
  estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: null };
  estado.respostas = {
    hercules_empreendimentos: {
      data: [{ cidade: "Cidade de Teste", pai_id: "uuid-do-pai", uf: "MG" }],
      error: null,
    },
    "hercules_empreendimentos:pai": {
      data: [{ c2x_enterprise_id: "35", cidade: "Cidade de Teste", uf: "MG" }],
      error: null,
    },
    hercules_posse: { data: null, error: null },
    hercules_premissas_de_rescisao: { data: null, error: TABELA_AUSENTE },
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

const ESCOPO = { c2xId: 77, contratoId: 900002, hoje: HOJE };

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("o termo de HOJE, com a migration 0166 pendente", () => {
  it("tabela das premissas ausente: o termo SAI, pela praxe, e o papel avisa", async () => {
    const resultado = await carregarTermoDeRescisao(ESCOPO);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.dados.conta.avisos).toContain(
      "Multa penal usou o percentual de praxe (10%): não há premissa cadastrada para este empreendimento.",
    );
  });

  it("e o dia em que a tabela existir, a premissa do PAI vale para o filho sem mudar código", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: [
        {
          ativa: true,
          base: "valor_de_tabela",
          clausula: null,
          enterprise_id: "35",
          percentual: "12.000",
          periodicidade: "unica",
          rubrica: "clausula_penal",
        },
      ],
      error: null,
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // 12% sobre 150.000, cadastrado no PAI (35) e lido para a unidade do filho (37).
    expect(deducaoDe(resultado.dados.conta, "clausula_penal")?.valor).toBe(18000);
    expect(resultado.dados.conta.avisos.some((aviso) => aviso.startsWith("Multa penal"))).toBe(false);

    // Os dois degraus foram pedidos, o filho primeiro.
    const premissas = estado.consultasAoSupabase.find((c) => c.tabela === "hercules_premissas_de_rescisao");
    expect(premissas?.filtros).toContainEqual(["enterprise_id", ["37", "35"]]);
  });
});

describe("não conseguir ler NÃO vira 'não tem'", () => {
  it("premissas com erro que não é tabela ausente: 503, e não praxe", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: "Não foi possível ler as premissas de rescisão deste empreendimento.",
      ok: false,
      status: 503,
    });
  });

  // ⚠️ ERRO DE COLUNA NÃO É TABELA AUSENTE. `ehTabelaAusente` recusa a mensagem que fala de coluna,
  // e o termo tem de recusar junto — uma 0166 aplicada pela metade não pode passar por "pendente".
  it("coluna ausente nas premissas também é 503", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: null,
      error: {
        code: "PGRST204",
        message: "Could not find the 'clausula' column of 'hercules_premissas_de_rescisao' in the schema cache",
      },
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.status).toBe(503);
  });

  it("posse ilegível: 503 com a frase, e nunca um termo sem fruição", async () => {
    estado.respostas.hercules_posse = { data: null, error: { message: "fetch failed" } };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "Não foi possível ler a posse deste contrato, e sem ela o termo não sabe se há fruição a deduzir.",
      ok: false,
      status: 503,
    });
  });

  it("cadastro do empreendimento ilegível: 503, e não 'sem pai'", async () => {
    estado.respostas.hercules_empreendimentos = { data: null, error: { message: "fetch failed" } };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.status).toBe(503);
    expect(!resultado.ok && resultado.error).toContain("herda premissas do principal");
  });

  it("C2X fora do ar na leitura do contrato: 503", async () => {
    estado.falhaNoC2x = true;

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: "Não foi possível ler o contrato no C2X.",
      ok: false,
      status: 503,
    });
  });

  it("sem Supabase: 503 com a frase", async () => {
    estado.comSupabase = false;

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(503);
    expect(!resultado.ok && resultado.error).toContain("Supabase indisponível");
  });

  it("extrato indisponível: 503 com o erro do próprio extrato", async () => {
    estado.extrato = { error: "Nao foi possivel carregar o extrato do cliente.", ok: false };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: "Nao foi possivel carregar o extrato do cliente.",
      ok: false,
      status: 503,
    });
  });
});

describe("as recusas do contrato", () => {
  it("contrato que não é deste cliente: 404", async () => {
    const resultado = await carregarTermoDeRescisao({ ...ESCOPO, contratoId: 123 });
    expect(!resultado.ok && resultado.status).toBe(404);
  });

  // ⚠️ A RECUSA DO CONTRATO VEM ANTES DO SUPABASE: a frase certa sai mesmo sem banco do Panteon.
  it("contrato encerrado: 422 com a frase, sem nem abrir o Supabase", async () => {
    estado.extrato = extratoDe({ encerrado: true, estagio: 7 });
    estado.comSupabase = false;

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: "O termo de rescisão só sai para contrato em curso, e este está cancelado.",
      ok: false,
      status: 422,
    });
    expect(estado.consultasAoSupabase).toHaveLength(0);
  });

  it("unidade sem preço: 422", async () => {
    estado.extrato = extratoDe({ precoTabela: 1 });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
  });
});

describe("o que cada fonte entrega ao papel", () => {
  it("a posse cadastrada chega à conta (e a fruição sem base sai com aviso)", async () => {
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.dados.conta.avisos.some((aviso) => aviso.startsWith("Fruição não entrou"))).toBe(true);
  });

  it("a comissão do contrato de corretagem vira a linha 'Conforme contrato'", async () => {
    estado.linhaDoC2x = {
      enterprise_id: 37,
      texto_da_corretagem:
        "R$ 9.000,00 (NOVE MIL REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 2.000,00 (DOIS MIL REAIS) será destinada ao pagamento da COORDENADORA e R$ 7.000,00 destinada aos ASSOCIADOS.",
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const linha = deducaoDe(resultado.dados.conta, "corretagem");
    expect(linha?.valor).toBe(9000);
    expect(linha?.descricao).toBe("Corretagem (6%)");
  });

  it("o município vem do cadastro do Panteon; o filho sem cidade herda a do pai", async () => {
    estado.respostas.hercules_empreendimentos = {
      data: [{ cidade: null, pai_id: "uuid-do-pai", uf: null }],
      error: null,
    };
    estado.respostas["hercules_empreendimentos:pai"] = {
      data: [{ c2x_enterprise_id: "35", cidade: "Cidade do Pai", uf: "MG" }],
      error: null,
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok && resultado.dados.imovel.cidade).toBe("Cidade do Pai");
    expect(resultado.ok && resultado.dados.imovel.uf).toBe("MG");
  });

  // ⚠️ O LOX DA LAVRA DO OURO É PAI SEM ID DO C2X. Sem id não há premissa dele para herdar, e o termo
  // pergunta só pelo próprio degrau — igual à tela de premissas.
  it("pai sem id do C2X: só o degrau do filho é pedido", async () => {
    estado.respostas["hercules_empreendimentos:pai"] = {
      data: [{ c2x_enterprise_id: null, cidade: "Cidade de Teste", uf: "MG" }],
      error: null,
    };
    estado.respostas.hercules_premissas_de_rescisao = { data: [], error: null };

    await carregarTermoDeRescisao(ESCOPO);
    const premissas = estado.consultasAoSupabase.find((c) => c.tabela === "hercules_premissas_de_rescisao");
    expect(premissas?.filtros).toContainEqual(["enterprise_id", ["37"]]);
  });
});

describe("o arquivo, lido como texto", () => {
  it("o workspace é `careli`, e não um uuid", () => {
    expect(FONTE).toContain('const WORKSPACE = "careli"');
    expect(FONTE).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });

  it("toda ida ao Supabase filtra pelo workspace", () => {
    const idas = CODIGO.split(".from(").length - 1;
    const filtros = CODIGO.split('.eq("workspace_id", WORKSPACE)').length - 1;
    expect(idas).toBeGreaterThan(0);
    expect(filtros).toBe(idas);
  });

  it("a ausência da tabela é decidida pela régua da casa, e não por uma cópia", () => {
    expect(CODIGO).toContain('import { ehTabelaAusente } from "@/lib/temis/tabela-ausente"');
    expect(CODIGO).toContain("ehTabelaAusente(error, TABELA_DAS_PREMISSAS)");
  });

  it("a precedência é a de `premissasDoRecorte`, e não uma escrita aqui", () => {
    expect(CODIGO).toContain("premissasDoRecorte(");
    expect(CODIGO).not.toContain("itensDoMenorRecorte");
  });

  it("o C2X só é lido (nenhum comando de escrita)", () => {
    expect(CODIGO).not.toMatch(/\b(insert|update|delete|replace)\s+(into|from)?\s*\w+/i);
  });
});
