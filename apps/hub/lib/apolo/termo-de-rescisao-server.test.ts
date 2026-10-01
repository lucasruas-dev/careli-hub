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
import { montarDadosDaRescisao } from "./termo-de-rescisao";
import {
  carregarTermoDeRescisao,
  conferirContratoDeCorretagemZero,
  recusaPorAvisos,
} from "./termo-de-rescisao-server";

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
  consultasAoSupabase: [] as Array<{
    filtros: Array<[string, unknown]>;
    limite: null | number;
    ordens: Array<[string, unknown]>;
    tabela: string;
  }>,
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
    const registro = {
      filtros: [] as Array<[string, unknown]>,
      limite: null as null | number,
      ordens: [] as Array<[string, unknown]>,
      tabela,
    };
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
      limit: (n: number) => {
        registro.limite = n;
        return construtor;
      },
      maybeSingle: async () => resposta(),
      order: (coluna: string, opcoes: unknown) => {
        registro.ordens.push([coluna, opcoes]);
        return construtor;
      },
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

const TEXTO_DA_CORRETAGEM =
  "R$ 9.000,00 (NOVE MIL REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 2.000,00 (DOIS MIL REAIS) será destinada ao pagamento da COORDENADORA e R$ 7.000,00 destinada aos ASSOCIADOS.";

const TABELA_AUSENTE = {
  code: "PGRST205",
  message: "Could not find the table 'public.hercules_premissas_de_rescisao' in the schema cache",
};

/** Uma linha de `hercules_premissas_de_rescisao` como o PostgREST devolve. */
function premissa(
  rubrica: string,
  sobre: Partial<{ ativa: boolean; base: string; clausula: null | string; enterprise_id: string; percentual: null | string; periodicidade: string }> = {},
) {
  const padrao: Record<string, { base: string; percentual: null | string; periodicidade: string }> = {
    clausula_penal: { base: "valor_de_tabela_menos_comissao", percentual: "10.000", periodicidade: "unica" },
    corretagem: { base: "valor_efetivo", percentual: null, periodicidade: "unica" },
    fruicao: { base: "valor_do_contrato_atualizado", percentual: "0.750", periodicidade: "mensal" },
    publicidade: { base: "valor_de_tabela_menos_comissao", percentual: "4.000", periodicidade: "unica" },
    tributos: { base: "total_pago", percentual: "5.930", periodicidade: "unica" },
  };
  return { ativa: true, clausula: null, enterprise_id: "37", rubrica, ...padrao[rubrica], ...sobre };
}

/** O cadastro inteiro do empreendimento da unidade (37): nenhuma linha cai na praxe. */
const CADASTRO_COMPLETO = ["clausula_penal", "publicidade", "corretagem", "tributos", "fruicao"].map((rubrica) =>
  premissa(rubrica),
);

