import { beforeEach, describe, expect, it, vi } from "vitest";

// A BUSCA DE PROPONENTES FORA DO COMERCIAL (revisão de 16/09/2026). A família do VOC (37) é 35 + 36
// + 37 + 41, e o 36 é a carteira do Lino: com a família inteira, o time do Cecílio varria prefixos de
// CPF e levava nome, CPF e etapa de qualquer comprador do Vale do Ouro. A rota é chamada de verdade,
// com o banco falso abaixo.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  permitidos: ["37", "39"] as string[],
  tipo: "incorporador" as "comercial" | "incorporador",
}));

const ESTEIRA: Linha[] = [
  // O cliente do próprio Cecílio, com CAD no VOC.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "37", entity_id: "e-voc", etapa: "credenciado" },
  // O cliente do Lino, com CAD no VOL.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "36", entity_id: "e-lino", etapa: "credenciado" },
  // O cliente com a CAD no espelho do pai (onde mora quase toda CAD do Vale do Ouro).
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "35", entity_id: "e-espelho", etapa: "credenciado" },
];

const ENTIDADES: Linha[] = [
  { display_name: "Ana do VOC", document_masked: "111.111.111-11", document_hash: null, id: "e-voc", legal_name: null, trade_name: null },
  { display_name: "Ana do Lino", document_masked: "222.222.222-22", document_hash: null, id: "e-lino", legal_name: null, trade_name: null },
  { display_name: "Ana do Espelho", document_masked: "333.333.333-33", document_hash: null, id: "e-espelho", legal_name: null, trade_name: null },
];

const IDENTIFICADORES: Linha[] = [
  { entity_id: "e-voc", value_hash: "hash:cpf:11111111111" },
  { entity_id: "e-lino", value_hash: "hash:cpf:22222222222" },
  { entity_id: "e-espelho", value_hash: "hash:cpf:33333333333" },
];

// (26/09/2026) Os contratos ativos da carteira (`hercules_propostas` com a unidade embutida) e a
// ligação usuário do C2X → entidade (`apolo_source_links`). O filtro com ponto percorre o embutido.
const CONTRATOS: Linha[] = [];
const FONTES: Linha[] = [];
const ESTEIRA_EXTRA: Linha[] = [];
const ENTIDADES_EXTRA: Linha[] = [];
const IDENTIFICADORES_EXTRA: Linha[] = [];

const valorDe = (linha: Linha, coluna: string): unknown =>
  coluna
    .split(".")
    .reduce<unknown>((atual, parte) => (atual && typeof atual === "object" ? (atual as Linha)[parte] : undefined), linha);

