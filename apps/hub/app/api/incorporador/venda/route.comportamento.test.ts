import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/incorporador/venda CHAMADA DE VERDADE — o que a Mesa recebe além do fluxo.
//
//   • `escritaPorEmpreendimento` (Lucas, 16/09/2026): no portal do Cecílio só o produto operado por
//     ele aceita escrita; o VOC (37, da Careli) é só consulta. A Gurgel escreve em tudo, como sempre.
//     Sem a 0170, ninguém fora do comercial escreve;
//   • a trava do LAB: sessão com o 31 não traz o LAB como produto "próprio" (onda 2, leitura [0]);
//   • a ressalva do plano chega à Mesa (onda 1, políticas);
//   • a grade pede as colunas do prédio e cai sem elas quando a 0171 não existe (onda 2, vertical);
//   • a grade pinta pela régua única da situação (Lucas, 18/09/2026: *"esses status tem que morar
//     em um so lugar"*), e falha nessa leitura não vira lote livre.
//
// Banco, catálogo e cookie são falsos; a agregação, a régua de escrita e a tradução do escopo são as
// de verdade.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  com0170: true,
  /** Faz a leitura da reserva do evento falhar: ela só é lida pela régua da situação. */
  falhaNaSituacao: false,
  /** `prometeu_reservas`: só a régua da situação a lê. */
  reservasDoEvento: [] as Array<Record<string, unknown>>,
  pedidos: [] as Array<{ codesAutorizados: string[]; proprios?: Array<{ codigo: string }> }>,
  permitidos: ["37", "39"] as string[],
  selectsDeUnidade: [] as string[],
  sem0171: false,
  sessao: {} as Record<string, unknown>,
  /** `hercules_propostas`: as vendas do escopo. */
  propostas: [] as Array<Record<string, unknown>>,
  /** `temis_trabalhos`: os cards de pedido abertos, por venda. `null` faz a leitura falhar. */
  cardsAbertos: [] as null | string[],
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Laboratório", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: null },
  { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", operadoPor: "inc-cecilio", paiId: null },
  { c2xEnterpriseId: "100001", codigo: "JAD", id: "jad", nome: "Ed. Jade", operadoPor: "inc-cecilio", paiId: null },
]);

const UNIDADES = vi.hoisted(() => [
  { categoria_id: null, codigo: "VOC1206", enterprise_id: "37", espelho_de: null, id: "u-voc", lote: "06", origem_c2x_id: 5001, preco_tabela: "100000.00", quadra: "12", situacao: "disponivel" },
  { categoria_id: null, codigo: "GDN0107", enterprise_id: "39", espelho_de: null, id: "u-gdn", lote: "07", origem_c2x_id: 5002, preco_tabela: "120000.00", quadra: "01", situacao: "disponivel" },
]);

const CECILIO = { incorporadorId: "inc-cecilio", slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL = { incorporadorId: "inc-gurgel", slug: "gurgel", tipo: "comercial" };

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/escopo")>()),
  codigosDaSessao: async () => ["VOC", "GDN"],
  idsDaSessao: async () => estado.permitidos,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC"], id: "37", name: "VOC", stageIds: ["37"] },
    { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: estado.com0170, linhas: CADASTRO }),
}));

vi.mock("@/lib/apolo/incorporador/codigos-do-pedido", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/codigos-do-pedido")>()),
  codigosDoPedido: async (entrada: { codesAutorizados: string[]; proprios?: Array<{ codigo: string }> }) => {
    estado.pedidos.push(entrada);
    return { codes: ["VOC", "GDN"], ok: true };
  },
}));

vi.mock("@/lib/apolo/incorporador/crm", () => ({
  lerEsteiraDoEscopo: async () => ({ ok: false }),
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }),
}));

