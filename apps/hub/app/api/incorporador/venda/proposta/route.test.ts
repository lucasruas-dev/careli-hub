import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/incorporador/venda/proposta — o que ela GRAVA.
//
// O que está travado aqui são dois defeitos reais da primeira versão:
//
// 1. O PRAZO CONTRATADO. O insert gravava só `plano_parcelas` (o molde: 180) e deixava
//    `contrato_parcelas` nulo. `fluxoDoPlano` prefere o contratado e cai no molde — então uma
//    proposta de 120x aparecia como "180x" na lista da tela Venda. É o mesmo erro que estampou
//    "144x" no extrato de um contrato de 62 parcelas.
// 2. O TELEFONE DO PROPONENTE. Ele chegava no corpo, era aceito e sumia antes da coluna
//    `compradores` — e o jsonb é o único lugar onde o contato de quem não é titular existe.
//
// Supabase e disparo mockados: o teste é da REGRA da rota, não da integração. A régua
// (`conferirProposta`) e o cronograma são os DE VERDADE, senão o teste provaria só a si mesmo.

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
  /** O desconto do plano (0178). Zero é o plano de sempre; o do Garden entra só no teste dele. */
  descontoDoPlano: 0,
  /** Cada folha que chegou ao gerador de PDF — é por ela que se prova o que o papel carrega. */
  folhas: [] as Array<Record<string, unknown>>,
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
  /**
   * O banco AINDA SEM A 0187: o insert que nomeia `bens_e_permutas` volta com o erro de coluna
   * desconhecida. Medido em produção em 22/09/2026 — `information_schema.columns` não devolve a
   * coluna em `hercules_propostas`, porque aplicar migration exige OK do Lucas, a cada vez.
   */
  semAColunaDeBens: false,
}));

const UNIDADE = {
  area: "250.00",
  codigo: "Q01 L01",
  enterprise_id: "39",
  id: "uni-1",
  lote: "01",
  preco_tabela: "178100.00",
  quadra: "01",
  situacao: "reservada",
};

/** O plano do C2X: um MOLDE de 180 parcelas, que serve centenas de contratos. */
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
  lerPlanosDoC2xPorIds: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  // ⚠️ A ROTA PASSOU A LER AS FAIXAS DE PRAZO NO POST (25/09/2026), e o dublê precisa exportar tudo o
  // que ela importa: sem esta linha a função chega `undefined`, a chamada quebra e a rota devolve
  // 503 — um erro que parece da proposta e é do mock. Vazio = empreendimento sem faixa cadastrada,
  // que é o caso destes testes.
  lerFaixasDoPanteon: async () => ({}),
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [
    { planos: [{ ...PLANO, descontoPercentual: estado.descontoDoPlano }] },
  ],
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

