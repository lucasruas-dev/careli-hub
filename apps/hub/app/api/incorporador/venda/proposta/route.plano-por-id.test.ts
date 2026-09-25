import { beforeEach, describe, expect, it, vi } from "vitest";

// O PLANO DA PROPOSTA É CASADO PELO ID DA LINHA, E NÃO PELO NOME (22/09/2026).
//
// ⚠️ O DEFEITO QUE ESTE ARQUIVO PRENDE GRAVA DINHEIRO ERRADO. A rota casava o plano com
// `planos.find((p) => p.nome.trim() === planoNome)`, e os nomes dos planos são texto que o cadastro
// edita. No rename do Garden — NORMAL vira INVESTIDOR, INVESTIDOR PARCELADO vira PROMOÇÃO
// PARCELADO, INVESTIDOR vira PROMOÇÃO À VISTA — um simulador aberto ANTES da troca continua
// mandando `planoNome: "INVESTIDOR"` querendo o plano de 36 parcelas, e o nome passa a casar com a
// linha de 60. O objeto vai inteiro para `montarCronograma` e congela na gravação: o de 36x tem
// `juros_taxa` 0,000000 e o de 60x tem 6,000000 ao ano. O cronograma gravado é o que alimenta o
// contrato.
//
// Os mocks são os de `route.garden.revisao.test.ts` — a régua, o cronograma e a folha são os de
// verdade; o que muda é que os planos vêm de `estado.planos`, para cada teste montar o cadastro no
// estado em que quer medir (antes do rename, no meio dele, depois dele).

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
  /** As folhas que foram para o desenhista do PDF. */
  folhas: [] as unknown[],
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
  /** Com que o C2X foi perguntado pelos planos: pela sigla (`lerPlanosDoC2x`) ou pelo id. */
  planosDoC2xPorSigla: [] as unknown[],
  planosDoC2xPorIds: [] as unknown[],
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

/**
 * Os três planos do Garden como `comoPlano` os entrega (SELECT de 18/09/2026), com o id da linha de
 * `temis_planos` e o nome como PARÂMETRO — é o nome que o rename troca, e o id que não troca.
 */
const PLANOS = vi.hoisted(
  () =>
    (nomes: { invest36: string; invparc84: string; normal60: string }) => {
      const base = {
        categoriaId: null,
        enterpriseId: "39",
        indiceCorrecao: "IPCA_ANUAL",
        jurosConvencao: "equivalente",
        jurosPeriodicidade: "anual",
        sistemaAmortizacao: "sacoc",
        slot: null,
      };
      // Na ordem do `order('ordem')` do banco — e é ela que o `find` por nome seguia.
      return [
        { ...base, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, id: "plano-60x", jurosTaxa: 6, nome: nomes.normal60, parcelas: 60 },
        { ...base, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, id: "plano-84x", jurosTaxa: 6, nome: nomes.invparc84, parcelas: 84 },
        { ...base, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, id: "plano-36x", jurosTaxa: 0, nome: nomes.invest36, parcelas: 36 },
      ];
    },
);

/** O cadastro como está hoje, antes de alguém renomear. */
const HOJE = vi.hoisted(() => ({
  invest36: "INVESTIDOR",
  invparc84: "INVESTIDOR PARCELADO",
  normal60: "NORMAL",
}));

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
  lerPlanosDoC2x: async (codes: unknown) => {
    estado.planosDoC2xPorSigla.push(codes);
    return { ok: false } as const;
  },
  lerPlanosDoC2xPorIds: async (ids: unknown) => {
    estado.planosDoC2xPorIds.push(ids);
    return { ok: false } as const;
  },
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
 * O que o simulador manda ao clicar no plano de 36 parcelas do lote de R$ 435.000.
 *
 * ⚠️ O `planoNome` É O QUE ESTAVA NA TELA QUANDO ELA CARREGOU, e é justamente o ponto: a aba do
 * corretor abriu antes do rename. O prazo (36) e os números (12% de desconto, 3 anuais de
 * R$ 30.000, 40% de entrada) são os do plano de 36 — não os do de 60.
 */
