import { beforeEach, describe, expect, it, vi } from "vitest";

// A PREMISSA QUE O CORRETOR ESCOLHEU CHEGA AO SERVIDOR, E É ELA QUE GRAVA (24/09/2026).
//
// Nívea, sobre a proposta 000038 (Vale do Ouro VOC, Quadra 12 · Lote 22, compradora TAISA FERNANDA
// BATISTA): *"Na proposta não está saindo o novo cenário de juros e correção."* Lucas, no mesmo dia:
// *"vamos corrigir isso ae"*. Ela havia zerado "Juros % a.m." e escolhido "Correção = poupança
// anual" na tela, o resumo ao lado dizia "sem juros, com poupança anual", e o PDF saiu com "Juros
// 0,7207% a.m." e "Correção IPCA anual".
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: O DEFEITO NÃO ERA DO PAPEL, ERA DA CONTA — E ESTÁ GRAVADO. Medido em
// 25/09/2026 (`select valor, contrato_parcelas, plano_juros, plano_correcao, condicoes->'totais'
// from hercules_propostas where protocolo_numero = 38`): `valor` 138.401,00, 48 parcelas,
// `plano_juros` 0,7207, `plano_correcao` "IPCA anual" e `totais.mensais` 138.130,32. Sem juros
// seriam 48 × R$ 2.595,00 = R$ 124.560,00. São R$ 13.570,32 numa venda de R$ 138.401,00, gravados —
// e o cronograma gravado é o que alimenta o contrato (`lib/temis/tabela-de-pagamentos.ts`).
//
// ⚠️ E O R$ 2.595,00 QUE A CORRETORA CONFERIU NA TELA ERA O ÚNICO NÚMERO IDÊNTICO NOS DOIS
// CENÁRIOS: no SACOC o primeiro ciclo é amortização pura, 124.560 ÷ 48 = 2.595,00 com ou sem juros.
// Do 13º mês em diante eles se separam — 2.719,84 / 2.964,61 / 3.231,41 na proposta gravada.
//
// ⚠️ A FAIXA DE PRAZO ENTRA DE CARONA, e é medição, não suposição: a rota NUNCA leu
// `temis_faixas_de_prazo` no POST (o grep de `faixasDePrazo` achava só a linha do GET). Medido em
// 25/09/2026 (`select enterprise_id, parcela_minima, parcela_maxima, define_juros, juros_taxa,
// define_indice, indice_correcao, ativo from temis_faixas_de_prazo where enterprise_id = '37'`): o
// VOC tem três faixas ATIVAS — 1 a 24 e 25 a 36 com juros 0,0000 e SEM_CORRECAO, e 37 a 156 com
// 0,7207 e IPCA_ANUAL. A terceira coincide com o plano NORMAL do cadastro (é por isso que a 000038,
// de 48 parcelas, não muda de preço por causa dela); as duas primeiras isentam juros que o cadastro
// cobra, e a primeira proposta do VOC com 36 parcelas ou menos cobraria juros que a diretoria
// isentou.
//
// Os mocks são os de `route.plano-por-id.test.ts`, com o cadastro do VOC no lugar do Garden e as
// faixas de prazo vindas de `estado.faixas`.