function clienteFalso() {
  const from = (tabela: string) => {
    const filtros: Array<(linha: Linha) => boolean> = [];
    const base = (): Linha[] => {
      if (tabela === "hercules_unidades") {
        return [
          { enterprise_id: "37", id: "u-voc", workspace_id: "careli" },
          // (26/09/2026) Uma unidade do Garden, que não tem pai: a família dele é só o 39.
          { enterprise_id: "39", id: "u-gdn", workspace_id: "careli" },
        ];
      }
      if (tabela === "apolo_esteira") return [...ESTEIRA, ...ESTEIRA_EXTRA];
      if (tabela === "apolo_entities") return [...ENTIDADES, ...ENTIDADES_EXTRA];
      if (tabela === "apolo_entity_identifiers") return [...IDENTIFICADORES, ...IDENTIFICADORES_EXTRA];
      if (tabela === "hercules_propostas") return CONTRATOS;
      if (tabela === "apolo_source_links") return FONTES;
      return [];
    };
    const resultado = () => ({ data: base().filter((l) => filtros.every((f) => f(l))), error: null });
    const cadeia = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(valorDe(l, coluna)));
        return cadeia;
      },
      is: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      order: () => cadeia,
      range: () => cadeia,
      limit: () => cadeia,
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      select: () => cadeia,
      then: (ok: (valor: ReturnType<typeof resultado>) => unknown) => Promise.resolve(resultado()).then(ok),
    };
    return cadeia;
  };
  return { from };
}

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => clienteFalso(),
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({
    ok: true,
    sessao: { slug: "cecilio-rocha", tipo: estado.tipo, usuarioId: "u", usuarioNome: "Maria" },
  }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  idsDaSessao: async () => estado.permitidos,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOL", "VOC", "VOR"], id: "group:Vale do Ouro", name: "Vale do Ouro", stageIds: ["36", "37", "41"] },
    { codes: ["VLO"], id: "35", name: "Vale do Ouro", stageIds: ["35"] },
    { codes: ["GDN"], id: "39", name: "Garden", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    { c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro", paiId: null },
    { c2xEnterpriseId: "36", codigo: "VOL", id: "vol", nome: "VOL", paiId: "vlo" },
    { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", paiId: "vlo" },
    { c2xEnterpriseId: "41", codigo: "VOR", id: "vor", nome: "VOR", paiId: "vlo" },
    { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", paiId: null },
  ],
}));

import { GET } from "./route";

async function buscar(q: string): Promise<string[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=u-voc&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  const corpo = (await resposta.json()) as { data: { encontrados: Array<{ nome: string }> } };
  return corpo.data.encontrados.map((p) => p.nome).sort();
}

beforeEach(() => {
  estado.permitidos = ["37", "39"];
  estado.tipo = "incorporador";
  CONTRATOS.length = 0;
  FONTES.length = 0;
  ESTEIRA_EXTRA.length = 0;
  ENTIDADES_EXTRA.length = 0;
  IDENTIFICADORES_EXTRA.length = 0;
});

describe("GET /api/incorporador/venda/proponentes fora do comercial", () => {
  it("⚠️ pelo nome, só quem tem CAD na família que a sessão alcança (nem o Lino, nem o espelho)", async () => {
    expect(await buscar("ana")).toEqual(["Ana do VOC"]);
  });

  it("⚠️ prefixo de CPF não abre a lista do Vale do Ouro", async () => {
    expect(await buscar("2222")).toEqual([]);
    expect(await buscar("3333")).toEqual([]);
  });

  it("o CPF INTEIRO acha o cliente cuja CAD mora no espelho do pai", async () => {
    expect(await buscar("333.333.333-33")).toEqual(["Ana do Espelho"]);
  });

  it("⚠️ nem com o CPF inteiro sai o cliente do irmão de outro dono (36)", async () => {
    expect(await buscar("22222222222")).toEqual([]);
  });
});

describe("GET /api/incorporador/venda/proponentes no comercial", () => {
  it("continua lendo a família inteira, como antes", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    expect(await buscar("ana")).toEqual(["Ana do Espelho", "Ana do Lino", "Ana do VOC"]);
  });
});

// ── O COMPRADOR DA CARTEIRA COMO CO-PROPONENTE (26/09/2026) ──────────────────
//
// A mesma régua do titular (`decidirPelasLinhas` com a compra): quem não tem CAD no escopo, mas é
// comprador de contrato ativo numa unidade da família, aparece como credenciado. E um recorte de
// privacidade MAIS FECHADO que o da esteira (revisão de 26/09/2026): o comprador da carteira só é
// alcançado pelo CPF INTEIRO, nunca por nome ou prefixo, e nunca no irmão de outro dono (36, o Lino).

const BIA = { cpf: "444.444.444-44", digitos: "44444444444", entidade: "e-bia", usuario: "9001" };

function contratoDaBia(parcial: Linha = {}): Linha {
  return {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    cliente_c2x_id: BIA.usuario,
    cliente_documento: BIA.cpf,
    cliente_entity_id: null,
    cliente_nome: "BIA DA CARTEIRA",
    codigo: "000501",
    compradores: [{ c2x_user_id: BIA.usuario, documento: BIA.cpf, nome: "BIA DA CARTEIRA", percentual: 100, titular: true }],
    etapa: "faturado",
    etapa_desde: "2024-05-01T12:00:00.000Z",
    id: "prop-bia",
    unidade: { codigo: "VOC0501", enterprise_id: "37", id: "u-501" },
    workspace_id: "careli",
    ...parcial,
  };
}

function comABia(contrato: Linha) {
  CONTRATOS.push(contrato);
  FONTES.push({ entity_id: BIA.entidade, source_id: BIA.usuario, source_system: "c2x", source_table: "users" });
  ENTIDADES_EXTRA.push({
    display_name: "Bia da Carteira",
    document_hash: null,
    document_masked: BIA.cpf,
    id: BIA.entidade,
    legal_name: null,
    trade_name: null,
  });
  IDENTIFICADORES_EXTRA.push({ entity_id: BIA.entidade, value_hash: `hash:cpf:${BIA.digitos}` });
}

type Achado = { credenciado: boolean; etapa: null | string; nome: string; origem?: null | string };

async function buscarTudo(q: string, unidade = "u-voc"): Promise<Achado[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=${unidade}&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as { data: { encontrados: Achado[] } }).data.encontrados;
}