const DO_SIMULADOR = {
  ajusteModo: "percentual",
  ajusteValor: -12,
  anuaisQuantidade: 3,
  anuaisValor: 30_000,
  diaDeVencimento: 10,
  entradaValor: 154_000,
  entradaVezes: 1,
  parcelasMensais: 36,
  planoNome: "INVESTIDOR",
  valorNegociado: 382_800,
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
  condicoes: { mensais: Array<{ valor: number; vencimento: string }> };
  contrato_parcelas: number;
  plano_juros: null | number;
  plano_nome: string;
  plano_parcelas: number;
};
const gravada = () =>
  (estado.inserido.find((i) => i.tabela === "hercules_propostas")?.linha ?? {}) as unknown as Gravada;
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
  estado.planos = PLANOS(HOJE);
  estado.planosDoC2xPorSigla = [];
  estado.planosDoC2xPorIds = [];
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

describe("os planos do C2X pelo id do empreendimento (PAN-124)", () => {
  it("🔴 pergunta ao C2X pelo `enterprise_id` da unidade, e não pela sigla do catálogo, que muda num renome", async () => {
    await pedir({ planoId: "plano-36x" });
    expect(estado.planosDoC2xPorIds).toEqual([["39"]]);
    expect(estado.planosDoC2xPorSigla).toEqual([]);
  });
});