const estado = vi.hoisted(() => ({
  apagado: [] as Array<{ tabela: string }>,
  /** Quantas vezes o WhatsApp da venda foi chamado, e quantas o registro de "não enviado". */
  avisados: 0,
  com0170: true,
  /** Leituras de quem opera o produto (a régua de escrita, D1). O comercial não faz nenhuma. */
  leuCadastroDeOperacao: 0,
  naoEnviados: 0,
  sessao: { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" } as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
  /** Simula a reserva ter saído de 'ativa' entre a leitura e o flip: update casa ZERO linhas. */
  reservaJaSaiu: false,
  /** Propostas vivas de OUTRA venda no terreno, como a trava do lote as lê (em lista). */
  propostasDeOutros: [] as Array<Record<string, unknown>>,
  atualizado: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  credenciado: true,
  /** Os planos do empreendimento, como `comoPlano` os entrega (com o id da linha). */
  planos: [] as Array<Record<string, unknown>>,
  /** As faixas de prazo do empreendimento, como `lerFaixasDoPanteon` as entrega. */
  faixas: [] as Array<Record<string, unknown>>,
  /** A leitura das faixas falhou? É o caso em que a rota NÃO grava — dinheiro na dúvida. */
  faixasQuebram: false,
  /** As folhas que foram para o desenhista do PDF. */
  folhas: [] as unknown[],
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
}));

/**
 * O LOTE DA 000038, como o banco o tem (SELECT de 25/09/2026): Vale do Ouro VOC, Quadra 12 · Lote
 * 22, preço de tabela R$ 148.401,00 — e a proposta saiu por R$ 138.401,00, R$ 10.000 de desconto.
 */
const UNIDADE = {
  area: "300.00",
  codigo: "VOC1222",
  enterprise_id: "37",
  id: "uni-1",
  lote: "22",
  preco_tabela: "148401.00",
  quadra: "12",
  situacao: "reservada",
};

/**
 * Os três planos do VOC como `comoPlano` os entrega (SELECT em `temis_planos` de 25/09/2026, com o
 * id real de cada linha). O NORMAL é o da 000038: 156 parcelas, 0,7207% ao MÊS e IPCA anual.
 */
const PLANOS = vi.hoisted(() => () => {
  const base = {
    anuaisQuantidade: null,
    anuaisValor: null,
    categoriaId: null,
    descontoPercentual: 0,
    enterpriseId: "37",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
    sistemaAmortizacao: "sacoc",
    slot: null,
  };
  return [
    { ...base, entradaPercentual: 10, id: "21b694ed-13d7-47ef-a983-bb09145b79c7", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.7207, nome: "NORMAL", parcelas: 156 },
    { ...base, entradaPercentual: 20, id: "e3c55a25-6401-4aa8-8d90-9b577ab5772b", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0, nome: "CURTO", parcelas: 36 },
    { ...base, entradaPercentual: 20, id: "d59b0675-8d6b-4c91-ab36-6f36283d3ab8", indiceCorrecao: "SEM_CORRECAO", jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 24 },
  ];
});

/**
 * As faixas ATIVAS do VOC (enterprise 37), como `lerFaixasDoPanteon` as entrega — SELECT de
 * 25/09/2026. As duas primeiras isentam juros e correção; a terceira repete o cadastro do NORMAL.
 */
const FAIXAS = vi.hoisted(() => () => {
  const base = {
    defineEntrada: true,
    defineIndice: true,
    defineJuros: true,
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
  };
  return [
    { ...base, entradaPercentual: 20, indiceCorrecao: "SEM_CORRECAO", jurosTaxa: 0, parcelaMaxima: 24, parcelaMinima: 1 },
    { ...base, entradaPercentual: 20, indiceCorrecao: "SEM_CORRECAO", jurosTaxa: 0, parcelaMaxima: 36, parcelaMinima: 25 },
    { ...base, entradaPercentual: 10, indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.7207, parcelaMaxima: 156, parcelaMinima: 37 },
  ];
});

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["37"],
  };
});

// ⚠️ O PORTÃO É `autorizarOperacaoDeVenda`, E NÃO `autorizar`. A diferença é o portal da sessão: as
// rotas de venda ficavam abertas a QUALQUER cookie `apolo_inc` válido, e o do incorporador é o mesmo
// dos portais de loteador — o dono do empreendimento podia cancelar por HTTP a proposta do time
// comercial e disparar WhatsApp em nome da Careli, sem que a aba Venda sequer apareça para ele.
// Desde 16/09/2026 passam o comercial e o incorporador que opera a própria venda (o Cecílio); o 404
// dos demais está provado com cookie assinado de verdade em board-do-portal.test.ts.
vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  // A revalidação da conta do portal (cookie de 12 horas) é de outro teste; aqui ela aprova.
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [{ codes: ["VOC"], stageIds: ["37"] }],
}));

vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: () => ["37"],
}));

// O VOC é da Careli: o comercial opera, e não há portal que confeccione sozinho aqui.
const CADASTRO = vi.hoisted(() => [
  {
    c2xEnterpriseId: "37",
    cidade: "Goiânia",
    codigo: "VOC",
    id: "emp-voc",
    nome: "Vale do Ouro",
    operadoPor: null,
    ordem: 1,
    paiId: null,
    uf: "GO",
    vendendo: true,
  },
]);

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => {
    estado.leuCadastroDeOperacao += 1;
    return { com0170: estado.com0170, linhas: CADASTRO };
  },
}));

vi.mock("@/lib/hercules/quem-pode-vender", () => ({ familiaDoEmpreendimento: () => ["37"] }));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  // ⚠️ A LEITURA DAS FAIXAS É A MESMA DO GET, e não uma segunda. A rota passou a chamá-la também no
  // POST em 25/09/2026: sem ela, a faixa aprovada pela diretoria valia na tela e não valia no que
  // ficava gravado.
  lerFaixasDoPanteon: async () => {
    if (estado.faixasQuebram) throw new Error("timeout lendo temis_faixas_de_prazo");
    return { "37": estado.faixas };
  },
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [{ planos: estado.planos }],
}));

vi.mock("@/lib/hercules/cliente-credenciado", () => ({
  credenciadoParaVender: async () => ({
    credenciado: estado.credenciado,
    desde: "2026-09-01",
    entityId: "ent-cliente",
    etapa: "credenciado",
    motivo: null,
  }),
  FalhaAoLerCredenciamento: class extends Error {},
}));

