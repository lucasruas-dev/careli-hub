import { beforeEach, describe, expect, it, vi } from "vitest";

// O GET E O POST DA PROPOSTA CONCORDANDO SOBRE A CAD EM ANDAMENTO.
//
// Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
// ela pode estar em validacao ou em qualquer outro estagio"*. E, sobre o print da CAD do MATEUS
// COTTA SACCHETTO em `validacao` (lote EIRETAMA-14, Aldeia das Cachoeiras das Pedras, empreendimento
// 42): *"essa devia passar"*.
//
// ⚠️ ESTE TESTE NÃO MOCKA `cliente-credenciado`, e é o ponto dele. Os outros arquivos desta rota
// (route.test.ts:154, route.plano-por-id.test.ts:175, e mais três) usam um dublê que devolve
// `credenciado` fixo — então nenhum deles prova o portão. Aqui a régua é a DE VERDADE, lendo
// `apolo_esteira` do client falso, e as duas passagens da rota respondem à MESMA leitura:
//   GET  (route.ts:591) acende ou apaga o botão "Gerar proposta";
//   POST (route.ts:856) grava, e recusa com 403.
// O topo de `lib/hercules/cliente-credenciado.ts` existe para a segunda não ficar mais frouxa que a
// primeira; este arquivo é onde isso é cobrado.
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select etapa, enterprise_id, atualizado_em, entity_id from apolo_esteira
//     where etapa = 'validacao' order by atualizado_em desc;
//     → enterprise_id 42, atualizado_em 2026-09-26 17:11:31+00 — a CAD do print do Lucas.
//   select etapa, count(*) from apolo_esteira group by 1;
//     → credenciado 662 · revisao 172 · correcao 6 · validacao 2 (zero em `indeferido`).

const ALDEIA = "42";
/** O irmão da família do mesmo pai — o escopo do coordenador é a família inteira. */
const IRMAO = "43";
/** A mesma família como o catálogo a grava: `apolo_esteira.enterprise_id` guarda as duas formas. */
const GRUPO = "group:ACP";
const CPF_DO_TITULAR = "529.982.247-25";
const CPF_EM_DIGITOS = "52998224725";
const ENTIDADE = "ent-mateus";

const estado = vi.hoisted(() => ({
  atualizado: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  /** Erro de leitura na esteira: o fail-closed tem de virar 503, nunca "não credenciado". */
  esteiraFalha: false,
  /** As entidades do Apolo que carregam o CPF do titular. Mais de uma é o caso duplicado. */
  entidadesDoCpf: [] as string[],
  /** As linhas de `apolo_esteira` que o banco falso devolve. */
  esteira: [] as Array<Record<string, unknown>>,
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
}));

const UNIDADE = {
  area: "250.00",
  codigo: "EIRETAMA-14",
  enterprise_id: ALDEIA,
  id: "uni-1",
  lote: "14",
  preco_tabela: "178100.00",
  quadra: "EIRETAMA",
  situacao: "reservada",
};

const PLANO = {
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 180,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => [ALDEIA],
  };
});

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

// ⚠️ A RÉGUA DE QUEM OPERA O PRODUTO É DE OUTRO TESTE. Aqui ela aprova para os dois portais de
// propósito: sem isso, o 403 do Cecílio poderia vir dela e não do credenciamento, e o teste
// afirmaria ter provado o portão sem tê-lo tocado.
vi.mock("@/lib/apolo/incorporador/operacao-do-produto-servidor", () => ({
  autorizarEscritaNoProduto: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [{ codes: ["ACP"], stageIds: [ALDEIA] }],
}));

// ⚠️ A FAMÍLIA TEM MAIS DE UM ID AQUI, E ISSO É PARTE DO TESTE. Enquanto estes dois mocks
// devolviam só `[ALDEIA]`, o escopo que chegava a `credenciadoParaVender` tinha um empreendimento
// só — e o caso "indeferido num irmão da família" era INALCANÇÁVEL pela rota, embora seja o escopo
// real: `escopoDaEsteiraDoPortal` (lib/apolo/incorporador/familia-no-portal.ts:62-64) devolve, para
// o comercial, a família INTEIRA mais os ids de grupo do catálogo.
vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: (familia: string[]) => [...familia, GRUPO],
}));

const CADASTRO = vi.hoisted(() => [
  {
    c2xEnterpriseId: "42",
    cidade: "Pirenópolis",
    codigo: "ACP",
    id: "emp-aldeia",
    nome: "Aldeia das Cachoeiras das Pedras",
    operadoPor: null,
    ordem: 1,
    paiId: null,
    uf: "GO",
    vendendo: true,
  },
]);

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/hercules/quem-pode-vender", () => ({
  familiaDoEmpreendimento: () => [ALDEIA, IRMAO],
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
  lerPlanosDoC2xPorIds: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  lerFaixasDoPanteon: async () => ({}),
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [{ planos: [PLANO] }],
}));