beforeEach(() => {
  estado.comSupabase = true;
  estado.consultasAoSupabase = [];
  estado.extrato = extratoDe();
  estado.falhaNoC2x = false;
  // O caso normal: o contrato de corretagem traz o valor em reais (2.888 de 3.012, medido em 16/09).
  estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_DA_CORRETAGEM };
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
    hercules_premissas_de_rescisao: { data: CADASTRO_COMPLETO, error: null },
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

const ESCOPO = { c2xId: 77, contratoId: 900002, hoje: HOJE };

// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ⚠️ SEM PREMISSA, O TERMO NÃO SAI (Lucas, 30/09/2026, ao ligar a chave). A praxe é o modelo da
// Lavra do Ouro, e aplicada a outro empreendimento deduziria o que o contrato dele não prevê.
describe("sem premissa, o termo não sai", () => {
  it("empreendimento sem cadastro nenhum: 422 com a frase, e não um papel pela praxe", async () => {
    estado.respostas.hercules_premissas_de_rescisao = { data: [], error: null };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "O termo de rescisão ainda não sai para a unidade VOC0101: o empreendimento não tem premissa de rescisão cadastrada para multa penal, publicidade e tributos. Sem ela, a conta usaria um percentual de praxe que o contrato pode não prever.",
      ok: false,
      status: 422,
    });
  });

  it("tabela das premissas ausente: a mesma recusa, porque tudo cairia na praxe", async () => {
    estado.respostas.hercules_premissas_de_rescisao = { data: null, error: TABELA_AUSENTE };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(!resultado.ok && resultado.error).toContain("não tem premissa de rescisão cadastrada");
  });

  it("cadastro pela metade: a frase cita só a rubrica que falta", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: CADASTRO_COMPLETO.filter((linha) => linha.rubrica !== "tributos"),
      error: null,
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.error).toContain("cadastrada para tributos. Sem ela");
  });

  it("corretagem sem premissa, com o valor em reais do contrato, não conta como praxe", async () => {
    estado.linhaDoC2x = {
      enterprise_id: 37,
      texto_da_corretagem:
        "R$ 9.000,00 (NOVE MIL REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 2.000,00 (DOIS MIL REAIS) será destinada ao pagamento da COORDENADORA e R$ 7.000,00 destinada aos ASSOCIADOS.",
    };
    estado.respostas.hercules_premissas_de_rescisao = {
      data: CADASTRO_COMPLETO.filter((linha) => linha.rubrica !== "corretagem"),
      error: null,
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
  });

  it("com o cadastro completo, o papel sai sem nenhum aviso de praxe", async () => {
    const resultado = await carregarTermoDeRescisao(ESCOPO);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.dados.conta.deducoes.every((linha) => linha.origem === "cadastrada")).toBe(true);
    expect(resultado.dados.conta.avisos.some((aviso) => aviso.includes("praxe"))).toBe(false);
  });

  // ⚠️ VALE DO OURO E RECANTO DO PARÁ: os contratos não preveem publicidade nem tributos. Desligada
  // é decisão, e não ausência: sai sem a linha e sem aviso, e o termo SAI.
  it("rubrica desligada: o termo sai, sem a linha e sem aviso", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: [
        ...CADASTRO_COMPLETO.filter((linha) => linha.rubrica !== "publicidade" && linha.rubrica !== "tributos"),
        premissa("publicidade", { ativa: false, clausula: "O contrato não prevê publicidade.", percentual: null }),
        premissa("tributos", { ativa: false, percentual: null }),
      ],
      error: null,
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(deducaoDe(resultado.dados.conta, "publicidade")).toBeUndefined();
    expect(deducaoDe(resultado.dados.conta, "tributos")).toBeUndefined();
    expect(resultado.dados.conta.avisos.some((aviso) => /Publicidade|Tributos/.test(aviso))).toBe(false);
  });

  it("a premissa do PAI vale para o filho sem mudar código", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: [
        ...CADASTRO_COMPLETO.filter((linha) => linha.rubrica !== "clausula_penal"),
        premissa("clausula_penal", { base: "valor_de_tabela", enterprise_id: "35", percentual: "12.000" }),
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
  // ⚠️ ACHADOS DA REVISÃO DE 30/09/2026: a linha que SOME também segura o papel, e não só a que cai
  // na praxe. Antes, os dois casos abaixo saíam com `ok: true` e um aviso cinza.
  it("posse cadastrada com a fruição sem base: 422, e nunca um papel sem a fruição", async () => {
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(!resultado.ok && resultado.error).toContain("Fruição não entrou na conta");
    expect(!resultado.ok && resultado.error).toContain("unidade VOC0101 sem conferência");
  });

  // ⚠️ O CASO QUE VAZOU PARA O CLIENTE (Recanto do Pará, 30/09/2026): a frase "confira no contrato
  // assinado" ia impressa. Decisão do Lucas em 30/09/2026: corretagem zero recusa e pede conferência.
  it("corretagem R$ 0,00 no contrato de corretagem: 422 com a frase para o operador", async () => {
    estado.linhaDoC2x = {
      enterprise_id: 37,
      texto_da_corretagem:
        "R$ 0,00 (ZERO REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 0,00 (ZERO REAIS) será destinada ao pagamento da COORDENADORA e R$ 0,00 destinada aos ASSOCIADOS.",
    };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: o contrato de corretagem desta venda registra R$ 0,00 de intermediação. Confira no contrato assinado se houve corretagem antes de simular a rescisão; enquanto isso não for esclarecido, a simulação não é emitida.",
      // O código que abre o formulário de conferência no painel (e não a frase).
      motivo: "corretagem_zero",
      ok: false,
      status: 422,
    });
  });

  // ⚠️ POR COMPORTAMENTO, E NÃO PROCURANDO TEXTO NO CÓDIGO. A versão anterior deste teste lia o
  // arquivo do servidor, e a revisão da Publicação (30/09/2026) provou que ela não guardava nada: uma
  // mutação que voltava a filtrar os avisos por texto passou nos 29 testes. Aqui a conta real ganha
  // um aviso INVENTADO, sem nenhuma palavra que um filtro conheceria, e o papel tem de recusar.
  it("um aviso que nenhum código conhece segura o papel do mesmo jeito", () => {
    const inventado = "Aviso inventado pelo teste, sem palavra nenhuma que um filtro reconheça.";

    expect(recusaPorAvisos([inventado], "VOC0101")).toEqual({
      error: `O termo de rescisão não sai para a unidade VOC0101 sem conferência: ${inventado}`,
      ok: false,
      status: 422,
    });
    expect(recusaPorAvisos(["um", "dois"], "VOC0101")).not.toBeNull();
    expect(recusaPorAvisos([], "VOC0101")).toBeNull();
  });

  it("e sem aviso nenhum, o mesmo contrato sai", async () => {
    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.dados.conta.avisos).toEqual([]);
  });

  it("corretagem pelo valor do contrato sem o valor em reais: 422, e nunca multa sobre a tabela cheia", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(!resultado.ok && resultado.error).toContain("Corretagem não entrou na conta");
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

// ⚠️ A CONFERÊNCIA DA CORRETAGEM ZERO (Lucas, 30/09/2026, migration 0202). O que se trava aqui é o
// MOTIVO da recusa (um código, e não o texto), cada resultado da conferência no papel, e a regra de
// que ela só vale onde o C2X diz EXATAMENTE zero.
describe("a conferência da corretagem zero", () => {
  const TEXTO_ZERO =
    "R$ 0,00 (ZERO REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 0,00 (ZERO REAIS) será destinada ao pagamento da COORDENADORA e R$ 0,00 destinada aos ASSOCIADOS.";

  const conferencia = (sobre: Record<string, unknown>) => ({
    data: {
      conferido_em: "2026-09-30T15:00:00.000Z",
      resultado: "sem_corretagem",
      valor_em_reais: null,
      ...sobre,
    },
    error: null,
  });

  beforeEach(() => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_ZERO };
  });

  it("sem conferência: 422 com motivo corretagem_zero", async () => {
    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(!resultado.ok && resultado.motivo).toBe("corretagem_zero");
  });

  it("as outras recusas não levam motivo", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_DA_CORRETAGEM };
    estado.respostas.hercules_premissas_de_rescisao = { data: [], error: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(resultado).not.toHaveProperty("motivo");
  });

  it("sem_corretagem: sai SEM a linha de corretagem e sem aviso", async () => {
    estado.respostas.hercules_conferencia_corretagem = conferencia({ resultado: "sem_corretagem" });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(deducaoDe(resultado.dados.conta, "corretagem")).toBeUndefined();
    expect(resultado.dados.conta.avisos).toEqual([]);
  });

  it("com_corretagem: a linha sai com o valor conferido, 'Conforme contrato' e sem aviso", async () => {
    estado.respostas.hercules_conferencia_corretagem = conferencia({
      resultado: "com_corretagem",
      valor_em_reais: "6000.00",
    });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const linha = deducaoDe(resultado.dados.conta, "corretagem");
    expect(linha?.valor).toBe(6000);
    expect(linha?.base).toBe("Conforme contrato");
    expect(linha?.descricao).toBe("Corretagem (4%)");
    expect(resultado.dados.conta.avisos).toEqual([]);
  });

  // ⚠️ O FUNDAMENTO CONTRATUAL É O DA PREMISSA (01/10/2026, achado da revisão da Publicação). A
  // versão de 30/09 escrevia "conferida no contrato assinado em dd/mm/aaaa" ali; a coluna cita
  // CLÁUSULA DO CONTRATO, e a data da conferência vive só no registro.
  it("com_corretagem mantém a cláusula da premissa cadastrada, sem frase da conferência", async () => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: CADASTRO_COMPLETO.map((linha) =>
        linha.rubrica === "corretagem" ? { ...linha, clausula: "5.2 c)" } : linha,
      ),
      error: null,
    };
    estado.respostas.hercules_conferencia_corretagem = conferencia({
      resultado: "com_corretagem",
      valor_em_reais: 6000,
    });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    const linha = resultado.ok ? deducaoDe(resultado.dados.conta, "corretagem") : undefined;
    expect(linha?.valor).toBe(6000);
    expect(linha?.clausula).toBe("5.2 c)");
  });

  it("com_corretagem sem cláusula na premissa: a cláusula fica nula, e não uma frase inventada", async () => {
    estado.respostas.hercules_conferencia_corretagem = conferencia({
      resultado: "com_corretagem",
      valor_em_reais: 6000,
    });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    const linha = resultado.ok ? deducaoDe(resultado.dados.conta, "corretagem") : undefined;
    expect(linha?.clausula).toBeNull();
  });

  it("devolve qual conferência o papel usou (o header do PDF), e nulo quando não usou", async () => {
    estado.respostas.hercules_conferencia_corretagem = conferencia({ resultado: "sem_corretagem" });
    const semCorretagem = await carregarTermoDeRescisao(ESCOPO);
    expect(semCorretagem.ok && semCorretagem.conferenciaUsada).toBe("sem_corretagem");

    estado.respostas.hercules_conferencia_corretagem = conferencia({
      resultado: "com_corretagem",
      valor_em_reais: 6000,
    });
    const comCorretagem = await carregarTermoDeRescisao(ESCOPO);
    expect(comCorretagem.ok && comCorretagem.conferenciaUsada).toBe("com_corretagem");

    // Comissão que não é zero: a conferência é ignorada, e então o papel não a usou.
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_DA_CORRETAGEM };
    const ignorada = await carregarTermoDeRescisao(ESCOPO);
    expect(ignorada.ok && ignorada.conferenciaUsada).toBeNull();
  });

  // ⚠️ HISTÓRICO (migration 0202, 01/10/2026): vale a mais recente. Sem a ordem e o limite, o
  // `maybeSingle` erraria com duas linhas e o termo cairia em 503 na primeira correção.
  it("lê a conferência MAIS RECENTE (conferido_em desc, id desc, limite 1)", async () => {
    await carregarTermoDeRescisao(ESCOPO);

    const ida = estado.consultasAoSupabase.find((c) => c.tabela === "hercules_conferencia_corretagem");
    expect(ida?.ordens).toEqual([
      ["conferido_em", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(ida?.limite).toBe(1);
  });

  // ⚠️ A CONFERÊNCIA SÓ VALE COM ZERO. Texto de corretagem corrigido no C2X vence a conferência velha.
  it("comissão diferente de zero: a conferência é ignorada", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_DA_CORRETAGEM };
    estado.respostas.hercules_conferencia_corretagem = conferencia({ resultado: "sem_corretagem" });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(deducaoDe(resultado.dados.conta, "corretagem")?.valor).toBe(9000);
  });

  it("comissão nula (texto sem o valor): a conferência é ignorada e a recusa segue", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: null };
    estado.respostas.hercules_conferencia_corretagem = conferencia({ resultado: "sem_corretagem" });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(resultado).not.toHaveProperty("motivo");
  });

  it("erro ao ler a conferência: 503, e não 'sem conferência'", async () => {
    estado.respostas.hercules_conferencia_corretagem = {
      data: null,
      error: { message: "connection reset" },
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(503);
    expect(!resultado.ok && resultado.error).toContain("conferência da corretagem");
  });

  it("resultado desconhecido na linha: 503", async () => {
    estado.respostas.hercules_conferencia_corretagem = conferencia({ resultado: "talvez" });

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(503);
  });

  it("tabela ausente: segue como sem conferência, e a recusa do zero continua", async () => {
    estado.respostas.hercules_conferencia_corretagem = {
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.hercules_conferencia_corretagem' in the schema cache",
      },
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(!resultado.ok && resultado.status).toBe(422);
    expect(!resultado.ok && resultado.motivo).toBe("corretagem_zero");
  });

  it("a conferência é lida junto com a posse, filtrada pelo contrato", async () => {
    await carregarTermoDeRescisao(ESCOPO);

    const ida = estado.consultasAoSupabase.find((c) => c.tabela === "hercules_conferencia_corretagem");
    expect(ida?.filtros).toEqual([
      ["workspace_id", "careli"],
      ["contrato_c2x_id", 900002],
    ]);
  });
});