vi.mock("@/lib/hercules/avisos-da-venda", async () => {
  const { portalConfeccionaContrato } = await import("@/lib/apolo/incorporador/perfis-de-portal");
  return {
    avisarSobreAVenda: async () => {
      estado.avisados += 1;
      return [{ ok: true, para: "imobiliaria" }];
    },
    destinatariosDaVenda: async () => ({
      coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
      corretor: { nome: "João Souza", telefone: "62988887777" },
      imobiliaria: { nome: "GURGEL", telefone: "6232220000" },
    }),
    registrarAvisoNaoEnviado: async () => {
      estado.naoEnviados += 1;
      return [];
    },
    // A régua de verdade é testada em avisos-da-venda.test.ts; aqui ela é refeita sem o gateway.
    vendaAvisaPeloWhatsapp: (sessao: { slug?: null | string; tipo?: null | string }) =>
      !portalConfeccionaContrato(sessao.slug, sessao.tipo),
  };
});

// O PDF de verdade é caro e não é o assunto deste teste — o insert acontece antes dele.
vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([1, 2, 3]);
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const feito: {
      insert: null | Record<string, unknown>;
      select: boolean;
      soLinhasDoPai: boolean;
      unica: boolean;
      update: boolean;
    } = {
      insert: null,
      select: false,
      soLinhasDoPai: false,
      unica: false,
      update: false,
    };
    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(responder(tabela, feito)).then(aceitar, recusar),
    };
    for (const metodo of ["eq", "in", "is", "limit", "or", "order", "range"]) {
      alvo[metodo] = () => alvo;
    }
    for (const metodo of ["maybeSingle", "single"]) {
      alvo[metodo] = () => {
        feito.unica = true;
        return alvo;
      };
    }
    alvo.not = () => {
      feito.soLinhasDoPai = true;
      return alvo;
    };
    // ⚠️ `update().select()` DEVOLVE AS LINHAS QUE CASARAM, e é assim que a rota descobre a corrida
    // (zero linhas = alguém chegou antes). O mock precisa saber que o select foi pedido, senão
    // devolve `null` para tudo e todo update parece uma corrida perdida.
    alvo.select = () => {
      feito.select = true;
      return alvo;
    };
    alvo.delete = () => {
      estado.apagado.push({ tabela });
      return alvo;
    };
    alvo.insert = (linha: Record<string, unknown>) => {
      feito.insert = linha;
      estado.inserido.push({ linha, tabela });
      return alvo;
    };
    alvo.update = (linha: Record<string, unknown>) => {
      feito.update = true;
      estado.atualizado.push({ linha, tabela });
      return alvo;
    };
    return alvo;
  };

  const responder = (
    tabela: string,
    feito: {
      insert: null | Record<string, unknown>;
      select: boolean;
      soLinhasDoPai: boolean;
      unica: boolean;
      update: boolean;
    },
  ) => {
    if (feito.insert) return { data: { id: "prop-1" }, error: null };
    // Update com `.select()`: uma linha casada, como no caminho feliz do PostgREST.
    if (feito.update) {
      if (!feito.select) return { data: null, error: null };
      const casou = tabela === "hercules_reservas" && estado.reservaJaSaiu ? [] : [{ id: "linha-1" }];
      return { data: casou, error: null };
    }
    // As leituras em lista da trava do lote, como em `route.test.ts`: a unidade é a única linha viva
    // do terreno, a reserva viva é a desta venda, e propostas de outros só quando o teste pede.
    if (!feito.unica) {
      if (tabela === "hercules_unidades") {
        return {
          data: feito.soLinhasDoPai
            ? []
            : [{ ...estado.unidade, atualizado_em: null, espelho_de: null, origem_c2x_id: null, workspace_id: "careli" }],
          error: null,
        };
      }
      if (tabela === "hercules_reservas") {
        return {
          data: [{ ...estado.reserva, prometeu_reserva_id: null, unidade_id: estado.unidade.id }],
          error: null,
        };
      }
      if (tabela === "hercules_propostas") return { data: estado.propostasDeOutros, error: null };
      if (tabela === "prometeu_reservas") return { data: [], error: null };
    }
    if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
    if (tabela === "hercules_reservas") return { data: estado.reserva, error: null };
    if (tabela === "apolo_enterprise_settings") {
      return { data: { entrada_minima_percentual: 8 }, error: null };
    }
    if (tabela === "apolo_entities") {
      return {
        data: [
          { display_name: null, id: "imob-1", legal_name: null, trade_name: "GURGEL" },
          { display_name: null, id: "corr-1", legal_name: null, trade_name: "João Souza" },
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  };

  return {
    // ⚠️ O DUBLÊ PRECISA EXPORTAR TUDO O QUE A ROTA IMPORTA DO MÓDULO. `hashIdentifier` entrou
    // quando o PDF da proposta passou a ser registrado como documento (ele monta o elo com a ficha
    // do cliente no Apolo); sem esta linha ele chega `undefined`, a chamada quebra e a rota devolve
    // 503 — um erro que parece da proposta e é do mock.
    createApoloAdminClient: () => ({
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://exemplo/proposta.pdf" },
            error: null,
          }),
          download: async () => ({ data: null, error: { message: "sem logo" } }),
          upload: async () => ({ data: { path: "x" }, error: null }),
        }),
      },
    }),
    hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
  };
});