vi.mock("@/lib/hercules/avisos-da-venda", () => ({
  avisarSobreAVenda: async () => [{ ok: true, para: "imobiliaria" }],
  destinatariosDaVenda: async () => ({
    coordenadores: [],
    corretor: null,
    imobiliaria: null,
  }),
  registrarAvisoNaoEnviado: async () => [],
  vendaAvisaPeloWhatsapp: () => false,
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async () => new Uint8Array([1, 2, 3]),
}));

// ⚠️ O BANCO FALSO RESPEITA OS FILTROS DA ESTEIRA. `credenciadoParaVender` filtra
// `.in("entity_id", …).in("enterprise_id", escopo)`; um dublê que devolvesse a fixture inteira
// esconderia justamente o caso "sem CAD neste empreendimento", que continua barrando.
vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const feito = { insert: null as null | Record<string, unknown>, select: false, unica: false, update: false };
    const filtros: Array<{ coluna: string; valores: unknown[] }> = [];
    const combina = (linha: Record<string, unknown>) =>
      filtros.every((f) => f.coluna in linha && f.valores.includes(linha[f.coluna]));

    const responder = () => {
      if (feito.insert) return { data: { id: "prop-1" }, error: null };
      if (feito.update) {
        if (!feito.select) return { data: null, error: null };
        return { data: [{ id: "linha-1" }], error: null };
      }
      if (tabela === "apolo_entities") {
        // A entidade do Mateus não nasceu no Apolo: `document_hash` é nulo e o CPF vive em
        // `apolo_entity_identifiers` (é o caso de 4.133 das 4.286 entidades medidas).
        if (filtros.some((f) => f.coluna === "document_hash")) return { data: [], error: null };
        return { data: [], error: null };
      }
      if (tabela === "apolo_entity_identifiers") {
        // ⚠️ UM CPF PODE TER MAIS DE UMA ENTIDADE, e o banco devolve as duas pelo mesmo
        // `value_hash` — 806 `value_hash` com mais de uma entidade, medido em 26/09/2026 com
        // `select count(*) from (select value_hash from apolo_entity_identifiers group by 1
        //  having count(distinct entity_id) > 1) d`. Um dublê fixo numa
        // entidade só esconderia o caso da CAD duplicada, que é onde a recusa se perdia.
        return {
          data: estado.entidadesDoCpf
            .map((entity_id) => ({ entity_id, value_hash: `hash:cpf:${CPF_EM_DIGITOS}` }))
            .filter(combina),
          error: null,
        };
      }
      if (tabela === "apolo_esteira") {
        if (estado.esteiraFalha) return { data: null, error: { message: "timeout" } };
        return { data: estado.esteira.filter(combina), error: null };
      }
      if (tabela === "apolo_enterprise_settings") {
        return { data: { entrada_minima_percentual: 10 }, error: null };
      }
      if (!feito.unica) {
        if (tabela === "hercules_unidades") {
          return {
            data: [{ ...estado.unidade, atualizado_em: null, espelho_de: null, origem_c2x_id: null, workspace_id: "careli" }],
            error: null,
          };
        }
        if (tabela === "hercules_reservas") {
          return { data: [{ ...estado.reserva, prometeu_reserva_id: null, unidade_id: estado.unidade.id }], error: null };
        }
        if (tabela === "hercules_propostas") return { data: [], error: null };
        if (tabela === "prometeu_reservas") return { data: [], error: null };
      }
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_reservas") return { data: estado.reserva, error: null };
      return { data: null, error: null };
    };

    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(responder()).then(aceitar, recusar),
    };
    for (const metodo of ["is", "limit", "not", "or", "order", "range"]) {
      alvo[metodo] = () => alvo;
    }
    for (const metodo of ["eq", "in"]) {
      alvo[metodo] = (coluna: string, valores: unknown) => {
        filtros.push({ coluna, valores: Array.isArray(valores) ? valores : [valores] });
        return alvo;
      };
    }
    for (const metodo of ["maybeSingle", "single"]) {
      alvo[metodo] = () => {
        feito.unica = true;
        return alvo;
      };
    }
    alvo.select = () => {
      feito.select = true;
      return alvo;
    };
    alvo.delete = () => alvo;
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

  return {
    createApoloAdminClient: () => ({
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://exemplo/proposta.pdf" }, error: null }),
          download: async () => ({ data: null, error: { message: "sem logo" } }),
          upload: async () => ({ data: { path: "x" }, error: null }),
        }),
      },
    }),
    hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
  };
});

import { GET, POST } from "@/app/api/incorporador/venda/proposta/route";