vi.mock("@/lib/hercules/planos-do-panteon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/planos-do-panteon")>()),
  lerFaixasDoPanteon: async () => ({}),
  lerPlanosDoPanteon: async () => [
    {
      code: "",
      enterpriseId: "39",
      planos: [
        {
          categoriaId: null,
          enterpriseId: "39",
          entradaPercentual: 8,
          indiceCorrecao: "IPCA_ANUAL",
          jurosConvencao: "equivalente",
          jurosPeriodicidade: "anual",
          jurosTaxa: 6,
          nome: "Investidor Parcelado",
          parcelas: 84,
          ressalva: "válido para as próximas 16 unidades",
          sistemaAmortizacao: "sacoc",
          slot: "investidor",
        },
      ],
      tabelaDoEmpreendimento: null,
    },
  ],
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let colunas = "";
    const resposta = (): { data: unknown; error: null | { code: string; message: string } } => {
      if (tabela === "hercules_unidades") {
        if (estado.sem0171 && colunas.includes("torre")) {
          return { data: null, error: { code: "42703", message: "column hercules_unidades.torre does not exist" } };
        }
        return { data: UNIDADES, error: null };
      }
      if (tabela === "hercules_propostas") return { data: estado.propostas, error: null };
      if (tabela === "temis_trabalhos") {
        if (estado.cardsAbertos === null) return { data: null, error: { code: "57014", message: "tempo esgotado" } };
        return { data: estado.cardsAbertos.map((id) => ({ proposta_id: id })), error: null };
      }
      if (tabela === "prometeu_reservas") {
        if (estado.falhaNaSituacao) return { data: null, error: { code: "08006", message: "conexão caiu" } };
        return { data: estado.reservasDoEvento, error: null };
      }
      return { data: [], error: null };
    };
    const cadeia: Linha = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    // `not` entrou com a régua da situação, que lê as linhas antigas do terreno por `espelho_de`.
    for (const metodo of ["eq", "in", "not", "order", "range"]) cadeia[metodo] = () => cadeia;
    cadeia.select = (lista: string) => {
      colunas = lista;
      if (tabela === "hercules_unidades") estado.selectsDeUnidade.push(lista);
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { GET } from "./route";

type Resposta = {
  data: {
    escritaPorEmpreendimento: Record<string, boolean>;
    fluxo: Array<{ etapa: string; quantidade: number }>;
    mapa: Array<{ unidades: Array<{ etapa: string; id: string; situacao: string }> }>;
    planos: Array<{ nome: string; ressalva: null | string }>;
  };
};

async function carregar(): Promise<Resposta["data"]> {
  const resposta = await GET(new Request("https://c2x.app.br/api/incorporador/venda"));
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as Resposta).data;
}

beforeEach(() => {
  estado.com0170 = true;
  estado.falhaNaSituacao = false;
  estado.reservasDoEvento = [];
  estado.pedidos = [];
  estado.permitidos = ["37", "39"];
  estado.selectsDeUnidade = [];
  estado.sem0171 = false;
  estado.sessao = CECILIO;
  estado.propostas = [];
  estado.cardsAbertos = [];
});

describe("a marca do pedido de cancelamento que sobrou (18/09/2026)", () => {
  // VOL1106 e VOC0306: o pedido foi indeferido e a marca ficou. A tela lia a marca como pedido e
  // apagava "Solicitar cancelamento" para sempre.
  const venda = (id: string, unidade: string, codigo: string, etapa: string) => ({
    cancelamento_pedido_em: "2026-09-16T18:01:41.367Z",
    cliente_nome: "CLIENTE",
    codigo: null,
    empreendimento_codigo: codigo,
    etapa,
    etapa_desde: "2026-09-16T17:00:00.000Z",
    id,
    origem: "panteon",
    protocolo_numero: 19,
    unidade_id: unidade,
    valor: 100000,
  });
  type Linha = { cancelamentoPedidoEm: null | string; id: string };
  const marcaDe = async (id: string) =>
    ((await carregar()) as unknown as { lista: Linha[] }).lista.find((l) => l.id === id)?.cancelamentoPedidoEm;

  it("sem card de pedido aberto na Têmis, a marca antiga não chega à tela; com card, chega", async () => {
    estado.propostas = [venda("venda-orfa", "u-voc", "VOC", "contrato"), venda("venda-com-card", "u-gdn", "GDN", "assinatura")];
    estado.cardsAbertos = ["venda-com-card"];
    expect(await marcaDe("venda-orfa")).toBeNull();
    expect(await marcaDe("venda-com-card")).toBe("2026-09-16T18:01:41.367Z");
  });

  it("⚠️ leitura da Têmis que falha deixa a marca: o botão fica apagado, como antes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.propostas = [venda("venda-orfa", "u-voc", "VOC", "contrato")];
    estado.cardsAbertos = null;
    expect(await marcaDe("venda-orfa")).toBe("2026-09-16T18:01:41.367Z");
  });
});