import { POST } from "@/app/api/incorporador/venda/proposta/route";

const PRIMEIRA_PARCELA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const CPF_DO_TITULAR = "529.982.247-25";

/**
 * O que o simulador manda na 000038: o NORMAL do VOC levado a 48 parcelas, R$ 10.000 de desconto,
 * entrada de 10% em 3 vezes, vencimento todo dia 20.
 */
const DA_000038 = {
  ajusteModo: "reais",
  ajusteValor: -10_000,
  diaDeVencimento: 20,
  entradaValor: 13_841,
  entradaVezes: 3,
  observacao: "Combinado com o Loteador.",
  parcelasMensais: 48,
  planoId: "21b694ed-13d7-47ef-a983-bb09145b79c7",
  planoNome: "NORMAL",
  valorNegociado: 138_401,
};

const pedir = (corpo: Record<string, unknown>) =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [
          {
            cpf: CPF_DO_TITULAR,
            nome: "TAISA FERNANDA BATISTA",
            participacao: 100,
            telefone: "37991234567",
          },
        ],
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: "uni-1",
        ...DA_000038,
        ...corpo,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

type FaixaGravada = { indiceCorrecao?: null | string; valor: number };
type Gravada = {
  condicoes: {
    plano: Record<string, unknown>;
    premissa?: Record<string, unknown>;
    reajustes: FaixaGravada[];
    totais: { financiado: number; mensais: number };
  };
  contrato_parcelas: number;
  /** A nota do corretor. Nula é o normal desde 25/09/2026: alterar premissa não exige motivo. */
  observacao: null | string;
  plano_correcao: null | string;
  plano_juros: null | number;
  plano_nome: string;
};
const gravada = () =>
  (estado.inserido.find((i) => i.tabela === "hercules_propostas")?.linha ?? {}) as unknown as Gravada;

/** O quadro CONDIÇÕES DO FINANCIAMENTO da folha que foi para o desenhista do PDF. */
const doQuadro = (rotulo: string): string | undefined => {
  const folha = estado.folhas.at(-1) as
    | undefined
    | { condicoes: Array<{ rotulo: string; valor: string }> };
  return folha?.condicoes.find((c) => c.rotulo === rotulo)?.valor;
};

const erroDe = async (r: Response, campo: string) =>
  ((await r.json()) as { erros?: Array<{ campo: string; mensagem: string }> }).erros?.find(
    (e) => e.campo === campo,
  )?.mensagem;