const PRIMEIRA_PARCELA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** A CAD do Mateus, na etapa que o teste pedir. */
const cad = (etapa: string, atualizado_em = "2026-09-26T17:11:31.401Z") => ({
  atualizado_em,
  chegou_em: null,
  created_at: "2026-09-20T12:00:00.000Z",
  enterprise_id: ALDEIA,
  entity_id: ENTIDADE,
  etapa,
});

const abrir = () =>
  GET(new Request("https://c2x.app.br/api/incorporador/venda/proposta?unidade=uni-1"));

const gerar = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [{ cpf: CPF_DO_TITULAR, nome: "MATEUS COTTA SACCHETTO", participacao: 100, telefone: "62991234567" }],
        diaDeVencimento: 10,
        entradaValor: 17_810,
        entradaVezes: 2,
        parcelasMensais: 120,
        planoNome: "NORMAL",
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: "uni-1",
        valorNegociado: 178_100,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

/** O portal comercial da Careli — o coordenador da decisão do Lucas. */
const COORDENADOR = { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Nívea" };

/** O portal do Cecílio: opera a própria venda, e continua exigindo a CAD credenciada. */
const CECILIO = { slug: "cecilio-rocha", tipo: "incorporador", usuarioId: "user-2", usuarioNome: "Time Cecílio" };

const gravou = () => estado.inserido.some((i) => i.tabela === "hercules_propostas");

beforeEach(() => {
  estado.atualizado = [];
  estado.entidadesDoCpf = [ENTIDADE];
  estado.esteira = [cad("validacao")];
  estado.esteiraFalha = false;
  estado.inserido = [];
  estado.sessao = { ...COORDENADOR };
  estado.unidade = UNIDADE;
  estado.reserva = {
    corretor_entity_id: null,
    criado_em: "2026-09-26T12:00:00.000Z",
    id: "res-1",
    imobiliaria_entity_id: null,
    proponentes: [{ cpf: CPF_DO_TITULAR, nome: "MATEUS COTTA SACCHETTO", telefone: "62991234567" }],
    protocolo_numero: 123,
    situacao: "ativa",
    validade_em: "2026-10-03T02:59:59.000Z",
  };
});

describe("CAD em validação: o coordenador gera, e a tela não mente", () => {
  it("GET acende o botão e MANTÉM a frase da etapa — os dois campos dizem coisas diferentes", async () => {
    const r = await abrir();
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as {
      data: { credenciamento: { credenciado: boolean; etapa: null | string; motivo: null | string; podeGerarProposta: boolean } };
    };

    expect(data.credenciamento.podeGerarProposta).toBe(true);
    // ⚠️ A TELA NÃO PODE MENTIR: com `credenciado: true` o selo da ModalDeProposta escreveria
    // "CAD credenciada neste empreendimento" em cima de uma CAD em validação.
    expect(data.credenciamento.credenciado).toBe(false);
    expect(data.credenciamento.etapa).toBe("validacao");
    expect(data.credenciamento.motivo).toBe(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
  });

  it("POST grava — e é aqui que o GET e o POST concordam sobre a MESMA CAD", async () => {
    const r = await gerar();
    expect(r.status).toBe(200);
    expect(gravou()).toBe(true);
  });

  it.each(["revisao", "correcao", "credito", "prevenda"])(
    "CAD em %s também passa nas duas passagens",
    async (etapa) => {
      estado.esteira = [cad(etapa)];

      const get = await abrir();
      const { data } = (await get.json()) as { data: { credenciamento: { podeGerarProposta: boolean } } };
      expect(data.credenciamento.podeGerarProposta).toBe(true);

      const post = await gerar();
      expect(post.status).toBe(200);
    },
  );
});

describe("o que continua barrando o coordenador", () => {
  it("CAD INDEFERIDA: GET apaga o botão e POST recusa com 403", async () => {
    estado.esteira = [cad("indeferido")];

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { credenciado: boolean; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    expect(data.credenciamento.credenciado).toBe(false);

    const post = await gerar();
    expect(post.status).toBe(403);
    expect(gravou()).toBe(false);
    const erro = (await post.json()) as { error: string };
    expect(erro.error).toContain("indeferido");
  });

  it("INDEFERIDO de hoje vence CREDENCIADO de ontem na MESMA CAD, e o POST recusa", async () => {
    estado.esteira = [
      cad("credenciado", "2026-09-25T12:00:00.000Z"),
      cad("indeferido", "2026-09-26T17:11:31.401Z"),
    ];

    const get = await abrir();
    const { data } = (await get.json()) as { data: { credenciamento: { podeGerarProposta: boolean } } };
    expect(data.credenciamento.podeGerarProposta).toBe(false);

    const post = await gerar();
    expect(post.status).toBe(403);
  });

  // ⚠️ E O INDEFERIDO BARRA MESMO QUANDO NÃO É A LINHA MAIS NOVA DO ESCOPO. O escopo do coordenador
  // é a FAMÍLIA INTEIRA mais os ids de grupo (route.ts:585, `escopoDoTitular(escopoDaEsteiraDoPortal
  // (...))`), e `apolo_esteira.enterprise_id` guarda a divisão E o grupo. Antes da correção a régua
  // escolhia UMA linha por recência e perguntava a porta só sobre ela: o POST gravava 200 para um
  // cliente indeferido no próprio empreendimento vendido. Medido com `npx tsx` chamando
  // `decidirPelasLinhas` de verdade em 26/09/2026.
  it("INDEFERIDO num IRMÃO da família: GET apaga o botão e POST recusa com a frase da recusa", async () => {
    estado.esteira = [
      cad("indeferido", "2026-09-20T12:00:00.000Z"),
      { ...cad("revisao", "2026-09-26T17:11:31.401Z"), enterprise_id: IRMAO },
    ];

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { motivo: null | string; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    // ⚠️ A TELA NÃO MENTE POR OMISSÃO: a frase é a do INDEFERIMENTO, e não "em revisão desde 26/09".
    expect(data.credenciamento.motivo).toBe(
      "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
    );

    const post = await gerar();
    expect(post.status).toBe(403);
    expect(gravou()).toBe(false);
    const erro = (await post.json()) as { error: string };
    expect(erro.error).toContain("indeferido");
  });

  it("INDEFERIDO numa entidade DUPLICADA do mesmo CPF, no MESMO empreendimento, recusa nas duas passagens", async () => {
    // São 806 `value_hash` com mais de uma entidade (medido): um do sync do C2X, outro de importação.
    // O client falso devolve as duas pelo mesmo `value_hash`, que é o que o banco faz de verdade.
    estado.entidadesDoCpf = [ENTIDADE, "ent-duplicada"];
    estado.esteira = [
      { ...cad("indeferido", "2026-09-20T12:00:00.000Z"), entity_id: ENTIDADE },
      { ...cad("validacao", "2026-09-26T17:11:31.401Z"), entity_id: "ent-duplicada" },
    ];

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { etapa: null | string; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    expect(data.credenciamento.etapa).toBe("indeferido");

    const post = await gerar();
    expect(post.status).toBe(403);
    expect(gravou()).toBe(false);
  });

  it("SEM CAD neste empreendimento continua barrado — não é etapa, é falta de entidade conferida", async () => {
    // A CAD existe, mas no Vale do Ouro (35). A proposta é da Aldeia (42).
    estado.esteira = [{ ...cad("credenciado"), enterprise_id: "35" }];

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { motivo: null | string; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    expect(data.credenciamento.motivo).toBe("Este cliente não tem CAD neste empreendimento.");

    const post = await gerar();
    expect(post.status).toBe(403);
    expect(gravou()).toBe(false);
  });

  it("documento inválido no titular continua barrado nas duas passagens", async () => {
    estado.reserva = { ...estado.reserva, proponentes: [{ cpf: "123", nome: "MATEUS", telefone: "62991234567" }] };

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { motivo: null | string; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    expect(data.credenciamento.motivo).toContain("Informe o CPF ou o CNPJ do titular");

    const post = await gerar();
    expect(post.status).toBe(403);
  });

  it("erro de leitura da esteira vira 503 nas duas passagens — nunca liberação, nunca recusa", async () => {
    estado.esteiraFalha = true;

    const get = await abrir();
    expect(get.status).toBe(503);

    const post = await gerar();
    expect(post.status).toBe(503);
    expect(gravou()).toBe(false);
  });
});

describe("só o portal comercial da Careli", () => {
  it("a MESMA CAD em validação NÃO gera no portal do Cecílio", async () => {
    // Lucas (26/09/2026): o afrouxamento é do coordenador. O `cecilio-rocha` opera a própria venda
    // (`portalOperaVenda`, perfis-de-portal.ts:122), mas continua precisando da CAD credenciada.
    estado.sessao = { ...CECILIO };

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { credenciado: boolean; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.podeGerarProposta).toBe(false);
    expect(data.credenciamento.credenciado).toBe(false);

    const post = await gerar();
    expect(post.status).toBe(403);
    expect(gravou()).toBe(false);
  });

  it("no Cecílio a CAD CREDENCIADA continua gerando — nada foi apertado para ele", async () => {
    estado.sessao = { ...CECILIO };
    estado.esteira = [cad("credenciado")];

    const get = await abrir();
    const { data } = (await get.json()) as {
      data: { credenciamento: { credenciado: boolean; podeGerarProposta: boolean } };
    };
    expect(data.credenciamento.credenciado).toBe(true);
    expect(data.credenciamento.podeGerarProposta).toBe(true);

    const post = await gerar();
    expect(post.status).toBe(200);
  });
});