// O desenho do PDF é caro e não é o assunto deste teste — o insert acontece antes dele.
//
// ⚠️ MAS A FOLHA FICA GUARDADA, e é o único jeito de provar o que o papel carrega sem abrir o PDF
// a olho. `montarFolhaDaProposta` (o de VERDADE, não mockado) é quem traduz o que a rota passa em
// linhas impressas: capturar o argumento aqui prende a costura inteira rota → folha → papel.
vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: Record<string, unknown>) => {
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
    if (feito.insert) {
      // ⚠️ O BANCO SEM A 0187 RECUSA O INSERT QUE NOMEIA A COLUNA — e é a forma exata do erro que
      // o PostgREST devolve quando o schema cache não conhece o campo (PGRST204). Sem este ramo o
      // dublê aceitaria qualquer coluna, e o teste provaria um banco que não existe.
      if (
        tabela === "hercules_propostas" &&
        estado.semAColunaDeBens &&
        "bens_e_permutas" in feito.insert
      ) {
        return {
          data: null,
          error: {
            code: "PGRST204",
            message:
              "Could not find the 'bens_e_permutas' column of 'hercules_propostas' in the schema cache",
          },
        };
      }
      return { data: { id: "prop-1" }, error: null };
    }
    // Update com `.select()`: uma linha casada, como no caminho feliz do PostgREST.
    if (feito.update) {
      if (!feito.select) return { data: null, error: null };
      const casou = tabela === "hercules_reservas" && estado.reservaJaSaiu ? [] : [{ id: "linha-1" }];
      return { data: casou, error: null };
    }
    // ⚠️ AS LEITURAS EM LISTA DA TRAVA DO LOTE (18/09/2026). Antes do INSERT a rota lê a situação
    // do terreno e pergunta à trava se há OUTRO dono vivo (`lerSituacaoDasUnidades` +
    // `outrosDonosDoLote`), e as duas leem em lista. Aqui a unidade é a única linha viva do terreno
    // (as linhas do pai, `not(espelho_de)`, voltam vazias), a reserva viva é a DESTA venda, e
    // propostas de outros só quando o teste pede.
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
      return { data: { entrada_minima_percentual: 10 }, error: null };
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
// ⚠️ O CRONOGRAMA AQUI É O DE VERDADE, e é ele o gabarito. Reescrever a conta esperada à mão
// (200.000 − 5.000 − 80.000) provaria a aritmética do teste, não que a rota MANDOU os bens para a
// lib: é exatamente assim que a rota ficou "meio ligada" — gravando a permuta e financiando o lote
// inteiro. O teste compara o que a rota congelou com o que a mesma composição produz.
import { montarCronograma } from "@/lib/hercules/cronograma";

/** Uma data que não é passado — a régua recusa cobrança em dia que já passou. */
const PRIMEIRA_PARCELA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const CPF_DO_TITULAR = "529.982.247-25";
const CPF_DO_SEGUNDO = "168.995.350-09";

const pedir = (corpo: Record<string, unknown>) =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [
          {
            cpf: CPF_DO_TITULAR,
            nome: "Maria da Silva",
            participacao: 60,
            telefone: "62991234567",
          },
          {
            cpf: CPF_DO_SEGUNDO,
            nome: "João Souza",
            participacao: 40,
            telefone: "62988887777",
          },
        ],
        diaDeVencimento: 10,
        entradaValor: 17_810,
        entradaVezes: 2,
        // ⚠️ 120 CONTRATADAS, contra as 180 do molde.
        parcelasMensais: 120,
        planoNome: "NORMAL",
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: "uni-1",
        valorNegociado: 178_100,
        ...corpo,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

/**
 * A linha que foi para `hercules_propostas` — a ÚLTIMA tentativa, que é a que valeu.
 *
 * ⚠️ A PRIMEIRA PODE TER SIDO RECUSADA. Com a 0187 ainda não aplicada, o insert que nomeia
 * `bens_e_permutas` volta com PGRST204 e a rota refaz sem a coluna; pegar a PRIMEIRA entrada da
 * lista devolveria a tentativa que o banco rejeitou, e o teste afirmaria ter gravado o que não
 * gravou.
 */
const gravada = () =>
  [...estado.inserido].reverse().find((i) => i.tabela === "hercules_propostas")?.linha ?? {};

beforeEach(() => {
  estado.apagado = [];
  estado.atualizado = [];
  estado.avisados = 0;
  estado.com0170 = true;
  estado.leuCadastroDeOperacao = 0;
  estado.naoEnviados = 0;
  estado.sessao = { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" };
  estado.unidade = UNIDADE;
  estado.credenciado = true;
  estado.descontoDoPlano = 0;
  estado.folhas = [];
  estado.inserido = [];
  estado.reservaJaSaiu = false;
  estado.semAColunaDeBens = false;
  estado.propostasDeOutros = [];
  estado.reserva = {
    corretor_entity_id: "corr-1",
    criado_em: "2026-09-01T12:00:00.000Z",
    id: "res-1",
    imobiliaria_entity_id: "imob-1",
    proponentes: [
      { cpf: CPF_DO_TITULAR, nome: "MARIA DA SILVA", telefone: "62991234567" },
    ],
    protocolo_numero: 123,
    situacao: "ativa",
    validade_em: "2026-09-07T02:59:59.000Z",
  };
});

describe("POST — a proposta gravada", () => {
  it("⚠️ grava o prazo CONTRATADO, e não o do molde", async () => {
    // O plano do C2X é MOLDE (180 parcelas servem centenas de contratos); quem sabe o tamanho
    // DESTA venda é o que o coordenador digitou. Com `contrato_parcelas` nulo, `fluxoDoPlano` cai
    // no molde e a lista mostra 180x numa proposta de 120x.
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(gravada().contrato_parcelas).toBe(120);
  });

  it("o molde continua gravado, como referência do produto que originou a proposta", () => {
    // As 4.857 importadas do C2X só têm este número: apagá-lo faria a nativa ser a única linha sem
    // dizer de que plano ela saiu.
    return pedir({}).then(() => {
      expect(gravada().plano_parcelas).toBe(180);
      expect(gravada().plano_nome).toBe("NORMAL");
    });
  });

  it("⚠️ o telefone dos compradores é GRAVADO, inclusive o do proponente adicional", async () => {
    // O jsonb é o único lugar onde o contato de quem não é titular existe: ele não tem reserva,
    // pode não ter CAD e pode não ter entidade no Apolo.
    await pedir({});
    const compradores = gravada().compradores as Array<Record<string, unknown>>;
    expect(compradores).toHaveLength(2);
    expect(compradores[0]).toMatchObject({ telefone: "62991234567", titular: true });
    expect(compradores[1]).toMatchObject({
      nome: "João Souza",
      telefone: "62988887777",
      titular: false,
    });
  });

  it("⚠️ o telefone do TITULAR é o da reserva, não o que veio no corpo", async () => {
    // Mesma regra do nome e do CPF: o titular é o da reserva e não se troca por HTTP.
    await pedir({
      compradores: [
        { cpf: CPF_DO_TITULAR, nome: "Outro Nome", participacao: 100, telefone: "11999999999" },
      ],
    });
    const compradores = gravada().compradores as Array<Record<string, unknown>>;
    expect(compradores[0]).toMatchObject({
      nome: "MARIA DA SILVA",
      telefone: "62991234567",
      titular: true,
    });
  });

  it("comprador sem telefone grava nulo — e não a string vazia", async () => {
    await pedir({
      compradores: [
        { cpf: CPF_DO_TITULAR, nome: "Maria da Silva", participacao: 60, telefone: "62991234567" },
        { cpf: CPF_DO_SEGUNDO, nome: "João Souza", participacao: 40 },
      ],
    });
    const compradores = gravada().compradores as Array<Record<string, unknown>>;
    expect(compradores[1]?.telefone).toBeNull();
  });

  it("o COD é o MESMO da reserva, copiado — e a etapa nasce em `proposta`", async () => {
    const r = await pedir({});
    expect(await r.json()).toMatchObject({ data: { codigo: "000123", id: "prop-1" } });
    expect(gravada().protocolo_numero).toBe(123);
    expect(gravada().etapa).toBe("proposta");
    expect(gravada().origem).toBe("panteon");
    // A reserva continua viva, agora travando a unidade em `proposta`.
    expect(estado.atualizado[0]).toMatchObject({
      linha: { situacao: "proposta" },
      tabela: "hercules_reservas",
    });
  });

  it("pedido que a régua recusa não grava nada", async () => {
    // Participações que não fecham 100%: a proposta inteira é recusada antes do banco.
    const r = await pedir({
      compradores: [
        { cpf: CPF_DO_TITULAR, nome: "Maria da Silva", participacao: 40, telefone: "62991234567" },
        { cpf: CPF_DO_SEGUNDO, nome: "João Souza", participacao: 40 },
      ],
    });
    expect(r.status).toBe(422);
    expect(estado.inserido).toHaveLength(0);
  });
});

describe("⚠️ a trava do lote antes do INSERT (Lucas, 18/09/2026)", () => {
  // *"eu não posso vender dois lotes para pessoas diferentes"*. A proposta nasce da reserva desta
  // unidade; outra proposta viva no terreno (a importada do legado, ou a de outra reserva) é outro
  // dono, e a rota recusa antes de gravar. A regra está provada contra um banco em memória em
  // `lib/hercules/trava-do-lote.test.ts`; aqui fica que a rota obedece a resposta.
  it("proposta viva de OUTRA venda no terreno: 409 com a frase da trava, e nada gravado", async () => {
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
    expect(estado.atualizado).toHaveLength(0);
    expect(estado.avisados).toBe(0);
  });

  it("a proposta que já nasceu DESTA reserva não conta como outro dono", async () => {
    estado.propostasDeOutros = [
      {
        criado_em_c2x: null,
        etapa: "proposta",
        etapa_desde: "2026-09-10T12:00:00.000Z",
        id: "p-desta",
        reserva_id: "res-1",
        unidade_id: "uni-1",
      },
    ];
    const r = await pedir({});
    expect(r.status).toBe(200);
  });
});

describe("⚠️ a reserva cancelada durante a geração não deixa proposta órfã", () => {
  it("desfaz a proposta e recusa quando o flip da reserva não casa linha nenhuma", async () => {
    // O cenário: o POST lê a reserva 'ativa' e só então busca credenciamento, cadastro, catálogo do
    // C2X e planos — vários segundos. Nesse meio-tempo outro coordenador cancela a reserva, a
    // unidade volta para 'disponivel' e os três recebem "reserva cancelada". Sem o `.select()`, o
    // update que casa ZERO linhas devolve `error: null` e passava por sucesso: a proposta ficava
    // viva sobre um lote livre, que aceitaria reserva de outro cliente enquanto o primeiro anda com
    // um PDF de preço na mão.
    estado.reservaJaSaiu = true;

    const r = await pedir({});

    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain(
      "cancelada enquanto a proposta era montada",
    );
    // A proposta recém-nascida foi apagada: ninguém foi avisado e nenhum PDF saiu.
    expect(estado.apagado.some((a) => a.tabela === "hercules_propostas")).toBe(true);
  });

  it("no caminho normal a proposta fica de pé e nada é apagado", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(estado.apagado).toEqual([]);
  });
});

// ── QUEM OPERA O PRODUTO DECIDE A ESCRITA (D1) E O AVISO (D3) ──────────────────
//
// Decisão do Lucas (16/09/2026): no portal do Cecílio a proposta só nasce no produto operado por ele
// (o 39 aqui); no VOC (37, da Careli) é só consulta. A Gurgel (comercial) gera como sempre, sem ir ao
// banco perguntar quem opera. E a proposta do Cecílio não manda WhatsApp para ninguém.

const CECILIO = {
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-cecilio",
  usuarioNome: "Maria do Cecílio",
};

describe("POST — a régua de quem opera o produto", () => {
  it("⚠️ Cecílio no VOC (37, operado pela Careli): 403 só consulta, e nada é gravado", async () => {
    estado.sessao = CECILIO;
    estado.unidade = { ...UNIDADE, enterprise_id: "37" };
    const r = await pedir({});
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ soConsulta: true });
    expect(estado.inserido).toHaveLength(0);
    expect(estado.atualizado).toHaveLength(0);
  });

  it("Cecílio no produto que ele opera (39): grava a proposta", async () => {
    estado.sessao = CECILIO;
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(gravada()).toMatchObject({ criado_por: "u-cecilio", etapa: "proposta" });
  });

  it("⚠️ a proposta do Cecílio não chama o WhatsApp: registra que o aviso não saiu", async () => {
    estado.sessao = CECILIO;
    await pedir({});
    expect(estado.avisados).toBe(0);
    expect(estado.naoEnviados).toBe(1);
  });

  it("a Gurgel (comercial) no VOC grava sem ler quem opera, e avisa como sempre", async () => {
    estado.unidade = { ...UNIDADE, enterprise_id: "37" };
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(estado.leuCadastroDeOperacao).toBe(0);
    expect(estado.avisados).toBe(1);
    expect(estado.naoEnviados).toBe(0);
  });

  it("sem a 0170 não dá para provar quem opera: 503, e nada é gravado", async () => {
    estado.sessao = CECILIO;
    estado.com0170 = false;
    const r = await pedir({});
    expect(r.status).toBe(503);
    expect(estado.inserido).toHaveLength(0);
  });
});