beforeEach(() => {
  estado.apagado = [];
  estado.atualizado = [];
  estado.avisados = 0;
  estado.com0170 = true;
  estado.faixas = FAIXAS();
  estado.faixasQuebram = false;
  estado.folhas = [];
  estado.leuCadastroDeOperacao = 0;
  estado.naoEnviados = 0;
  estado.sessao = { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" };
  estado.unidade = UNIDADE;
  estado.credenciado = true;
  estado.inserido = [];
  estado.reservaJaSaiu = false;
  estado.propostasDeOutros = [];
  estado.planos = PLANOS();
  estado.reserva = {
    corretor_entity_id: "corr-1",
    criado_em: "2026-09-20T12:00:00.000Z",
    id: "res-1",
    imobiliaria_entity_id: "imob-1",
    proponentes: [
      { cpf: CPF_DO_TITULAR, nome: "TAISA FERNANDA BATISTA", telefone: "37991234567" },
    ],
    protocolo_numero: 38,
    situacao: "ativa",
    validade_em: "2026-09-30T02:59:59.000Z",
  };
});

describe("o cenário escolhido pelo corretor é o que grava", () => {
  // ⚠️ O TESTE DA 000038, NÚMERO POR NÚMERO. Com juros zerado e poupança escolhida, o financiado
  // continua R$ 124.560,00 (a entrada não muda) e a SOMA das 48 mensais passa a ser exatamente ele
  // — amortização pura, sem degrau. O que estava gravado eram R$ 138.130,32.
  it("⚠️ juros 0 e poupança anual: grava 48 × R$ 2.595,00, e não os R$ 138.130,32 da 000038", async () => {
    const r = await pedir({ indiceEscolhido: "POUPANCA", jurosEscolhido: 0 });
    expect(r.status).toBe(200);

    const g = gravada();
    expect(g.plano_juros).toBe(0);
    expect(g.plano_correcao).toBe("poupança anual");
    expect(g.condicoes.totais.financiado).toBe(124_560);
    expect(g.condicoes.totais.mensais).toBe(124_560);
    expect(g.condicoes.totais.mensais).not.toBe(138_130.32);
    // Uma faixa só, sem degrau: no SACOC sem juros a parcela não muda.
    expect(g.condicoes.reajustes).toHaveLength(1);
    expect(g.condicoes.reajustes[0]?.valor).toBe(2_595);
    // O plano CONGELADO é o efetivo, e não o do cadastro: é dele que a Têmis tira a tabela do
    // contrato (`lib/temis/tabela-de-pagamentos.ts` lê `condicoes.plano`).
    expect(g.condicoes.plano.jurosTaxa).toBe(0);
    expect(g.condicoes.plano.indiceCorrecao).toBe("POUPANCA");
    // E o prazo contratado continua sendo o da venda, não o do molde.
    expect(g.contrato_parcelas).toBe(48);
    expect(g.plano_nome).toBe("NORMAL");
  });

  // ⚠️ O PAPEL SAI DO MESMO OBJETO, e é por isso que ele estava errado junto com a conta: o PDF
  // nunca mentiu, ele imprimia fielmente o que o servidor havia calculado.
  it("⚠️ o PDF do mesmo POST diz 'sem juros' e a correção escolhida", async () => {
    await pedir({ indiceEscolhido: "POUPANCA", jurosEscolhido: 0 });

    expect(doQuadro("Juros")).toBe("sem juros");
    expect(doQuadro("Correção")).toBe("poupança anual");
    expect(doQuadro("Parcelas mensais")).toBe("48");
  });

  // ⚠️ A ABA ABERTA ANTES DO DEPLOY NÃO MUDA DE PREÇO. Ausência dos dois campos quer dizer "não
  // alterei nada", e o resultado é o do cadastro — que neste prazo é também o da faixa.
  it("sem os campos novos, grava o que grava hoje: 0,7207% a.m. e IPCA anual", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);

    const g = gravada();
    expect(g.plano_juros).toBe(0.7207);
    expect(g.plano_correcao).toBe("IPCA anual");
    expect(g.condicoes.totais.mensais).toBe(138_130.32);
    expect(g.condicoes.reajustes.map((f) => f.valor)).toEqual([
      2_595, 2_719.84, 2_964.61, 3_231.41,
    ]);
  });

  // ⚠️ SÓ O QUE O CORRETOR MEXEU VIAJA. Zerar os juros e NÃO tocar na correção tem de manter o IPCA
  // do cadastro: mandar os dois juntos sempre faria a tela reescrever uma premissa que ninguém mexeu.
  it("juros 0 sem trocar o índice mantém o IPCA anual do cadastro", async () => {
    const r = await pedir({ jurosEscolhido: 0 });
    expect(r.status).toBe(200);
    expect(gravada().plano_juros).toBe(0);
    expect(gravada().plano_correcao).toBe("IPCA anual");
  });

  // ⚠️ A FAIXA APROVADA PELA DIRETORIA PASSA A VALER NO QUE É GRAVADO. Com 24 parcelas o VOC isenta
  // juros e correção (faixa 1 a 24), e o cadastro do NORMAL cobra 0,7207 + IPCA. Até 25/09/2026 a
  // rota gravava o do cadastro: a tela mostrava a isenção e o boleto vinha com juros.
  it("⚠️ 24 parcelas no VOC: a faixa isenta os juros, e agora é ela que grava", async () => {
    const r = await pedir({ entradaValor: 27_680.2, parcelasMensais: 24 });
    expect(r.status).toBe(200);

    const g = gravada();
    expect(g.plano_juros).toBe(0);
    expect(g.plano_correcao).toBe("sem correção");
    expect(g.condicoes.plano.indiceCorrecao).toBe("SEM_CORRECAO");
    expect(g.condicoes.reajustes.every((f) => f.indiceCorrecao == null)).toBe(true);
  });

  // ⚠️ A ORDEM É CADASTRO → FAIXA → CORRETOR, e ela precisa ser provada ATRAVÉS DA ROTA:
  // `premissa-efetiva.ts` a testa isolada, e isso não prova que a rota a usa.
  it("⚠️ o corretor vence a faixa, e a faixa vence o cadastro", async () => {
    const r = await pedir({
      entradaValor: 27_680.2,
      indiceEscolhido: "IPCA_MENSAL",
      jurosEscolhido: 0.5,
      parcelasMensais: 24,
    });
    expect(r.status).toBe(200);

    const g = gravada();
    // Nem o 0 da faixa, nem o 0,7207 do cadastro: o 0,5 que ele escreveu.
    expect(g.plano_juros).toBe(0.5);
    expect(g.plano_correcao).toBe("IPCA mensal");
  });

  // ⚠️ NA DÚVIDA SOBRE DINHEIRO, NÃO GRAVA — o mesmo princípio do 409 da trava do lote e da recusa
  // da proposta com bem sem a coluna. Sem conseguir ler as faixas, a rota não sabe qual é o preço.
  it("⚠️ leitura das faixas quebrada NÃO grava proposta nenhuma", async () => {
    estado.faixasQuebram = true;

    const r = await pedir({});
    expect(r.status).toBe(503);
    expect(estado.inserido).toHaveLength(0);
  });
});

