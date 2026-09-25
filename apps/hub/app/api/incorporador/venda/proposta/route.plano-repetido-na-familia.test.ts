import { beforeEach, describe, expect, it, vi } from "vitest";

// A VENDA DO LAGOA BONITA COM UM NOME DE PLANO QUE SE REPETE NA FAMÍLIA (22/09/2026).
//
// ⚠️ ESTE ARQUIVO EXISTE PORQUE UMA TRAVA JÁ PAROU ESTA VENDA. `planosDaUnidade` achata os planos
// da FAMÍLIA do empreendimento (pai e irmãos), porque é a mesma expansão que a esteira e o
// credenciamento usam. Em 22/09/2026, junto com o casamento do plano por id, nasceu uma trava que
// recusava com 422 "dois planos de mesmo nome que discordam no dinheiro" — e ela passou a comparar
// planos de empreendimentos DIFERENTES como se fossem candidatos à mesma unidade. Medido no mesmo
// dia: ela parava TODA proposta de lote do LBR no NORMAL 01, hoje, sem rename nenhum no meio.
//
// ⚠️ E O CADASTRO ESTÁ CERTO. Medido em 22/09/2026 no projeto `bxgukywoxgivlrhjkwjx`, família Lagoa
// Bonita (raiz `307c93d6-6a42-42b3-ab20-ee06ae879f42`), `temis_planos` ativos:
//
//   plano          | LBR (enterprise 27)          | LBF (enterprise 33)
//   INVESTIDOR 01  | 36x, sem juros, entrada 20%  | 36x, sem juros, entrada 20%   → iguais
//   INVESTIDOR 02  | 48x, sem juros, entrada 12%  | 48x, sem juros, entrada 20%   → discordam
//   NORMAL 01      | 72x, 0,8% a.m., entrada 12%  | 72x, 0,8% a.m., entrada 20%   → discordam
//   NORMAL 02      | 120x, 0,8% a.m., entrada 12% | 120x, 0,8% a.m., entrada 12%  → iguais
//
// Dois empreendimentos irmãos terem o mesmo nome de plano com entrada diferente é normal, e não
// pode recusar venda. A trava saiu, o caminho sem id voltou a ser o `find` de sempre (o PRIMEIRO da
// lista), e quem fecha o buraco do rename é o `planoId` que a tela passou a mandar.
//
// Os mocks são os de `route.plano-por-id.test.ts`, com o cadastro do Lagoa Bonita no lugar do
// Garden: os planos vêm de `estado.planos`, cada um com o `enterpriseId` do seu dono.

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
  /** Os planos da FAMÍLIA, como `planosDaUnidade` os entrega (achatados, com o dono em cada um). */
  planos: [] as Array<Record<string, unknown>>,
  /** As folhas que foram para o desenhista do PDF. */
  folhas: [] as unknown[],
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
}));

/** Um lote do LBR — o empreendimento 27, filho do Lagoa Bonita. */
const UNIDADE = {
  area: "300.00",
  codigo: "LBR0907",
  enterprise_id: "27",
  id: "uni-1",
  lote: "07",
  preco_tabela: "300000.00",
  quadra: "C09",
  situacao: "reservada",
};

/**
 * Os quatro planos do LBR e do LBF como o banco os tem hoje (SELECT de 22/09/2026).
 *
 * ⚠️ O `enterpriseId` É O CAMPO DO TESTE. Ele já vem de `comoPlano` em toda linha de `temis_planos`
 * e é o que diz de QUAL empreendimento o plano é — a informação que o `flatMap` da rota jogava fora.
 */