describe("escritaPorEmpreendimento", () => {
  it("⚠️ Cecílio: o Garden (dele) escreve, o VOC (da Careli) é só consulta", async () => {
    expect((await carregar()).escritaPorEmpreendimento).toEqual({ "37": false, "39": true });
  });

  it("a Gurgel (comercial) escreve em tudo, como sempre", async () => {
    estado.sessao = GURGEL;
    expect((await carregar()).escritaPorEmpreendimento).toEqual({ "37": true, "39": true });
  });

  it("sem a 0170 não dá para provar quem opera: o Cecílio não escreve em nada", async () => {
    estado.com0170 = false;
    expect((await carregar()).escritaPorEmpreendimento).toEqual({ "37": false, "39": false });
  });
});

describe("a trava do LAB", () => {
  it("⚠️ sessão com o 31 não traz o LAB como próprio; o produto do Panteon continua", async () => {
    estado.permitidos = ["31", "37", "39", "100001"];
    await carregar();
    const pedido = estado.pedidos[0];
    expect(pedido?.proprios?.map((p) => p.codigo)).toEqual(["JAD"]);
    expect(pedido?.codesAutorizados).not.toContain("LAB");
  });
});

describe("os planos", () => {
  it("a ressalva do plano chega à Mesa junto do plano", async () => {
    const { planos } = await carregar();
    expect(planos).toHaveLength(1);
    expect(planos[0]).toMatchObject({ nome: "Investidor Parcelado", ressalva: "válido para as próximas 16 unidades" });
  });
});

describe("a grade do prédio", () => {
  it("pede as colunas do apartamento", async () => {
    await carregar();
    expect(estado.selectsDeUnidade[0]).toContain("apartamento");
    expect(estado.selectsDeUnidade[0]).toContain("torre");
  });

  it("⚠️ sem a 0171, repete sem as colunas e a grade continua inteira", async () => {
    estado.sem0171 = true;
    const { mapa } = await carregar();
    expect(estado.selectsDeUnidade[1]).not.toContain("torre");
    expect(mapa.flatMap((g) => g.unidades)).toHaveLength(2);
  });
});

describe("a situação na grade vem da régua única", () => {
  it("⚠️ lote reservado no EVENTO sai reservado na grade, e não disponível", async () => {
    // Cadastro `disponivel` e nenhuma proposta: a conta antiga da Venda pintava de verde. A régua
    // vê a reserva do evento pelo id do legado da unidade, igual ao que o Apolo vai mostrar.
    estado.reservasDoEvento = [{ situacao: "reservada", unidade_c2x_id: 5001 }];
    const { fluxo, mapa } = await carregar();
    const etapas = Object.fromEntries(mapa.flatMap((g) => g.unidades).map((u) => [u.id, u.etapa]));
    expect(etapas).toEqual({ "u-gdn": "disponivel", "u-voc": "reservado" });
    // ⚠️ A FAIXA INTEIRA ACOMPANHA A GRADE (Lucas, 21/09/2026). Antes só o passo `disponivel` vinha
    // da régua e o resto vinha das propostas, então o lote reservado no salão aparecia reservado na
    // grade e sumia da faixa. Era esse desencontro que fazia a tela do VOC mostrar "Reservado 0"
    // em cima e "Reservado 2" embaixo.
    expect(fluxo.find((f) => f.etapa === "disponivel")?.quantidade).toBe(1);
    expect(fluxo.find((f) => f.etapa === "reservado")?.quantidade).toBe(1);
  });

  it("⚠️ falha na leitura da situação responde 503, e nunca devolve lote livre", async () => {
    estado.falhaNaSituacao = true;
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resposta = await GET(new Request("https://c2x.app.br/api/incorporador/venda"));
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { data?: unknown; error?: string };
    expect(corpo.data).toBeUndefined();
    erro.mockRestore();
  });
});