// ── O QUE CHEGA DO CORPO É CONFERIDO, NUNCA ADIVINHADO ───────────────────────
//
// ⚠️ UM PALPITE AQUI ZERA CONTRATO. `Number("abc")` é NaN e `Number("")` é 0: aceitar lixo como
// zero transformaria um campo sujo em "venda sem juros", e o erro sairia no papel do cliente como
// desconto que ninguém deu.
describe("o corpo do pedido é conferido", () => {
  it("⚠️ juros que não é número recusa com frase, e não vira zero", async () => {
    const r = await pedir({ jurosEscolhido: "abc" });
    expect(r.status).toBe(422);
    expect(await erroDe(r, "juros")).toContain("juros");
    expect(estado.inserido).toHaveLength(0);
  });

  it("juros negativo recusa", async () => {
    const r = await pedir({ jurosEscolhido: -1 });
    expect(r.status).toBe(422);
    expect(estado.inserido).toHaveLength(0);
  });

  it("⚠️ índice que não existe no catálogo recusa, e não é ignorado em silêncio", async () => {
    const r = await pedir({ indiceEscolhido: "INVENTADO" });
    expect(r.status).toBe(422);
    expect(await erroDe(r, "correcao")).toContain("Correção");
    expect(estado.inserido).toHaveLength(0);
  });

  // ⚠️ ZERO É VALOR, E É O CASO DA NÍVEA. Uma conferência por `!jurosEscolhido` engoliria justamente
  // o cenário que este lote existe para consertar.
  it("juros ZERO passa — é a escolha da Nívea, não um campo vazio", async () => {
    const r = await pedir({ jurosEscolhido: 0 });
    expect(r.status).toBe(200);
    expect(gravada().plano_juros).toBe(0);
  });
});

// ── A ORIGEM FICA CONGELADA JUNTO COM O VALOR ────────────────────────────────
//
// ⚠️ ISTO EXISTE PORQUE A PERGUNTA "QUANTAS PROPOSTAS O DEFEITO ATINGIU?" NÃO TEVE RESPOSTA EM SQL
// em 25/09/2026: nada do cenário escolhido era persistido — não havia coluna nem chave no jsonb. Das
// 22 propostas nativas, só a 000038 está CONFIRMADA, e pelo print da Nívea, não pelo banco.
//
// ⚠️ E ELE NÃO ALCANÇA O PASSADO: as propostas já congeladas não serão reescritas.
describe("a premissa congelada diz de onde cada número veio", () => {
  it("⚠️ com condição alterada, a origem é o CORRETOR e o cadastro fica ao lado", async () => {
    await pedir({ indiceEscolhido: "POUPANCA", jurosEscolhido: 0 });

    const p = gravada().condicoes.premissa as {
      alteradaPeloCorretor: boolean;
      doCadastro: { indiceCorrecao: string; jurosTaxa: number };
      indiceDe: string;
      jurosDe: string;
    };
    expect(p.jurosDe).toBe("corretor");
    expect(p.indiceDe).toBe("corretor");
    expect(p.alteradaPeloCorretor).toBe(true);
    // O molde, para a diferença ficar legível depois.
    expect(p.doCadastro.jurosTaxa).toBe(0.7207);
    expect(p.doCadastro.indiceCorrecao).toBe("IPCA_ANUAL");
  });

  it("sem alteração, a origem é a FAIXA quando ela manda", async () => {
    await pedir({ entradaValor: 27_680.2, parcelasMensais: 24 });

    const p = gravada().condicoes.premissa as {
      alteradaPeloCorretor: boolean;
      daFaixa: null | {
        entradaPercentual: null | number;
        parcelaMaxima: number;
        parcelaMinima: number;
      };
      indiceDe: string;
      jurosDe: string;
    };
    expect(p.jurosDe).toBe("faixa");
    expect(p.indiceDe).toBe("faixa");
    expect(p.alteradaPeloCorretor).toBe(false);
    // ⚠️ A ENTRADA DA FAIXA VIAJA AQUI, e não no molde: ver a nota de `condicoes.plano` na rota.
    expect(p.daFaixa).toEqual({
      entradaPercentual: 20,
      parcelaMaxima: 24,
      parcelaMinima: 1,
    });
  });

  it("sem faixa cadastrada e sem alteração, a origem é o CADASTRO", async () => {
    estado.faixas = [];
    await pedir({});

    const p = gravada().condicoes.premissa as {
      alteradaPeloCorretor: boolean;
      daFaixa: null;
      indiceDe: string;
      jurosDe: string;
    };
    expect(p.jurosDe).toBe("cadastro");
    expect(p.indiceDe).toBe("cadastro");
    expect(p.alteradaPeloCorretor).toBe(false);
    expect(p.daFaixa).toBeNull();
  });
});