const PLANOS = vi.hoisted(() => () => {
  const base = {
    anuaisQuantidade: null,
    anuaisValor: null,
    categoriaId: null,
    descontoPercentual: 0,
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
    sistemaAmortizacao: "sacoc",
    slot: null,
  };
  const lbr = { ...base, enterpriseId: "27" };
  const lbf = { ...base, enterpriseId: "33" };
  return [
    // O LBR primeiro, que é o dono da unidade deste teste.
    { ...lbr, entradaPercentual: 20, id: "lbr-inv01", indiceCorrecao: "SEM_CORRECAO", jurosTaxa: 0, nome: "INVESTIDOR 01", parcelas: 36 },
    { ...lbr, entradaPercentual: 12, id: "lbr-inv02", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0, nome: "INVESTIDOR 02", parcelas: 48 },
    { ...lbr, entradaPercentual: 12, id: "lbr-nor01", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.8, nome: "NORMAL 01", parcelas: 72 },
    { ...lbr, entradaPercentual: 12, id: "lbr-nor02", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.8, nome: "NORMAL 02", parcelas: 120 },
    // E o irmão LBF, que a família traz junto e a unidade do LBR nunca deveria ter que considerar.
    { ...lbf, entradaPercentual: 20, id: "lbf-inv01", indiceCorrecao: "SEM_CORRECAO", jurosTaxa: 0, nome: "INVESTIDOR 01", parcelas: 36 },
    { ...lbf, entradaPercentual: 20, id: "lbf-inv02", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: null, nome: "INVESTIDOR 02", parcelas: 48 },
    { ...lbf, entradaPercentual: 20, id: "lbf-nor01", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.8, nome: "NORMAL 01", parcelas: 72 },
    { ...lbf, entradaPercentual: 12, id: "lbf-nor02", indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.8, nome: "NORMAL 02", parcelas: 120 },
  ];
});

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["27", "31", "33"],
  };
});

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["LAB", "LBR", "LBF"], stageIds: ["31", "27", "33"] },
  ],
}));

vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: () => ["27", "31", "33"],
}));

