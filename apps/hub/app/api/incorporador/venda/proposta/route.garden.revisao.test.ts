import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// REVISÃO 3 (18/09/2026): A PROPOSTA GRAVADA DO GARDEN, pela rota de verdade.
//
// Lucas: *"tem que ser igual o mmendes"*. O simulador já sobe o valor, o ajuste e o desconto do plano
// (ver `SimuladorDeProposta.revisao.comportamento.test.tsx`); aqui se confere o que a ROTA faz com
// isso: o que vai para `hercules_propostas` (valor, ajuste, preço de tabela, `condicoes` com o
// desconto congelado e o cronograma) e o que vai para a folha do PDF. O pedido é exatamente o que a
// Mesa manda para o INVESTIDOR PARCELADO do lote de R$ 435.000 (conta da MMendes: `garden.html`,
// `condicoes`, com `jurosAM: 0`).
//
// Mocks copiados de `route.test.ts`, com os planos do Garden, o piso de 8% e o desenhista do PDF
// guardando a folha. A régua (`conferirProposta`), o cronograma e a folha são os de verdade.
//
// ⚠️ O DUBLÊ DO BANCO ACOMPANHA O DE `route.test.ts`, INCLUSIVE A TRAVA DO LOTE (1.350.0). Antes de
// gravar, a rota lê a situação do terreno e pergunta se há OUTRO dono vivo (`lerSituacaoDasUnidades`
// + `outrosDonosDoLote`), em lista e com `.or()`/`.not()`. A cópia de antes do rebase não sabia
// responder em lista: a trava lançava, a rota não conseguia conferir e devolvia 409 (fail-closed,
// como deve). Não se afrouxa a trava para o teste passar: o dublê é que aprende a responder.

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
  /** A 0178 aplicada (8% e 12%) ou não. */
  comDesconto: true,
  /** As folhas que foram para o desenhista do PDF. */
  folhas: [] as unknown[],
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
}));

const UNIDADE = {
  area: "420.00",
  codigo: "GDN1110",
  enterprise_id: "39",
  id: "uni-1",
  lote: "10",
  preco_tabela: "435000.00",
  quadra: "11",
  situacao: "reservada",
};

/** Os três planos do Garden como `comoPlano` os entrega (SELECT de 18/09/2026), com ou sem a 0178. */
const GARDEN = vi.hoisted(() => (comDesconto: boolean) => {
  const base = {
    categoriaId: null,
    enterpriseId: "39",
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    sistemaAmortizacao: "sacoc",
    slot: null,
  };
  return [
    { ...base, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60 },
    { ...base, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: comDesconto ? 8 : 0, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84 },
    { ...base, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: comDesconto ? 12 : 0, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36 },
  ];
});

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["37", "39"],
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
  catalogoDeEmpreendimentos: async () => [{ codes: ["JDG"], stageIds: ["39"] }],
}));

vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: () => ["39"],
}));