// ── ALTERAR A PREMISSA EXIGE O MOTIVO, E AGORA O SERVIDOR TAMBÉM COBRA ───────
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ATÉ 25/09/2026 A REGRA DO LUCAS ERA GARANTIDA POR IMPOSSIBILIDADE. Ele
// pediu em 13/09/2026: *"ele altera abre uma caixa de nota para ele registrar o que achar
// necessário"*. A trava era de TELA (`ModalDeProposta.tsx`, `precisaDaNota`) e bastava porque o
// valor alterado MORRIA NO NAVEGADOR: o servidor não tinha como gravar uma premissa trocada.
//
// ⚠️ ISSO MUDOU NESTE MESMO LOTE. `jurosEscolhido` e `indiceEscolhido` passaram a ser campos de
// corpo aceitos, e `observacao` continuou opcional — uma aba antiga, um retry que perde o campo ou um
// POST montado à mão com sessão de portal comercial grava a venda com juros trocados e a coluna
// `observacao` NULA. Seis meses depois, na rescisão, "quem autorizou tirar os juros desta venda?"
// não tem resposta em lugar nenhum: `condicoes.premissa.jurosDe = "corretor"` diz QUEM, e nunca o
// POR QUÊ.
//
// ⚠️ E O SERVIDOR JÁ SABIA. `efetivo.alteradaPeloCorretor` está calculado três linhas acima da lista
// de erros e é gravado no jsonb; faltava usá-lo para recusar.
// ⚠️ ALTERAR A PREMISSA NÃO EXIGE NOTA, E ISSO É TRAVA (Lucas, 25/09/2026: *"acho que não tem
// necessidade de pedir justificativa"*). Eu tinha acabado de pôr a exigência na rota e na tela, com
// o argumento da rescisão futura, e ele mandou tirar: a autonomia de mudar juros e correção é do
// coordenador. Estes dois testes eram o oposto disto até hoje; ficam aqui virados para que ninguém
// reponha a trava sem a decisão dele. O QUE a proposta gravou continua provado nos testes acima
// (`condicoes.premissa.jurosDe = "corretor"`), e o DESCONTO segue com régua própria.
describe("a premissa alterada NÃO exige a nota", () => {
  it("⚠️ juros trocado sem observação GRAVA, e grava o cenário escolhido", async () => {
    const r = await pedir({ jurosEscolhido: 0, observacao: "" });
    expect(r.status).toBe(200);
    expect(gravada().observacao ?? null).toBeNull();
    expect(gravada().plano_juros).toBe(0);
  });

  it("⚠️ correção trocada sem observação também grava", async () => {
    const r = await pedir({ indiceEscolhido: "POUPANCA", observacao: "   " });
    expect(r.status).toBe(200);
    expect(gravada().observacao ?? null).toBeNull();
    expect(String(gravada().plano_correcao ?? "")).toContain("oupan");
  });

  it("com a nota escrita, a mesma proposta passa e grava o motivo", async () => {
    const r = await pedir({
      indiceEscolhido: "POUPANCA",
      jurosEscolhido: 0,
      observacao: "Sem juros por decisão do Loteador, alinhado com o Northon.",
    });
    expect(r.status).toBe(200);
    expect(gravada().plano_juros).toBe(0);
  });

  // ⚠️ SEM ALTERAÇÃO, NADA MUDA. As 4.857 linhas importadas do C2X vieram sem observação e a coluna
  // precisa continuar aceitando nulo: a exigência é SÓ de quem escreveu por cima da premissa.
  it("proposta sem alteração de premissa continua passando sem observação", async () => {
    const r = await pedir({ observacao: "" });
    expect(r.status).toBe(200);
    expect(gravada().plano_juros).toBe(0.7207);
  });

  // ⚠️ A FAIXA NÃO É ALTERAÇÃO DO CORRETOR: ela é cadastro aprovado pela diretoria. Cobrar nota de
  // quem não mexeu em nada faria o VOC em prazo curto pedir justificativa a cada venda.
  it("a premissa que vem da FAIXA não pede nota", async () => {
    const r = await pedir({ entradaValor: 27_680.2, observacao: "", parcelasMensais: 24 });
    expect(r.status).toBe(200);
    expect((gravada().condicoes.premissa as { jurosDe: string }).jurosDe).toBe("faixa");
  });
});

