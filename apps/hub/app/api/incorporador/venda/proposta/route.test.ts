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
  atualizado: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  credenciado: true,
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  reserva: {} as Record<string, unknown>,
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

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () => ({
    ok: true,
    sessao: { usuarioId: "user-1", usuarioNome: "Lucas Ruas" },
  }),
  idsDaSessao: async () => ["39"],
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [{ codes: ["JDG"], stageIds: ["39"] }],
}));

vi.mock("@/lib/apolo/incorporador/resumo-do-produto", () => ({
  comIdsDoGrupo: () => ["39"],
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    {
      c2xEnterpriseId: "39",
      cidade: "Aparecida de Goiânia",
      codigo: "JDG",
      id: "emp-1",
      nome: "Jardim das Gaivotas",
      ordem: 1,
      paiId: null,
      uf: "GO",
      vendendo: true,
    },
  ],
}));

vi.mock("@/lib/hercules/quem-pode-vender", () => ({ familiaDoEmpreendimento: () => ["39"] }));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [{ planos: [PLANO] }],
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

vi.mock("@/lib/hercules/avisos-da-venda", () => ({
  avisarSobreAVenda: async () => [{ ok: true, para: "imobiliaria" }],
  destinatariosDaVenda: async () => ({
    coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
    corretor: { nome: "João Souza", telefone: "62988887777" },
    imobiliaria: { nome: "GURGEL", telefone: "6232220000" },
  }),
}));

// O PDF de verdade é caro e não é o assunto deste teste — o insert acontece antes dele.
vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async () => new Uint8Array([1, 2, 3]),
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const feito: { insert: null | Record<string, unknown>; update: boolean } = {
      insert: null,
      update: false,
    };
    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(responder(tabela, feito)).then(aceitar, recusar),
    };
    for (const metodo of ["eq", "in", "limit", "maybeSingle", "order", "range", "select", "single"]) {
      alvo[metodo] = () => alvo;
    }
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
    feito: { insert: null | Record<string, unknown>; update: boolean },
  ) => {
    if (feito.insert) return { data: { id: "prop-1" }, error: null };
    if (feito.update) return { data: null, error: null };
    if (tabela === "hercules_unidades") return { data: UNIDADE, error: null };
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
  };
});

import { POST } from "@/app/api/incorporador/venda/proposta/route";

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

/** A linha que foi para `hercules_propostas`. */
const gravada = () => estado.inserido.find((i) => i.tabela === "hercules_propostas")?.linha ?? {};

beforeEach(() => {
  estado.atualizado = [];
  estado.credenciado = true;
  estado.inserido = [];
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