// ⚠️ A FIAÇÃO DA RECUSA, POR COMPORTAMENTO (01/10/2026, achado da revisão da Publicação). `recusaPorAvisos`
// é testada pura acima, mas a CHAMADA dentro de `carregarTermoDeRescisao` também precisa de guarda:
// uma mutação que filtrava os avisos por texto na chamada (só os que dizem "não entrou na conta" ou
// "R$ 0,00") passava em todos os testes, porque eles só conferiam um pedaço da frase com
// `toContain`. Aqui a frase é COMPLETA, com TODOS os avisos que a conta real produz em cada
// caminho real, e `toEqual`: um aviso que sumir da chamada muda a frase e derruba o teste.
describe("a recusa por avisos, de ponta a ponta", () => {
  const TEXTO_ZERO =
    "R$ 0,00 (ZERO REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 0,00 (ZERO REAIS) será destinada ao pagamento da COORDENADORA e R$ 0,00 destinada aos ASSOCIADOS.";

  it("(i) fruição com posse cadastrada: a frase traz o aviso da fruição por inteiro", async () => {
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: Fruição não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.",
      ok: false,
      status: 422,
    });
  });

  it("(ii) corretagem valor_efetivo sem texto de corretagem: os DOIS avisos entram na frase", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: null };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: Corretagem não entrou na conta: a premissa manda usar o valor do contrato, que não foi informado. Sem a corretagem, a base da multa penal e da publicidade passa a ser o valor de tabela cheio.",
      ok: false,
      status: 422,
    });
  });

  it("(iii) corretagem zero sem conferência: a frase do zero, por inteiro, com o motivo", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_ZERO };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: o contrato de corretagem desta venda registra R$ 0,00 de intermediação. Confira no contrato assinado se houve corretagem antes de simular a rescisão; enquanto isso não for esclarecido, a simulação não é emitida.",
      motivo: "corretagem_zero",
      ok: false,
      status: 422,
    });
  });

  // ⚠️ O `motivo` SÓ VAI COM ZERO E SEM CONFERÊNCIA. Com a conferência gravada (e a posse cadastrada,
  // então sobra o aviso da fruição), a recusa continua, mas o formulário NÃO deve reabrir: o problema
  // já não é a corretagem. A mutação que tira `conferencia.conferencia === null` da condição devolve
  // o motivo aqui e derruba este teste.
  it("zero, conferência gravada e posse cadastrada: recusa 422 SEM motivo", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_ZERO };
    estado.respostas.hercules_conferencia_corretagem = {
      data: { resultado: "sem_corretagem", valor_em_reais: null },
      error: null,
    };
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO);
    expect(resultado).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: Fruição não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.",
      ok: false,
      status: 422,
    });
    expect(resultado).not.toHaveProperty("motivo");
  });
});