// ── O TETO DE SANIDADE DA TAXA ───────────────────────────────────────────────
//
// ⚠️ A VÍRGULA PERDIDA NÃO PODE VIRAR CONTRATO. `0,7207` digitado como `7207` passava sem uma
// palavra enquanto "abc" era recusado com frase: um número finito e positivo era aceito qualquer que
// fosse o tamanho, e vira cronograma, PDF e quadro nominal do contrato.
describe("a taxa escolhida tem teto de sanidade", () => {
  it("⚠️ 7207% ao mês (a vírgula perdida de 0,7207) recusa com frase", async () => {
    const r = await pedir({ jurosEscolhido: 7207, observacao: "conferido" });
    expect(r.status).toBe(422);
    expect(await erroDe(r, "juros")).toContain("%");
    expect(estado.inserido).toHaveLength(0);
  });

  it("uma taxa alta mas possível continua passando", async () => {
    const r = await pedir({ jurosEscolhido: 2.5, observacao: "Plano especial do Loteador." });
    expect(r.status).toBe(200);
    expect(gravada().plano_juros).toBe(2.5);
  });
});

// ── O MOLDE CONGELADO NÃO PODE DESMENTIR A RÉGUA QUE APROVOU A PROPOSTA ──────
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ISTO É A CONTRADIÇÃO QUE A CASA DESFEZ EM 22/09/2026, e ela está
// escrita no cabeçalho de `lib/hercules/escolher-plano.ts`: *"gravava plano.entradaPercentual = 20 ao
// lado de uma entrada de 12%, no mesmo objeto"*. `aplicarPremissa` troca também `entradaPercentual`,
// então o plano EFETIVO carrega a entrada da FAIXA — enquanto `pedido.planosDaTabela`, que é o que
// `conferirProposta` mede, continua sendo montado com os planos do CADASTRO.
//
// ⚠️ E A DIVERGÊNCIA EXISTE NO BANCO HOJE. Medido em 25/09/2026 (join de `temis_planos` ativo com
// `temis_faixas_de_prazo` ativa pelo prazo do próprio plano): LBR (27) INVESTIDOR 02 de 48 parcelas
// tem cadastro 12% e faixa 20%; LBF (33) INVESTIDOR 02 e NORMAL 01 têm cadastro 20% e faixa 12%.
//
// ⚠️ A ESCOLHA ESTÁ FEITA, E É A DO COMENTÁRIO DA PRÓPRIA ROTA: `condicoes.plano` é o MOLDE, logo
// guarda a entrada do CADASTRO; a entrada EFETIVA da faixa vai para `condicoes.premissa.daFaixa`,
// que existe exatamente para isso. Mexer na régua mudaria a % de entrada exigida do LBR sem ninguém
// ter pedido.
describe("a entrada congelada é a do CADASTRO, e a da faixa fica ao lado", () => {
  it("⚠️ faixa com entrada diferente do plano não sobrescreve o molde", async () => {
    // A faixa de 37 a 156 do VOC pedindo 25%, contra os 10% do plano NORMAL do cadastro.
    estado.faixas = [
      {
        defineEntrada: true,
        defineIndice: true,
        defineJuros: true,
        entradaPercentual: 25,
        indiceCorrecao: "IPCA_ANUAL",
        jurosConvencao: "equivalente",
        jurosPeriodicidade: "mensal",
        jurosTaxa: 0.7207,
        parcelaMaxima: 156,
        parcelaMinima: 37,
      },
    ];

    const r = await pedir({});
    expect(r.status).toBe(200);
    // O molde é o do cadastro: é ele que a régua mediu.
    expect(gravada().condicoes.plano.entradaPercentual).toBe(10);
    // E a exigência da faixa fica visível, com o recorte dela.
    expect(
      (gravada().condicoes.premissa as { daFaixa: null | { entradaPercentual: null | number } })
        .daFaixa?.entradaPercentual,
    ).toBe(25);
  });

  it("sem faixa que opine sobre entrada, `daFaixa.entradaPercentual` é nulo", async () => {
    estado.faixas = [];
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(gravada().condicoes.plano.entradaPercentual).toBe(10);
    expect((gravada().condicoes.premissa as { daFaixa: null }).daFaixa).toBeNull();
  });
});