describe("POST — a guarda do preço de tabela", () => {
  it.each([null, "0.00", "1"])("preço %s: 409, e nem a prévia nem a proposta saem", async (preco) => {
    estado.unidade = { ...UNIDADE, preco_tabela: preco };
    const r = await pedir({});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe(
      "Esta unidade está sem preço de tabela e não pode receber proposta.",
    );
    expect(estado.inserido).toHaveLength(0);
  });
});

describe("POST: o desconto do plano congelado na proposta (18/09/2026)", () => {
  // `condicoes.plano.descontoPercentual` guarda o que o plano PREVIA, ao lado do `ajuste_*` que foi
  // DADO. A régua é a do simulador: o desconto só é do plano no prazo do plano. Fora dele, o que
  // ficou no campo é exceção do coordenador (a modal pediu a nota), e o congelado é zero.
  const congelado = () =>
    ((gravada().condicoes as { plano?: { descontoPercentual?: unknown } } | undefined)?.plano
      ?.descontoPercentual);

  it("no prazo do plano, congela o desconto dele", async () => {
    estado.descontoDoPlano = 8;
    const r = await pedir({ parcelasMensais: 180 });
    expect(r.status).toBe(200);
    expect(congelado()).toBe(8);
  });

  it("⚠️ fora do prazo do plano, congela zero: o desconto que ficou no campo é exceção", async () => {
    estado.descontoDoPlano = 8;
    const r = await pedir({ parcelasMensais: 120 });
    expect(r.status).toBe(200);
    expect(congelado()).toBe(0);
  });

  it("plano sem desconto congela zero, como sempre", async () => {
    await pedir({ parcelasMensais: 180 });
    expect(congelado()).toBe(0);
  });
});