// ⚠️ O AVISO DE CADA RUBRICA, PELO CAMINHO REAL (01/10/2026, achado da revisão da Publicação da
// 1.403.1). Os testes acima cobriam o aviso da fruição, o da corretagem e o do zero; um filtro que
// ESCONDESSE por texto o aviso de Multa penal, Publicidade ou Tributos (uma lista de frases
// PROIBIDAS na chamada de `recusaPorAvisos`) passava em todos, porque nenhum teste gerava esses
// avisos pela montagem real. Aqui a premissa cadastrada pede uma base que não veio, a conta real
// escreve "<Rubrica> não entrou na conta: ...", e a recusa tem de trazer a frase COMPLETA, sem a
// costura `dependencias.montar`.
//
// Os caminhos reais que existem hoje: `valor_do_contrato_atualizado` é SEMPRE nulo (nenhuma fonte da
// casa o define, ver `montarDadosDaRescisao`), e `valor_do_contrato` é nulo quando a soma das
// parcelas do contrato é zero (o caso do LOS0618, medido em 1.017 contratos). Os tributos NÃO aceitam
// o "atualizado" (as bases da rubrica são total pago, valor do contrato e valor de tabela, e a leitura
// das premissas ignora a linha com base que não serve), então o caminho real deles é o valor do
// contrato com a soma das parcelas zerada.
describe("o aviso de cada rubrica, pela montagem real", () => {
  /** O cadastro completo, com a base de UMA rubrica trocada. */
  function cadastroComBase(rubrica: string, base: string) {
    return CADASTRO_COMPLETO.map((linha) => (linha.rubrica === rubrica ? { ...linha, base } : linha));
  }

  const BASE_ATUALIZADA = "valor_do_contrato_atualizado";
  const SEM_BASE = "a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.";
  const ABERTURA = "O termo de rescisão não sai para a unidade VOC0101 sem conferência: ";

  /** Um contrato cujas parcelas somam ZERO: o "valor do contrato" não existe, e as rubricas que o pedem avisam. */
  function extratoComParcelasZeradas() {
    const relatorio = montarExtratoDoContrato({
      contrato: CONTRATO,
      hoje: HOJE,
      parcelas: [
        parcela({ id: 1, parcelaAtual: 1, statusId: 7, valorInicial: 0, vencimento: "2026-08-10" }),
        parcela({ id: 2, parcelaAtual: 2, valorInicial: 0, vencimento: "2026-10-10" }),
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

  it.each([
    ["clausula_penal", "Multa penal"],
    ["publicidade", "Publicidade"],
  ])("%s com a base que não veio: 422 com o aviso de %s por inteiro", async (rubrica, rotulo) => {
    estado.respostas.hercules_premissas_de_rescisao = {
      data: cadastroComBase(rubrica, BASE_ATUALIZADA),
      error: null,
    };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: `${ABERTURA}${rotulo} não entrou na conta: ${SEM_BASE}`,
      ok: false,
      status: 422,
    });
  });

  it("tributos sobre o valor do contrato, com a soma das parcelas zerada: o aviso real do LOS0618", async () => {
    estado.extrato = extratoComParcelasZeradas();
    estado.respostas.hercules_premissas_de_rescisao = {
      data: cadastroComBase("tributos", "valor_do_contrato"),
      error: null,
    };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error: `${ABERTURA}Tributos não entrou na conta: a premissa manda calcular sobre o valor do contrato, que não foi informado.`,
      ok: false,
      status: 422,
    });
  });

  it("multa, publicidade, tributos e fruição juntas: a frase leva os quatro avisos na ordem em que a conta os produz", async () => {
    estado.extrato = extratoComParcelasZeradas();
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };
    estado.respostas.hercules_premissas_de_rescisao = {
      data: CADASTRO_COMPLETO.map((linha) => {
        if (linha.rubrica === "tributos") return { ...linha, base: "valor_do_contrato" };
        if (["clausula_penal", "publicidade"].includes(linha.rubrica)) return { ...linha, base: BASE_ATUALIZADA };
        return linha;
      }),
      error: null,
    };

    expect(await carregarTermoDeRescisao(ESCOPO)).toEqual({
      error:
        `${ABERTURA}Multa penal não entrou na conta: ${SEM_BASE} ` +
        `Publicidade não entrou na conta: ${SEM_BASE} ` +
        "Tributos não entrou na conta: a premissa manda calcular sobre o valor do contrato, que não foi informado. " +
        `Fruição não entrou na conta: ${SEM_BASE}`,
      ok: false,
      status: 422,
    });
  });
});