/** O Lagoa Bonita e as duas divisões que têm plano cadastrado. */
const CADASTRO = vi.hoisted(() => [
  {
    c2xEnterpriseId: "31",
    cidade: "Senador Canedo",
    codigo: "LAB",
    id: "emp-lab",
    nome: "Lagoa Bonita",
    operadoPor: null,
    ordem: 1,
    paiId: null,
    uf: "GO",
    vendendo: true,
  },
  {
    c2xEnterpriseId: "27",
    cidade: "Senador Canedo",
    codigo: "LBR",
    id: "emp-lbr",
    nome: "Lagoa Bonita · LBR",
    operadoPor: null,
    ordem: 2,
    paiId: "emp-lab",
    uf: "GO",
    vendendo: true,
  },
  {
    c2xEnterpriseId: "33",
    cidade: "Senador Canedo",
    codigo: "LBF",
    id: "emp-lbf",
    nome: "Lagoa Bonita · LBF",
    operadoPor: null,
    ordem: 3,
    paiId: "emp-lab",
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

// A família de verdade do Lagoa Bonita: o pai e os dois filhos, que é o que a rota expande hoje.
vi.mock("@/lib/hercules/quem-pode-vender", () => ({
  familiaDoEmpreendimento: () => ["27", "31", "33"],
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  // ⚠️ A ROTA PASSOU A LER AS FAIXAS DE PRAZO NO POST (25/09/2026), e o dublê precisa exportar tudo o
  // que ela importa: sem esta linha a função chega `undefined`, a chamada quebra e a rota devolve
  // 503 — um erro que parece da proposta e é do mock. Vazio = empreendimento sem faixa cadastrada,
  // que é o caso destes testes.
  lerFaixasDoPanteon: async () => ({}),
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
    if (feito.update) {
      if (!feito.select) return { data: null, error: null };
      const casou = tabela === "hercules_reservas" && estado.reservaJaSaiu ? [] : [{ id: "linha-1" }];
      return { data: casou, error: null };
    }
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
 * O que a modal manda ao escolher o NORMAL 01 num lote de R$ 300.000.
 *
 * ⚠️ SÓ O NOME. `ModalDeProposta.tsx:661` monta o corpo com `planoNome` e nenhum `planoId` — por
 * isso o caminho do nome é o que TODA proposta de verdade percorre hoje.
 */
const DO_SIMULADOR = {
  diaDeVencimento: 10,
  entradaValor: 36_000,
  entradaVezes: 1,
  parcelasMensais: 72,
  planoNome: "NORMAL 01",
  valorNegociado: 300_000,
};

const pedir = (corpo: Record<string, unknown>) =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [
          { cpf: CPF_DO_TITULAR, nome: "Maria da Silva", participacao: 100, telefone: "62991234567" },
        ],
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: "uni-1",
        ...DO_SIMULADOR,
        ...corpo,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

type Gravada = {
  /** ⚠️ A ENTRADA DO PLANO MORA AQUI, e não numa coluna plana: ver o insert da rota. */
  condicoes: { plano: { entradaPercentual: number } };
  plano_juros: null | number;
  plano_nome: string;
  plano_parcelas: number;
};
const gravada = () =>
  (estado.inserido.find((i) => i.tabela === "hercules_propostas")?.linha ?? {}) as unknown as Gravada;
/** O % de entrada que FICOU congelado na proposta — o número que separa o LBR do LBF. */
const entradaGravada = () => gravada().condicoes.plano.entradaPercentual;
const erroDoPlano = async (r: Response) =>
  ((await r.json()) as { erros: Array<{ campo: string; mensagem: string }> }).erros.find(
    (e) => e.campo === "plano",
  )?.mensagem;

beforeEach(() => {
  estado.apagado = [];
  estado.atualizado = [];
  estado.avisados = 0;
  estado.com0170 = true;
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
    criado_em: "2026-09-01T12:00:00.000Z",
    id: "res-1",
    imobiliaria_entity_id: "imob-1",
    proponentes: [{ cpf: CPF_DO_TITULAR, nome: "MARIA DA SILVA", telefone: "62991234567" }],
    protocolo_numero: 123,
    situacao: "ativa",
    validade_em: "2026-09-07T02:59:59.000Z",
  };
});

describe("a venda do Lagoa Bonita com um nome de plano repetido na família", () => {
  // ⚠️ O CASO QUE A TRAVA QUEBRAVA. Unidade do LBR, plano "NORMAL 01", sem id no pedido — e na
  // lista achatada estão o NORMAL 01 do LBR (entrada 12%) e o do LBF (entrada 20%). Isto é uma
  // venda legítima que acontece hoje, e ela tem que passar.
  it("⚠️ unidade do LBR, NORMAL 01, sem id: passa, com o plano de 72x", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(gravada().plano_nome).toBe("NORMAL 01");
    expect(gravada().plano_parcelas).toBe(72);
    // ⚠️ O PRIMEIRO DA LISTA, QUE É O COMPORTAMENTO DE SEMPRE. Aqui o primeiro é o do LBR, o dono
    // da unidade. O que congela essa escolha contra um rename é o `planoId` — o teste abaixo —,
    // e não uma recusa: recusar aqui era o 422 que parava a venda do Lagoa Bonita inteira.
    expect(entradaGravada()).toBe(12);
  });

  // ⚠️ O EMPREENDIMENTO SEM PLANO PRÓPRIO VENDE COM OS DA FAMÍLIA. Medido em 22/09/2026: 18
  // empreendimentos com unidade disponível não têm UMA linha em `temis_planos` — entre eles o
  // próprio Lagoa Bonita raiz (enterprise 31, 51 lotes disponíveis) e o VOC, o VOL e o VOR.
  it("unidade de empreendimento SEM plano próprio continua usando os da família", async () => {
    estado.unidade = { ...UNIDADE, codigo: "LAB0101", enterprise_id: "31" };

    const r = await pedir({ parcelasMensais: 120, planoNome: "NORMAL 02" });
    expect(r.status).toBe(200);
    expect(gravada().plano_parcelas).toBe(120);
  });

  // ⚠️ O ID É A CHAVE, E ELE ATRAVESSA A FAMÍLIA INTEIRA. `temis_planos.id` é único, então ele
  // alcança a linha certa em qualquer degrau da hierarquia sem precisar adivinhar o dono — e sem
  // consultar o nome, que é o que o rename estraga.
  it("com o planoId, o plano do LBF é alcançável e o nome nem é consultado", async () => {
    const r = await pedir({ planoId: "lbf-nor01", planoNome: "NOME QUE NÃO EXISTE" });
    expect(r.status).toBe(200);
    expect(entradaGravada()).toBe(20);
  });
});