// ── O BEM E A PERMUTA RECEBIDOS NA AQUISIÇÃO (Lucas, 22/09/2026) ─────────────
//
// *"Abate, como uma entrada"*, *"Vários"*, *"pode ser um ou outro, pode apontar na entrada ou
// somente no valor negociado"*. O que se trava aqui é o CONTRATO DO DADO: a lista chega pela rota,
// é conferida item a item e vai para `hercules_propostas.bens_e_permutas` (0187). O que cada
// `entraComo` faz com a entrada mínima é régua de `lib/hercules/proposta.ts`, de outra frente.
//
// ⚠️ O CASO DO VALOR VAZIO É O MOTIVO DESTE BLOCO EXISTIR. `Number("")` é ZERO, e nesta casa isso
// já virou cobrança de R$ 0,00 em produção: um campo de valor que o coordenador não preencheu não
// pode virar "permuta de zero reais" gravada e impressa no contrato como se fosse combinada.
const PERMUTA = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada",
  tipo: "bem",
  valor: 32_000,
};

/** A lista como ela ficou gravada na coluna. */
const bensGravados = () =>
  gravada().bens_e_permutas as Array<Record<string, unknown>>;

/** O primeiro erro de campo que a rota devolveu. */
const erroDeCampo = async (r: Response) =>
  ((await r.json()) as { erros?: Array<{ campo: string; mensagem: string }> })
    .erros?.[0] ?? null;