// ⚠️ A CHAMADA NÃO PODE FILTRAR NADA, PROVADA COM UM AVISO QUE NENHUM CÓDIGO CONHECE (01/10/2026,
// achado da segunda revisão da Publicação). Os testes acima usam os avisos REAIS de hoje, e uma lista
// de frases permitidas que casasse com todos eles (por exemplo `/não entrou na conta|Sem a
// corretagem|R\$ 0,00/`) passava em todos, porque nenhum caminho real produz um aviso fora dela.
// `carregarTermoDeRescisao` tem um ponto de injeção pequeno (`dependencias.montar`) só para isto: o
// teste passa uma montagem que chama a real e ACRESCENTA um aviso inventado. Qualquer filtro por
// texto na chamada engole o aviso e o papel sai; aqui ele tem de recusar com a frase inteira.
describe("a chamada de recusaPorAvisos não filtra nada", () => {
  const INVENTADO = "Aviso inventado pelo teste, sem palavra nenhuma que um filtro reconheça.";

  /** A montagem real, com um aviso a mais no fim da conta. */
  const comAvisoInventado: typeof montarDadosDaRescisao = (entrada) => {
    const montado = montarDadosDaRescisao(entrada);
    if (!montado.ok) return montado;
    return {
      ...montado,
      dados: {
        ...montado.dados,
        conta: { ...montado.dados.conta, avisos: [...montado.dados.conta.avisos, INVENTADO] },
      },
    };
  };

  it("o contrato que sairia limpo recusa só por causa do aviso inventado, com a frase inteira", async () => {
    // Sem a injeção, é o mesmo contrato do teste "sem aviso nenhum, sai".
    expect((await carregarTermoDeRescisao(ESCOPO)).ok).toBe(true);

    expect(await carregarTermoDeRescisao(ESCOPO, { montar: comAvisoInventado })).toEqual({
      error: `O termo de rescisão não sai para a unidade VOC0101 sem conferência: ${INVENTADO}`,
      ok: false,
      status: 422,
    });
  });

  it("junto dos avisos reais, a frase leva TODOS, na ordem em que a conta os produziu", async () => {
    estado.respostas.hercules_posse = { data: { data_da_posse: "2025-09-16" }, error: null };

    expect(await carregarTermoDeRescisao(ESCOPO, { montar: comAvisoInventado })).toEqual({
      error:
        "O termo de rescisão não sai para a unidade VOC0101 sem conferência: Fruição não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado. " +
        INVENTADO,
      ok: false,
      status: 422,
    });
  });

  it("na corretagem zero sem conferência, o aviso inventado entra na frase e o motivo continua", async () => {
    estado.linhaDoC2x = {
      enterprise_id: 37,
      texto_da_corretagem:
        "R$ 0,00 (ZERO REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 0,00 (ZERO REAIS) será destinada ao pagamento da COORDENADORA e R$ 0,00 destinada aos ASSOCIADOS.",
    };

    const resultado = await carregarTermoDeRescisao(ESCOPO, { montar: comAvisoInventado });
    expect(!resultado.ok && resultado.error).toContain(`. ${INVENTADO}`);
    expect(!resultado.ok && resultado.motivo).toBe("corretagem_zero");
  });

  it("a costura só troca a montagem: as recusas anteriores a ela seguem as mesmas", async () => {
    estado.respostas.hercules_premissas_de_rescisao = { data: [], error: null };

    const resultado = await carregarTermoDeRescisao(ESCOPO, { montar: comAvisoInventado });
    expect(!resultado.ok && resultado.error).toContain("não tem premissa de rescisão cadastrada");
  });
});