// O 39 é operado pelo portal do Cecílio (o Garden da decisão de 16/09/2026); o 37 é da Careli.
const CADASTRO = vi.hoisted(() => [
  {
    c2xEnterpriseId: "39",
    cidade: "Aparecida de Goiânia",
    codigo: "JDG",
    id: "emp-1",
    nome: "Jardim das Gaivotas",
    operadoPor: "inc-cecilio",
    ordem: 1,
    paiId: null,
    uf: "GO",
    vendendo: true,
  },
  {
    c2xEnterpriseId: "37",
    cidade: "Goiânia",
    codigo: "VOC",
    id: "emp-voc",
    nome: "VOC",
    operadoPor: null,
    ordem: 2,
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

vi.mock("@/lib/hercules/quem-pode-vender", () => ({ familiaDoEmpreendimento: () => ["39"] }));

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
  planosPreferindoOPanteon: () => [{ planos: GARDEN(estado.comDesconto) }],
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

/** O que a Mesa manda para o INVESTIDOR PARCELADO do lote de R$ 435.000 (o clique no cartão). */
const DO_SIMULADOR = {
  ajusteModo: "percentual",
  ajusteValor: -8,
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  diaDeVencimento: 10,
  entradaValor: 32_016,
  entradaVezes: 1,
  parcelasMensais: 84,
  planoNome: "INVESTIDOR PARCELADO",
  valorNegociado: 400_200,
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
  ajuste_modo: null | string;
  ajuste_valor: null | number;
  condicoes: {
    anuais: Array<{ valor: number; vencimento: string }>;
    mensais: Array<{ valor: number; vencimento: string }>;
    plano: { descontoPercentual: number };
    totais: { anuais: number; entrada: number; financiado: number };
  };
  contrato_parcelas: number;
  preco_tabela: number;
  valor: number;
};
const gravada = () =>
  (estado.inserido.find((i) => i.tabela === "hercules_propostas")?.linha ?? {}) as unknown as Gravada;
const folha = () =>
  estado.folhas.at(-1) as PropostaParaPdf & {
    condicoes: Array<{ rotulo: string; valor: string }>;
    destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
  };
const naFolha = (rotulo: string) => folha().condicoes.find((c) => c.rotulo === rotulo)?.valor;
const destaque = (rotulo: string) => folha().destaques.find((d) => d.rotulo === rotulo);
const centavos = (v: number) => Math.round(v * 100);

beforeEach(() => {
  estado.apagado = [];
  estado.atualizado = [];
  estado.avisados = 0;
  estado.com0170 = true;
  estado.comDesconto = true;
  estado.folhas = [];
  estado.leuCadastroDeOperacao = 0;
  estado.naoEnviados = 0;
  estado.sessao = { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" };
  estado.unidade = UNIDADE;
  estado.credenciado = true;
  estado.inserido = [];
  estado.reservaJaSaiu = false;
  estado.propostasDeOutros = [];
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

describe("revisão 3: a proposta do INVESTIDOR PARCELADO do Garden, gravada pela rota", () => {
  it("grava o valor do plano, o ajuste de -8%, a tabela e o desconto congelado", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);
    const g = gravada();
    expect(g.valor).toBe(400_200);
    expect(g.preco_tabela).toBe(435_000);
    expect(g.ajuste_modo).toBe("percentual");
    expect(g.ajuste_valor).toBe(-8);
    expect(g.contrato_parcelas).toBe(84);
    expect(g.condicoes.plano.descontoPercentual).toBe(8);
  });

  it("o cronograma gravado é o da MMendes: 84 × R$ 3.192,67, 4 anuais de R$ 25.000 e a conta fecha", async () => {
    await pedir({});
    const { anuais, mensais, totais } = gravada().condicoes;
    expect(mensais).toHaveLength(84);
    // (400.200 − 32.016 − 100.000) ÷ 84, que é `condicoes` do garden.html com jurosAM 0.
    expect(mensais[0]!.valor).toBe(3_192.67);
    expect(totais.entrada).toBe(32_016);
    expect(totais.anuais).toBe(100_000);
    expect(totais.financiado).toBe(268_184);
    expect(centavos(totais.entrada + totais.anuais + totais.financiado)).toBe(centavos(400_200));
    // A anual k vence junto com a mensal 12k.
    expect(anuais.map((a) => a.vencimento)).toEqual(
      [12, 24, 36, 48].map((m) => mensais[m - 1]!.vencimento),
    );
  });

  it("a folha do PDF diz tabela, desconto do plano, entrada, anuais e parcela, e a soma fecha", async () => {
    await pedir({});
    expect(estado.folhas.length).toBeGreaterThan(0);
    expect(naFolha("Valor de tabela")).toBe("R$ 435.000,00");
    expect(naFolha("Desconto")).toBe("8% · R$ 34.800,00");
    expect(naFolha("Parcelas anuais")).toBe("4 de R$ 25.000,00");
    expect(destaque("Entrada")?.valor).toBe("R$ 32.016,00");
    expect(destaque("Financiado")?.valor).toBe("R$ 268.184,00");
    expect(destaque("Financiado")?.detalhe).toBe("84 mensais, fora as 4 anuais");
    expect(destaque("Parcela mensal")?.valor).toBe("R$ 3.192,67");
  });

  it("⚠️ INVESTIDOR levado a 84x com os 12% dele: a rota aceita (a faixa de 84 é 8%) e congela zero de desconto do plano", async () => {
    // A régua do prazo: fora do prazo do plano, o desconto que ficou no campo é exceção. A nota
    // é exigida só na tela (`ModalDeProposta`); o servidor nunca exigiu, e isto registra o que ele faz.
    const r = await pedir({
      ajusteValor: -12,
      entradaValor: 30_624,
      anuaisQuantidade: 3,
      anuaisValor: 30_000,
      planoNome: "INVESTIDOR",
      valorNegociado: 382_800,
    });
    expect(r.status).toBe(200);
    expect(gravada().condicoes.plano.descontoPercentual).toBe(0);
    expect(gravada().ajuste_valor).toBe(-12);
    // A folha continua dizendo a verdade do dinheiro: tabela e desconto efetivo.
    expect(naFolha("Desconto")).toBe("12% · R$ 52.200,00");
  });

  it("NORMAL (sem desconto): sem ajuste, sem linha de tabela na folha, como sempre", async () => {
    const r = await pedir({
      ajusteModo: null,
      ajusteValor: null,
      anuaisQuantidade: 5,
      entradaValor: 43_500,
      parcelasMensais: 60,
      planoNome: "NORMAL",
      valorNegociado: 435_000,
    });
    expect(r.status).toBe(200);
    expect(gravada().ajuste_modo).toBeNull();
    expect(gravada().condicoes.plano.descontoPercentual).toBe(0);
    expect(gravada().condicoes.mensais[0]!.valor).toBe(4_441.67);
    expect(naFolha("Valor de tabela")).toBeUndefined();
  });

  // A trava de venda dupla (1.350.0) vale para o plano com desconto como para qualquer outro: o
  // desconto do Garden não abre porta nenhuma para vender o mesmo lote duas vezes.
  it("⚠️ proposta viva de OUTRA venda no terreno: o INVESTIDOR PARCELADO também recebe 409 e nada é gravado", async () => {
    estado.propostasDeOutros = [
      {
        criado_em_c2x: null,
        etapa: "contrato",
        etapa_desde: "2026-09-10T12:00:00.000Z",
        id: "p-c2x",
        reserva_id: null,
        unidade_id: "uni-1",
      },
    ];
    const r = await pedir({});
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      erros: [{ campo: "unidade", mensagem: "Este lote já tem dono: proposta em contrato. Nada foi gravado." }],
    });
    expect(estado.inserido).toHaveLength(0);
    expect(estado.folhas).toHaveLength(0);
  });
});