describe("GET /api/incorporador/venda/proponentes: o comprador da carteira", () => {
  it("⚠️ sem CAD, com contrato ativo na família da sessão, o CPF inteiro o acha credenciado e marcado", async () => {
    comABia(contratoDaBia());
    for (const q of [BIA.cpf, BIA.digitos]) {
      expect(await buscarTudo(q)).toEqual([
        expect.objectContaining({ credenciado: true, nome: "Bia da Carteira", origem: "comprador_da_carteira" }),
      ]);
    }
  });

  it("⚠️ por NOME ou por PREFIXO de CPF o comprador sem CAD não aparece: não se enumera a carteira", async () => {
    comABia(contratoDaBia());
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect(await buscarTudo("4444444444")).toEqual([]);
  });

  it("⚠️ nem no comercial o nome ou o prefixo listam a carteira; o CPF inteiro, sim", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    comABia(contratoDaBia({ unidade: { codigo: "VOL0501", enterprise_id: "36", id: "u-36" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect((await buscarTudo(BIA.digitos)).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
  });

  it("⚠️ o contrato no irmão de outro dono (36) nunca aparece, nem com o CPF inteiro", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "VOL0501", enterprise_id: "36", id: "u-36" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("⚠️ o contrato no espelho do pai (35) só aparece com o CPF inteiro", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "VLO0501", enterprise_id: "35", id: "u-35" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect((await buscarTudo(BIA.cpf)).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
  });

  it("⚠️ comprador do Vale do Ouro buscado numa unidade do GARDEN (39): não aparece, nem com o CPF inteiro", async () => {
    // A sessão do Cecílio alcança o 37 e o 39. O Garden não tem pai: a família dele é só o 39, e o
    // contrato no VOC (37) não é prova para o Garden.
    comABia(contratoDaBia());
    expect(await buscarTudo(BIA.digitos, "u-gdn")).toEqual([]);
    expect(await buscarTudo(BIA.cpf, "u-gdn")).toEqual([]);
  });

  it("e o comprador do próprio Garden aparece no Garden pelo CPF inteiro (o recorte não está só vazio)", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "GDN0101", enterprise_id: "39", id: "u-39" } }));
    expect((await buscarTudo(BIA.digitos, "u-gdn")).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("o CO-COMPRADOR do contrato também aparece, pelo CPF inteiro", async () => {
    comABia(
      contratoDaBia({
        cliente_c2x_id: "9999",
        cliente_documento: "555.555.555-55",
        cliente_nome: "OUTRO TITULAR",
        compradores: [
          { c2x_user_id: "9999", documento: "555.555.555-55", nome: "OUTRO TITULAR", percentual: 50, titular: true },
          { c2x_user_id: BIA.usuario, documento: BIA.digitos, nome: "BIA DA CARTEIRA", percentual: 50, titular: false },
        ],
      }),
    );
    expect(await buscarTudo("bia")).toEqual([]);
    const achados = await buscarTudo(BIA.digitos);
    expect(achados.map((a) => [a.nome, a.credenciado, a.origem])).toEqual([
      ["Bia da Carteira", true, "comprador_da_carteira"],
    ]);
  });

  it("distrato não é contrato ativo: a pessoa sem CAD continua sem aparecer", async () => {
    comABia(contratoDaBia({ etapa: "distrato" }));
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("faturado com pedido de cancelamento em curso não é contrato ativo", async () => {
    comABia(contratoDaBia({ cancelamento_pedido_em: "2026-09-20T12:00:00.000Z" }));
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("⚠️ CAD em revisão numa entidade qualquer do CPF barra, como no titular", async () => {
    comABia(contratoDaBia());
    ENTIDADES_EXTRA.push({
      display_name: "Bia (Apolo)",
      document_hash: `hash:cpf:${BIA.digitos}`,
      document_masked: "***.444.444-**",
      id: "e-bia-apolo",
      legal_name: null,
      trade_name: null,
    });
    ESTEIRA_EXTRA.push({
      atualizado_em: "2026-09-11",
      chegou_em: null,
      created_at: "2026-09-01",
      enterprise_id: "37",
      entity_id: "e-bia-apolo",
      etapa: "revisao",
    });
    const daCarteira = (await buscarTudo(BIA.digitos)).find((a) => a.nome === "Bia da Carteira");
    expect(daCarteira?.credenciado).toBe(false);
    expect(daCarteira?.etapa).toBe("revisao");
  });
});