// A guarda da rota que GRAVA a conferência: só SELECT, contrato do cliente e comissão exatamente zero.
describe("a guarda da gravação da conferência", () => {
  const TEXTO_ZERO =
    "R$ 0,00 (ZERO REAIS) refere-se à intermediação imobiliária, sendo que a quantia R$ 0,00 (ZERO REAIS) será destinada ao pagamento da COORDENADORA e R$ 0,00 destinada aos ASSOCIADOS.";

  it("contrato do cliente e comissão zero: libera", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_ZERO };
    expect(await conferirContratoDeCorretagemZero({ c2xId: 77, contratoId: 900002 })).toEqual({ ok: true, valorDeTabela: 150000 });
  });

  it("contrato que não é do cliente: 404", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: TEXTO_ZERO };
    const resultado = await conferirContratoDeCorretagemZero({ c2xId: 77, contratoId: 123 });
    expect(!resultado.ok && resultado.status).toBe(404);
  });

  it("comissão diferente de zero: 422", async () => {
    const resultado = await conferirContratoDeCorretagemZero({ c2xId: 77, contratoId: 900002 });
    expect(!resultado.ok && resultado.status).toBe(422);
  });

  // ⚠️ PARA LER (GET da rota) NÃO SE EXIGE ZERO (01/10/2026): quem corrige uma conferência antiga
  // precisa vê-la mesmo que o C2X já tenha sido corrigido. O pertencimento continua conferido.
  it("exigirZero: false lê mesmo com a comissão diferente de zero, mas segue conferindo o cliente", async () => {
    const lendo = await conferirContratoDeCorretagemZero(
      { c2xId: 77, contratoId: 900002 },
      { exigirZero: false },
    );
    expect(lendo.ok).toBe(true);

    const deOutro = await conferirContratoDeCorretagemZero(
      { c2xId: 77, contratoId: 123 },
      { exigirZero: false },
    );
    expect(!deOutro.ok && deOutro.status).toBe(404);
  });

  it("comissão não achada no texto: 422, e não zero", async () => {
    estado.linhaDoC2x = { enterprise_id: 37, texto_da_corretagem: null };
    const resultado = await conferirContratoDeCorretagemZero({ c2xId: 77, contratoId: 900002 });
    expect(!resultado.ok && resultado.status).toBe(422);
  });

  it("C2X fora do ar: 503", async () => {
    estado.falhaNoC2x = true;
    const resultado = await conferirContratoDeCorretagemZero({ c2xId: 77, contratoId: 900002 });
    expect(!resultado.ok && resultado.status).toBe(503);
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