describe("POST — os bens e permutas da proposta", () => {
  it("aceita a lista e grava os quatro campos de cada item", async () => {
    const r = await pedir({
      bensEPermutas: [
        PERMUTA,
        {
          descricao: "lote 12 da quadra 4 em Anápolis",
          entraComo: "abatimento",
          tipo: "permuta",
          valor: 55_000,
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(bensGravados()).toEqual([
      {
        descricao: "Ford Ka 2019 placa ABC1D23",
        entraComo: "entrada",
        tipo: "bem",
        valor: 32_000,
      },
      {
        descricao: "lote 12 da quadra 4 em Anápolis",
        entraComo: "abatimento",
        tipo: "permuta",
        valor: 55_000,
      },
    ]);
  });

  it("⚠️ proposta SEM o campo continua sendo gravada, com a lista vazia", async () => {
    // É a tela de hoje, e os clientes em cache: nenhum deles manda `bensEPermutas`. Recusá-los
    // pararia a venda inteira por causa de um campo que eles não sabem existir. E a coluna é NOT
    // NULL: quem lê nunca precisa distinguir nulo de vazio.
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect(bensGravados()).toEqual([]);
  });

  it("a descrição é gravada aparada, e o valor vira número", async () => {
    await pedir({
      bensEPermutas: [{ ...PERMUTA, descricao: "  Ford Ka 2019  ", valor: "32000.50" }],
    });
    expect(bensGravados()[0]).toMatchObject({ descricao: "Ford Ka 2019", valor: 32_000.5 });
  });

  it("⚠️ valor vazio é ERRO, nunca zero — `Number(\"\")` é 0 e já virou cobrança de R$ 0,00", async () => {
    const r = await pedir({ bensEPermutas: [{ ...PERMUTA, valor: "" }] });
    expect(r.status).toBe(400);
    expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[0].valor");
    expect(estado.inserido).toHaveLength(0);
  });

  it("valor zero, negativo, não finito ou ilegível é recusado", async () => {
    for (const valor of [0, -1, "abc", Number.NaN, null, undefined, {}]) {
      estado.inserido = [];
      const r = await pedir({ bensEPermutas: [{ ...PERMUTA, valor }] });
      expect(r.status).toBe(400);
      expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[0].valor");
      expect(estado.inserido).toHaveLength(0);
    }
  });

  it("tipo fora de {bem, permuta} é recusado, dizendo o campo", async () => {
    const r = await pedir({ bensEPermutas: [{ ...PERMUTA, tipo: "veiculo" }] });
    expect(r.status).toBe(400);
    const erro = await erroDeCampo(r);
    expect(erro?.campo).toBe("bensEPermutas[0].tipo");
    expect(erro?.mensagem).toContain("bem");
    expect(estado.inserido).toHaveLength(0);
  });

  it("⚠️ entraComo fora de {entrada, abatimento} é recusado — e ausente NÃO vira padrão", async () => {
    // Lucas: *"pode ser um ou outro"*. Escolher por ele mudaria o que a proposta promete: com
    // "entrada", o bem CUMPRE o piso de 10% e o cliente não precisa pôr dinheiro; com
    // "abatimento", precisa. Um padrão em silêncio decide o negócio no lugar do coordenador.
    for (const entraComo of ["sinal", "", null, undefined]) {
      estado.inserido = [];
      const r = await pedir({ bensEPermutas: [{ ...PERMUTA, entraComo }] });
      expect(r.status).toBe(400);
      expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[0].entraComo");
      expect(estado.inserido).toHaveLength(0);
    }
  });

  it("descrição vazia é recusada: o contrato precisa dizer O QUE está recebendo", async () => {
    for (const descricao of ["", "   ", null, 42]) {
      estado.inserido = [];
      const r = await pedir({ bensEPermutas: [{ ...PERMUTA, descricao }] });
      expect(r.status).toBe(400);
      expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[0].descricao");
      expect(estado.inserido).toHaveLength(0);
    }
  });

  it("descrição acima do limite é recusada, e não cortada em silêncio", async () => {
    const r = await pedir({
      bensEPermutas: [{ ...PERMUTA, descricao: "a".repeat(301) }],
    });
    expect(r.status).toBe(400);
    expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[0].descricao");
    expect(estado.inserido).toHaveLength(0);
  });

  it("descrição no limite exato passa", async () => {
    const r = await pedir({
      bensEPermutas: [{ ...PERMUTA, descricao: "a".repeat(300) }],
    });
    expect(r.status).toBe(200);
    expect((bensGravados()[0]?.descricao as string).length).toBe(300);
  });

  it("o campo que não é lista é recusado — e o erro aponta a lista, não um item", async () => {
    for (const bensEPermutas of ["Ford Ka", 3, { descricao: "Ford Ka" }]) {
      estado.inserido = [];
      const r = await pedir({ bensEPermutas });
      expect(r.status).toBe(400);
      expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas");
      expect(estado.inserido).toHaveLength(0);
    }
  });

  it("item que não é objeto é recusado, dizendo a posição", async () => {
    const r = await pedir({ bensEPermutas: [PERMUTA, "Ford Ka"] });
    expect(r.status).toBe(400);
    expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas[1]");
    expect(estado.inserido).toHaveLength(0);
  });

  // ⚠️ OS ITENS DESTES DOIS TESTES VALEM POUCO DE PROPÓSITO. O que se trava aqui é o TETO DE
  // QUANTIDADE, e dez carros de R$ 32.000 num lote de R$ 178.100 batem antes no teto do DINHEIRO
  // (`conferirProposta` recusa entrada + bens acima do valor negociado, e com razão): o teste
  // passaria a provar a régua do dinheiro achando que prova a da lista.
  const BEM_BARATO = { ...PERMUTA, valor: 1_000 };

  it("acima do teto de itens é recusado", async () => {
    const r = await pedir({
      bensEPermutas: Array.from({ length: 11 }, (_, i) => ({
        ...BEM_BARATO,
        descricao: `bem ${i + 1}`,
      })),
    });
    expect(r.status).toBe(400);
    expect((await erroDeCampo(r))?.campo).toBe("bensEPermutas");
    expect(estado.inserido).toHaveLength(0);
  });

  it("no teto exato passa: o limite é teto, não parede antes dele", async () => {
    const r = await pedir({
      bensEPermutas: Array.from({ length: 10 }, (_, i) => ({
        ...BEM_BARATO,
        descricao: `bem ${i + 1}`,
      })),
    });
    expect(r.status).toBe(200);
    expect(bensGravados()).toHaveLength(10);
  });

  it("⚠️ o campo a mais no item é DESCARTADO, e não gravado", async () => {
    // A coluna é o que a Têmis vai imprimir no contrato. Deixar passar o que a tela mandou por
    // engano (um `id` de rascunho, um `valorFipe` de outra aba) põe na minuta um dado que ninguém
    // conferiu — e jsonb não tem schema para barrar depois.
    await pedir({
      bensEPermutas: [{ ...PERMUTA, id: "rascunho-1", valorFipe: 41_000 }],
    });
    expect(Object.keys(bensGravados()[0] ?? {}).sort()).toEqual([
      "descricao",
      "entraComo",
      "tipo",
      "valor",
    ]);
  });
});

// ── ⚠️ O BEM ENTRA NA CONTA, E NÃO SÓ NA COLUNA ─────────────────────────────
//
// O bloco acima prova que a lista CHEGA e é GRAVADA. Este prova o que faltava: que ela é usada.
// A rota estava meio ligada, que é pior do que desligada — validava a permuta, gravava a permuta
// e emitia o cronograma do lote INTEIRO. Reproduzido no código antes de consertar: lote de
// R$ 200.000, entrada de R$ 20.000 e um carro de R$ 80.000 gravavam a proposta com o carro na
// coluna E 120 boletos sobre R$ 180.000 — o bem cobrado de novo, em boleto, de quem já o entregou.
//
// ⚠️ O GABARITO É `montarCronograma`, E NÃO UM NÚMERO ESCRITO À MÃO. Ver o comentário do import.
describe("⚠️ os bens e permutas ENTRAM NA CONTA da proposta (22/09/2026)", () => {
  const LOTE = 200_000;
  const CARRO = 80_000;
  /** 10% de R$ 200.000 — o piso deste empreendimento (`apolo_enterprise_settings`). */
  const PISO = 20_000;

  const carro = (entraComo: "abatimento" | "entrada") => ({
    descricao: "Ford Ka 2019 placa ABC1D23",
    entraComo,
    tipo: "bem",
    valor: CARRO,
  });

  /** A MESMA composição do corpo, montada pela lib de verdade. */
  const gabarito = (entradaValor: number, bens: ReturnType<typeof carro>[]) =>
    montarCronograma({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      bensEPermutas: bens as Parameters<
        typeof montarCronograma
      >[0]["bensEPermutas"],
      diaDeVencimento: 10,
      entradaDatas: null,
      entradaParcelas: null,
      entradaValor,
      entradaVezes: 2,
      parcelasMensais: 120,
      plano: { ...PLANO, descontoPercentual: 0 } as unknown as Parameters<
        typeof montarCronograma
      >[0]["plano"],
      primeiraParcelaDaEntrada: PRIMEIRA_PARCELA,
      valorNegociado: LOTE,
    });

  /** O cronograma que a rota CONGELOU na proposta — `condicoes` é o cronograma mais a premissa. */
  const congelado = () =>
    gravada().condicoes as {
      mensais: Array<{ valor: number }>;
      totais: Record<string, number>;
    };

  beforeEach(() => {
    // O preço de tabela acompanha o negociado: a guarda da rota só recusa unidade SEM preço.
    estado.unidade = { ...UNIDADE, preco_tabela: "200000.00" };
  });

  it("⚠️ permuta apontada na ENTRADA cumpre o piso e financia o saldo certo", async () => {
    // R$ 5.000 em espécie estão abaixo dos R$ 20.000 de piso; o carro apontado na entrada é o que
    // completa. Sem a lista chegando a `conferirProposta`, a rota recusa uma venda legítima.
    const r = await pedir({
      bensEPermutas: [carro("entrada")],
      entradaValor: 5_000,
      valorNegociado: LOTE,
    });
    expect(r.status).toBe(200);

    const esperado = gabarito(5_000, [carro("entrada")]);
    expect(congelado().totais).toEqual(esperado.totais);
    expect(congelado().mensais).toEqual(esperado.mensais);
    // O número que o defeito produzia era R$ 195.000 financiados (o carro fora da conta).
    expect(congelado().totais.financiado).toBe(LOTE - 5_000 - CARRO);
    expect(congelado().totais.bensEPermutas).toBe(CARRO);
  });

  it("⚠️ permuta como ABATIMENTO não cumpre o piso — mas abate o saldo igual", async () => {
    const recusada = await pedir({
      bensEPermutas: [carro("abatimento")],
      entradaValor: 5_000,
      valorNegociado: LOTE,
    });
    expect(recusada.status).toBe(422);
    expect((await erroDeCampo(recusada))?.campo).toBe("entrada");
    expect(estado.inserido).toHaveLength(0);

    // O mesmo carro, com a entrada em dia: o piso está cumprido em espécie e o bem abate igual.
    const aceita = await pedir({
      bensEPermutas: [carro("abatimento")],
      entradaValor: PISO,
      valorNegociado: LOTE,
    });
    expect(aceita.status).toBe(200);
    expect(congelado().totais).toEqual(
      gabarito(PISO, [carro("abatimento")]).totais,
    );
    expect(congelado().totais.financiado).toBe(LOTE - PISO - CARRO);
  });

  it("⚠️ o PDF que a rota gera carrega os bens, com o papel de cada um", async () => {
    // Sem isto o comprador recebe um papel que abate R$ 80.000 do saldo e não diz por quê.
    const r = await pedir({
      bensEPermutas: [carro("entrada")],
      entradaValor: PISO,
      valorNegociado: LOTE,
    });
    expect(r.status).toBe(200);

    const folha = estado.folhas.at(-1) as {
      bensEPermutas?: Array<Record<string, string>>;
      bensEPermutasTotal?: string;
    };
    expect(folha.bensEPermutas).toEqual([
      {
        comoEntra: "Entrada",
        descricao: "Ford Ka 2019 placa ABC1D23",
        tipo: "Bem",
        valor: "R$ 80.000,00",
      },
    ]);
    expect(folha.bensEPermutasTotal).toBe("R$ 80.000,00");
  });

  it("a prévia imprime os mesmos bens, antes de qualquer escrita", async () => {
    const r = await pedir({
      bensEPermutas: [carro("entrada")],
      entradaValor: PISO,
      previa: true,
      valorNegociado: LOTE,
    });
    expect(r.status).toBe(200);
    expect(estado.inserido).toHaveLength(0);
    expect(
      (estado.folhas.at(-1) as { bensEPermutasTotal?: string })
        .bensEPermutasTotal,
    ).toBe("R$ 80.000,00");
  });
});

// ── ⚠️ O CÓDIGO PODE IR AO AR ANTES DA 0187 ─────────────────────────────────
//
// Medido em produção em 22/09/2026: `select column_name from information_schema.columns where
// table_name='hercules_propostas' and column_name='bens_e_permutas'` devolve VAZIO. A migration
// está escrita e não aplicada — e aplicar exige OK do Lucas, a cada vez. Com o insert nomeando a
// coluna sem desvio, QUALQUER proposta (com ou sem permuta) morria em 503.
describe("⚠️ a proposta antes da migration 0187", () => {
  beforeEach(() => {
    estado.semAColunaDeBens = true;
  });

  it("sem permuta, grava SEM o campo e se comporta exatamente como hoje", async () => {
    const r = await pedir({});
    expect(r.status).toBe(200);
    expect("bens_e_permutas" in gravada()).toBe(false);
    // O resto da linha continua o de sempre — a proposta nasce inteira.
    expect(gravada()).toMatchObject({ contrato_parcelas: 120, etapa: "proposta" });
    expect(estado.avisados).toBe(1);
  });

  it("⚠️ COM permuta, recusa e não grava: o bem não pode sumir da linha que já o abateu", async () => {
    // Regravar sem a coluna deixaria a venda com o cronograma abatido em R$ 80.000 e sem uma linha
    // dizendo por quê — a Têmis imprimiria um contrato com desconto sem causa.
    const r = await pedir({
      bensEPermutas: [
        { descricao: "Ford Ka", entraComo: "entrada", tipo: "bem", valor: 80_000 },
      ],
      entradaValor: 20_000,
      valorNegociado: 200_000,
    });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe(
      "Esta proposta tem bens ou permutas, e o registro deles ainda não está disponível neste ambiente. Nada foi gravado.",
    );
    // UMA tentativa só: nenhuma regravação silenciosa sem o campo.
    expect(estado.inserido.filter((i) => i.tabela === "hercules_propostas")).toHaveLength(1);
    expect(estado.avisados).toBe(0);
  });

  it("com a coluna no lugar, a lista grava na PRIMEIRA tentativa", async () => {
    estado.semAColunaDeBens = false;
    const r = await pedir({
      bensEPermutas: [
        { descricao: "Ford Ka", entraComo: "entrada", tipo: "bem", valor: 80_000 },
      ],
      entradaValor: 20_000,
      valorNegociado: 200_000,
    });
    expect(r.status).toBe(200);
    expect(estado.inserido.filter((i) => i.tabela === "hercules_propostas")).toHaveLength(1);
    expect(bensGravados()).toHaveLength(1);
  });
});

// ── A PROPOSTA NASCIDA DE UMA RESERVA DE PESSOA JURÍDICA ──────────────────────
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ ESTA É A PONTA A PONTA QUE FALTAVA. As três mudanças de PJ desta rota não tinham teste nenhum:
// a leitura do documento do comprador na chave nova (`c.documento ?? c.cpf`), a chave `documento`
// dentro de `compradores`, e — a principal, porque é o que GRAVA — o namespace do
// `cliente_documento_hash`. Um `hashIdentifier("cpf", ...)` com um CNPJ dentro gera uma chave que
// JAMAIS casa com a CAD da empresa (o hash é `apolo-identifier:TIPO:valor`), e o contrato social
// anexado desaparece da ficha do cliente no CRM e na esteira, sem erro nenhum no log.
//
// MEDIDO em 26/09/2026 (produção, só SELECT): as 11 CADs de entidade `pj` da esteira têm
// identificador `cnpj` cujo `value_hash` é igual ao `document_hash` da entidade em 11 de 11 casos, e
// ZERO delas casa com um hash de namespace `cpf`.
//
// ⚠️ O QUE ESTE TESTE NÃO COBRE: o portão do credenciamento. `credenciadoParaVender` é DUBLÊ nos
// cinco arquivos de teste desta rota (aqui em :155), então nada do que se afirme sobre PJ aqui prova
// o portão real — ele é coberto em `lib/hercules/cliente-credenciado.test.ts`, com CNPJ e com
// documento sem dígito verificador.
describe("POST — titular pessoa jurídica", () => {
  const CNPJ = "12.345.678/0001-95";
  const CNPJ_DIGITOS = "12345678000195";

  beforeEach(() => {
    // A forma CANÔNICA que a rota da reserva grava para PJ: a chave `documento`, e NENHUMA `cpf`
    // (ver `proponenteParaGravar` em `venda/reserva/route.ts`).
    estado.reserva = {
      ...estado.reserva,
      proponentes: [
        {
          documento: CNPJ_DIGITOS,
          nome: "ACME CONSTRUTORA LTDA",
          telefone: "62991234567",
          tipoPessoa: "pj",
        },
      ],
    };
  });

  const pedirPj = () =>
    pedir({
      compradores: [
        {
          documento: CNPJ,
          nome: "ACME Construtora Ltda",
          participacao: 100,
          telefone: "62991234567",
        },
      ],
    });

  it("⚠️ grava cliente_documento com os 14 dígitos", async () => {
    const r = await pedirPj();
    expect(r.status).toBe(200);
    expect(gravada().cliente_documento).toBe(CNPJ_DIGITOS);
    expect(gravada().cliente_nome).toBe("ACME CONSTRUTORA LTDA");
  });

  it("⚠️ o item de compradores leva a chave `documento`, que é a forma da carga", async () => {
    // MEDIDO em 26/09/2026 (produção `bxgukywoxgivlrhjkwjx`, só SELECT): `hercules_propostas`
    // tem 5.027 itens de `compradores` com a chave `documento` contra 23 com SÓ a chave `cpf` (a
    // forma nativa antiga), e 136 linhas com `cliente_documento` de 14 dígitos contra 4.809 de 11.
    // Ou seja: `documento` é o vocabulário que a casa já usa justamente onde PJ existe.
    await pedirPj();
    const compradores = gravada().compradores as Array<Record<string, unknown>>;
    expect(compradores).toHaveLength(1);
    expect(compradores[0]).toMatchObject({
      documento: CNPJ_DIGITOS,
      participacao: 100,
      titular: true,
    });
  });

  it("⚠️ o hash do PDF sai no namespace CNPJ, e NÃO no de CPF", async () => {
    // É esta linha que grava `cliente_documento_hash` em `hercules_documentos`; errado, o papel da
    // venda não aparece na ficha da empresa, e nada no log diz por quê.
    await pedirPj();
    const doc = estado.inserido.find((i) => i.tabela === "hercules_documentos")?.linha ?? {};
    expect(doc.cliente_documento_hash).toBe(`hash:cnpj:${CNPJ_DIGITOS}`);
    expect(doc.cliente_documento_hash).not.toBe(`hash:cpf:${CNPJ_DIGITOS}`);
  });
});