describe("o plano da proposta é casado pelo ID da linha, com o nome como reserva", () => {
  it("cadastro de hoje, tela de hoje: o id leva ao plano de 36x sem juros, e nada mais mudou", async () => {
    const r = await pedir({ planoId: "plano-36x" });
    expect(r.status).toBe(200);
    const g = gravada();
    expect(g.plano_nome).toBe("INVESTIDOR");
    expect(g.plano_parcelas).toBe(36);
    expect(g.plano_juros).toBe(0);
    expect(g.contrato_parcelas).toBe(36);
    // (382.800 − 154.000 − 90.000) ÷ 36, sem juros nenhum.
    expect(g.condicoes.mensais[0]!.valor).toBe(3_855.56);
  });

  // ⚠️ O CASO QUE CUSTA DINHEIRO. Os três planos renomeados e a aba do corretor aberta antes: ela
  // manda o id do plano de 36 e o nome VELHO dele, que agora pertence ao plano de 60.
  it("⚠️ depois do rename, a tela velha manda o nome de OUTRO plano — e o id leva ao plano certo", async () => {
    estado.planos = PLANOS({
      invest36: "PROMOÇÃO À VISTA",
      invparc84: "PROMOÇÃO PARCELADO",
      normal60: "INVESTIDOR",
    });

    const r = await pedir({ planoId: "plano-36x", planoNome: "INVESTIDOR" });
    expect(r.status).toBe(200);
    const g = gravada();
    // O plano é o de 36 parcelas SEM JUROS, e o nome gravado é o do cadastro de agora — não o que
    // a aba velha mandou. Casando por nome, isto sairia "INVESTIDOR", 60 parcelas e 6% ao ano.
    expect(g.plano_nome).toBe("PROMOÇÃO À VISTA");
    expect(g.plano_parcelas).toBe(36);
    expect(g.plano_juros).toBe(0);
    // ⚠️ E O CRONOGRAMA GRAVADO É O DINHEIRO. Com o plano de 36 (sem juros) saem 36 mensais IGUAIS
    // de R$ 3.855,56, somando R$ 138.800,16. Medido com o `find` por nome no lugar: o cronograma
    // saía com o degrau do SACOC a 6% ao ano — R$ 3.855,56, R$ 3.979,75 e R$ 4.218,53 —, somando
    // R$ 144.646,08. São R$ 5.845,92 a mais cobrados de um cliente que fechou um plano sem juros,
    // gravados na proposta que alimenta o contrato.
    expect([...new Set(g.condicoes.mensais.map((m) => m.valor))]).toEqual([3_855.56]);
    expect(
      Math.round(g.condicoes.mensais.reduce((t, m) => t + m.valor, 0) * 100) / 100,
    ).toBe(138_800.16);
  });

  // ⚠️ O ESTADO DO MEIO DO RENAME, E ELE EXISTE DE VERDADE: trocar três nomes é trocar três linhas,
  // uma de cada vez. Enquanto o NORMAL já virou INVESTIDOR e o INVESTIDOR antigo ainda não virou
  // PROMOÇÃO À VISTA, há DOIS "INVESTIDOR" na lista — 60 parcelas com 6% ao ano e 36 sem juros.
  //
  // ⚠️ E É POR ISSO QUE A TELA MANDA O ID, E NÃO POR UMA RECUSA. Em 22/09/2026 chegou a existir aqui
  // uma trava que recusava esse cadastro com 422; ela foi desfeita no mesmo dia porque parava a
  // venda do Lagoa Bonita inteira, sem rename nenhum (ver `route.plano-repetido-na-familia.test.ts`
  // e o cabeçalho de `escolherPlanoDaProposta`). Sem id, o nome repetido leva o PRIMEIRO da lista,
  // como sempre levou — e este par de testes mede exatamente essa diferença.
  it("⚠️ sem id, o nome repetido leva o primeiro da lista — o comportamento de sempre", async () => {
    estado.planos = PLANOS({ ...HOJE, normal60: "INVESTIDOR" });

    const r = await pedir({});
    expect(r.status).toBe(200);
    // O primeiro "INVESTIDOR" da lista é o de 60 parcelas a 6% ao ano, e não o de 36 sem juros que
    // o corretor escolheu. É o buraco que o id fecha, e que só o id fecha.
    expect(gravada().plano_parcelas).toBe(60);
    expect(gravada().plano_juros).toBe(6);
  });

  it("o mesmo cadastro ambíguo, com o id no pedido: passa, e passa no plano de 36x", async () => {
    estado.planos = PLANOS({ ...HOJE, normal60: "INVESTIDOR" });

    const r = await pedir({ planoId: "plano-36x" });
    expect(r.status).toBe(200);
    expect(gravada().plano_parcelas).toBe(36);
    expect(gravada().plano_juros).toBe(0);
  });

  // ⚠️ A RESERVA TEM QUE CONTINUAR VALENDO. A tela ainda não manda o id, e os empreendimentos
  // servidos pelo C2X não têm id para mandar: exigi-lo pararia a venda de todo mundo no deploy.
  it("sem id e com o nome único, a proposta sai como sempre saiu", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(gravada().plano_nome).toBe("INVESTIDOR");
    expect(gravada().plano_parcelas).toBe(36);
  });

  // ⚠️ E O ID QUE NÃO CASA NÃO CAI NO NOME. O fallback silencioso seria o buraco de volta: a tela
  // velha manda o id certo E o nome velho, e o nome velho é de outro plano.
  it("⚠️ id que não existe mais recusa, mesmo com um nome que casaria", async () => {
    const r = await pedir({ planoId: "plano-que-foi-desativado" });
    expect(r.status).toBe(422);
    expect(await erroDoPlano(r)).toBe(
      "O plano escolhido não está mais disponível neste empreendimento. Abra a proposta de novo e escolha o plano na lista.",
    );
    expect(estado.inserido).toHaveLength(0);
  });

  it("nome que não existe continua com a frase de sempre", async () => {
    const r = await pedir({ planoNome: "PLANO QUE NINGUÉM CADASTROU" });
    expect(r.status).toBe(422);
    expect(await erroDoPlano(r)).toBe(
      'O plano "PLANO QUE NINGUÉM CADASTROU" não está disponível neste empreendimento.',
    );
    expect(estado.inserido).toHaveLength(0);
  });

  it("sem plano nenhum no pedido, a frase é o convite a escolher", async () => {
    const r = await pedir({ planoNome: "" });
    expect(r.status).toBe(422);
    expect(await erroDoPlano(r)).toBe("Escolha o plano da proposta.");
  });
});
